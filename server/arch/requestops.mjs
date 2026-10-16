// Reviewing a request of the owner from the page (mm27): Later, Discard, and Close when every item it became is done. The
// words of the registry stay the owner's: only the Status line of that request changes (and its tick), the old status is kept
// after "Before", and nothing is ever deleted. The change is one care operation (fd14), so the project's care mode decides
// whether it is written and an undo is recorded. Pure but for the one read of the registry file.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { requestsOf } from '../web/requests.js';
import { applyOp } from '../foundation/care.mjs';
import { RECENT_MS } from './livemark.mjs';

export const REVIEW_TO = ['later', 'discarded', 'done'];
const REASON_MAX = 300;
const ITEM_RE = /^[-*+]\s+\[[ xX]\]\s/;
const STATUS_RE = /^(\s*[-*+]\s+)(status|situação|situacao)(\s*:\s*)(.*)$/i;
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// A closed request is ticked and is no longer "in progress": that mark goes (a bold "in progress · important:" keeps its weight).
const tickOf = (line) => line.replace(/^([-*+]\s+)\[ \]/, '$1[x]')
  .replace(/\*\*(?:in progress|em andamento)\s*:\*\*\s*/i, '')
  .replace(/\*\*(?:in progress|em andamento)\s*·\s*/i, '**');
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const WORDS = {
  en: {
    later: (day, why) => `later (parked in the review of ${day}${why ? `: ${why}` : ''})`,
    discarded: (day, why) => `discarded (${why}; review of ${day})`,
    done: (day) => `done on ${day} (every item it became is done; closed in the review)`,
    before: 'Before',
  },
  pt: {
    later: (day, why) => `depois (guardado na revisão de ${day}${why ? `: ${why}` : ''})`,
    discarded: (day, why) => `descartado (${why}; revisão de ${day})`,
    done: (day) => `feito em ${day} (todos os itens em que virou estão feitos; fechado na revisão)`,
    before: 'Antes',
  },
};

// Where the request's block is in the registry text: [first line, end] (end is exclusive, trailing blank lines left out).
function blockOf(lines, code) {
  const mark = `\`${code}\``;
  const at = lines.findIndex((l) => ITEM_RE.test(l) && l.trimEnd().endsWith(mark));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && !ITEM_RE.test(lines[end]) && !/^#{1,6}\s/.test(lines[end])) end++;
  while (end > at + 1 && lines[end - 1].trim() === '') end--;
  return [at, end];
}

// → { ok: true, text } or { ok: false, error }. The registry text with the status line of `code` rewritten.
export function setRequestStatus(text, { code, to, reason, day, lang = 'en' }) {
  if (!REVIEW_TO.includes(to)) return { ok: false, error: 'bad-status' };
  const why = oneLine(reason).slice(0, REASON_MAX);
  if (to === 'discarded' && !why) return { ok: false, error: 'reason-needed' };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const block = blockOf(lines, code);
  if (!block) return { ok: false, error: 'unknown-request' };
  const [at, end] = block;
  const words = WORDS[lang] ?? WORDS.en;
  let statusAt = -1;
  for (let i = at + 1; i < end; i++) if (STATUS_RE.test(lines[i])) { statusAt = i; break; }
  const old = statusAt >= 0 ? STATUS_RE.exec(lines[statusAt]) : null;
  const before = oneLine(old?.[4]).replace(/\s*(Before|Antes):.*$/i, '').replace(/[.\s]+$/, '');
  const now = `${words[to](day, why)}.${before ? ` ${words.before}: ${before}.` : ''}`;
  if (statusAt >= 0) lines[statusAt] = `${old[1]}${old[2]}${old[3]}${now}`;
  else lines.splice(end, 0, `  - ${lang === 'pt' ? 'Situação' : 'Status'}: ${now}`);
  if (to !== 'later') lines[at] = tickOf(lines[at]);
  return { ok: true, text: lines.join(eol) };
}

// → { ok: true, op } (op is null when nothing would change) or { ok: false, error }. The care operation for one decision.
// `now` is a clock in ms; `read` and `recent` are injectable for tests.
export function requestStatusOp({ root, arch, code, to, reason, now = Date.now, read = (path) => readFileSync(path, 'utf8'), recent = (path) => now() - statSync(path).mtimeMs < RECENT_MS }) {
  if (!REVIEW_TO.includes(to)) return { ok: false, error: 'bad-status' };
  if (to === 'discarded' && !oneLine(reason)) return { ok: false, error: 'reason-needed' };
  if (!arch || arch.source === 'main-branch') return { ok: false, error: 'arch-not-here' };
  const request = requestsOf({ arch }).list.find((r) => r.code === code);
  if (!request) return { ok: false, error: 'unknown-request' };
  if (request.state === 'done' && !request.unconfirmed) return { ok: false, error: 'already-closed' };
  if (request.state === 'dropped') return { ok: false, error: 'already-closed' };
  if (to === 'done' && !request.unconfirmed) return { ok: false, error: 'not-finished' };
  if (to === 'later' && request.state === 'later') return { ok: true, op: null };
  const part = arch.parts.find((p) => p.id === request.partId);
  const file = part?.file;
  // The registry is a file of this project: a link in the map that climbs out of the folder is never followed.
  const inside = typeof file === 'string' && !isAbsolute(file) && !/^[a-z]:/i.test(file) && !file.split(/[\\/]/).includes('..');
  const path = inside ? join(root, file) : null;
  if (!path || !existsSync(path)) return { ok: false, error: 'bad-path' };
  // A chat may be writing the registry right now: never write over it.
  if (recent(path)) return { ok: false, error: 'busy' };
  const before = read(path);
  const out = setRequestStatus(before, { code, to, reason, day: dayOf(now()), lang: arch.lang === 'pt' ? 'pt' : 'en' });
  if (!out.ok) return out;
  if (out.text === before) return { ok: true, op: null };
  return { ok: true, op: { kind: 'request-status', sensitive: false, files: [{ path: file, after: out.text }], why: { msg: 'requests.op.why', params: { code, to } } } };
}

// Writes the decision through care.applyOp. The owner's click is the accept: auto and suggest write and record an undo; look
// (or not asked yet) writes nothing. care = { id, smDir, mode? }.
export function applyRequestStatus({ root, arch, code, to, reason, care, now }) {
  if (typeof care?.id !== 'string' || typeof care?.smDir !== 'string') throw new TypeError('applyRequestStatus needs the care mode: { id, smDir }');
  const built = requestStatusOp({ root, arch, code, to, reason, now });
  if (!built.ok) return built;
  if (!built.op) return { ok: true, changed: false, status: 'unchanged', opId: null, files: [] };
  const out = applyOp({ id: care.id, root }, built.op, { smDir: care.smDir, mode: care.mode, accept: true });
  const changed = out.status === 'applied';
  return { ok: out.ok, changed, status: out.status, opId: out.opId, files: out.files, ...(out.ok ? {} : { error: out.error ?? out.status }) };
}
