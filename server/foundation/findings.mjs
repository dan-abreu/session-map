import { createHash } from 'node:crypto';
import { readFd, writeFd } from './store.mjs';

const FILE = 'findings.json';
const PER_RULE_CAP = 50; // ponytail: a noisy rule must not bury the panel; the rest shows up in later rounds
const DECIDED = new Set(['never', 'accepted', 'later']);
const SEVERITY = { grave: 0, important: 1, detail: 2 };

// open -> accepted|later|never; accepted -> applied|undone; undone -> open. Everything else is refused.
const NEXT = {
  open: ['accepted', 'later', 'never'],
  later: ['open', 'accepted', 'never'],
  accepted: ['applied', 'undone'],
  undone: ['open'],
  applied: [],
  never: [],
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}

// The line is left out on purpose: the same finding keeps its id when the text moves.
export function findingId(rule, file, params = {}) {
  const sha = createHash('sha1').update(JSON.stringify([rule, file, stable(params)])).digest('hex');
  return `f:${sha.slice(0, 12)}`;
}

export function readFindings(smDir, projectId) {
  const data = readFd(smDir, projectId, FILE, null);
  return data && Array.isArray(data.findings) ? data.findings : [];
}

export function writeFindings(smDir, projectId, findings) {
  writeFd(smDir, projectId, FILE, { version: 1, findings });
}

function capPerRule(list) {
  const byRule = new Map();
  for (const f of list) byRule.set(f.rule, [...(byRule.get(f.rule) || []), f]);
  const out = [];
  for (const items of byRule.values()) {
    if (items.length <= PER_RULE_CAP) { out.push(...items); continue; }
    // What the owner decided on stays; the rest is cut by severity, oldest first.
    const rank = (f) => [DECIDED.has(f.state) ? 0 : 1, SEVERITY[f.severity] ?? 3, f.firstSeen || ''];
    const sorted = [...items].sort((a, b) => {
      const ra = rank(a); const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0);
    });
    const keep = new Set(sorted.slice(0, PER_RULE_CAP));
    out.push(...items.filter((f) => keep.has(f)));
  }
  return out;
}

export function mergeFindings(prev, current, nowIso) {
  const before = new Map((prev || []).map((f) => [f.id, f]));
  const seen = new Set();
  const out = [];
  for (const cur of current || []) {
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    const old = before.get(cur.id);
    if (!old) { out.push({ ...cur, state: 'open', firstSeen: nowIso, lastSeen: nowIso }); continue; }
    // A finding that was applied and shows up again means the problem came back.
    const state = old.state === 'applied' ? 'open' : old.state;
    out.push({ ...cur, fix: { ...cur.fix, opId: old.fix?.opId ?? cur.fix?.opId ?? null }, state, firstSeen: old.firstSeen, lastSeen: nowIso });
  }
  for (const old of before.values()) {
    if (seen.has(old.id)) continue;
    if (old.state === 'never') out.push(old);
    else if (old.state === 'accepted') out.push({ ...old, state: 'applied' });
  }
  return capPerRule(out);
}

export function setFindingState(smDir, projectId, fid, state, opId = null) {
  if (!(state in NEXT)) return { ok: false, error: 'bad-state' };
  const list = readFindings(smDir, projectId);
  const at = list.findIndex((f) => f.id === fid);
  if (at < 0) return { ok: false, error: 'not-found' };
  if (!NEXT[list[at].state]?.includes(state)) return { ok: false, error: 'bad-transition' };
  const next = { ...list[at], state };
  if (opId) next.fix = { ...next.fix, opId };
  list[at] = next;
  writeFindings(smDir, projectId, list);
  return { ok: true, finding: next };
}
