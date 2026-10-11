// The Changes tab's data (mind-map-page mm30): every change the conversations and their helpers made, placed on the
// project and part of its file, joined with what the folder holds not saved yet and with the version history. The rows
// and where each step sits in its transcript stay on the server (the state's internals); the page asks for them when the
// tab is open, and for one change's before and after when it is clicked. The state itself only carries what lights the
// boxes ("+N files +M lines now").
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { changeDetail, changeRows, freshOf, readChanges } from './changes.mjs';
import { FILE_MAX, isSecretsFile, readFileForView, safeResolve, worktreeDiff } from './files.mjs';
import { listUndo } from './foundation/care.mjs';
import { placer } from './footprint.mjs';
import { normalizePath } from './paths.mjs';
import { keepSnapshots, readSnapshot, snapshotDir } from './snapshots.mjs';
import { helperAgents } from './sources/claude.mjs';
import { maskSecrets } from './sources/claude-conversation.mjs';
import { firstTagWith, workingTree } from './sources/git.mjs';
import { runGit } from './sources/gitqueue.mjs';

const INTERNALS = Symbol.for('session-map.internals');
const ROWS_MAX = 2000;
// ponytail: the release of the newest 60 saved changes is looked up (one git call each, remembered); older ones read "saved".
const TAGGED_MAX = 60;
const TAGS_TTL_MS = 30_000;
// Reading a month of transcripts the first time takes tens of seconds: each pass spends at most this much, newest
// conversations first, and the next passes go on where it stopped.
const READ_BUDGET_MS = 1500;

const idOf = (...parts) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);

// root → {at, sig, tags: hash → tag | null}: the tag list is checked again at most every 30 s.
const tagMemo = new Map();
async function tagsSignature(root) {
  return (await runGit(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/tags'], { timeout: 5000 })).stdout;
}

// root → {at, stamp, tree}, for a project nobody works on now: git status and diff run again only when the index or HEAD
// moved, a conversation edited a file of the project after the last look, or TREE_TTL_MS passed (an edit by hand).
const TREE_TTL_MS = 60_000;
const treeMemo = new Map();
const treeStamp = (root) => ['index', 'HEAD'].map((m) => {
  const st = statSync(join(root, '.git', m), { throwIfNoEntry: false });
  return st ? `${st.mtimeMs}:${st.size}` : '-';
}).join('|');
export async function treeFor(root, { nowMs, editedMs = 0, read = workingTree }) {
  const stamp = treeStamp(root);
  const hit = treeMemo.get(root);
  if (hit && hit.stamp === stamp && nowMs - hit.at < TREE_TTL_MS && editedMs <= hit.at) return hit.tree;
  const tree = await read(root);
  treeMemo.set(root, { at: nowMs, stamp, tree });
  return tree;
}
export async function tagsFor(root, hashes, nowMs) {
  let memo = tagMemo.get(root);
  if (!memo || nowMs - memo.at > TAGS_TTL_MS) {
    const sig = await tagsSignature(root);
    if (!memo || memo.sig !== sig) memo = { sig, tags: new Map() };
    memo.at = nowMs;
    tagMemo.set(root, memo);
  }
  if (!memo.sig) return memo.tags;
  for (const hash of hashes) if (!memo.tags.has(hash)) memo.tags.set(hash, await firstTagWith(root, hash));
  return memo.tags;
}

const agentMemo = new Map();
// The helper transcripts of a conversation, listed again only while it is live or when its own transcript changed.
function agentsOf(item, live) {
  const sessionDir = join(dirname(item.ref.path), item.ref.sessionId);
  const sig = `${item.ref.mtimeMs}:${item.ref.size}`;
  const hit = agentMemo.get(sessionDir);
  if (hit && !live && hit.sig === sig) return hit.agents;
  const agents = helperAgents(sessionDir);
  agentMemo.set(sessionDir, { sig, agents });
  return agents;
}

// Who made a change: the helper, and for a workflow agent its workflow and the request that launched it (mm31), so a
// changed file leads back to what the owner asked. A helper started on its own has the request before its launch (mm37);
// words: what the conversation gave the team or the helper, when the owner's message answers something else.
const requestOf = (launch) => (launch ? { text: launch.text, ts: launch.ts, ...(launch.words ? { words: launch.words } : {}) } : null);
function agentOf(agent, change, item) {
  const who = { label: agent.label, model: change.model ?? agent.model };
  if (!agent.workflowId) {
    const launch = requestOf(item.summary.launches?.[agent.agentId]);
    return launch ? { ...who, request: launch } : who;
  }
  const name = item.workflows?.find((w) => w.id === agent.workflowId)?.name ?? agent.workflowId;
  return { ...who, workflow: { id: agent.workflowId, name }, request: requestOf(item.summary.launches?.[agent.workflowId]) };
}

const mtimeIso = (root, rel) => {
  const st = statSync(join(root, rel), { throwIfNoEntry: false });
  return st?.isFile() ? new Date(st.mtimeMs).toISOString() : null;
};

// built: [{project, key, ownersOf, commits}] from collect; groups: [{root, items}]. Hangs project.fresh on each project
// and keeps the rows in the state's internals under `changes`. removed: the ids removed from session-map (mm43), whose
// changes still show, as made outside a conversation.
export async function attachChanges({ dir, smDir, now, windowMs, liveById, removed = new Set() }, built, groups) {
  const nowMs = now.getTime();
  const byKey = new Map(built.map((b) => [b.key, b]));
  const titles = new Map(built.flatMap((b) => (b.project.conversations ?? []).map((r) => [r.sessionId, r.title])));
  const events = new Map(built.map((b) => [b.key, []]));
  const refs = new Map(built.map((b) => [b.key, new Map()]));
  const deadline = Date.now() + READ_BUDGET_MS;
  const newestFirst = groups.flatMap((g) => g.items.map((item) => ({ g, item }))).sort((x, y) => y.item.ref.mtimeMs - x.item.ref.mtimeMs);
  for (const { g, item } of newestFirst) {
    const s = item.summary;
    const unnamed = removed.has(s.sessionId);
    const place = placer({ root: g.root, cwd: s.cwd, skip: [dir, smDir] });
    const sources = [{ file: item.ref.path, agent: null }, ...agentsOf(item, liveById.has(s.sessionId)).map((a) => ({ file: a.file, agent: a }))];
    for (const src of sources) {
      for (const change of readChanges(src.file, { deadline })) {
        if (!(Date.parse(change.ts) >= nowMs - windowMs)) continue;
        const hit = place(change.path);
        const key = hit && normalizePath(hit.home);
        if (!key || !byKey.has(key)) continue;
        const id = idOf(src.file, change.useAt, change.kind, change.path);
        const from = change.from ? place(change.from) : null;
        events.get(key).push({
          id, ts: change.ts, kind: change.kind, path: hit.rel, ...(from ? { from: from.rel } : {}), added: change.added, removed: change.removed,
          sessionId: unnamed ? null : s.sessionId, title: unnamed ? null : titles.get(s.sessionId) ?? s.title ?? '', model: change.model,
          agent: src.agent && !unnamed ? agentOf(src.agent, change, item) : null,
        });
        refs.get(key).set(id, { file: src.file, change });
      }
    }
  }
  const store = new Map();
  for (const b of built) {
    const root = b.project.root;
    const snapDir = snapshotDir(smDir, b.project.id);
    const ops = opRows(smDir, b.project.id, root, nowMs, windowMs);
    // A folder row that is exactly what an operation left (file not touched since) is the operation's row, not a second one.
    const mine = new Set(ops.filter((o) => o.undoable).flatMap((o) => o.files));
    // The project someone works on is looked at on every pass, so an edit by hand shows at once; the others wait.
    const quiet = b.project.background?.working === false;
    const editedMs = quiet ? events.get(b.key).reduce((max, e) => Math.max(max, Date.parse(e.ts) || 0), 0) : 0;
    const tree = (quiet ? await treeFor(root, { nowMs, editedMs }) : await workingTree(root)).filter((w) => !mine.has(w.path));
    const gone = keepSnapshots(snapDir, root, tree, nowMs, windowMs);
    const worktree = [...tree.map((w) => ({ ...w, ts: w.kind === 'delete' ? null : mtimeIso(root, w.path) })), ...gone];
    const base = { events: events.get(b.key), worktree, commits: b.commits ?? [], ownersOf: b.ownersOf, nowIso: now.toISOString() };
    const draft = changeRows(base);
    const hashes = [...new Set(draft.filter((r) => r.hash).map((r) => r.hash))].slice(0, TAGGED_MAX);
    const own = changeRows({ ...base, tagOf: await tagsFor(root, hashes, nowMs) });
    const owners = b.ownersOf(ops.map((o) => o.path));
    ops.forEach((o, i) => { o.partId = owners[i] ?? null; });
    const rows = [...own, ...ops].map((r, i) => [r, i]).sort(([x, i], [y, j]) => y.ts.localeCompare(x.ts) || i - j).map(([r]) => r).slice(0, ROWS_MAX);
    for (const r of rows) if (r.id.startsWith('wt:')) refs.get(b.key).set(r.id, { wt: r.path });
    store.set(b.project.id, { root, smDir, projectId: b.project.id, snapDir, rows, refs: refs.get(b.key) });
    b.project.fresh = freshOf(own, nowMs);
  }
  return store;
}

const entryOf = (state, projectId) => state?.[INTERNALS]?.changes?.get(projectId) ?? null;

export const changesOf = (state, projectId) => entryOf(state, projectId)?.rows ?? [];

const maskLine = (l) => l.slice(0, 1) + maskSecrets(l.slice(1));

// ---- what the session-map itself wrote (fd14): the Undo records of applyOp, shown beside the conversations' changes ----
const CONTEXT = 3;
const LCS_CELLS_MAX = 1_000_000;
const DETAIL_LINES_MAX = 3000;

const linesOf = (text) => {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

// A small line diff: common head and tail trimmed, the middle matched by longest common subsequence. A middle too big
// for that (ponytail: 1M cells) reads as all removed then all added, which is still true, only longer.
function lineOps(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const ops = a.slice(0, head).map((l) => [' ', l]);
  if ((x.length + 1) * (y.length + 1) > LCS_CELLS_MAX) {
    ops.push(...x.map((l) => ['-', l]), ...y.map((l) => ['+', l]));
  } else {
    const w = y.length + 1;
    const len = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) len[i * w + j] = x[i] === y[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { ops.push([' ', x[i]]); i++; j++; }
      else if (j >= y.length || (i < x.length && len[(i + 1) * w + j] >= len[i * w + j + 1])) { ops.push(['-', x[i]]); i++; }
      else { ops.push(['+', y[j]]); j++; }
    }
  }
  ops.push(...a.slice(a.length - tail).map((l) => [' ', l]));
  return ops;
}

// before/after: text or null (the file did not exist / does not now) → {hunks: [{oldStart, newStart, lines}], added, removed}.
export function lineDiff(before, after) {
  const ops = lineOps(linesOf(before), linesOf(after));
  const changed = ops.flatMap(([t], i) => (t === ' ' ? [] : [i]));
  let oldAt = 1;
  let newAt = 1;
  const starts = ops.map(([t]) => { const at = [oldAt, newAt]; if (t !== '+') oldAt++; if (t !== '-') newAt++; return at; });
  const hunks = [];
  for (let k = 0; k < changed.length;) {
    const from = Math.max(0, changed[k] - CONTEXT);
    let last = changed[k];
    while (k + 1 < changed.length && changed[k + 1] - last <= 2 * CONTEXT) last = changed[++k];
    k++;
    const to = Math.min(ops.length, last + CONTEXT + 1);
    hunks.push({ oldStart: before === null ? 0 : starts[from][0], newStart: starts[from][1], lines: ops.slice(from, to).map(([t, l]) => t + l) });
  }
  return { hunks, added: ops.filter(([t]) => t === '+').length, removed: ops.filter(([t]) => t === '-').length };
}

function currentText(root, rel) {
  const abs = safeResolve(root, rel);
  if (!abs) return null;
  try {
    const buf = readFileSync(abs);
    return buf.length > FILE_MAX || buf.includes(0) ? null : buf.toString('utf8');
  } catch {
    return null;
  }
}

const opKind = (files) => (files.every((f) => f.before === null) ? 'create' : files.every((f) => f.afterSha === null) ? 'delete' : 'edit');

// One row per operation in the window. While the files are as the operation left them the counts are its own lines; once
// undone or edited since, the record no longer knows the "after", so they read 0.
function opRows(smDir, id, root, nowMs, windowMs) {
  return listUndo(smDir, id, { root, since: new Date(nowMs - windowMs).toISOString() }).map((r) => {
    const files = (r.files ?? []).filter((f) => f && typeof f.path === 'string');
    let added = 0;
    let removed = 0;
    if (r.undoable) {
      for (const f of files) {
        const d = lineDiff(f.before, f.afterSha === null ? null : currentText(root, f.path));
        added += d.added;
        removed += d.removed;
      }
    }
    return {
      id: `op:${String(r.id).replace(/^op:/, '')}`, ts: r.at, kind: opKind(files), path: files[0]?.path ?? '', added, removed,
      sessionId: null, title: null, agent: null, origin: 'session-map', opId: r.id, mode: r.mode, files: files.map((f) => f.path),
      undoable: r.undoable === true, undone: r.undone === true, state: 'pending',
    };
  }).filter((r) => r.path);
}

// The Undo record against the file now (the record keeps the "before"; the file is the "after"), secrets masked.
function opDetail(root, row, record) {
  let left = DETAIL_LINES_MAX;
  let cut = false;
  const hunks = [];
  for (const f of record.files ?? []) {
    if (isSecretsFile(f.path)) return { hunks: [], error: 'sensitive' };
    const d = lineDiff(f.before, currentText(root, f.path));
    for (const h of d.hunks) {
      const lines = h.lines.slice(0, Math.max(0, left));
      if (lines.length < h.lines.length) cut = true;
      left -= lines.length;
      if (lines.length) hunks.push({ ...h, path: f.path, lines: lines.map(maskLine) });
    }
  }
  return { hunks, cut, files: row.files, undoable: row.undoable, undone: row.undone };
}

// The before and after of one change, secrets masked: {hunks, cut} for an edit or a new file; {hunks: [], before} for a
// removed one, its previous content: the last copy a pass kept (snapshots.mjs), else the version before it was removed,
// else the text a conversation wrote when no step changed it after; {error: 'not-kept'} when none of them holds it;
// {error} for a secrets file. null for an unknown change.
export async function changeDetailOf(state, projectId, id) {
  const entry = entryOf(state, projectId);
  const ref = entry?.refs.get(id);
  const row = entry && entry.rows.find((r) => r.id === id && (ref || r.origin === 'session-map'));
  if (!row) return null;
  if (row.origin === 'session-map') {
    const record = listUndo(entry.smDir, entry.projectId).find((r) => r.id === row.opId);
    return record ? opDetail(entry.root, row, record) : null;
  }
  if (isSecretsFile(row.path) || (row.from && isSecretsFile(row.from))) return { hunks: [], error: 'sensitive' };
  if (row.kind === 'delete') {
    const kept = entry.snapDir ? readSnapshot(entry.snapDir, row.path, Date.parse(row.ts)) : null;
    if (kept !== null) return { hunks: [], before: kept };
  }
  if (ref.wt) {
    const d = await worktreeDiff(entry.root, ref.wt);
    if (d.ok) return { hunks: d.hunks.map((h) => ({ ...h, lines: h.lines.map(maskLine) })), cut: d.cut };
    return { hunks: [], error: d.error === 'not-found' && row.kind === 'delete' ? 'not-kept' : d.error };
  }
  if (row.kind === 'delete') {
    const prev = await readFileForView(entry.root, row.path, { ref: row.hash ? `${row.hash}^` : 'HEAD' });
    if (prev.ok) return { hunks: [], before: maskSecrets(prev.text) };
    const made = entry.rows.find((r) => r.path === row.path && r.kind === 'create' && r.ts <= row.ts && entry.refs.get(r.id)?.file);
    // A step that changed it after it was written makes that text stale: better say it was not kept than show it.
    const changedSince = made && entry.rows.some((r) => r !== made && r !== row && r.path === row.path && r.ts >= made.ts && r.ts <= row.ts);
    const d = made && !changedSince && changeDetail(entry.refs.get(made.id).file, entry.refs.get(made.id).change);
    if (d) return { hunks: [], before: d.hunks.flatMap((h) => h.lines.map((l) => l.slice(1))).join('\n') };
    return { hunks: [], error: prev.error === 'not-found' ? 'not-kept' : prev.error };
  }
  if (row.kind === 'rename') return { hunks: [] };
  return changeDetail(ref.file, ref.change) ?? { hunks: [], error: 'not-found' };
}
