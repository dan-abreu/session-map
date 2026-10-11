// Foundation routes of block B4 (fd08 health, fd09 versions). Contract: http/index.mjs.
// The network is only touched by POST online, at the owner's click and at most once a minute per project. A fix never
// writes by itself: the client names a catalogue item, the server builds the draft (health-drafts) from what the program
// read, and care.applyOp decides, by the care mode, whether it is written, proposed or refused.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { safeResolve } from '../../files.mjs';
import { log } from '../../log.mjs';
import { normalizePath } from '../../paths.mjs';
import { readJsonFile } from '../../store.mjs';
import { applyOp } from '../care.mjs';
import { censusOf } from '../census.mjs';
import { buildHealthCtx } from '../health-ctx.mjs';
import { draftFor } from '../health-drafts.mjs';
import { fetchApiFacts, githubToken, writeApiFacts } from '../health-github.mjs';
import { HEALTH_ITEMS } from '../health-items.mjs';
import { healthOf } from '../health.mjs';
import { fetchSources } from '../versions-online.mjs';
import { versionsOf } from '../versions.mjs';
import { readFd, writeFd } from '../store.mjs';
import { fail } from './common.mjs';

// ponytail: one online round a minute per project; GitHub allows 60 anonymous calls an hour and a round makes about ten.
export const ONLINE_GAP_MS = 60_000;
const ITEM_IDS = new Set(HEALTH_ITEMS.map((i) => i.id));
// What care.applyOp may answer, as HTTP (the same table as the B3 routes).
const ERRORS = {
  'bad-path': 400, 'bad-op': 400, 'outside-root': 400, 'secret-file': 403, 'look-only': 409, 'needs-confirm': 409,
  'already-applied': 409, 'too-big': 413, 'not-text': 415, 'write-failed': 500,
};

const rootOf = (ctx) => ctx.project.root || fail(409, 'no-root');
const censusOfCtx = (ctx) => {
  const census = ctx.read('census.json', null);
  return Array.isArray(census?.files) ? census : null;
};

function audit(ctx, what, fields) {
  log('info', 'foundation-health-write', { project: ctx.project.id, what, ...fields });
}

// The live-version address comes only from the user's own config.json, never from a file inside the repository
// (a cloned repository could point it at the local network). bloco-4b § 5.
function liveUrlOf(smDir, root) {
  const projects = readJsonFile(join(smDir, 'config.json'), {})?.projects;
  if (!projects || typeof projects !== 'object') return null;
  const key = normalizePath(root);
  const url = Object.hasOwn(projects, key) ? projects[key]?.liveVersionUrl : null;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

// versions-online.json (contract of B4-T16) <-> the `cached` fetchSources reads back.
const onlineFile = (src, at) => ({
  version: 1, generatedAt: at, fetchedAt: src.fetchedAt,
  sources: { vulns: src.vulns, eol: src.eol, latest: src.latest, reason: src.reason }, live: src.live, selfVersion: src.self,
});
const cachedOf = (file) => (file?.version === 1 && file.sources
  ? { fetchedAt: file.fetchedAt, vulns: file.sources.vulns, eol: file.sources.eol, latest: file.sources.latest, self: file.selfVersion }
  : null);

// The draft's input, all of it read by the program: the census paths, the manifests, the env names the extractors found.
function draftInput(ctx, hctx, census) {
  const files = census.files.filter((f) => f?.kind !== 'dep' && typeof f.path === 'string').map((f) => f.path);
  const facts = ctx.read('facts.json', null);
  const envNames = (Array.isArray(facts?.facts) ? facts.facts : []).filter((f) => f?.kind === 'env' && typeof f.name === 'string').map((f) => f.name);
  const ecosystems = files.some((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p)) ? ['github-actions'] : [];
  return { files, packages: hctx.packages, envNames, projectName: ctx.project.name, license: null, ecosystems };
}

// healthRoutes({ fetchFn, env, now }): the network, the environment (the GitHub token) and the clock, injectable for tests.
export function healthRoutes({ fetchFn = (...a) => globalThis.fetch(...a), env = process.env, now = Date.now } = {}) {
  // smDir|projectId -> when its last online round started (running or not: a double click is the second round).
  const lastOnline = new Map();
  const busy = new Set();

  async function online(ctx) {
    const root = rootOf(ctx);
    const key = `${ctx.smDir}|${ctx.project.id}`;
    const started = now();
    const last = lastOnline.get(key);
    if (last !== undefined && started - last < ONLINE_GAP_MS) fail(429, 'too-soon');
    lastOnline.set(key, started);
    const { smDir } = ctx;
    const id = ctx.project.id;
    const census = censusOfCtx(ctx);

    // GitHub: only for the remote git names; the token, if any, goes to api.github.com alone (health-github.mjs).
    const hctx = await buildHealthCtx({ root, census, smDir, id });
    const token = githubToken(env);
    const api = await fetchApiFacts({ remote: hctx.git.remote, token, fetchFn, cached: readFd(smDir, id, 'health-api.json', null), now: started });
    writeApiFacts(smDir, id, api);

    // Versions: what the files declare (read offline, nothing written), then the sources about those pieces only.
    const local = await versionsOf({ root, census, cache: null });
    const src = await fetchSources({
      pieces: local.pieces, node: local.node, selfVersion: local.selfVersion?.current ?? null,
      liveUrl: liveUrlOf(smDir, root), codeVersion: local.code?.version ?? null,
      fetchFn, cached: cachedOf(readFd(smDir, id, 'versions-online.json', null)), now: started,
    });
    writeFd(smDir, id, 'versions-online.json', onlineFile(src, new Date(started).toISOString()));
    const versions = await versionsOf({ root, census, smDir, id });
    const health = await healthOf({ root, smDir, id });
    log('info', 'foundation-online', { project: id, api: api.mode, apiError: api.error ?? null, versions: src.reason ?? null });
    ctx.fresh();
    return { ok: true, health, versions, api: { mode: api.mode, fetchedAt: api.fetchedAt ?? null, error: api.error ?? null } };
  }

  async function fix(ctx) {
    const itemId = ctx.body?.itemId;
    const confirm = ctx.body?.confirm === true;
    if (typeof itemId !== 'string' || !ITEM_IDS.has(itemId)) {
      audit(ctx, 'fix', { item: typeof itemId === 'string' ? itemId.slice(0, 80) : null, error: 'bad-item' });
      fail(400, 'bad-item');
    }
    const root = rootOf(ctx);
    const census = censusOfCtx(ctx);
    if (!census) {
      audit(ctx, 'fix', { item: itemId, error: 'no-census' });
      fail(409, 'no-census');
    }
    const hctx = await buildHealthCtx({ root, census, smDir: ctx.smDir, id: ctx.project.id });
    const draft = draftFor(itemId, draftInput(ctx, hctx, census));
    if (!draft) {
      audit(ctx, 'fix', { item: itemId, error: 'no-draft' });
      fail(409, 'no-draft');
    }
    // The census may be older than the disk: a draft only creates, so a file that is there now stays untouched.
    // Checked right before applyOp, which is synchronous: nothing can land in between.
    if (draft.files.some((f) => { const abs = safeResolve(root, f.path); return !abs || existsSync(abs); })) {
      audit(ctx, 'fix', { item: itemId, error: 'exists' });
      fail(409, 'exists');
    }
    const op = { kind: 'health-draft', sensitive: false, files: draft.files, why: draft.why };
    const res = applyOp({ id: ctx.project.id, root }, op, { smDir: ctx.smDir, confirm });
    const code = res.ok ? null : res.error ?? res.status;
    audit(ctx, 'fix', { item: itemId, confirm, opId: res.opId, status: res.status, error: code });
    if (code) fail(ERRORS[code] ?? 409, code);
    ctx.fresh();
    if (res.status !== 'applied') return { ...res, placeholders: draft.placeholders };
    // The gap is measured again on the files as they are now (census in memory; the next refresh writes census.json).
    const known = new Map(census.files.map((f) => [f.path, f.owner ?? null]));
    const health = await healthOf({ root, smDir: ctx.smDir, id: ctx.project.id, census: await censusOf(root, census, { owners: known }) });
    return { ...res, placeholders: draft.placeholders, health };
  }

  return [
    { method: 'GET', path: 'health', run: (ctx) => ctx.read('health.json', null) },
    { method: 'GET', path: 'versions', run: (ctx) => ctx.read('versions.json', null) },
    { method: 'POST', path: 'online', run: online },
    {
      method: 'POST', path: 'health/fix',
      run: async (ctx) => {
        const key = `${ctx.smDir}|${ctx.project.id}`;
        if (busy.has(key)) fail(409, 'busy');
        busy.add(key);
        try {
          return await fix(ctx);
        } finally {
          busy.delete(key);
        }
      },
    },
  ];
}

export const routes = healthRoutes();
