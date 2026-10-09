// Everything that depends on Claude Code's undocumented on-disk formats lives in this file.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { personsWords } from '../chat/prompt.mjs';
import { log } from '../log.mjs';

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CARD_RE = /```session-map[ \t]*\r?\n([\s\S]*?)```/g;
const GIT_COMMIT_RE = /\bgit\b[^\n;&|]*?\bcommit\b/;
const GIT_PUSH_RE = /\bgit\b[^\n;&|]*?\bpush\b/;
const COMMIT_LINE_RE = /^\[[^\]]*?\s([0-9a-f]{7,40})\]\s*(.+)$/m;
const PATH_RE = /(?<![\w:/.\\~-])(?:[A-Za-z]:[\\/]|\/(?=[^\s/]+\/))[^\s"'`<>|;&()*?]+/g;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const BULKY_INPUT_KEYS = new Set(['content', 'old_string', 'new_string', 'new_source']);
const HEAD_BYTES = 64 * 1024;
const PROMPT_MAX = 1000;
const TITLE_MAX = 80;
const MENTIONED_LINES = 200;
// The shape of an item code of the architecture convention (wa04, pa-x12, pf-lacuna2); only codes the map knows count later.
const ITEM_CODE_RE = /(?<![\w-])([a-z]{1,4}(?:-[a-z]{1,8})?\d{1,4})(?![\w-])/gi;
const CODES_MAX = 100;

export function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'read-failed', { path, code: err.code });
    return null;
  }
}

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') log('warn', 'list-failed', { dir, code: err.code });
    return [];
  }
}

// A line cut mid-write (the file is live) fails to parse and is simply skipped.
function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch { /* truncated or foreign line */ }
  }
  return out;
}

function isAliveDefault(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function listLiveSessions(dir, { isAlive = isAliveDefault } = {}) {
  const sessions = [];
  for (const file of listDir(join(dir, 'sessions'))) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue;
    const text = readText(join(dir, 'sessions', file.name));
    let raw;
    try { raw = JSON.parse(text); } catch { continue; }
    if (!Number.isInteger(raw?.pid) || typeof raw.sessionId !== 'string') continue;
    const str = (v) => (typeof v === 'string' ? v : '');
    sessions.push({
      pid: raw.pid,
      sessionId: raw.sessionId,
      cwd: str(raw.cwd),
      name: str(raw.name),
      status: raw.status === 'busy' ? 'busy' : 'idle',
      entrypoint: str(raw.entrypoint),
      kind: str(raw.kind),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
      bridgeSessionId: typeof raw.bridgeSessionId === 'string' ? raw.bridgeSessionId : null,
      alive: isAlive(raw.pid),
    });
  }
  return sessions;
}

export function listTranscripts(dir, { sinceMs = 0 } = {}) {
  const refs = [];
  for (const proj of listDir(join(dir, 'projects'))) {
    if (!proj.isDirectory()) continue;
    const projectDir = proj.name;
    for (const file of listDir(join(dir, 'projects', projectDir))) {
      const sessionId = file.name.slice(0, -'.jsonl'.length);
      if (!file.isFile() || !file.name.endsWith('.jsonl') || !UUID_RE.test(sessionId)) continue;
      const path = join(dir, 'projects', projectDir, file.name);
      try {
        const st = statSync(path);
        if (st.mtimeMs >= sinceMs) refs.push({ sessionId, projectDir, path, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* vanished between listing and stat */ }
    }
  }
  return refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ---- content helpers -------------------------------------------------------

const blocksOf = (entry) => {
  const content = entry.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : [];
};

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
}

// Injected blocks (<system-reminder>, <ide_…>) start with "<"; real prompts do not.
function humanPromptOf(entry) {
  if (entry.type !== 'user' || (entry.origin && entry.origin.kind !== 'human')) return null;
  const blocks = blocksOf(entry);
  if (blocks.some((b) => b.type === 'tool_result')) return null;
  const parts = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text.trim()).filter((t) => t && !t.startsWith('<'));
  return parts.length ? parts.join('\n') : null;
}

function usageRowOf(entry, fallbackId) {
  const msg = entry.message;
  const u = msg?.usage;
  if (entry.type !== 'assistant' || !u || msg.model === '<synthetic>') return null;
  const hasSplit = u.cache_creation && typeof u.cache_creation === 'object';
  return {
    messageId: msg.id ?? entry.uuid ?? fallbackId,
    model: msg.model ?? 'unknown',
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite5m: hasSplit ? u.cache_creation.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0,
    cacheWrite1h: hasSplit ? u.cache_creation.ephemeral_1h_input_tokens ?? 0 : 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    ts: entry.timestamp ?? null,
  };
}

// Repeated lines of one message.id carry the same (growing) usage: the last one wins.
function addUsage(byId, row) {
  byId.delete(row.messageId);
  byId.set(row.messageId, row);
}

function cardsIn(entry) {
  if (entry.type !== 'assistant') return [];
  const found = [];
  for (const b of blocksOf(entry)) {
    if (b.type !== 'text' || typeof b.text !== 'string') continue;
    for (const m of b.text.matchAll(CARD_RE)) found.push(m[1].trim());
  }
  return found;
}

function* stringsIn(value, depth = 0) {
  if (typeof value === 'string') yield value;
  else if (value && typeof value === 'object' && depth < 4) {
    for (const [key, v] of Object.entries(value)) if (!BULKY_INPUT_KEYS.has(key)) yield* stringsIn(v, depth + 1);
  }
}

function pathsMentioned(entries) {
  const found = new Set();
  for (const entry of entries) {
    if (entry.type !== 'assistant') continue;
    for (const b of blocksOf(entry)) {
      if (b.type !== 'tool_use') continue;
      for (const s of stringsIn(b.input)) {
        for (const m of s.matchAll(PATH_RE)) found.add(m[0].replace(/[.,:]+$/, ''));
      }
    }
  }
  return [...found];
}

function commitMessageOf(command) {
  const m = command.match(/(?:-m|--message)[ =]+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
  if (!m) return null;
  const raw = (m[1] ?? m[2]).trim();
  const lines = raw.split('\n').map((l) => l.trim());
  // -m "$(cat <<'EOF' ... )": the subject is the first line after the heredoc opener.
  const subject = raw.startsWith('$(cat <<') ? lines.slice(1).find(Boolean) : lines[0];
  return subject || null;
}

function pushBranchOf(command, output, fallback) {
  const arrows = [...output.matchAll(/->\s*(\S+)/g)];
  if (arrows.length) return arrows.at(-1)[1];
  const args = command.split(/\bpush\b/)[1]?.split(/[\s;&|]/).filter((a) => a && !a.startsWith('-')) ?? [];
  const ref = args[1]?.replace(/^\+/, '');
  return ref ? ref.split(':').at(-1) : fallback;
}

// ---- live steps: what a conversation is doing right now --------------------------------------

const STEPS_MAX = 5;
const STEP_MAX = 80;
const STEP_KIND = {
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Read: 'read', Bash: 'run', PowerShell: 'run',
  Grep: 'search', Glob: 'search', WebFetch: 'web', WebSearch: 'web', Task: 'agent', Agent: 'agent', Workflow: 'agent',
  TodoWrite: 'plan', Skill: 'skill',
};
const SECRET_RES = [
  [/\b(bearer|basic)\s+[^\s"']+/gi, '$1 …'],
  [/\b((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[=:]\s*)[^\s"'&]+/gi, '$1…'],
  [/(?=[A-Za-z_\-+/]*\d)(?=[\d_\-+/]*[A-Za-z])[A-Za-z0-9_\-+/]{32,}={0,2}/g, '…'],
];

const cutEnd = (s) => (s.length > STEP_MAX ? `${s.slice(0, STEP_MAX - 1)}…` : s);
const cutStart = (s) => (s.length > STEP_MAX ? `…${s.slice(s.length - STEP_MAX + 1)}` : s);

function relativeTo(cwd, path) {
  const p = String(path).replaceAll('\\', '/');
  const base = String(cwd ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
  return base && p.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? p.slice(base.length + 1) : p;
}

// A command's first line, without what looks like a secret: the step is shown on a page other people may see.
function commandWords(command) {
  let line = String(command).split('\n')[0].trim();
  for (const [re, to] of SECRET_RES) line = line.replace(re, to);
  return line;
}

function stepOf(tool, cwd, answered) {
  const input = tool.input ?? {};
  if (tool.name === 'AskUserQuestion') return answered ? null : { kind: 'ask', target: '' };
  const kind = STEP_KIND[tool.name] ?? 'tool';
  if (kind === 'edit' || kind === 'read') return { kind, target: cutStart(relativeTo(cwd, input.file_path ?? input.notebook_path ?? '')) };
  if (kind === 'run') return { kind, target: cutEnd(typeof input.description === 'string' && input.description.trim() ? input.description.trim() : commandWords(input.command ?? '')) };
  if (kind === 'search') return { kind, target: cutEnd(String(input.pattern ?? '')) };
  if (kind === 'web') {
    let host = '';
    try { host = new URL(input.url).hostname; } catch { /* a search, not a page */ }
    return { kind, target: cutEnd(host || String(input.query ?? '')) };
  }
  if (kind === 'agent') return { kind, target: cutEnd(String(input.description ?? input.name ?? '')) };
  if (kind === 'skill') return { kind, target: cutEnd(String(input.skill ?? '')) };
  if (kind === 'plan') return { kind, target: '' };
  return { kind, target: cutEnd(String(tool.name).split('__').pop()) };
}

// The last steps of a transcript tail, in words the page translates: tool steps (never their contents or output), a
// question still waiting for the person, and "thinking" when the person's prompt is the last thing written.
export function liveStepsOf(entries, cwd) {
  const answered = new Set();
  for (const entry of entries) {
    if (entry.type === 'user') for (const b of blocksOf(entry)) if (b.type === 'tool_result') answered.add(b.tool_use_id);
  }
  const steps = [];
  let promptLast = null;
  for (const entry of entries) {
    if (humanPromptOf(entry)) { promptLast = entry.timestamp ?? null; continue; }
    if (entry.type !== 'assistant') continue;
    promptLast = null;
    for (const b of blocksOf(entry)) {
      if (b.type !== 'tool_use') continue;
      const step = stepOf(b, cwd, answered.has(b.id));
      if (step) steps.push({ ...step, ts: entry.timestamp ?? null });
    }
  }
  if (promptLast !== null) steps.push({ kind: 'think', target: '', ts: promptLast });
  return steps.slice(-STEPS_MAX);
}

// ---- transcript summary ----------------------------------------------------

function summarize(entries, sessionId) {
  let cwd = '';
  let gitBranch = '';
  let entrypoint = '';
  let aiTitle = null;
  let lastPromptLine = null;
  let lastAssistantText = '';
  let lastCardText = null;
  let startedAt = null;
  let endedAt = null;
  let turnStartedAt = null;
  const userPrompts = [];
  const usageById = new Map();
  const toolUses = [];
  const results = new Map();
  const codes = new Map();
  const noteCodes = (text) => {
    for (const m of text.matchAll(ITEM_CODE_RE)) {
      const code = m[1].toLowerCase();
      const n = (codes.get(code) ?? 0) + 1;
      codes.delete(code);
      codes.set(code, n);
    }
  };

  entries.forEach((entry, i) => {
    if (typeof entry.cwd === 'string') cwd = entry.cwd;
    if (typeof entry.gitBranch === 'string') gitBranch = entry.gitBranch;
    if (!entrypoint && typeof entry.entrypoint === 'string') entrypoint = entry.entrypoint;
    if (typeof entry.timestamp === 'string') {
      startedAt ??= entry.timestamp;
      endedAt = entry.timestamp;
    }
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') aiTitle = entry.aiTitle;
    if (entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string') lastPromptLine = entry.lastPrompt;

    const prompt = humanPromptOf(entry);
    // A chat the page started opens with a context block: the person's own words are what names it.
    if (prompt) {
      turnStartedAt = entry.timestamp ?? turnStartedAt;
      userPrompts.push(personsWords(prompt).slice(0, PROMPT_MAX));
      noteCodes(prompt);
    }

    if (entry.type === 'assistant') {
      const row = usageRowOf(entry, `line-${i}`);
      if (row) addUsage(usageById, row);
      const text = textOf(blocksOf(entry).filter((b) => b.type === 'text'));
      if (text) {
        lastAssistantText = text;
        noteCodes(text);
      }
      for (const card of cardsIn(entry)) lastCardText = card;
      for (const b of blocksOf(entry)) {
        if (b.type === 'tool_use') toolUses.push({ id: b.id, name: b.name, input: b.input ?? {}, ts: entry.timestamp ?? null, gitBranch });
      }
    } else if (entry.type === 'user') {
      for (const b of blocksOf(entry)) {
        if (b.type === 'tool_result') results.set(b.tool_use_id, { text: textOf(b.content), isError: b.is_error === true, ts: entry.timestamp ?? null });
      }
    }
  });

  const editedFiles = [...new Set(toolUses.filter((t) => EDIT_TOOLS.has(t.name)).map((t) => t.input.file_path ?? t.input.notebook_path).filter((p) => typeof p === 'string'))];
  const lastTool = toolUses.at(-1);
  const bash = toolUses.filter((t) => t.name === 'Bash' && typeof t.input.command === 'string');

  const commits = [];
  for (const t of bash.filter((b) => GIT_COMMIT_RE.test(b.input.command))) {
    const res = results.get(t.id);
    if (res?.isError) continue;
    const fromOutput = res?.text.match(COMMIT_LINE_RE);
    if (fromOutput) commits.push({ hash: fromOutput[1], subject: fromOutput[2].trim() });
    else {
      const subject = commitMessageOf(t.input.command);
      if (subject) commits.push({ hash: '', subject });
    }
  }

  const pushes = [];
  for (const t of bash.filter((b) => GIT_PUSH_RE.test(b.input.command))) {
    const res = results.get(t.id);
    if (!res || res.isError || /\berror:|fatal:|\[(remote )?rejected\]|Everything up-to-date/i.test(res.text)) continue;
    pushes.push({ branch: pushBranchOf(t.input.command, res.text, t.gitBranch), ts: res.ts ?? t.ts });
  }

  return {
    sessionId,
    cwd,
    gitBranch,
    entrypoint,
    aiTitle,
    title: aiTitle ?? (userPrompts[0] ?? '').slice(0, TITLE_MAX),
    lastPrompt: lastPromptLine ?? userPrompts.at(-1) ?? '',
    userPrompts,
    lastAssistantText,
    turnStartedAt,
    pendingQuestion: lastTool?.name === 'AskUserQuestion' && !results.has(lastTool.id),
    liveSteps: liveStepsOf(entries, cwd),
    editedFiles,
    commits,
    pushes,
    mentionedPaths: pathsMentioned(entries.slice(-MENTIONED_LINES)),
    mentionedCodes: [...codes].slice(-CODES_MAX).map(([code, n]) => ({ code, n })),
    startedAt,
    endedAt,
    usage: [...usageById.values()],
    lastCardText,
  };
}

function readSlice(path, position, length) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, position);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

// Splits on the newline byte, so a UTF-8 character cut by a chunk edge is joined back before decoding.
// One string per line, never per file: a transcript can outgrow the longest string V8 allows (~512 MB).
export function forEachLine(path, fn, { chunkBytes = 8 * 1024 * 1024 } = {}) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(chunkBytes);
    let rest = Buffer.alloc(0);
    let index = 0;
    for (let n; (n = readSync(fd, buf, 0, chunkBytes, null)) > 0;) {
      let data = Buffer.concat([rest, buf.subarray(0, n)]);
      for (let nl; (nl = data.indexOf(10)) !== -1; data = data.subarray(nl + 1)) fn(data.toString('utf8', 0, nl), index++);
      rest = Buffer.from(data);
    }
    if (rest.length) fn(rest.toString('utf8'), index);
  } finally {
    closeSync(fd);
  }
}

// Whole-file pass for what the tail cannot tell: full usage, an older card, the title.
// Only lines that can matter are parsed; cached per file version because the page polls.
const fullScanCache = new Map();
function fullScan(path, st) {
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = fullScanCache.get(path);
  if (hit?.key === key) return hit.value;
  const usageById = new Map();
  let lastCardText = null;
  let aiTitle = null;
  forEachLine(path, (line, i) => {
    if (!line.includes('"usage"') && !line.includes('session-map') && !line.includes('"ai-title"')) return;
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    const row = usageRowOf(entry, `line-${i}`);
    if (row) addUsage(usageById, row);
    for (const card of cardsIn(entry)) lastCardText = card;
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') aiTitle = entry.aiTitle;
  });
  const value = { usage: [...usageById.values()], lastCardText, aiTitle };
  fullScanCache.set(path, { key, value });
  return value;
}

// A file can vanish (cleanupPeriodDays) or outgrow one string between stat and scan: that chat is skipped.
export function readTranscript(path, { tailBytes = 2_000_000 } = {}) {
  try {
    const st = statSync(path);
    const truncated = st.size > tailBytes;
    let text = truncated ? readSlice(path, st.size - tailBytes, tailBytes) : readFileSync(path, 'utf8');
    // The slice starts mid-line: drop that first fragment.
    if (truncated) text = text.slice(text.indexOf('\n') + 1);
    const summary = summarize(parseLines(text), basename(path, '.jsonl'));
    if (truncated) {
      const full = fullScan(path, st);
      const head = summarize(parseLines(readSlice(path, 0, HEAD_BYTES).replace(/\n[^\n]*$/, '')), summary.sessionId);
      summary.usage = full.usage;
      summary.lastCardText ??= full.lastCardText;
      summary.startedAt = head.startedAt ?? summary.startedAt;
      summary.aiTitle ??= full.aiTitle;
      summary.title = summary.aiTitle ?? head.title ?? summary.title;
    }
    delete summary.aiTitle;
    return summary;
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'read-failed', { path, code: err.code, error: err.message });
    return null;
  }
}

// ---- helpers (subagents) and workflows --------------------------------------

function helperFiles(sessionDir) {
  const base = join(sessionDir, 'subagents');
  const files = listDir(base).filter((f) => f.isFile() && /^agent-.*\.jsonl$/.test(f.name)).map((f) => join(base, f.name));
  for (const wf of listDir(join(base, 'workflows'))) {
    if (!wf.isDirectory()) continue;
    const dir = join(base, 'workflows', wf.name);
    for (const f of listDir(dir)) if (f.isFile() && /^agent-.*\.jsonl$/.test(f.name)) files.push(join(dir, f.name));
  }
  return files;
}

export function readHelperUsage(sessionDir) {
  const usageById = new Map();
  for (const file of helperFiles(sessionDir)) {
    const text = readText(file);
    if (text === null) continue;
    parseLines(text).forEach((entry, i) => {
      const row = usageRowOf(entry, `${basename(file)}-${i}`);
      if (row) addUsage(usageById, row);
    });
  }
  return [...usageById.values()];
}

// Workflow agents commit from their own transcripts; those commits belong to the chat that started them.
export function readHelperCommits(sessionDir) {
  const commits = [];
  for (const file of helperFiles(sessionDir)) {
    const text = readText(file);
    if (text !== null) commits.push(...summarize(parseLines(text), basename(file, '.jsonl')).commits);
  }
  return commits;
}

// The model a workflow agent runs on, from its meta file ('opus', 'sonnet'...); none when it inherits the conversation's.
function agentModel(dir, agentId) {
  if (typeof agentId !== 'string' || !/^[\w-]+$/.test(agentId)) return null;
  try {
    const meta = JSON.parse(readText(join(dir, `agent-${agentId}.meta.json`)));
    return typeof meta?.model === 'string' && meta.model ? meta.model : null;
  } catch {
    return null;
  }
}

// When a workflow agent last wrote to its own transcript: a killed workflow leaves agents with no result behind forever.
function agentMovedAt(dir, agentId) {
  if (typeof agentId !== 'string' || !/^[\w-]+$/.test(agentId)) return null;
  try {
    return statSync(join(dir, `agent-${agentId}.jsonl`)).mtimeMs;
  } catch {
    return null;
  }
}

export function readWorkflows(sessionDir) {
  const workflows = [];
  const scripts = listDir(join(sessionDir, 'workflows', 'scripts')).map((f) => f.name);
  for (const wf of listDir(join(sessionDir, 'subagents', 'workflows'))) {
    if (!wf.isDirectory()) continue;
    const journalPath = join(sessionDir, 'subagents', 'workflows', wf.name, 'journal.jsonl');
    const text = readText(journalPath);
    if (text === null) continue;
    let mtimeMs;
    try { mtimeMs = statSync(journalPath).mtimeMs; } catch { continue; }
    const events = parseLines(text);
    const started = events.filter((e) => e.type === 'started');
    // The meta file is written when the run ends; while it runs, the script's file name ("<name>-<id>.js") holds the name.
    const suffix = `-${wf.name}.js`;
    let name = scripts.find((f) => f.endsWith(suffix))?.slice(0, -suffix.length) || wf.name;
    try {
      const meta = JSON.parse(readText(join(sessionDir, 'workflows', `${wf.name}.json`)));
      const named = [meta?.workflowName, meta?.name].find((n) => typeof n === 'string' && n);
      if (named) name = named;
    } catch { /* no meta file yet */ }
    const answered = new Set(events.filter((e) => e.type === 'result').map((e) => e.agentId));
    workflows.push({
      id: wf.name,
      name,
      started: new Set(started.map((e) => e.agentId)).size,
      done: answered.size,
      lastLabel: started.at(-1)?.label ?? null,
      running: started.filter((e) => !answered.has(e.agentId)).map((e) => {
        const dir = join(sessionDir, 'subagents', 'workflows', wf.name);
        return { label: e.label ?? null, model: agentModel(dir, e.agentId), activeAt: new Date(agentMovedAt(dir, e.agentId) ?? mtimeMs).toISOString() };
      }),
      updatedAt: new Date(mtimeMs).toISOString(),
    });
  }
  return workflows;
}

// ---- whole conversation, for the archive ------------------------------------

function toolLine(block) {
  const input = block.input ?? {};
  const detail = input.file_path ?? input.notebook_path ?? input.command ?? input.pattern ?? input.description ?? '';
  const oneLine = String(detail).split('\n')[0].slice(0, 120);
  return oneLine ? `[${block.name} ${oneLine}]` : `[${block.name}]`;
}

// Accepts a plain .jsonl or the gzip copy the archive keeps. Tools become one-line markers;
// consecutive assistant lines merge into one message.
export function readFullTranscript(path) {
  let raw;
  try {
    raw = readFileSync(path);
    if (path.endsWith('.gz')) raw = gunzipSync(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'read-failed', { path, code: err.code });
    return [];
  }
  const messages = [];
  for (const entry of parseLines(raw.toString('utf8'))) {
    let role;
    let text;
    if (entry.type === 'assistant') {
      role = 'assistant';
      text = blocksOf(entry).map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? toolLine(b) : '')).filter(Boolean).join('\n');
    } else {
      text = humanPromptOf(entry);
      role = 'user';
    }
    if (!text) continue;
    const prev = messages.at(-1);
    if (role === 'assistant' && prev?.role === 'assistant') prev.text += `\n${text}`;
    else messages.push({ role, text, ts: entry.timestamp ?? null });
  }
  return messages;
}
