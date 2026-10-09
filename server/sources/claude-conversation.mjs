// The whole conversation as the chat screen shows it (mind-map-page mm22): every message with its time, the steps with
// what went in and came out (secrets masked), questions with the answer given, images, helper agents and the cost of each
// reply. Like claude.mjs, this file depends on Claude Code's undocumented transcript format.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { costOf, loadPrices } from '../cost.mjs';
import { log } from '../log.mjs';
import { blocksOf, parseLines, relativeTo, stepOf } from './claude.mjs';

const RESULT_MAX = 12_000;
const INPUT_MAX = 12_000;
const AGENT_ID_RE = /^[\w-]{1,64}$/;
// What an edit's diff already shows, left out of what went in.
const EDIT_SHOWN = new Set(['content', 'old_string', 'new_string', 'new_source', 'edits', 'file_path', 'notebook_path']);
const QUESTION_TOOL = 'AskUserQuestion';
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const COMMAND_RE = /^<command-name>\s*([^<]*?)\s*<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;
const round6 = (usd) => Math.round(usd * 1e6) / 1e6;

// Most specific first: a whole key block, then the shapes a token has, then anything long that mixes cases and digits
// (lowercase hex, such as commit hashes and ids, stays readable).
const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '…'],
  [/\b(bearer|basic)\s+[^\s"']+/gi, '$1 …'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '…'],
  [/\b(?:sk|pk|rk)-[\w-]{8,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_\w{20,}|\bxox[abprs]-[\w-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[\w-]{30,}/g, '…'],
  [/\b((?:api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|token|secret|password|passwd|pwd)["']?\s*[=:]\s*["']?)[^\s"'&,]+/gi, '$1…'],
  [/(?=[\w+-]*[a-z])(?=[\w+-]*[A-Z])(?=[\w+-]*\d)[\w+-]{32,}={0,2}/g, '…'],
];

export function maskSecrets(text) {
  let out = String(text ?? '');
  for (const [re, to] of SECRETS) out = out.replace(re, to);
  return out;
}

const maskDeep = (value) => {
  if (typeof value === 'string') return maskSecrets(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  return value;
};

const cut = (text, max) => (text.length > max ? { text: `${text.slice(0, max)}…`, cut: true } : { text, cut: false });

// Edits as before and after: one hunk per replaced piece; a new file is all "after".
function diffOf(name, input, cwd) {
  const path = relativeTo(cwd, input.file_path ?? input.notebook_path ?? '');
  const hunk = (before, after) => ({ before: maskSecrets(before ?? ''), after: maskSecrets(after ?? '') });
  if (name === 'Edit') return { path, hunks: [hunk(input.old_string, input.new_string)] };
  if (name === 'Write') return { path, hunks: [hunk('', input.content)] };
  if (name === 'MultiEdit' && Array.isArray(input.edits)) return { path, hunks: input.edits.map((e) => hunk(e?.old_string, e?.new_string)) };
  if (name === 'NotebookEdit') return { path, hunks: [hunk('', input.new_source)] };
  return undefined;
}

const todosOf = (input) => (Array.isArray(input.todos)
  ? input.todos.filter((t) => t && typeof t.content === 'string').map((t) => ({ text: t.content, status: t.status, active: t.activeForm ?? t.content }))
  : undefined);

// What a step shows besides its name, for the transcript and for the live chat alike.
export function toolDetails(name, rawInput, cwd = '') {
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const out = { step: stepOf({ name, input }, cwd, true) ?? { kind: 'tool', target: '' } };
  const diff = diffOf(name, input, cwd);
  if (diff) out.diff = diff;
  if (name === 'TodoWrite') out.todos = todosOf(input);
  const shown = diff ? Object.fromEntries(Object.entries(input).filter(([k, v]) => !EDIT_SHOWN.has(k) && v !== false)) : input;
  out.input = cut(JSON.stringify(maskDeep(shown), null, 2), INPUT_MAX).text;
  return out;
}

const questionsOf = (input) => (Array.isArray(input?.questions) ? input.questions : []).filter((q) => q && typeof q.question === 'string').map((q) => ({
  header: typeof q.header === 'string' ? q.header : '',
  question: q.question,
  multiSelect: q.multiSelect === true,
  options: (Array.isArray(q.options) ? q.options : []).filter((o) => o && typeof o.label === 'string').map((o) => ({ label: o.label, description: typeof o.description === 'string' ? o.description : '' })),
}));

function readEntries(path) {
  let raw;
  try {
    raw = readFileSync(path);
    if (path.endsWith('.gz')) raw = gunzipSync(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'read-failed', { path, code: err.code });
    return null;
  }
  return parseLines(raw.toString('utf8'));
}

// The person's own message: typed text (a slash command as they typed it) and pasted images. Injected blocks
// (<system-reminder>, <ide_…>), meta lines and messages from other agents are not the person.
function promptOf(entry) {
  if (entry.type !== 'user' || entry.isMeta || (entry.origin && entry.origin.kind !== 'human')) return null;
  const blocks = blocksOf(entry);
  if (blocks.some((b) => b.type === 'tool_result')) return null;
  const parts = [];
  let images = 0;
  for (const b of blocks) {
    if (b.type === 'image') images++;
    if (b.type !== 'text' || typeof b.text !== 'string') continue;
    const text = b.text.trim();
    const command = COMMAND_RE.exec(text);
    if (command) parts.push([command[1], COMMAND_ARGS_RE.exec(text)?.[1]?.trim()].filter(Boolean).join(' '));
    else if (text && !text.startsWith('<')) parts.push(text);
  }
  return parts.length || images ? { text: parts.join('\n'), images } : null;
}

const resultText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('\n') : '');
const imageBlocks = (blocks) => blocks.filter((b) => b.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string');

function usageOf(entry) {
  const u = entry.message?.usage;
  if (entry.type !== 'assistant' || !u || entry.message.model === '<synthetic>') return null;
  const split = u.cache_creation && typeof u.cache_creation === 'object';
  return {
    model: entry.message.model ?? 'unknown',
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite5m: split ? u.cache_creation.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0,
    cacheWrite1h: split ? u.cache_creation.ephemeral_1h_input_tokens ?? 0 : 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
  };
}

let shippedPrices = null;

// → {items, costUSD, version}; items in the order they were written. A reply's own cost sits on its last message
// (replyCostUSD); helpers are in the conversation's total, not here.
export function readConversation(path, { cwd = '', prices } = {}) {
  const { items, costUSD } = build(readEntries(path) ?? [], { cwd, prices: prices ?? (shippedPrices ??= loadPrices()) });
  let version = '0';
  try {
    const st = statSync(path);
    version = `${st.size}-${Math.round(st.mtimeMs)}`;
  } catch { /* gone */ }
  return { items, costUSD, version };
}

// keep: an array that receives every image block, numbered in the same walk that numbers them for the page.
function build(entries, { cwd, prices, keep = null }) {
  const items = [];
  const tools = new Map();
  let images = 0;
  let turn = { usage: new Map(), last: null };
  let total = 0;
  const closeTurn = () => {
    if (!turn.last || !turn.usage.size) return;
    const usd = round6(costOf([...turn.usage.values()], prices).usd);
    turn.last.replyCostUSD = usd;
    total += usd;
  };
  const numbered = (blocks) => imageBlocks(blocks).map((b) => {
    keep?.push(b);
    return { n: images++, media: b.source.media_type };
  });

  for (const entry of entries) {
    const ts = entry.timestamp ?? null;
    const prompt = promptOf(entry);
    if (prompt) {
      closeTurn();
      turn = { usage: new Map(), last: null };
      const shot = numbered(blocksOf(entry));
      items.push({ type: 'user', text: prompt.text, ts, ...(shot.length ? { images: shot } : {}) });
      continue;
    }
    if (entry.type === 'assistant') {
      const usage = usageOf(entry);
      // Repeated lines of one message carry the same (growing) usage: the last one counts.
      if (usage) turn.usage.set(entry.message.id ?? entry.uuid ?? items.length, usage);
      for (const b of blocksOf(entry)) {
        if (b.type === 'text' && b.text?.trim()) {
          const item = { type: 'assistant', text: b.text, ts, model: entry.message?.model ?? null };
          items.push(item);
          turn.last = item;
        } else if (b.type === 'thinking' && (b.thinking?.trim() || entry.thinkingDurationMs)) {
          items.push({ type: 'thinking', text: b.thinking ?? '', ms: Number.isFinite(entry.thinkingDurationMs) ? entry.thinkingDurationMs : null, ts });
        } else if (b.type === 'tool_use' && b.name === QUESTION_TOOL) {
          const item = { type: 'question', ts, questions: questionsOf(b.input), answers: null };
          items.push(item);
          tools.set(b.id, item);
        } else if (b.type === 'tool_use') {
          const item = { type: 'tool', id: b.id, name: b.name, ts, ...toolDetails(b.name, b.input, cwd), result: null, isError: false };
          if (AGENT_TOOLS.has(b.name)) {
            item.agent = {
              id: null, kind: b.input?.subagent_type ?? null, description: b.input?.description ?? '', model: b.input?.model ?? null, status: null, steps: null,
              prompt: cut(maskSecrets(b.input?.prompt ?? ''), INPUT_MAX).text,
            };
          }
          items.push(item);
          tools.set(b.id, item);
          turn.last ??= item;
        }
      }
      continue;
    }
    if (entry.type !== 'user') continue;
    for (const b of blocksOf(entry)) {
      if (b.type !== 'tool_result' || !tools.has(b.tool_use_id)) continue;
      const item = tools.get(b.tool_use_id);
      const meta = entry.toolUseResult && typeof entry.toolUseResult === 'object' ? entry.toolUseResult : null;
      if (item.type === 'question') {
        item.answers = meta?.answers && typeof meta.answers === 'object' ? meta.answers : {};
        continue;
      }
      const shown = cut(maskSecrets(resultText(b.content)), RESULT_MAX);
      item.result = shown.text;
      item.isError = Boolean(b.is_error);
      if (shown.cut) item.cut = true;
      const shot = numbered(Array.isArray(b.content) ? b.content.filter((c) => c && typeof c === 'object') : []);
      if (shot.length) item.images = shot;
      if (item.agent && meta) {
        item.agent = { ...item.agent, id: AGENT_ID_RE.test(meta.agentId ?? '') ? meta.agentId : null, kind: item.agent.kind ?? meta.agentType ?? null, status: meta.status ?? null, steps: Number.isFinite(meta.totalToolUseCount) ? meta.totalToolUseCount : null };
      }
    }
  }
  closeTurn();
  return { items, costUSD: round6(total) };
}

// The n-th image of a transcript (pasted by the person or returned by a step), in the order readConversation numbered them.
export function readImage(path, n) {
  if (!Number.isInteger(n) || n < 0) return null;
  const keep = [];
  build(readEntries(path) ?? [], { cwd: '', prices: {}, keep });
  const b = keep[n];
  return b ? { media: b.source.media_type, data: Buffer.from(b.source.data, 'base64') } : null;
}

// A helper's own transcript sits next to the conversation's: <session>/subagents/agent-<id>.jsonl, or inside a workflow folder.
export function helperPath(transcriptPath, agentId) {
  if (typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)) return null;
  const base = join(transcriptPath.replace(/\.jsonl(\.gz)?$/, ''), 'subagents');
  let workflows = [];
  try { workflows = readdirSync(join(base, 'workflows')); } catch { /* no workflow ran */ }
  const candidates = [join(base, `agent-${agentId}.jsonl`), ...workflows.map((wf) => join(base, 'workflows', wf, `agent-${agentId}.jsonl`))];
  return candidates.find((p) => { try { return statSync(p).isFile(); } catch { return false; } }) ?? null;
}
