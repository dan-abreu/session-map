// The Changes tab's data (mind-map-page mm30): every change the conversations and their helpers made, placed on the
// project and part of its file, joined with what the folder holds not saved yet and with the version history. The rows
// and where each step sits in its transcript stay on the server (the state's internals); the page asks for them when the
// tab is open, and for one change's before and after when it is clicked. The state itself only carries what lights the
// boxes ("+N files +M lines now").
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { changeDetail, changeRows, freshOf, readChanges } from './changes.mjs';
import { isSecretsFile, readFileForView, worktreeDiff } from './files.mjs';
import { placer } from './footprint.mjs';
import { normalizePath } from './paths.mjs';
import { helperAgents } from './sources/claude.mjs';
import { firstTagWith, workingTree } from './sources/git.mjs';

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
function tagsSignature(root) {
  return new Promise((resolve) => {
    execFile('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/tags'], { cwd: root, timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? '' : out));
  });
}
async function tagsFor(root, hashes, nowMs) {
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

const mtimeIso = (root, rel) => {
  const st = statSync(join(root, rel), { throwIfNoEntry: false });
  return st?.isFile() ? new Date(st.mtimeMs).toISOString() : null;
};

// built: [{project, key, ownersOf, commits}] from collect; groups: [{root, items}]. Hangs project.fresh on each project
// and keeps the rows in the state's internals under `changes`.
export async function attachChanges({ dir, smDir, now, windowMs, liveById }, built, groups) {
  const nowMs = now.getTime();
  const byKey = new Map(built.map((b) => [b.key, b]));
  const titles = new Map(built.flatMap((b) => (b.project.conversations ?? []).map((r) => [r.sessionId, r.title])));
  const events = new Map(built.map((b) => [b.key, []]));
  const refs = new Map(built.map((b) => [b.key, new Map()]));
  const deadline = Date.now() + READ_BUDGET_MS;
  const newestFirst = groups.flatMap((g) => g.items.map((item) => ({ g, item }))).sort((x, y) => y.item.ref.mtimeMs - x.item.ref.mtimeMs);
  for (const { g, item } of newestFirst) {
    const s = item.summary;
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
          sessionId: s.sessionId, title: titles.get(s.sessionId) ?? s.title ?? '', model: change.model,
          agent: src.agent ? { label: src.agent.label, model: change.model ?? src.agent.model } : null,
        });
        refs.get(key).set(id, { file: src.file, change });
      }
    }
  }
  const store = new Map();
  for (const b of built) {
    const root = b.project.root;
    const worktree = (await workingTree(root)).map((w) => ({ ...w, ts: w.kind === 'delete' ? null : mtimeIso(root, w.path) }));
    const base = { events: events.get(b.key), worktree, commits: b.commits ?? [], ownersOf: b.ownersOf, nowIso: now.toISOString() };
    const draft = changeRows(base);
    const hashes = [...new Set(draft.filter((r) => r.hash).map((r) => r.hash))].slice(0, TAGGED_MAX);
    const rows = changeRows({ ...base, tagOf: await tagsFor(root, hashes, nowMs) }).slice(0, ROWS_MAX);
    for (const r of rows) if (r.id.startsWith('wt:')) refs.get(b.key).set(r.id, { wt: r.path });
    store.set(b.project.id, { root, rows, refs: refs.get(b.key) });
    b.project.fresh = freshOf(rows, nowMs);
  }
  return store;
}

const entryOf = (state, projectId) => state?.[INTERNALS]?.changes?.get(projectId) ?? null;

export const changesOf = (state, projectId) => entryOf(state, projectId)?.rows ?? [];

// The before and after of one change: {hunks, cut} for an edit or a new file; {hunks: [], before} for a removed one, its
// previous content from the version before it was removed (or the text a conversation wrote when it never was saved);
// {error} for a secrets file. null for an unknown change.
export async function changeDetailOf(state, projectId, id) {
  const entry = entryOf(state, projectId);
  const ref = entry?.refs.get(id);
  const row = ref && entry.rows.find((r) => r.id === id);
  if (!row) return null;
  if (isSecretsFile(row.path) || (row.from && isSecretsFile(row.from))) return { hunks: [], error: 'sensitive' };
  if (ref.wt) {
    const d = await worktreeDiff(entry.root, ref.wt);
    return d.ok ? { hunks: d.hunks, cut: d.cut } : { hunks: [], error: d.error };
  }
  if (row.kind === 'delete') {
    const prev = await readFileForView(entry.root, row.path, { ref: row.hash ? `${row.hash}^` : 'HEAD' });
    if (prev.ok) return { hunks: [], before: prev.text };
    const made = entry.rows.find((r) => r.path === row.path && r.kind === 'create' && r.ts <= row.ts && entry.refs.get(r.id)?.file);
    const d = made && changeDetail(entry.refs.get(made.id).file, entry.refs.get(made.id).change);
    return d ? { hunks: [], before: d.hunks.flatMap((h) => h.lines.map((l) => l.slice(1))).join('\n') } : { hunks: [], error: prev.error };
  }
  if (row.kind === 'rename') return { hunks: [] };
  return changeDetail(ref.file, ref.change) ?? { hunks: [], error: 'not-found' };
}
