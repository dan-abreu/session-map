import { mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { normalizePath } from './paths.mjs';
import { execCapture } from './sources/catalog.mjs';
import { writeAtomic } from './store.mjs';
import { repoNameOf } from './web/reponame.js';

export { repoNameOf };

// A new project (sv14): the page creates its folder, and session-map lists it as a project before any conversation runs
// there. The folder is remembered in the person's config.json; its first conversation makes it a project like the others.

const NAME_MAX = 80;
// Names Windows cannot hold, on any computer: a project folder may be copied to one.
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// One plain folder name: never a path, never a name a disk refuses.
export function nameError(name) {
  if (typeof name !== 'string') return 'bad-name';
  const n = name.trim();
  if (!n || n.length > NAME_MAX || n === '.' || n === '..' || BAD_CHARS.test(n) || /[. ]$/.test(n) || RESERVED.test(n)) return 'bad-name';
  return null;
}

// body: {parent (an absolute folder that exists), name}. → {ok, root} or {ok: false, error}.
export function createProject(smDir, body, { now = new Date() } = {}) {
  const error = nameError(body?.name);
  if (error) return { ok: false, error };
  const { parent } = body;
  if (typeof parent !== 'string' || !parent.trim() || !isAbsolute(parent.trim()) || !isDir(parent.trim())) return { ok: false, error: 'bad-parent' };
  const root = join(resolve(parent.trim()), body.name.trim());
  const file = join(smDir, 'config.json');
  let config = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: 'config-unreadable' };
  }
  // A config.json session-map cannot read whole is never written over: the person's other settings would be lost.
  if (!isObject(config) || (config.projects !== undefined && !isObject(config.projects))) return { ok: false, error: 'config-unreadable' };
  try {
    // Not recursive: an existing folder (or file) answers EEXIST and is never touched.
    mkdirSync(root);
  } catch (err) {
    if (err.code === 'EEXIST') return { ok: false, error: 'folder-exists' };
    return { ok: false, error: 'folder-failed' };
  }
  const key = normalizePath(root);
  const projects = { ...(config.projects ?? {}) };
  projects[key] = { ...(isObject(projects[key]) ? projects[key] : {}), created: { at: now.toISOString(), root } };
  try {
    writeAtomic(file, `${JSON.stringify({ ...config, projects }, null, 2)}\n`);
  } catch {
    // Not remembered, the folder would be lost to the map and a retry would find it taken: the empty folder goes away.
    rmdirSync(root);
    return { ok: false, error: 'config-unreadable' };
  }
  return { ok: true, root };
}

// The folders session-map created, as they were typed: the collect shows each one that still exists as a project.
export function createdRoots(userConfig) {
  const projects = isObject(userConfig?.projects) ? userConfig.projects : {};
  return Object.values(projects).map((p) => p?.created?.root).filter((r) => typeof r === 'string' && r);
}

// ---- GitHub (sv15): only when the person chose it, through the gh login already on this computer ----

const GH_TTL_MS = 5 * 60_000;
let ghSeen = null;

// Who is logged in to GitHub here: {ready, user}. Asked again after GH_TTL_MS, or at once with fresh.
export async function githubStatus({ exec = execCapture, fresh = false, now = Date.now } = {}) {
  if (!fresh && ghSeen && now() - ghSeen.at < GH_TTL_MS) return ghSeen.status;
  const out = await exec('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 15_000 });
  const user = out.code === 0 ? out.stdout.trim() : '';
  const status = user ? { ready: true, user } : { ready: false, user: null };
  ghSeen = { at: now(), status };
  return status;
}

// What gh says when a repository does not exist.
const NOT_FOUND_RE = /could not resolve to a repository|not found|http 404/i;

const detailOf = (out) => (out.stderr || out.stdout).trim().slice(-300);

// The folder becomes a repository with a README and a first save, and goes to GitHub as `repo`.
async function publish(root, { name, repo, user, isPrivate }, exec) {
  try {
    writeFileSync(join(root, 'README.md'), `# ${name}\n`, { flag: 'wx' });
  } catch (err) {
    return { ok: false, error: 'git-failed', detail: err.code ?? 'README' };
  }
  for (const args of [['init', '-b', 'main'], ['add', 'README.md'], ['commit', '-m', 'Primeiro commit']]) {
    const out = await exec('git', args, { cwd: root, timeoutMs: 30_000 });
    if (out.code !== 0) return { ok: false, error: 'git-failed', detail: detailOf(out) };
  }
  const out = await exec('gh', ['repo', 'create', `${user}/${repo}`, isPrivate ? '--private' : '--public', '--source', '.', '--remote', 'origin', '--push'], { cwd: root, timeoutMs: 120_000 });
  if (out.code !== 0) return { ok: false, error: 'github-failed', detail: detailOf(out) };
  return { ok: true, url: `https://github.com/${user}/${repo}`, private: isPrivate };
}

// body: {parent, name, github?: 'private' | 'public'}. GitHub is checked before the folder is made, so a refusal there
// leaves nothing behind; a step that fails after it keeps the folder (the project is there) and says which step.
export async function newProject(smDir, body, { exec = execCapture, fresh = false, now } = {}) {
  const github = body?.github;
  if (github !== undefined && github !== null && github !== false && github !== 'private' && github !== 'public') return { ok: false, error: 'bad-github' };
  const wanted = github === 'private' || github === 'public';
  let gh = null;
  let repo = null;
  if (wanted) {
    const error = nameError(body.name);
    if (error) return { ok: false, error };
    repo = repoNameOf(body.name.trim());
    if (!repo) return { ok: false, error: 'bad-repo-name' };
    gh = await githubStatus({ exec, fresh });
    if (!gh.ready) return { ok: false, error: 'github-not-ready' };
    // The account the page showed is the one that receives the repository: a switch in between stops here.
    if (typeof body.githubUser === 'string' && body.githubUser !== gh.user) return { ok: false, error: 'github-user-changed' };
    const seen = await exec('gh', ['repo', 'view', `${gh.user}/${repo}`, '--json', 'name'], { timeoutMs: 15_000 });
    if (seen.code === 0) return { ok: false, error: 'repo-exists' };
    // Only a clear "no such repository" lets the name through; no answer (network, login) stops before the folder.
    if (!NOT_FOUND_RE.test(`${seen.stderr}${seen.stdout}`)) return { ok: false, error: 'github-unreachable', detail: detailOf(seen) };
  }
  const made = createProject(smDir, body, now ? { now } : {});
  if (!made.ok || !wanted) return made;
  return { ...made, github: await publish(made.root, { name: body.name.trim(), repo, user: gh.user, isPrivate: github === 'private' }, exec) };
}

// Where a new project goes by default: the folder most of the person's projects live in, else their home folder.
export function suggestParent(roots, { home = homedir() } = {}) {
  const count = new Map();
  for (const r of roots) {
    const up = dirname(r);
    if (up === r) continue;
    count.set(up, (count.get(up) ?? 0) + 1);
  }
  let best = null;
  for (const [dir, n] of count) if (!best || n > best.n) best = { dir, n };
  return best?.dir ?? home;
}
