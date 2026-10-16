// Everything that depends on the DeepSeek Harness on-disk formats lives in this file: the zstd-framed session log
// (~/.dsh/sessions/<project>/<session-id>/session.v4.jsonl.zstd) and the workspace registry (~/.dsh/storages/workspace.json).
// It mirrors the public surface of claude.mjs so the rest of session-map treats DeepSeek conversations like Claude ones:
// listSessions -> refs, readSummary -> the same summary shape, readConversation -> {items, costUSD, version}.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
// zstd arrived in Node 22.15: a namespace import, because a named one stops the whole program from loading on Node 20.
const zstdDecompressSync = zlib.zstdDecompressSync;
import { log } from '../log.mjs';
import { costOf as providersCostOf, providerOf } from '../ai/providers.mjs';
import { costOf, windowed } from '../cost.mjs';

const SESSION_ID_RE = /^session-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Both engines' checked session ids (a Claude UUID or a DeepSeek 'session-<uuid>'): the map moves, opens and lists them alike.
export const isAnySessionId = (id) => typeof id === 'string' && (UUID_RE.test(id) || SESSION_ID_RE.test(id));
const CARD_RE = /```session-map[ \t]*\r?\n([\s\S]*?)```/g;
const GIT_COMMIT_RE = /\bgit\b[^\n;&|]*?\bcommit\b/;
const GIT_PUSH_RE = /\bgit\b[^\n;&|]*?\bpush\b/;
const COMMIT_LINE_RE = /^\[[^\]]*?\s([0-9a-f]{7,40})\]\s*(.+)$/m;
const PATH_RE = /(?<![\w:/.\\~-])(?:[A-Za-z]:[\\/]|\/(?=[^\s/]+\/))[^\s"'`<>|;&()*?]+/g;
const EDIT_TOOLS = new Set(['edit', 'write']);
const RUN_TOOLS = new Set(['pwsh', 'bash']);
const SEARCH_TOOLS = new Set(['grep', 'glob']);
const WEB_TOOLS = new Set(['web_search', 'web_fetch']);
const AGENT_TOOLS = new Set(['subagent', 'task', 'spawn_teammate']);
const QUESTION_TOOL = 'ask_user_question';
const ITEM_CODE_RE = /(?<![\w-])([a-z]{1,4}(?:-[a-z]{1,8})?\d{1,4})(?![\w-])/gi;
const CODES_MAX = 100;
const TITLE_MAX = 80;
const STEPS_MAX = 5;
const STEP_MAX = 80;
const RESULT_MAX = 40_000;
const MENTIONED_LINES = 200;
// A session whose turn is open and whose file was written recently counts as working (the DSH writes nothing like
// Claude's sessions/<pid>.json, so liveness is inferred from the log itself).
const BUSY_MS = 30 * 60_000;

// Node exposes Zstandard only from 22.15 on; older Nodes simply skip DeepSeek sessions.
export const zstdAvailable = () => typeof zstdDecompressSync === 'function';

export function dshDir() {
  return process.env.DSH_DIR || join(homedir(), '.dsh');
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'deepseek-read-failed', { path, code: err.code });
    return null;
  }
}

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ---- zstd container ---------------------------------------------------------

const ZSTD_MAGIC = 4247762216; // 0xFD2FB528, little-endian

// One checksummed frame holds the header line, then one frame per append batch; a torn final frame is dropped.
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

// The header object and every durable event, in order. A line cut mid-write is skipped like claude.mjs skips torn lines.
function decodeEvents(path) {
  const raw = readFileSync(path);
  const { frames } = scanFrames(raw);
  const events = [];
  let header = null;
  for (const { start, end } of frames) {
    let text;
    try {
      text = zstdDecompressSync(raw.subarray(start, end)).toString('utf8');
    } catch (err) {
      log('warn', 'deepseek-frame-failed', { path, at: start, error: err.message });
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object') {
          if (obj.type === 'session') header = obj;
          else events.push(obj);
        }
      } catch { /* truncated line */ }
    }
  }
  return { header, events };
}

// ---- content helpers --------------------------------------------------------

const blocksOf = (entry) => {
  const content = entry.data?.content ?? entry.data?.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : [];
};

const textOf = (blocks) => blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).filter(Boolean).join('\n');

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

const cutEnd = (s) => (s.length > STEP_MAX ? `${s.slice(0, STEP_MAX - 1)}…` : s);
const cutStart = (s) => (s.length > STEP_MAX ? `…${s.slice(s.length - STEP_MAX + 1)}` : s);

// The person's own words: user/message rows carry source.kind 'user' for them; every other kind
// ('user-approval', 'runtime-context', 'skill-catalog', 'tool-jobs', 'time-context') is an injection.
function humanPromptOf(entry) {
  if (entry.type !== 'user/message' || entry.data?.source?.kind !== 'user') return null;
  const text = textOf(blocksOf(entry)).trim();
  return text && !text.startsWith('<') ? text : null;
}

function cardsIn(text) {
  const found = [];
  for (const m of text.matchAll(CARD_RE)) found.push(m[1].trim());
  return found;
}

const STEP_KIND = {
  edit: 'edit', write: 'edit', read: 'read',
  pwsh: 'run', bash: 'run',
  grep: 'search', glob: 'search',
  web_search: 'web', web_fetch: 'web',
  subagent: 'agent', task: 'agent', spawn_teammate: 'agent',
  workflow: 'team', todo_write: 'plan', create_goal: 'plan', update_goal: 'plan',
  skill: 'skill',
};

// What a step is, in the same words the page translates for Claude steps; secrets are masked like claude.mjs does.
function stepOf(tool, cwd, answered) {
  const input = tool.input ?? {};
  if (tool.name === QUESTION_TOOL) return answered ? null : { kind: 'ask', target: '' };
  const kind = STEP_KIND[tool.name] ?? 'tool';
  if (kind === 'edit' || kind === 'read') return { kind, target: cutStart(String(input.file_path ?? input.notebook_path ?? '')) };
  if (kind === 'run') return { kind, target: cutEnd(typeof input.description === 'string' && input.description.trim() ? input.description.trim() : String(input.command ?? '').split('\n')[0].trim()) };
  if (kind === 'search') return { kind, target: cutEnd(String(input.pattern ?? '')) };
  if (kind === 'web') {
    let host = '';
    try { host = new URL(input.url).hostname; } catch { /* a search, not a page */ }
    return { kind, target: cutEnd(host || String(input.query ?? '')) };
  }
  if (kind === 'agent') return { kind, target: cutEnd(String(input.description ?? input.prompt ?? input.name ?? '')) };
  if (kind === 'team') return { kind, target: cutEnd(String(input.meta?.name ?? input.name ?? '')) };
  if (kind === 'skill') return { kind, target: cutEnd(String(input.skill ?? '')) };
  return { kind, target: cutEnd(String(tool.name).split('__').pop()) };
}

function commitMessageOf(command) {
  const m = command.match(/(?:-m|--message)[ =]+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
  if (!m) return null;
  const raw = (m[1] ?? m[2]).trim();
  const lines = raw.split('\n').map((l) => l.trim());
  const subject = raw.startsWith('$(cat <<') ? lines.slice(1).find(Boolean) : lines[0];
  return subject || null;
}

// ---- workspaces and listing -------------------------------------------------

// workspace.json: workspace ids -> {path, title, sessionIds}; the authoritative root of each session.
function readWorkspaces(dir) {
  const bySession = new Map();
  try {
    const ws = JSON.parse(readText(join(dir, 'storages', 'workspace.json')) ?? 'null');
    for (const w of Object.values(ws?.tables?.workspaces ?? {})) {
      if (typeof w?.path !== 'string') continue;
      for (const id of w.sessionIds ?? []) if (typeof id === 'string') bySession.set(id, w.path);
    }
  } catch { /* no workspace registry yet */ }
  return bySession;
}

// The session log of the highest supported generation in a session directory.
function logFileOf(sessionDir) {
  const v4 = join(sessionDir, 'session.v4.jsonl.zstd');
  try {
    statSync(v4);
    return v4;
  } catch { /* fall through to older generations */ }
  let best = null;
  let bestN = -1;
  for (const f of listDir(sessionDir)) {
    const m = /^session(?:\.v(\d+))?\.jsonl\.zstd$/.exec(f.name);
    if (!f.isFile() || !m) continue;
    const n = m[1] === undefined ? 0 : Number(m[1]);
    if (n > bestN) { bestN = n; best = join(sessionDir, f.name); }
  }
  return best;
}

// Refs shaped like claude.mjs's listTranscripts: {sessionId, projectDir, path, mtimeMs, size, root}.
export function listSessions(dir, { sinceMs = 0 } = {}) {
  const roots = readWorkspaces(dir);
  const refs = [];
  for (const proj of listDir(join(dir, 'sessions'))) {
    if (!proj.isDirectory()) continue;
    for (const sess of listDir(join(dir, 'sessions', proj.name))) {
      if (!sess.isDirectory() || !SESSION_ID_RE.test(sess.name)) continue;
      const path = logFileOf(join(dir, 'sessions', proj.name, sess.name));
      if (!path) continue;
      try {
        const st = statSync(path);
        if (st.mtimeMs >= sinceMs) refs.push({ sessionId: sess.name, projectDir: proj.name, path, mtimeMs: st.mtimeMs, size: st.size, root: roots.get(sess.name) ?? null });
      } catch { /* vanished between listing and stat */ }
    }
  }
  return refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ---- transcript summary ------------------------------------------------------

// The DeepSeek prices in the shape cost.mjs's costOf reads (the Claude table's fields), from providers.mjs's deepseek
// catalog (peak rates, checked 2026-10-14): cache reads bill at the context-cache price, new input at the full rate.
export function deepseekPrices() {
  const table = providerOf('deepseek')?.pricesUSDPerMTok ?? {};
  const out = {};
  for (const [model, p] of Object.entries(table)) {
    out[model] = { input: p.in, output: p.out, cacheWrite5m: p.in, cacheWrite1h: p.in, cacheRead: p.cacheHit ?? p.in };
  }
  return out;
}

// The dollars of DeepSeek usage rows (the shape readSummary builds): null when any row's model is not in the table — the
// owner's rule: a wrong number is worse than none. The sum is never partial.
export function deepseekCostOf(rows) {
  const c = costOf(rows ?? [], deepseekPrices());
  return c.unpriced.length ? null : c.usd;
}

// The same sum split into today / 7 days / 30 days (cost.mjs's windowed), or null when any row is unpriced.
export function deepseekWindowed(rows, now) {
  const list = rows ?? [];
  if (list.some((r) => !Object.hasOwn(deepseekPrices(), String(r.model ?? '')))) return null;
  return windowed(list, now, deepseekPrices());
}

// The same shape claude.mjs's summarize() returns, so collect.mjs and the page never notice the engine.
export function readSummary(path) {
  try {
    const { header, events } = decodeEvents(path);
    if (!header || header.type !== 'session' || typeof header.id !== 'string') return null;
    const sessionId = header.id;
    let cwd = typeof header.cwd === 'string' ? header.cwd : '';
    let title = null;
    let lastPromptLine = null;
    let lastAssistantText = '';
    let lastCardText = null;
    let turnStartedAt = null;
    let endedAt = iso(header.createdAt);
    let startedAt = iso(header.createdAt);
    // The assistant messages carry no model: each request/context (or request/header) names the model that answered
    // after it, and the usage rows take that name. Without one, the rows keep 'deepseek' and no price table owns them.
    let model = 'deepseek';
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

    for (const entry of events) {
      const ts = iso(entry.time);
      if (ts) endedAt = ts;
      if (entry.type === 'session/title' && typeof entry.data?.title === 'string') title = entry.data.title.trim();
      if (entry.type === 'request/context' && typeof entry.data?.model === 'string') model = entry.data.model;
      if (entry.type === 'request/header' && typeof entry.data?.header?.config?.model === 'string') model = entry.data.header.config.model;
      const prompt = humanPromptOf(entry);
      if (prompt) {
        turnStartedAt = ts ?? turnStartedAt;
        userPrompts.push(prompt.slice(0, 1000));
        noteCodes(prompt);
        lastPromptLine = prompt;
      }
      if (entry.type === 'assistant/message') {
        const text = textOf(blocksOf(entry));
        if (text) {
          lastAssistantText = text;
          noteCodes(text);
          for (const card of cardsIn(text)) lastCardText = card;
        }
        const u = entry.data?.usage;
        if (u && typeof u === 'object') {
          const row = {
            messageId: entry.data?.id ?? entry.data?.message?.id ?? `line-${entry.seq}`,
            model,
            input: u.inputTokens ?? 0,
            output: u.outputTokens ?? 0,
            cacheWrite5m: 0,
            cacheWrite1h: 0,
            cacheRead: u.cacheReadTokens ?? 0,
            ts,
          };
          usageById.delete(row.messageId);
          usageById.set(row.messageId, row);
        }
      }
      if (entry.type === 'tool/call') {
        let input = {};
        try { input = JSON.parse(entry.data?.arguments ?? '{}') ?? {}; } catch { /* arguments in flight */ }
        toolUses.push({ id: entry.data?.callId ?? entry.data?.id, name: entry.data?.name ?? '', input, ts, gitBranch: '' });
      }
      if (entry.type === 'tool/result') {
        const callId = entry.data?.message?.toolCallId ?? entry.data?.toolCallId;
        if (typeof callId === 'string') results.set(callId, { text: textOf(blocksOf(entry)), isError: entry.data?.isError === true, ts });
      }
    }

    const answered = new Set(results.keys());
    const steps = [];
    let promptLast = null;
    let turnOpen = false;
    for (const entry of events) {
      const prompt = humanPromptOf(entry);
      if (prompt) { promptLast = entry.time ?? null; continue; }
      if (entry.type === 'turn/start') { turnOpen = true; promptLast = null; continue; }
      if (entry.type === 'turn/end') { turnOpen = false; promptLast = null; continue; }
      if (entry.type === 'assistant/message') { turnOpen = true; promptLast = null; }
      if (entry.type !== 'tool/call') continue;
      let input = {};
      try { input = JSON.parse(entry.data?.arguments ?? '{}') ?? {}; } catch { /* ignore */ }
      const step = stepOf({ name: entry.data?.name ?? '', input }, cwd, answered.has(entry.data?.callId ?? entry.data?.id));
      if (step) steps.push({ ...step, ts: iso(entry.time) });
    }
    if (promptLast !== null) steps.push({ kind: 'think', target: '', ts: iso(promptLast) });

    const editedFiles = [...new Set(toolUses.filter((t) => EDIT_TOOLS.has(t.name)).map((t) => t.input.file_path).filter((p) => typeof p === 'string'))];
    const lastTool = toolUses.at(-1);
    const lastFile = [...toolUses].reverse().map((t) => t.input.file_path).find((p) => typeof p === 'string') ?? null;
    const run = toolUses.filter((t) => RUN_TOOLS.has(t.name) && typeof t.input.command === 'string');

    const commits = [];
    for (const t of run.filter((b) => GIT_COMMIT_RE.test(b.input.command))) {
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
    for (const t of run.filter((b) => GIT_PUSH_RE.test(b.input.command))) {
      const res = results.get(t.id);
      if (!res || res.isError || /\berror:|fatal:|\[(remote )?rejected\]|Everything up-to-date/i.test(res.text)) continue;
      pushes.push({ branch: '', ts: res.ts ?? t.ts });
    }

    const mentionedPaths = new Set();
    for (const t of toolUses.slice(-MENTIONED_LINES)) {
      const walk = (v, depth = 0) => {
        if (typeof v === 'string') {
          for (const m of v.matchAll(PATH_RE)) mentionedPaths.add(m[0].replace(/[.,:]+$/, ''));
        } else if (v && typeof v === 'object' && depth < 4) {
          for (const x of Object.values(v)) walk(x, depth + 1);
        }
      };
      walk(t.input);
    }

    return {
      sessionId,
      cwd,
      gitBranch: '',
      entrypoint: 'deepseek-harness',
      title: title ?? (userPrompts[0] ?? '').slice(0, TITLE_MAX),
      lastPrompt: lastPromptLine ?? userPrompts.at(-1) ?? '',
      userPrompts,
      fromPage: false,
      lastAssistantText,
      turnStartedAt,
      pendingQuestion: lastTool?.name === QUESTION_TOOL && !results.has(lastTool.id),
      turnOpen,
      liveSteps: steps.slice(-STEPS_MAX),
      editedFiles,
      skillCalls: toolUses.filter((t) => t.name === 'skill' && typeof t.input.skill === 'string').map((t) => ({ name: t.input.skill, ts: t.ts })),
      lastFile,
      commits,
      pushes,
      launches: {},
      mentionedPaths: [...mentionedPaths],
      mentionedCodes: [...codes].slice(-CODES_MAX).map(([code, n]) => ({ code, n })),
      startedAt,
      endedAt,
      usage: [...usageById.values()],
      lastCardText,
      limitHit: null,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'deepseek-transcript-failed', { path, code: err.code, error: err.message });
    return null;
  }
}

// ---- whole conversation, for the page -----------------------------------------

export function versionOf(path) {
  try {
    const st = statSync(path);
    return `${st.size}-${Math.round(st.mtimeMs)}`;
  } catch {
    return '0';
  }
}

const safeParse = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

// Items in the shapes claude-conversation.mjs produces: user/assistant/thinking/tool/question.
// costUSD: summed from the usage rows at the DeepSeek prices the page may claim (providers.mjs, checked on a date).
// A conversation with no usage rows, or with a model the table does not know, shows null: a wrong number is worse
// than none (the owner's rule from id119).
export function readConversation(path, { cwd = '' } = {}) {
  try {
    const { header, events } = decodeEvents(path);
    const items = [];
    const tools = new Map();
    let costUSD = 0;
    let anyUsage = false;
    let model = 'deepseek';
    const deepseekTable = providerOf('deepseek')?.pricesUSDPerMTok ?? {};
    for (const entry of events) {
      const ts = iso(entry.time);
      if (entry.type === 'request/context' && typeof entry.data?.model === 'string') model = entry.data.model;
      if (entry.type === 'request/header' && typeof entry.data?.header?.config?.model === 'string') model = entry.data.header.config.model;
      if (entry.type === 'user/message') {
        const prompt = humanPromptOf(entry);
        if (prompt) items.push({ type: 'user', text: prompt, ts });
      } else if (entry.type === 'assistant/message') {
        const u = entry.data?.usage;
        if (u && typeof u === 'object' && (Number.isFinite(u.inputTokens) || Number.isFinite(u.outputTokens))) {
          anyUsage = true;
          const m = String(model ?? '').toLowerCase();
          if (Object.hasOwn(deepseekTable, m)) {
            // Cache reads bill at the context-cache price, like the map's own cost (deepseekCostOf).
            costUSD += providersCostOf('deepseek', m, Number(u.inputTokens) || 0, Number(u.outputTokens) || 0)
              + ((Number(u.cacheReadTokens) || 0) * (deepseekTable[m].cacheHit ?? 0)) / 1e6;
          } else {
            costUSD = NaN; // an unknown model anywhere: the whole sum is refused
          }
        }
        for (const b of blocksOf(entry)) {
          if (b.type === 'text' && b.text?.trim()) items.push({ type: 'assistant', text: b.text, ts, model });
          else if (b.type === 'reasoning' && b.text?.trim()) items.push({ type: 'thinking', text: b.text, ms: null, ts });
        }
      } else if (entry.type === 'tool/call') {
        const d = entry.data ?? {};
        const input = safeParse(d.arguments) ?? {};
        const detail = String(input.file_path ?? input.notebook_path ?? input.pattern ?? input.command ?? input.description ?? input.query ?? '').split('\n')[0].slice(0, 120);
        if (d.name === QUESTION_TOOL) {
          const item = { type: 'question', ts, questions: Array.isArray(input.questions) ? input.questions : [], answers: null };
          items.push(item);
          tools.set(d.callId ?? d.id, item);
        } else {
          const item = { type: 'tool', id: d.callId ?? d.id, name: d.name ?? '', ts, detail, result: null, isError: false };
          items.push(item);
          tools.set(d.callId ?? d.id, item);
        }
      } else if (entry.type === 'tool/result') {
        const callId = entry.data?.message?.toolCallId ?? entry.data?.toolCallId;
        const item = typeof callId === 'string' ? tools.get(callId) : null;
        if (!item) continue;
        const text = textOf(blocksOf(entry));
        if (item.type === 'question') item.answers = safeParse(text) ?? {};
        else item.result = text.slice(0, RESULT_MAX);
      }
    }
    return { items, costUSD: anyUsage && Number.isFinite(costUSD) ? Math.round(costUSD * 1e6) / 1e6 : null, version: versionOf(path) };
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'deepseek-conversation-failed', { path, code: err.code, error: err.message });
    return { items: [], costUSD: null, version: '0' };
  }
}

// Whether a session is working right now: its turn is open and its log was written recently.
export const isBusy = (summary, mtimeMs, nowMs) => Boolean(summary?.turnOpen) && nowMs - mtimeMs <= BUSY_MS;
