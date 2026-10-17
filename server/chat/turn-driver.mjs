import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { maskSecrets, toolDetails } from '../sources/claude-conversation.mjs';
import { turnArgs } from '../ai/clis.mjs';
import { talkCostUSD } from '../ai/providers.mjs';

// The talk of the page on OpenAI or Gemini (id171): their official programs run one turn per process (Codex `exec`, Gemini
// `-p`) and continue the same conversation by its id, so this driver starts one process per message and speaks to the hub
// in the very events of driver.mjs (session, text, thinking, tool, turn-end, exit). It also writes each turn, in Claude
// Code's own transcript lines, to the map's mirror of the conversation (smDir/chat-mirror/<id>.jsonl): the page reopens a
// conversation from a transcript, and these programs keep theirs where the page does not read.

const RESULT_MAX = 12_000;
export const mirrorPath = (smDir, sessionId) => join(smDir, 'chat-mirror', `${sessionId}.jsonl`);

// The tools of each program, named as the page names Claude Code's, so a step reads the same whoever took it.
const GEMINI_TOOLS = { read_file: 'Read', write_file: 'Write', replace: 'Edit', run_shell_command: 'Bash', glob: 'Glob', search_file_content: 'Grep', grep_search: 'Grep', list_directory: 'LS', web_fetch: 'WebFetch', google_web_search: 'WebSearch', read_many_files: 'Read' };
const geminiInput = (name, p = {}) => (name === 'run_shell_command' ? { command: p.command, description: p.description } : name === 'replace' ? { file_path: p.file_path, old_string: p.old_string, new_string: p.new_string } : name === 'write_file' ? { file_path: p.file_path, content: p.content } : p);
const cut = (s) => {
  const text = maskSecrets(String(s ?? ''));
  return text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}…` : text;
};

// One stdout line of Codex's `exec --json` -> the hub's events, and the usage of the turn when it ends.
export function translateCodex(msg, cwd = '') {
  const item = msg?.item ?? {};
  switch (msg?.type) {
    case 'thread.started': return [{ type: 'session', data: { sessionId: msg.thread_id } }];
    case 'item.started':
      if (item.type === 'command_execution') return [{ type: 'tool', data: { phase: 'use', id: item.id, name: 'Bash', ...toolDetails('Bash', { command: item.command }, cwd), raw: { command: item.command } } }];
      return [];
    case 'item.completed':
      if (item.type === 'agent_message' && item.text) return [{ type: 'text', data: { text: item.text, partial: false } }];
      if (item.type === 'reasoning' && item.text) return [{ type: 'thinking', data: { text: item.text } }];
      if (item.type === 'command_execution') return [{ type: 'tool', data: { phase: 'result', id: item.id, isError: Number.isFinite(item.exit_code) && item.exit_code !== 0, text: cut(item.aggregated_output) } }];
      if (item.type === 'file_change') {
        return (Array.isArray(item.changes) ? item.changes : []).flatMap((c, i) => [
          { type: 'tool', data: { phase: 'use', id: `${item.id}-${i}`, name: c.kind === 'add' ? 'Write' : 'Edit', ...toolDetails(c.kind === 'add' ? 'Write' : 'Edit', { file_path: c.path }, cwd), raw: { file_path: c.path } } },
          { type: 'tool', data: { phase: 'result', id: `${item.id}-${i}`, isError: item.status === 'failed', text: `${c.kind ?? 'update'} ${c.path ?? ''}` } },
        ]);
      }
      if (item.type === 'web_search') return [{ type: 'tool', data: { phase: 'use', id: item.id, name: 'WebSearch', ...toolDetails('WebSearch', { query: item.query }, cwd), raw: { query: item.query } } }];
      if (item.type === 'error' && item.message) return [{ type: 'text', data: { text: `⚠ ${item.message}`, partial: false } }];
      return [];
    default: return [];
  }
}

// One stdout line of Gemini's `-o stream-json` -> the hub's events.
export function translateGemini(msg, cwd = '') {
  switch (msg?.type) {
    case 'init': return [{ type: 'session', data: { sessionId: msg.session_id, model: typeof msg.model === 'string' ? msg.model : null } }];
    case 'message':
      if (msg.role !== 'assistant' || typeof msg.content !== 'string') return [];
      return [{ type: 'text', data: { text: msg.content, partial: Boolean(msg.delta) } }];
    case 'tool_use': {
      const name = GEMINI_TOOLS[msg.tool_name] ?? msg.tool_name;
      const raw = geminiInput(msg.tool_name, msg.parameters);
      return [{ type: 'tool', data: { phase: 'use', id: msg.tool_id, name, ...toolDetails(name, raw, cwd), raw } }];
    }
    case 'tool_result': return [{ type: 'tool', data: { phase: 'result', id: msg.tool_id, isError: msg.status !== 'success', text: cut(msg.output ?? msg.error?.message) } }];
    default: return [];
  }
}

// The tokens of a finished turn, per model, in Claude Code's modelUsage shape (for talkCostUSD and the mirror).
export function usageOf(provider, msg, model) {
  if (provider === 'openai' && msg?.type === 'turn.completed' && msg.usage) {
    const u = msg.usage;
    const cached = Number(u.cached_input_tokens) || 0;
    return { [model]: { inputTokens: Math.max(0, (Number(u.input_tokens) || 0) - cached), cacheReadInputTokens: cached, outputTokens: (Number(u.output_tokens) || 0) + (Number(u.reasoning_output_tokens) || 0) } };
  }
  if (provider === 'gemini' && msg?.type === 'result' && msg.stats?.models && typeof msg.stats.models === 'object') {
    const out = {};
    for (const [m, s] of Object.entries(msg.stats.models)) {
      const input = Number(s?.input_tokens ?? s?.tokens?.input ?? s?.tokens?.prompt) || 0;
      const cached = Number(s?.cached ?? s?.tokens?.cached) || 0;
      const total = Number(s?.total_tokens ?? s?.tokens?.total) || 0;
      const output = Math.max(Number(s?.output_tokens ?? s?.tokens?.candidates) || 0, total - input);
      out[m] = { inputTokens: Math.max(0, input - cached), cacheReadInputTokens: cached, outputTokens: output };
    }
    return out;
  }
  return null;
}

// startTurnDriver: the same face as driver.mjs's startDriver. script: the program's script (run with node); session: the
// conversation to continue, or null for a new one; stance: the program's words for the first turn of a new conversation
// (these programs take no system prompt on the command line).
export function startTurnDriver({ provider, script, cwd, env, onEvent, session = null, model, effort, mode = 'default', stance = '', smDir, spawner = spawn, platform = process.platform, run = execFile }) {
  let sessionId = session;
  let child = null;
  let ended = false;
  let exited = false;
  let costUSD = 0;
  let current = mode;
  const translate = provider === 'openai' ? translateCodex : translateGemini;

  const mirror = (entry) => {
    if (!smDir || !sessionId) return;
    try {
      mkdirSync(join(smDir, 'chat-mirror'), { recursive: true });
      appendFileSync(mirrorPath(smDir, sessionId), `${JSON.stringify({ ...entry, sessionId, timestamp: new Date().toISOString() })}\n`);
    } catch { /* the mirror is never worth the turn */ }
  };
  const exit = (code = 0) => {
    if (exited) return;
    exited = true;
    onEvent({ type: 'exit', data: { code, signal: null } });
  };

  function send(text) {
    if (child || ended) return false;
    const fresh = !sessionId;
    const newSession = fresh && provider === 'gemini' ? randomUUID() : null;
    const prompt = fresh && stance ? `${stance}\n\n${text}` : text;
    const args = turnArgs(provider, { session: sessionId, newSession, prompt, model, effort, mode: current });
    if (newSession) sessionId = newSession;
    const pending = [];
    const blocks = [];
    const toolResults = [];
    let usage = null;
    let failed = null;
    let partial = '';
    child = spawner(process.execPath, [script, ...args], { cwd, env: { ...env, SESSION_MAP_PAGE_CHAT: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.on('error', (err) => onEvent({ type: 'error', data: { error: 'spawn-failed', code: err.code ?? null } }));
    child.stderr?.resume();
    let announced = false;
    if (sessionId) {
      // The user's words go to the mirror once the conversation has its id (Codex names it in its first line).
      announced = true;
      onEvent({ type: 'session', data: { sessionId, mode: current, model } });
      mirror({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
    } else pending.push(text);
    createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg?.type === 'turn.failed' || msg?.type === 'error') failed = msg.error?.message ?? msg.message ?? 'failed';
      usage = usageOf(provider, msg, model) ?? usage;
      for (const evt of translate(msg, cwd)) {
        if (evt.type === 'session') {
          sessionId = evt.data.sessionId ?? sessionId;
          if (!announced) {
            announced = true;
            onEvent({ type: 'session', data: { sessionId, mode: current, model: evt.data.model ?? model } });
            for (const t of pending.splice(0)) mirror({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: t }] } });
          }
          continue;
        }
        if (evt.type === 'text' && evt.data.partial) partial += evt.data.text;
        if (evt.type === 'text' && !evt.data.partial) blocks.push({ type: 'text', text: evt.data.text });
        if (evt.type === 'thinking') blocks.push({ type: 'thinking', thinking: evt.data.text });
        if (evt.type === 'tool' && evt.data.phase === 'use') {
          blocks.push({ type: 'tool_use', id: evt.data.id, name: evt.data.name, input: evt.data.raw ?? {} });
          const { raw, ...data } = evt.data;
          onEvent({ ...evt, data });
          continue;
        }
        if (evt.type === 'tool' && evt.data.phase === 'result') toolResults.push({ type: 'tool_result', tool_use_id: evt.data.id, content: evt.data.text, is_error: evt.data.isError });
        onEvent(evt);
      }
    });
    child.on('close', (code) => {
      child = null;
      // Gemini streams the answer in pieces only: the whole of it is the text the page keeps.
      if (partial && !blocks.some((b) => b.type === 'text')) {
        blocks.push({ type: 'text', text: partial });
        onEvent({ type: 'text', data: { text: partial, partial: false } });
      }
      const turnUsd = usage ? talkCostUSD(provider, usage) : 0;
      costUSD = Math.round((costUSD + turnUsd) * 1e6) / 1e6;
      const tokens = usage ? Object.values(usage)[0] : null;
      if (blocks.length) {
        mirror({ type: 'assistant', message: { id: randomUUID(), role: 'assistant', model, content: blocks, ...(tokens ? { usage: { input_tokens: tokens.inputTokens, output_tokens: tokens.outputTokens, cache_read_input_tokens: tokens.cacheReadInputTokens ?? 0 } } : {}) } });
      }
      if (toolResults.length) mirror({ type: 'user', message: { role: 'user', content: toolResults } });
      const isError = Boolean(failed) || (code !== 0 && code !== null) || !announced;
      if (failed) onEvent({ type: 'text', data: { text: `⚠ ${String(failed).slice(0, 300)}`, partial: false } });
      onEvent({ type: 'turn-end', data: { subtype: isError ? 'error' : 'success', isError, sessionId, terminalReason: isError ? 'error' : 'completed', denials: 0, processCostUSD: costUSD } });
      if (ended) exit(0);
    });
    return true;
  }

  const kill = () => {
    if (!child) return;
    if (platform === 'win32' && child.pid) run('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }, (err) => { if (err) child?.kill(); });
    else child.kill();
  };

  return {
    send,
    interrupt: kill,
    setMode: (m) => { current = m; },
    end: () => {
      ended = true;
      if (!child) setImmediate(() => exit(0));
    },
    kill: () => {
      ended = true;
      if (child) kill();
      else setImmediate(() => exit(0));
    },
  };
}
