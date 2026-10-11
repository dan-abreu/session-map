// The statement as bookkeeping (sb10, from id98): the period's total first, then each chat opened down to who worked,
// which files it created or changed, what the money went on and the replies. Pure functions over the rows that
// statement.mjs reads; every section of a chat adds up to the same total, and the page says so.

const DAY = 86_400_000;

// What one tool call was, for the books: its kind, the file or command it was about, and the lines it wrote.
// kinds: create (a whole file written), edit, read, run (a command), search, helper (an agent or a team called),
// web, other; a reply with no tool call is "answer" (thinking and writing the answer).
export function actOf(block) {
  const name = String(block?.name ?? '');
  const i = block?.input ?? {};
  const lines = (s) => (typeof s === 'string' && s.length ? s.split('\n').length : 0);
  const path = typeof (i.file_path ?? i.notebook_path) === 'string' ? i.file_path ?? i.notebook_path : null;
  if (name === 'Write') return { k: 'create', t: path, add: lines(i.content), del: 0 };
  if (name === 'Edit') return { k: 'edit', t: path, add: lines(i.new_string), del: lines(i.old_string) };
  if (name === 'MultiEdit') {
    const edits = Array.isArray(i.edits) ? i.edits : [];
    return { k: 'edit', t: path, add: edits.reduce((n, e) => n + lines(e?.new_string), 0), del: edits.reduce((n, e) => n + lines(e?.old_string), 0) };
  }
  if (name === 'NotebookEdit') return { k: 'edit', t: path, add: lines(i.new_source), del: 0 };
  if (name === 'Read') return { k: 'read', t: path };
  if (name === 'Bash' || name === 'PowerShell') return { k: 'run', t: String(i.description ?? i.command ?? '').slice(0, 120) };
  if (name === 'Grep' || name === 'Glob' || name === 'ToolSearch') return { k: 'search', t: String(i.pattern ?? i.query ?? '').slice(0, 120) };
  if (name === 'Agent' || name === 'Task' || name === 'Workflow') return { k: 'helper', t: String(i.description ?? i.title ?? '').slice(0, 120) };
  if (name === 'WebFetch' || name === 'WebSearch') return { k: 'web', t: String(i.url ?? i.query ?? '').slice(0, 120) };
  return { k: 'other', t: name.replace(/^mcp__/, '').slice(0, 80) };
}

const FILE_KINDS = new Set(['create', 'edit', 'read']);
export const KINDS = ['answer', 'read', 'edit', 'create', 'run', 'search', 'helper', 'web', 'other'];

// A file named the same way whatever tool wrote it: forward slashes, the drive in lower case.
export function fileKey(path) {
  return String(path).replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `${d.toLowerCase()}:`);
}

// The file as the person reads it: inside the chat's folder, from there; else the full path.
export function fileName(key, cwd) {
  const root = cwd ? `${fileKey(cwd).replace(/\/+$/, '')}/` : null;
  return root && key.toLowerCase().startsWith(root.toLowerCase()) ? key.slice(root.length) : key;
}

const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// "YYYY-MM-DD" (local) → the period [from, to): to is the end of its day. Missing → the last 30 days up to now.
// A day that does not exist (month 13, February 30) is no day: the default is used instead.
function localDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00`);
  return Number.isNaN(d.getTime()) || dayOf(d.getTime()) !== text ? null : d;
}

export function periodOf({ from = '', to = '' } = {}, now = Date.now()) {
  const start = localDay(from)?.getTime() ?? now - 30 * DAY;
  // The next calendar day, not 24 hours later: a day with a clock change still ends at midnight.
  const last = localDay(to);
  if (last) last.setDate(last.getDate() + 1);
  const endDay = last ? last.getTime() : now + 1;
  return { from: start, to: Math.max(start, endDay) };
}

const cents = () => ({ replies: 0, usd: 0, usdRead: 0, usdKeep: 0, usdNew: 0, usdWrite: 0, usdSearch: 0, first: Infinity, last: 0 });
function add(b, r) {
  const c = r.cost;
  b.replies++;
  b.first = Math.min(b.first, r.ts);
  b.last = Math.max(b.last, r.ts);
  if (!c) return;
  b.usd += c.total;
  b.usdRead += c.cacheRead;
  b.usdKeep += c.cacheWrite;
  b.usdNew += c.input;
  b.usdWrite += c.output;
  b.usdSearch += c.webSearch;
}
const r6 = (n) => Math.round(n * 1e6) / 1e6;
function out(b) {
  const o = {};
  for (const [k, v] of Object.entries(b)) o[k] = typeof v === 'number' ? (Number.isFinite(v) ? (k.startsWith('usd') ? r6(v) : v) : null) : v;
  return o;
}
const inPeriod = (rows, p) => rows.filter((r) => r.ts >= p.from && r.ts < p.to);
const isMain = (who) => who === 'conversa principal';

// The period: its total split by what it was spent on, and one line per chat with its share, most expensive first.
export function periodLedger(st, period) {
  const rows = inPeriod(st.rows, period);
  const total = cents();
  const chats = new Map();
  const byDay = new Map();
  const byProject = new Map();
  const byModel = new Map();
  const get = (m, k, extra) => { if (!m.has(k)) m.set(k, { ...cents(), ...extra }); return m.get(k); };
  for (const r of rows) {
    const s = st.sessions.get(r.sessionId);
    add(total, r);
    const c = get(chats, r.sessionId, { sessionId: r.sessionId, title: s?.title ?? '', project: s?.project ?? '', helpers: new Set() });
    add(c, r);
    if (!isMain(r.who)) c.helpers.add(r.who);
    add(get(byDay, dayOf(r.ts), { day: dayOf(r.ts) }), r);
    add(get(byProject, s?.project ?? '', { name: s?.project ?? '' }), r);
    add(get(byModel, r.model, { model: r.model }), r);
  }
  const share = (b) => (total.usd > 0 ? r6(b.usd / total.usd) : 0);
  const sorted = (m) => [...m.values()].sort((a, b) => b.usd - a.usd).map((b) => ({ ...out(b), share: share(b) }));
  return {
    from: period.from, to: period.to,
    total: out(total),
    chats: [...chats.values()].sort((a, b) => b.usd - a.usd).map(({ helpers, ...c }) => ({
      ...out(c), helpers: helpers.size, share: share(c), allTimeUsd: r6(st.allTime?.get(c.sessionId)?.usd ?? c.usd),
    })),
    byDay: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).map((b) => ({ ...out(b), share: share(b) })),
    byProject: sorted(byProject),
    byModel: sorted(byModel),
  };
}

// One chat in the period, opened: who worked, its files, what the money went on, its days. Each reply's cost is split
// evenly among the things it did (a reply that only thought and wrote counts as "answer"), so files and kinds add up
// to the chat's total too.
export function chatLedger(st, sessionId, period) {
  const s = st.sessions.get(sessionId);
  if (!s) return null;
  const rows = inPeriod(st.rows, period).filter((r) => r.sessionId === sessionId);
  const total = cents();
  const who = new Map();
  const kinds = new Map(KINDS.map((k) => [k, { kind: k, count: 0, usd: 0 }]));
  const files = new Map();
  const byDay = new Map();
  const get = (m, k, extra) => { if (!m.has(k)) m.set(k, { ...cents(), ...extra }); return m.get(k); };
  for (const r of rows) {
    add(total, r);
    add(get(who, r.who, { who: r.who, main: isMain(r.who) }), r);
    add(get(byDay, dayOf(r.ts), { day: dayOf(r.ts) }), r);
    const acts = r.acts?.length ? r.acts : [{ k: 'answer' }];
    const part = (r.cost?.total ?? 0) / acts.length;
    for (const a of acts) {
      const k = kinds.get(a.k) ?? kinds.get('other');
      k.count++;
      k.usd += part;
      if (!a.t || !FILE_KINDS.has(a.k)) continue;
      const key = fileKey(a.t);
      if (!files.has(key)) files.set(key, { file: key, name: fileName(key, s.cwd), created: 0, edits: 0, reads: 0, add: 0, del: 0, usd: 0, first: r.ts, last: r.ts });
      const f = files.get(key);
      if (a.k === 'create') f.created++;
      if (a.k === 'edit') f.edits++;
      if (a.k === 'read') f.reads++;
      f.add += a.add ?? 0;
      f.del += a.del ?? 0;
      f.usd += part;
      f.first = Math.min(f.first, r.ts);
      f.last = Math.max(f.last, r.ts);
    }
  }
  // Since it began: from the reader's count of every reply of the chat; without one, from every row of the chat.
  const all = st.allTime?.get(sessionId) ?? st.rows.filter((r) => r.sessionId === sessionId)
    .reduce((a, r) => ({ usd: a.usd + (r.cost?.total ?? 0), first: Math.min(a.first, r.ts), replies: a.replies + 1 }), { usd: 0, first: Infinity, replies: 0 });
  const fileList = [...files.values()].map((f) => ({ ...f, usd: r6(f.usd) }));
  const changed = fileList.filter((f) => f.created || f.edits).sort((a, b) => b.usd - a.usd);
  const onlyRead = fileList.filter((f) => !f.created && !f.edits).sort((a, b) => b.usd - a.usd);
  const sum = (list) => r6(list.reduce((n, x) => n + x.usd, 0));
  const whoList = [...who.values()].sort((a, b) => (b.main - a.main) || (b.usd - a.usd)).map(out);
  const kindList = [...kinds.values()].filter((k) => k.count).sort((a, b) => b.usd - a.usd).map((k) => ({ ...k, usd: r6(k.usd) }));
  return {
    sessionId, title: s.title, project: s.project, from: period.from, to: period.to,
    total: out(total),
    allTime: { usd: r6(all?.usd ?? total.usd), first: all?.first ?? total.first, replies: all?.replies ?? total.replies },
    helpers: whoList.filter((w) => !w.main).length,
    who: whoList,
    files: {
      changed, onlyRead,
      created: changed.filter((f) => f.created).length,
      edited: changed.filter((f) => !f.created).length,
      add: changed.reduce((n, f) => n + f.add, 0),
      del: changed.reduce((n, f) => n + f.del, 0),
      readUsd: sum(onlyRead),
    },
    kinds: kindList,
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map(out),
    // Each split must give the chat's total back; the page shows the check.
    check: { total: r6(total.usd), who: sum(whoList), kinds: sum(kindList) },
  };
}

// The replies behind whatever was opened: a chat, who answered, a file, a kind of work, a day, or words.
export function ledgerRows(st, period, { chat = '', who = '', file = '', kind = '', day = '', q = '' } = {}) {
  const words = q.trim().toLowerCase();
  const key = file ? fileKey(file) : '';
  return inPeriod(st.rows, period).filter((r) => (!chat || r.sessionId === chat) && (!who || r.who === who)
    && (!day || dayOf(r.ts) === day)
    && (!key || r.acts?.some((a) => FILE_KINDS.has(a.k) && a.t && fileKey(a.t) === key))
    && (!kind || (kind === 'answer' ? !r.acts?.length : r.acts?.some((a) => a.k === kind)))
    && (!words || `${r.did} ${r.readWhat} ${r.ask?.text ?? ''}`.toLowerCase().includes(words)));
}
