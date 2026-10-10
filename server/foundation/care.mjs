// Care mode (fd14): the single door through which session-map writes into a project's repository.
// Contract: .dev/fundacao/00-contratos.md § 10 and bloco-3.md (decisions 1-4). Synchronous on purpose: one operation
// runs from its first check to its last write without another one interleaving in the same process.
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { FILE_MAX, isSecretsFile, safeResolve } from '../files.mjs';
import { log } from '../log.mjs';
import { assertSafeName } from '../store.mjs';
import { fdDir, readFd, writeFd } from './store.mjs';

export const MODES = ['auto', 'suggest', 'look'];
const SENSITIVE_KINDS = new Set(['delete', 'publish', 'money', 'account']);
const PROPOSAL_ACTIONS = { accept: 'accepted', dismiss: 'dismissed', never: 'never' };
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const KIND_RE = /^[a-z][a-z0-9-]{0,39}$/;
const DRIVE_RE = /^[a-z]:/i;
// Same as files.mjs: ".git" and its 8.3 short name ("GIT~1").
const GIT_NAME_RE = /^(\.git|git~\d+)$/i;
const SLUG_MAX = 100;
const FILES_MAX = 500;
// ponytail: deliberate ceiling of 500 undo records per project; the oldest go first.
export const UNDO_MAX = 500;

const iso = (now) => new Date(now()).toISOString();
const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const winKey = (abs) => (process.platform === 'win32' ? abs.toLowerCase() : abs);
// Windows drops trailing dots and spaces from a name, so ".env." and ".env " open ".env".
const bareName = (path) => String(path).replaceAll('\\', '/').split('/').pop().replace(/[. ]+$/, '');
export const isGitName = (segment) => GIT_NAME_RE.test(segment);
const nativeReal = (path) => { try { return realpathSync.native(path); } catch { return null; } };

function within(root, path, { orSame = false } = {}) {
  const rel = relative(root, path);
  if (rel === '') return orSame;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

// "op:abc" and "abc" name the same operation; the bare slug is the file name under proposals/ and undo/.
function opSlug(opId) {
  if (typeof opId !== 'string') return null;
  const slug = opId.startsWith('op:') ? opId.slice(3) : opId;
  return slug.length <= SLUG_MAX && SLUG_RE.test(slug) && !slug.includes('..') ? slug : null;
}

export function readCare(smDir, projectId) {
  const data = readFd(smDir, projectId, 'care.json', null);
  const mode = MODES.includes(data?.mode) ? data.mode : null;
  return { mode, askedAt: typeof data?.askedAt === 'string' ? data.askedAt : null };
}

// The owner answers the question once; later changes keep the first askedAt so the question is never asked again.
export function writeCare(smDir, projectId, mode, { now = Date.now } = {}) {
  if (!MODES.includes(mode)) throw new Error(`invalid care mode: ${mode}`);
  const at = iso(now);
  const care = { mode, askedAt: readCare(smDir, projectId).askedAt ?? at };
  writeFd(smDir, projectId, 'care.json', { version: 1, generatedAt: at, ...care });
  log('info', 'care-mode', { project: projectId, mode });
  return care;
}

function normalizeOp(op, now) {
  if (!op || typeof op !== 'object') return { error: 'bad-op' };
  const id = op.id === undefined || op.id === null ? `op:${now().toString(36)}-${randomBytes(4).toString('hex')}` : op.id;
  const slug = opSlug(id);
  if (!slug || typeof op.kind !== 'string' || !KIND_RE.test(op.kind)) return { error: 'bad-op' };
  if (!Array.isArray(op.files) || !op.files.length) return { error: 'bad-op' };
  if (op.files.length > FILES_MAX) return { error: 'too-big' };
  for (const f of op.files) {
    if (!f || typeof f !== 'object' || typeof f.path !== 'string' || !(f.after === null || typeof f.after === 'string')) return { error: 'bad-op' };
  }
  return {
    slug,
    op: {
      id: `op:${slug}`, kind: op.kind, sensitive: op.sensitive === true,
      findingId: typeof op.findingId === 'string' ? op.findingId : null,
      files: op.files.map((f) => ({ path: f.path, after: f.after })),
      why: op.why && typeof op.why === 'object' ? JSON.parse(JSON.stringify(op.why)) : null,
    },
  };
}

// Nearest folder that exists on the way up from abs, and the folders that would have to be created below it (deepest first).
function existingAncestor(abs) {
  const missing = [];
  let dir = dirname(abs);
  while (!existsSync(dir)) {
    missing.push(dir);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { dir, missing };
}

// Where a requested path may be written, or the reason it may not. safeResolve alone is not enough for a write:
// it returns a missing file as is, so a new file under a linked folder would land outside the root.
function targetOf(root, realRoot, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return { error: 'bad-path' };
  const slashed = rel.replaceAll('\\', '/');
  if (slashed.startsWith('/') || DRIVE_RE.test(slashed) || isAbsolute(rel)) return { error: 'outside-root' };
  const segments = slashed.split('/').filter(Boolean);
  // "a:b" would be a drive on Windows and a stream name on NTFS: never a plain file of the project.
  if (!segments.length || segments.some((s) => s.includes(':'))) return { error: 'bad-path' };
  const lexical = resolve(root, ...segments);
  if (!within(root, lexical)) return { error: 'outside-root' };
  if (isSecretsFile(slashed) || isSecretsFile(bareName(slashed))) return { error: 'secret-file' };
  const abs = safeResolve(root, rel);
  const { dir } = existingAncestor(abs ?? lexical);
  let realDir;
  try { realDir = realpathSync(dir); } catch { return { error: 'bad-path' }; }
  if (!within(realRoot, realDir, { orSame: true })) return { error: 'outside-root' };
  // A link inside the root may lead into .git; safeResolve only sees that for files that already exist.
  const nativeDir = nativeReal(dir);
  const nativeRoot = nativeReal(realRoot) ?? realRoot;
  for (const [base, path] of [[realRoot, realDir], [nativeRoot, nativeDir]]) {
    if (path && relative(base, path).split(sep).some(isGitName)) return { error: 'bad-path' };
  }
  if (!abs) return { error: 'bad-path' };
  // The JS realpath keeps 8.3 short names ("ENV~1"); the native one gives the real name (".env").
  if (isSecretsFile(abs) || isSecretsFile(bareName(abs)) || isSecretsFile(nativeReal(abs) ?? '')) return { error: 'secret-file' };
  return { abs, path: relative(root, lexical).split(sep).join('/') };
}

// The current bytes of a target: null when it does not exist. Text only, so undo can give back every byte.
function readCurrent(abs) {
  let st;
  try { st = lstatSync(abs); } catch (err) { return err.code === 'ENOENT' || err.code === 'ENOTDIR' ? { buf: null } : { error: 'bad-path' }; }
  if (!st.isFile() && !st.isSymbolicLink()) return { error: 'bad-path' };
  if (st.size > FILE_MAX) return { error: 'too-big' };
  let buf;
  try { buf = readFileSync(abs); } catch { return { error: 'bad-path' }; }
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) return { error: 'not-text' };
  return { buf, text, mode: statSync(abs).mode };
}

// The project's id when it is a safe folder name, else null: callers answer bad-path instead of throwing.
function projectId(project) {
  try { return typeof project?.id === 'string' ? assertSafeName(project.id, 'project id') : null; } catch { return null; }
}

function projectRoot(project) {
  try {
    const root = resolve(String(project?.root ?? ''));
    if (!project?.root || !statSync(root).isDirectory()) return null;
    return { root, realRoot: realpathSync(root) };
  } catch {
    return null;
  }
}

// Every check that does not depend on the mode: paths, secrets, sizes, text. First failure wins, in file order.
function prepare(project, op) {
  const roots = projectRoot(project);
  if (!roots) return { error: 'bad-path' };
  const seen = new Set();
  const targets = [];
  for (const f of op.files) {
    const t = targetOf(roots.root, roots.realRoot, f.path);
    if (t.error) return { error: t.error };
    if (seen.has(winKey(t.abs))) return { error: 'bad-path' };
    seen.add(winKey(t.abs));
    if (f.after !== null && Buffer.byteLength(f.after, 'utf8') > FILE_MAX) return { error: 'too-big' };
    const cur = readCurrent(t.abs);
    if (cur.error) return { error: cur.error };
    targets.push({ ...t, after: f.after, current: cur });
  }
  return { ...roots, targets };
}

function writeRepoFile(abs, buf, mode) {
  // Unguessable name, and 'wx' fails on anything already there instead of writing through a planted link.
  const tmp = `${abs}.sm-${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, buf, { flag: 'wx' });
    if (mode !== undefined) chmodSync(tmp, mode & 0o777);
    renameSync(tmp, abs);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function removeEmptyDirs(dirs) {
  for (const dir of dirs) {
    try { rmdirSync(dir); } catch { /* not empty or already gone: someone else's files stay */ }
  }
}

// Puts each target in its wanted state; on the first failure the ones already touched go back and created folders go.
function writeAll(steps) {
  const done = [];
  const made = [];
  try {
    for (const s of steps) {
      if (s.buf === null) {
        if (existsSync(s.abs)) unlinkSync(s.abs);
      } else {
        const { missing } = existingAncestor(s.abs);
        mkdirSync(dirname(s.abs), { recursive: true });
        made.push(...missing);
        writeRepoFile(s.abs, s.buf, s.mode);
      }
      done.push(s);
    }
    return { ok: true, made };
  } catch (err) {
    for (const s of done.reverse()) {
      try {
        if (s.back === null) rmSync(s.abs, { force: true });
        else writeRepoFile(s.abs, s.back, s.mode);
      } catch (backErr) {
        log('error', 'care-rollback-failed', { path: s.path, code: backErr.code });
      }
    }
    removeEmptyDirs(made.sort((a, b) => b.length - a.length));
    return { ok: false, code: err.code };
  }
}

const result = (ok, status, op, files, error) => ({ ok, status, opId: op?.id ?? null, files, ...(error ? { error } : {}) });

// applyOp(project, op, { smDir, mode, accept, confirm, now }) → { ok, status, opId, files, error? }.
// mode undefined = read care.json; any mode given (null included) is used in memory and never written.
export function applyOp(project, rawOp, { smDir, mode, accept = false, confirm = false, now = Date.now } = {}) {
  const norm = normalizeOp(rawOp, now);
  if (norm.error) return result(false, 'refused', null, [], norm.error);
  const { op, slug } = norm;
  const id = projectId(project);
  if (!id) return result(false, 'refused', op, op.files.map((f) => f.path), 'bad-path');
  const prep = prepare(project, op);
  const files = prep.targets?.map((t) => t.path) ?? op.files.map((f) => f.path);
  if (prep.error) return result(false, 'refused', op, files, prep.error);

  const sensitive = op.sensitive || SENSITIVE_KINDS.has(op.kind) || op.files.some((f) => f.after === null);
  if (sensitive && confirm !== true) return result(false, 'needs-confirm', op, files);

  const active = mode === undefined ? readCare(smDir, id).mode : mode;
  if (active !== 'auto' && active !== 'suggest') return result(false, 'look-only', op, files);

  if (active === 'suggest' && accept !== true) {
    const diff = prep.targets.map((t) => ({ path: t.path, before: t.current.text ?? null, after: t.after }));
    writeFd(smDir, id, `proposals/${slug}.json`, { version: 1, op: { ...op, files: op.files.map((f, i) => ({ ...f, path: files[i] })) }, mode: active, createdAt: iso(now), state: 'open', diff });
    log('info', 'care-op-proposed', { project: id, opId: op.id, kind: op.kind, files });
    return result(true, 'proposed', op, files);
  }

  const undoName = `undo/${slug}.json`;
  const previous = readFd(smDir, id, undoName, null);
  if (previous && previous.undone !== true) return result(false, 'refused', op, files, 'already-applied');

  const record = {
    version: 1, id: op.id, at: iso(now), mode: active, kind: op.kind, findingId: op.findingId, why: op.why,
    files: prep.targets.map((t) => ({ path: t.path, before: t.current.text ?? null, afterSha: t.after === null ? null : sha16(Buffer.from(t.after, 'utf8')) })),
    dirs: [], undone: false,
  };
  // Undo is on disk before the repository is touched: a crash halfway still knows what to put back.
  writeFd(smDir, id, undoName, record);
  const steps = prep.targets.map((t) => ({
    abs: t.abs, path: t.path, mode: t.current.mode,
    buf: t.after === null ? null : Buffer.from(t.after, 'utf8'), back: t.current.buf,
  }));
  const written = writeAll(steps);
  if (!written.ok) {
    rmSync(join(fdDir(smDir, id), 'undo', `${slug}.json`), { force: true });
    log('warn', 'care-op-failed', { project: id, opId: op.id, code: written.code });
    return result(false, 'refused', op, files, 'write-failed');
  }
  record.dirs = [...new Set(written.made)].sort((a, b) => b.length - a.length).map((d) => relative(prep.root, d).split(sep).join('/'));
  writeFd(smDir, id, undoName, record);
  pruneUndo(smDir, id);
  log('info', 'care-op-applied', { project: id, opId: op.id, kind: op.kind, mode: active, files });
  return result(true, 'applied', op, files);
}

function readDir(smDir, projectId, folder) {
  let names;
  try { names = readdirSync(join(fdDir(smDir, projectId), folder)); } catch { return []; }
  return names.filter((n) => n.endsWith('.json') && SLUG_RE.test(n))
    .map((n) => ({ slug: n.slice(0, -5), data: readFd(smDir, projectId, `${folder}/${n}`, null) }))
    .filter((e) => e.data && typeof e.data === 'object');
}

export function listProposals(smDir, projectId, { state } = {}) {
  return readDir(smDir, projectId, 'proposals').map((e) => e.data)
    .filter((p) => !state || p.state === state)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// accept → applies it (the files must still be what the proposal showed); dismiss / never → only the state changes.
export function resolveProposal(project, opId, action, { smDir, mode, confirm = false, now = Date.now } = {}) {
  if (!Object.hasOwn(PROPOSAL_ACTIONS, action)) return { ok: false, error: 'bad-action' };
  const id = projectId(project);
  const roots = id && projectRoot(project);
  if (!roots) return { ok: false, error: 'bad-path' };
  const slug = opSlug(opId);
  const name = slug && `proposals/${slug}.json`;
  const proposal = name ? readFd(smDir, id, name, null) : null;
  if (!proposal?.op) return { ok: false, error: 'not-found' };
  // A proposal the owner turned down stays turned down: accepting it later would apply what they said no to.
  if (action === 'accept' && proposal.state !== 'open') return { ok: false, error: 'not-open' };
  if (action !== 'accept') {
    writeFd(smDir, id, name, { ...proposal, state: PROPOSAL_ACTIONS[action], resolvedAt: iso(now) });
    return { ok: true, state: PROPOSAL_ACTIONS[action] };
  }
  const files = (proposal.diff ?? []).map((d) => d.path);
  for (const d of proposal.diff ?? []) {
    const t = targetOf(roots.root, roots.realRoot, d.path);
    const cur = !t.error ? readCurrent(t.abs) : { error: 'bad-path' };
    if (cur.error || (cur.text ?? null) !== d.before) return result(false, 'refused', proposal.op, files, 'changed-since');
  }
  const res = applyOp(project, proposal.op, { smDir, mode, accept: true, confirm, now });
  if (res.status === 'applied') writeFd(smDir, id, name, { ...proposal, state: 'accepted', resolvedAt: iso(now) });
  return res;
}

// Each file as the operation left it? afterSha null = the operation deleted it, so it must still be absent.
function undoCheck(roots, record) {
  const checks = [];
  for (const f of record.files ?? []) {
    const t = targetOf(roots.root, roots.realRoot, f.path);
    if (t.error) return { error: 'bad-path' };
    const cur = readCurrent(t.abs);
    const sha = cur.buf ? sha16(cur.buf) : null;
    if (cur.error || sha !== (f.afterSha ?? null)) return { error: 'changed-since' };
    checks.push({ ...t, file: f, current: cur });
  }
  return { checks };
}

export function listUndo(smDir, projectId, { root, since } = {}) {
  const roots = root ? projectRoot({ root }) : null;
  return readDir(smDir, projectId, 'undo').map((e) => e.data)
    .filter((r) => !since || String(r.at) >= since)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)))
    .map((r) => (roots ? { ...r, undoable: r.undone !== true && !undoCheck(roots, r).error } : r));
}

export function pruneUndo(smDir, projectId, max = UNDO_MAX) {
  const records = listUndo(smDir, projectId);
  for (const r of records.slice(max)) {
    const slug = opSlug(r.id);
    if (slug) rmSync(join(fdDir(smDir, projectId), 'undo', `${slug}.json`), { force: true });
  }
}

// undoOp(project, opId, { smDir, confirm }) → { ok, restored } or { ok:false, error }. Refuses if any file moved on.
// Removing a file the operation created is a delete, so it asks for confirm like every delete.
export function undoOp(project, opId, { smDir, confirm = false, now = Date.now } = {}) {
  const id = projectId(project);
  const roots = id && projectRoot(project);
  if (!roots) return { ok: false, error: 'bad-path' };
  const slug = opSlug(opId);
  const name = slug && `undo/${slug}.json`;
  const record = name ? readFd(smDir, id, name, null) : null;
  if (!record || !Array.isArray(record.files)) return { ok: false, error: 'not-found' };
  if (record.undone === true) return { ok: false, error: 'already-undone' };
  const { checks, error } = undoCheck(roots, record);
  if (error) return { ok: false, error };
  if (confirm !== true && checks.some((c) => c.file.before === null && c.current.buf)) return { ok: false, error: 'needs-confirm' };
  const steps = checks.map((c) => ({
    abs: c.abs, path: c.path, mode: c.current.mode,
    buf: c.file.before === null ? null : Buffer.from(c.file.before, 'utf8'), back: c.current.buf,
  }));
  const written = writeAll(steps);
  if (!written.ok) {
    log('warn', 'care-undo-failed', { project: id, opId: record.id, code: written.code });
    return { ok: false, error: 'write-failed' };
  }
  removeEmptyDirs((record.dirs ?? []).map((d) => targetOf(roots.root, roots.realRoot, d)).filter((t) => !t.error).map((t) => t.abs));
  writeFd(smDir, id, name, { ...record, undone: true, undoneAt: iso(now) });
  log('info', 'care-op-undone', { project: id, opId: record.id, files: checks.map((c) => c.path) });
  return { ok: true, restored: checks.map((c) => c.path) };
}
