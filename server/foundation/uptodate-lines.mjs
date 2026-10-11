// The catalogue of the "Everything up to date?" panel (fd07): the lines of the three files, in the order of the groups,
// and the guard every line goes through. A line is a pure function (ctx) -> { state, evidence, reason, findingIds, detail }.
import { log } from '../log.mjs';
import { LINES as CODE } from './uptodate-lines-code.mjs';
import { LINES as DOCS } from './uptodate-lines-docs.mjs';
import { LINES as OPS } from './uptodate-lines-ops.mjs';

const STATES = new Set(['confirmed', 'warning', 'unverified']);
const REASONS = new Set(['no-token', 'no-network', 'tool-missing', 'no-data', 'not-applicable']);
// The versions step names a source it could not ask 'no-source'; for the panel that is plain missing data.
const ALIAS = { 'no-source': 'no-data' };
const KIND = { confirmed: 'ok', warning: 'warn', unverified: 'unverified' };

// Stable order: by group, and inside a group in the order the three files list them.
export const LINES = [...CODE, ...DOCS, ...OPS]
  .map((line, i) => ({ line, i }))
  .sort((a, b) => a.line.group - b.line.group || a.i - b.i)
  .map((x) => x.line);

const unknown = (id, why) => {
  log('warn', 'uptodate-line-invalid', { line: id, why });
  return { state: 'unverified', evidence: [], reason: 'no-data', findingIds: [], detail: null };
};

// What a line says is only kept when it can stand: confirmed needs something that was checked, unverified needs a reason.
function guard(id, answer) {
  if (!answer || typeof answer !== 'object' || !STATES.has(answer.state)) return unknown(id, 'bad-answer');
  const evidence = Array.isArray(answer.evidence) ? answer.evidence : [];
  const findingIds = Array.isArray(answer.findingIds) ? answer.findingIds : [];
  if (answer.state === 'confirmed' && !evidence.length) return unknown(id, 'confirmed-without-evidence');
  if (answer.state === 'unverified') {
    const given = ALIAS[answer.reason] ?? answer.reason;
    const reason = REASONS.has(given) ? given : null;
    if (!reason) log('warn', 'uptodate-line-invalid', { line: id, why: 'unverified-without-reason' });
    return { state: 'unverified', evidence: [], reason: reason ?? 'no-data', findingIds, detail: answer.detail };
  }
  return { state: answer.state, evidence, reason: null, findingIds, detail: answer.detail };
}

// The text key of the screen is always uptodate.<id>.ok|warn|unverified; a line that gave only a note keeps it in params.
function detailOf(id, state, detail) {
  if (detail && typeof detail === 'object' && typeof detail.msg === 'string') return { msg: detail.msg, params: detail.params ?? {} };
  return { msg: `uptodate.${id}.${KIND[state]}`, params: typeof detail === 'string' && detail ? { detail } : {} };
}

export function runLine(line, ctx) {
  let answer;
  try {
    answer = guard(line.id, line.run(ctx ?? {}));
  } catch (err) {
    log('warn', 'uptodate-line-failed', { line: line.id, error: err.message });
    answer = { state: 'unverified', evidence: [], reason: 'no-data', findingIds: [], detail: null };
  }
  return { ...answer, detail: detailOf(line.id, answer.state, answer.detail) };
}
