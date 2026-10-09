import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CHAT_MODES } from './mode.mjs';

const PREVIEW_MAX = 280;
export const PERMISSION_TOOL = 'mcp__sessionmap__approve';

export const preview = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
};

const resultText = (content) => (Array.isArray(content) ? content.map((c) => c?.text ?? '').join('') : content);

// Formats from .dev/prova/RESULTADO.md. The permission mode is always spelled out, and only from CHAT_MODES:
// a user setting or a crafted request cannot turn it into a bypass. run: the model flags of run.mjs (runArgs).
export function buildArgs({ mcpConfigPath, resume, mode = 'default', run = [] }) {
  return [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', CHAT_MODES.includes(mode) ? mode : 'default',
    '--mcp-config', mcpConfigPath, '--strict-mcp-config', '--permission-prompt-tool', PERMISSION_TOOL,
    ...run,
    ...(resume ? ['--resume', resume] : []),
  ];
}

// One stdout line of the CLI → the page events it stands for (hooks, rate limits and control replies stand for none).
export function translate(msg) {
  switch (msg?.type) {
    case 'system':
      return msg.subtype === 'init' && msg.session_id ? [{ type: 'session', data: { sessionId: msg.session_id, mode: msg.permissionMode, model: typeof msg.model === 'string' ? msg.model : null } }] : [];
    case 'stream_event': {
      const delta = msg.event?.type === 'content_block_delta' ? msg.event.delta : null;
      return delta?.type === 'text_delta' ? [{ type: 'text', data: { text: delta.text, partial: true } }] : [];
    }
    case 'assistant':
      return (msg.message?.content ?? []).flatMap((block) => {
        if (block.type === 'text' && block.text) return [{ type: 'text', data: { text: block.text, partial: false } }];
        if (block.type === 'tool_use') return [{ type: 'tool', data: { phase: 'use', id: block.id, name: block.name, input: preview(block.input) } }];
        return [];
      });
    case 'user':
      return (Array.isArray(msg.message?.content) ? msg.message.content : [])
        .filter((block) => block.type === 'tool_result')
        .map((block) => ({ type: 'tool', data: { phase: 'result', id: block.tool_use_id, isError: Boolean(block.is_error), text: preview(resultText(block.content)) } }));
    case 'result':
      return [{
        type: 'turn-end',
        data: { subtype: msg.subtype, isError: Boolean(msg.is_error), sessionId: msg.session_id, terminalReason: msg.terminal_reason, denials: msg.permission_denials?.length ?? 0,
          // What this process has spent so far: claude adds every turn of the process into it.
          processCostUSD: Number.isFinite(msg.total_cost_usd) ? msg.total_cost_usd : null },
      }];
    default:
      return [];
  }
}

// The CLI as a chat: one process, one line per message on stdin. onEvent gets translated events and
// {type: 'exit', data: {code, signal}} / {type: 'error', data: {error}} for the process itself.
export function startDriver({ bin, args, cwd, env, onEvent, spawner = spawn }) {
  const script = /\.(m?js|cjs)$/i.test(bin);
  const child = spawner(script ? process.execPath : bin, script ? [bin, ...args] : args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let requests = 0;
  child.on('error', (err) => onEvent({ type: 'error', data: { error: 'spawn-failed', code: err.code ?? null } }));
  child.on('exit', (code, signal) => onEvent({ type: 'exit', data: { code, signal } }));
  child.stdin.on('error', () => { /* the process is gone; 'exit' reports it */ });
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    for (const evt of translate(msg)) onEvent(evt);
  });
  const write = (msg) => child.stdin.writable && child.stdin.write(`${JSON.stringify(msg)}\n`);
  return {
    send: (text) => write({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' }),
    // SIGINT kills outright on Windows; this ends the turn and keeps the process for the next message.
    interrupt: () => write({ type: 'control_request', request_id: `req-${++requests}`, request: { subtype: 'interrupt' } }),
    // Takes effect from the next turn on; claude confirms it in the init line of that turn.
    setMode: (mode) => write({ type: 'control_request', request_id: `req-${++requests}`, request: { subtype: 'set_permission_mode', mode } }),
    end: () => child.stdin.end(),
    kill: () => child.kill(),
  };
}
