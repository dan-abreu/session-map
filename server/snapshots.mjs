// What a changed file held, kept in the session-map folder (never in the project) so the Changes tab can still show what
// a removed file had (mm30): git keeps only what was saved, and a file a conversation, a script or the owner made and
// then removed is gone from the folder. Each pass copies the files not saved yet that changed since the last copy,
// masked; a copy goes when its file is saved again (the version history holds it) or a month after it was last seen.
// One folder per project: index.json (path → {file, mtimeMs, lines, kind, goneMs?}) and one text file per path.
import { createHash } from 'node:crypto';
import { readFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isSecretsFile } from './files.mjs';
import { maskSecrets } from './sources/claude-conversation.mjs';
import { assertSafeName, readJsonFile, writeAtomic } from './store.mjs';

const FILE_MAX_BYTES = 256 * 1024;
// ponytail: past 32 MB per project the oldest copies go first; a removed file that big is better recovered from a backup.
const PROJECT_MAX_BYTES = 32 * 1024 * 1024;

export const snapshotDir = (smDir, projectId) => join(smDir, 'kept-copies', assertSafeName(projectId, 'project id'));
const fileOf = (path) => `${createHash('sha1').update(path).digest('hex').slice(0, 20)}.txt`;
const lineCount = (text) => (text.match(/\n/g)?.length ?? 0) + (text && !text.endsWith('\n') ? 1 : 0);
const statOf = (abs) => {
  try {
    return statSync(abs, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
};

function copyOf(abs) {
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    return null;
  }
  return buf.subarray(0, 8000).includes(0) ? null : maskSecrets(buf.toString('utf8'));
}

// worktree: what workingTree found. Returns the files that were never saved and are gone from the folder since a pass
// saw them (git has no trace of those), as removals for the Changes tab.
export function keepSnapshots(dir, root, worktree, nowMs, windowMs) {
  const indexPath = join(dir, 'index.json');
  const index = readJsonFile(indexPath, {}) ?? {};
  let changed = false;
  const drop = (path) => {
    try { unlinkSync(join(dir, index[path].file)); } catch { /* already gone */ }
    delete index[path];
    changed = true;
  };
  const listed = new Set(worktree.map((w) => w.path));
  for (const w of worktree) {
    if (w.kind === 'delete' || isSecretsFile(w.path)) continue;
    const st = statOf(join(root, w.path));
    if (!st?.isFile() || st.size > FILE_MAX_BYTES) continue;
    const had = index[w.path];
    if (had && had.mtimeMs === st.mtimeMs && had.size === st.size && had.goneMs === undefined) continue;
    const text = copyOf(join(root, w.path));
    if (text === null) continue;
    const file = fileOf(w.path);
    writeAtomic(join(dir, file), text);
    index[w.path] = { file, mtimeMs: st.mtimeMs, size: st.size, bytes: Buffer.byteLength(text), lines: lineCount(text), kind: had?.kind === 'create' ? 'create' : w.kind };
    changed = true;
  }
  for (const [path, e] of Object.entries(index)) {
    if (listed.has(path)) continue;
    if (statOf(join(root, path))) drop(path);
    else if (e.goneMs === undefined) {
      e.goneMs = nowMs;
      changed = true;
    }
  }
  const lastSeen = (e) => e.goneMs ?? e.mtimeMs;
  let bytes = 0;
  for (const [path, e] of Object.entries(index).sort(([, a], [, b]) => lastSeen(b) - lastSeen(a))) {
    bytes += e.bytes ?? 0;
    if (lastSeen(e) < nowMs - windowMs || bytes > PROJECT_MAX_BYTES) drop(path);
  }
  if (changed) writeAtomic(indexPath, JSON.stringify(index));
  return Object.entries(index)
    .filter(([path, e]) => e.goneMs !== undefined && e.kind === 'create' && !listed.has(path))
    .map(([path, e]) => ({ path, kind: 'delete', added: 0, removed: e.lines, ts: new Date(e.goneMs).toISOString() }));
}

// The last copy of a path made no later than atMs, or null.
export function readSnapshot(dir, path, atMs) {
  const e = (readJsonFile(join(dir, 'index.json'), {}) ?? {})[path];
  if (!e || !(e.mtimeMs <= atMs)) return null;
  try {
    return readFileSync(join(dir, e.file), 'utf8');
  } catch {
    return null;
  }
}
