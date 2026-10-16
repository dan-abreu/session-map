import { statSync } from 'node:fs';
import { readArch } from '../arch/detect.mjs';
import { withLocalParts } from '../arch/local.mjs';
import { loadConfig } from '../config.mjs';
import { mainBranch } from '../sources/git.mjs';
import { MODES } from './care.mjs';
import { recomputeGuide } from './guide.mjs';
import { healthOf } from './health.mjs';
import { buildModel } from './model.mjs';
import { fdPath, readFd, writeFd } from './store.mjs';
import { runUptodate } from './uptodate.mjs';
import { versionsOf } from './versions.mjs';

// The blocks after the reading step (fd20): each one reads what the reading step saved and writes its own file under
// brain/<id>/foundation/, in the order of the index: model -> versions -> profile, practices and compass -> health ->
// "Tudo em dia?".
// The refresh round runs them after `read` (refresh.mjs), and the summary the page draws reads their files (summary.mjs).
// Nothing here touches the project or the network: the blocks only read the saved files and the project's own files.

// The reading step did not read this project (no folder, too wide a folder): there is nothing to judge, and that is not a failure.
const unread = (ctx) => !ctx.results.read;

// Health is the dear block (91 checks, about 1.7 s on this repository): when the reading step found nothing new it is not
// run again for a quarter of an hour. Versions and "Tudo em dia?" look at git too, which moves without the census moving.
export const HEALTH_GAP_MS = 15 * 60_000;
const lastHealth = new Map();

const fileExists = (smDir, id, name) => { try { return statSync(fdPath(smDir, id, name)).isFile(); } catch { return false; } };

const sameDoc = (a, b) => JSON.stringify({ ...a, generatedAt: null }) === JSON.stringify({ ...b, generatedAt: null });

export function blockSteps({ now = () => new Date(), clock = Date.now } = {}) {
  return [
    {
      // fd03: the one model of the code (levels 1 to 3), from the facts, the census and the architecture. The owner's drawing
      // (model-overrides.json) and the approved claims (claims.json) are laid over it when they exist.
      name: 'model',
      async run(ctx) {
        if (unread(ctx)) return { skipped: 'unread' };
        const { project, smDir } = ctx;
        const id = project.id;
        const census = readFd(smDir, id, 'census.json', null);
        const facts = readFd(smDir, id, 'facts.json', null);
        if (!census || !facts) return { skipped: 'no-facts' };
        const arch = withLocalParts(await readArch(project.root, loadConfig(project.root, smDir), { mainBranch: await mainBranch(project.root) }), smDir, id);
        const claims = readFd(smDir, id, 'claims.json', null);
        const model = buildModel(facts, census, arch, readFd(smDir, id, 'model-overrides.json', {}) ?? {}, { name: project.name, now: now(), ...(Array.isArray(claims?.claims) ? { claims: claims.claims } : {}) });
        if (!sameDoc(readFd(smDir, id, 'model.json', null), model)) writeFd(smDir, id, 'model.json', model);
        return { nodes: model.nodes.length, edges: model.edges.length };
      },
    },
    {
      name: 'versions',
      async run(ctx) {
        if (unread(ctx)) return { skipped: 'unread' };
        const { project, smDir } = ctx;
        const doc = await versionsOf({ root: project.root, census: readFd(smDir, project.id, 'census.json', null), smDir, id: project.id, now: now() });
        return { mismatch: Boolean(doc?.mismatch) };
      },
    },
    {
      name: 'guide',
      async run(ctx) {
        if (unread(ctx)) return { skipped: 'unread' };
        const out = await recomputeGuide(ctx.smDir, ctx.project, { now: now() });
        return { practices: Array.isArray(out?.practices?.practices) ? out.practices.practices.length : null };
      },
    },
    {
      name: 'health',
      async run(ctx) {
        if (unread(ctx)) return { skipped: 'unread' };
        const { project, smDir } = ctx;
        const key = `${smDir}|${project.id}`;
        const at = clock();
        if (!ctx.results.read.moved && fileExists(smDir, project.id, 'health.json') && at - (lastHealth.get(key) ?? 0) < HEALTH_GAP_MS) return { skipped: 'fresh' };
        const health = await healthOf({ root: project.root, smDir, id: project.id, now: now() });
        lastHealth.set(key, at);
        return { score: health?.score ?? null };
      },
    },
    {
      name: 'uptodate',
      async run(ctx) {
        if (unread(ctx)) return { skipped: 'unread' };
        const doc = await runUptodate(ctx.project, ctx.smDir, { now: now() });
        return { lines: doc?.lines?.length ?? null };
      },
    },
  ];
}

// ---------- the summary pieces of the page (project.foundation in /api/state): light, from the saved files ----------

export function uptodatePiece(read) {
  const lines = read('uptodate.json')?.lines;
  if (!Array.isArray(lines)) return {};
  const out = { confirmed: 0, warning: 0, unverified: 0 };
  for (const l of lines) if (l?.state in out) out[l.state]++;
  return { uptodate: out };
}

export function healthPiece(read) {
  const score = read('health.json')?.score;
  return Number.isFinite(score) ? { health: { score } } : {};
}

export function versionPiece(read) {
  const v = read('versions.json');
  if (!v || typeof v !== 'object') return {};
  return { version: { code: v.code?.version ?? null, mismatch: Boolean(v.mismatch) } };
}

// The care mode the owner chose; no key until he answers, and the page asks once.
export function carePiece(read) {
  const mode = read('care.json')?.mode;
  return MODES.includes(mode) ? { care: mode } : {};
}

export const BLOCK_PIECES = Object.freeze([uptodatePiece, healthPiece, versionPiece, carePiece]);
