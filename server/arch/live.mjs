// The status robot (sb13): what is being built right now and what is built on main, read from facts, never from an AI
// writing the plan file. Pure: it receives what the state builder already knows and returns data.

export const ACTIVE_MS = 15 * 60_000;

// The shape of an item code of the architecture convention (same as the readers'); only codes the plan has count.
const CODE_RE = /(?<![\w-])([a-z]{1,4}(?:-[a-z]{1,8})?\d{1,4})(?![\w-])/gi;
// feat or fix, with an optional scope and "!" ("feat(chat)!:"); docs, chore, test and plan commits never count as built.
const BUILT_SUBJECT_RE = /^(?:feat|fix)(?:\([^)]*\))?!?:/i;
const WHERE_RE = /^(?:where it went|para onde foi)\s*:/i;
const WHO_MAX = 90;

const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));
const iso = (ms) => new Date(ms).toISOString();
const pathKey = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// A branch name joins words with dashes ("feat/sb14-badge"), so there a dash may sit next to a code, and every start
// is tried ("feat-sb14" holds sb14).
const BRANCH_CODE_RE = /(?<![a-z0-9])(?=([a-z]{1,4}(?:-[a-z]{1,8})?\d{1,4})(?![a-z0-9]))/gi;

function codesIn(text, known, re = CODE_RE) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(re)) {
    const code = m[1].toLowerCase();
    if (known.has(code)) out.add(code);
  }
  return out;
}

// Codes written in backticks or in parentheses: how a commit subject names the item it builds.
function namedCodes(subject, known) {
  const out = new Set();
  for (const m of String(subject ?? '').matchAll(/`([^`]*)`|\(([^)]*)\)/g)) for (const c of codesIn(m[1] ?? m[2], known)) out.add(c);
  return out;
}

// The worktree of a chat or an agent: by the cell id the chat was placed in, else by the folder it works in.
function cellFor(who, workcells) {
  const byId = who.workCellId && workcells.find((w) => w.id === who.workCellId);
  if (byId) return byId;
  const cwd = pathKey(who.cwd);
  if (!cwd) return null;
  // The deepest folder wins when worktrees sit inside one another.
  const inside = workcells.filter((w) => w.path && (cwd === pathKey(w.path) || cwd.startsWith(`${pathKey(w.path)}/`)));
  return inside.sort((a, b) => pathKey(b.path).length - pathKey(a.path).length)[0] ?? null;
}

// items: [{code, status, detail}]; chats: [{sessionId, label, activeAt, startedAt, card, branch, workCellId, cwd}];
// agents: [{label, brief, activeAt, startedAt, cwd}]; workcells: [{id, branch, path, subjects}];
// mainCommits: [{subject, ts, hash}]; now: ms or a date.
// -> Map code -> { live: 'working' | 'built', who: [labels], since: iso | null }. An item nobody works on has no entry.
export function liveStatus({ items = [], chats = [], agents = [], workcells = [], mainCommits = [], now = Date.now() } = {}) {
  const nowMs = toMs(now);
  const open = new Map(items.filter((i) => i.code && i.status !== 'done').map((i) => [String(i.code).toLowerCase(), i]));
  const working = new Map(); // code -> { who: Set, since: ms | null }
  const note = (codes, label, sinceMs) => {
    for (const code of codes) {
      const e = working.get(code) ?? { who: new Set(), since: null };
      e.who.add(label);
      if (Number.isFinite(sinceMs) && (e.since === null || sinceMs < e.since)) e.since = sinceMs;
      working.set(code, e);
    }
  };
  const active = (at) => {
    const ms = toMs(at);
    // A time ahead of the clock by more than a minute is not activity either.
    return Number.isFinite(ms) && nowMs - ms <= ACTIVE_MS && ms - nowMs <= 60_000;
  };
  const fromCell = (who) => {
    const cell = cellFor(who, workcells);
    return { branch: cell?.branch ?? '', subjects: cell?.subjects ?? [] };
  };

  for (const c of chats) {
    if (!active(c.activeAt)) continue;
    const cell = fromCell(c);
    const found = new Set([
      ...codesIn([c.card?.title, c.card?.doing].join('\n'), open),
      ...codesIn([c.branch, cell.branch].join('\n'), open, BRANCH_CODE_RE),
      ...codesIn(cell.subjects.join('\n'), open),
    ]);
    note(found, c.label || c.sessionId || '?', toMs(c.startedAt ?? c.activeAt));
  }
  for (const a of agents) {
    if (!active(a.activeAt)) continue;
    const cell = fromCell(a);
    const found = new Set([...codesIn(a.brief, open), ...codesIn(cell.branch, open, BRANCH_CODE_RE), ...codesIn(cell.subjects.join('\n'), open)]);
    note(found, a.label || 'agent', toMs(a.startedAt ?? a.activeAt));
  }

  // A request (the ideas file) is worked on when something it lists under "Where it went" is.
  for (const [code, item] of open) {
    const line = (item.detail ?? []).find((d) => WHERE_RE.test(d));
    if (!line) continue;
    for (const listed of codesIn(line, open)) {
      const from = working.get(listed);
      if (listed === code || !from) continue;
      const e = working.get(code) ?? { who: new Set(), since: null };
      for (const w of from.who) e.who.add(w);
      if (from.since !== null && (e.since === null || from.since < e.since)) e.since = from.since;
      working.set(code, e);
    }
  }

  const out = new Map();
  for (const [code, e] of working) out.set(open.get(code).code, { live: 'working', who: [...e.who], since: e.since === null ? null : iso(e.since) });

  // Built: a feat or fix commit on main names it while the plan still shows it open. The newest one tells the time.
  const built = new Map();
  for (const c of mainCommits) {
    if (!BUILT_SUBJECT_RE.test(String(c.subject ?? '').trim())) continue;
    const ms = toMs(c.ts);
    for (const code of namedCodes(c.subject, open)) {
      const prev = built.get(code);
      if (!prev || (Number.isFinite(ms) && ms > prev.ms)) built.set(code, { ms, subject: String(c.subject).trim().slice(0, WHO_MAX) });
    }
  }
  for (const [code, b] of built) {
    const item = open.get(code);
    if (out.has(item.code)) continue;
    out.set(item.code, { live: 'built', who: [b.subject], since: Number.isFinite(b.ms) ? iso(b.ms) : null });
  }
  return out;
}

// The architecture with each item's answer hung on it as item.live; the input is not changed.
export function withLive(arch, live) {
  if (!live?.size) return arch;
  const byCode = new Map([...live].map(([code, v]) => [String(code).toLowerCase(), v]));
  return {
    ...arch,
    parts: arch.parts.map((p) => ({
      ...p,
      groups: p.groups.map((g) => ({
        ...g,
        items: g.items.map((i) => {
          const v = i.code ? byCode.get(String(i.code).toLowerCase()) : null;
          return v ? { ...i, live: v } : i;
        }),
      })),
    })),
  };
}
