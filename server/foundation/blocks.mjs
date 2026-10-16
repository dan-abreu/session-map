import { statSync } from 'node:fs';
import { buildFlowModel, projectArch } from '../arch/flowmodel.mjs';
import { mainBranch } from '../sources/git.mjs';
import { MODES } from './care.mjs';
import { recomputeGuide } from './guide.mjs';
import { healthOf } from './health.mjs';
import { fdPath, readFd, writeFd } from './store.mjs';
import { runUptodate } from './uptodate.mjs';
import { versionsOf } from './versions.mjs';

// The blocks after the reading step (fd24): each one reads what the reading step saved and writes its own file under
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
      // fd03, fd25: the one model of the project is the Flow's (arch/flowmodel.mjs): the round builds it, so it is kept fresh in
      // session-map's storage (flow-model.json), and the page, "Tudo em dia?" and the route of the Foundation all read that one.
      name: 'model',
      async run(ctx) {
        if (unread(ctx)) return { skipped: 'unread' };
        const { project, smDir } = ctx;
        const arch = await projectArch({ ...project, mainBranch: project.mainBranch ?? await mainBranch(project.root) }, smDir);
        const model = await buildFlowModel({ root: project.root, arch, smDir, projectId: project.id, source: arch.source });
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
