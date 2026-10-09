import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { brainDir, readJsonFile, writeAtomic, writeUnits } from '../brain/cells.mjs';
import { appendEvents, readEvents } from '../brain/events.mjs';
import { log } from '../log.mjs';
import { applyChanges, consolidate, shouldConsolidate } from './consolidate.mjs';
import { digestOf } from './digest.mjs';
import { writeAiNuclei } from './nucleus.mjs';
import { applyPerception, normalizeUnit, perceive } from './perceive.mjs';
import { AiQueue } from './runner.mjs';

// The map's own life, driven from collect: perceive new or changed chats in the background, tidy the tree now and then.
const PERCEPTION_USD_GUESS = 0.003;
const AI_DEFAULTS = { enabled: true, model: 'haiku', maxCallsPerHour: 30, bootstrapLimit: 60 };
const lives = new Map();

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const hashOf = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex');

export function lifeOf(smDir, userConfig, ai = {}) {
  if (lives.has(smDir)) return lives.get(smDir);
  const cfg = { ...AI_DEFAULTS, ...(userConfig.ai ?? {}) };
  const queue = new AiQueue({
    smDir,
    enabled: cfg.enabled !== false,
    model: cfg.model,
    maxCallsPerHour: cfg.maxCallsPerHour,
    ...('bin' in ai ? { bin: ai.bin } : {}),
    ...(ai.run ? { run: ai.run } : {}),
  });
  const life = { queue, bootstrapLimit: cfg.bootstrapLimit, pending: new Set(), perceived: new Map(), inFlight: new Set(), boot: new Map(), since: new Map(), lastPass: new Map(), consolidating: new Set(), writingNuclei: new Set() };
  lives.set(smDir, life);
  return life;
}

function track(life, job) {
  const p = job.catch((err) => log('warn', 'ai-job-failed', { error: err.message }));
  life.pending.add(p);
  p.finally(() => life.pending.delete(p));
}

// A restart, for tests: the next lifeOf starts from what is on disk.
export const forgetLife = (smDir) => lives.delete(smDir);

// Tests and shutdown wait for the background AI work to finish.
export async function settleAi(smDir) {
  const life = lives.get(smDir);
  while (life?.pending.size) await Promise.allSettled([...life.pending]);
}

export const unitsFile = (smDir, projectId) => join(brainDir(smDir, projectId), 'units.json');
const unitsNow = (smDir, projectId) => {
  const stored = readJsonFile(unitsFile(smDir, projectId), []);
  return (Array.isArray(stored) ? stored : []).map(normalizeUnit);
};

// What the AI already read, per chat: the digest hash and the unit it chose. On disk, so a restart asks nothing new.
const perceivedFile = (smDir, projectId) => join(brainDir(smDir, projectId), 'perceived.json');

function perceivedOf(life, smDir, projectId) {
  if (!life.perceived.has(projectId)) {
    const stored = readJsonFile(perceivedFile(smDir, projectId), {});
    life.perceived.set(projectId, stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {});
  }
  return life.perceived.get(projectId);
}

function remember(life, p, sessionId, hash, unitId) {
  const seen = perceivedOf(life, p.smDir, p.projectId);
  seen[sessionId] = { hash, unitId };
  writeAtomic(perceivedFile(p.smDir, p.projectId), JSON.stringify(seen));
}

const alreadyPerceived = (life, p, sessionId, hash) => perceivedOf(life, p.smDir, p.projectId)[sessionId]?.hash === hash;

function saveUnits(smDir, projectId, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) writeUnits(smDir, projectId, after);
}

// Resolves to the cost of the call, or null when nothing was learned (no answer, cap reached).
async function perceiveChat(life, p, item, workCell, uncapped) {
  const { sessionId } = item.summary;
  const digest = digestOf(item.summary, workCell);
  let answer = null;
  const ask = async (req) => (answer = await life.queue.ask({ ...req, uncapped, projectId: p.projectId }));
  const perception = await perceive(digest, unitsNow(p.smDir, p.projectId), ask);
  if (answer?.error === 'rate-limited') return null;
  if (!perception) {
    remember(life, p, sessionId, hashOf(digest), null);
    return null;
  }
  const before = unitsNow(p.smDir, p.projectId);
  const after = applyPerception(before, { sessionId, files: digest.files }, perception, new Date().toISOString());
  saveUnits(p.smDir, p.projectId, before, after);
  remember(life, p, sessionId, hashOf(digest), after.find((u) => u.chatIds.includes(sessionId))?.id ?? null);
  return answer?.costUSD ?? 0;
}

// One pass per project at a time: chats answered from the cache finish together, and each would start its own pass
// on the same cached answer, applying the same "group" again and again.
async function consolidateProject(life, p, uncapped) {
  if (life.consolidating.has(p.projectId)) return;
  life.consolidating.add(p.projectId);
  life.since.set(p.projectId, 0);
  try {
    const ask = (req) => life.queue.ask({ ...req, uncapped, projectId: p.projectId });
    const changes = await consolidate(unitsNow(p.smDir, p.projectId), readEvents(p.smDir, p.projectId), ask);
    const before = unitsNow(p.smDir, p.projectId);
    const { units, events } = applyChanges(before, changes, new Date().toISOString());
    saveUnits(p.smDir, p.projectId, before, units);
    appendEvents(p.smDir, p.projectId, events);
    life.lastPass.set(p.projectId, Date.now());
  } finally {
    life.consolidating.delete(p.projectId);
  }
}

export const aiNucleusFile = (smDir, projectId) => join(brainDir(smDir, projectId), 'ai-nucleus.json');

// p.nucleusInputs() builds, from the units as they are on disk now, what the AI reads for each nucleus.
async function writeNuclei(life, p, uncapped) {
  if (life.writingNuclei.has(p.projectId)) return;
  life.writingNuclei.add(p.projectId);
  try {
    const file = aiNucleusFile(p.smDir, p.projectId);
    const stored = readJsonFile(file, {});
    const before = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const ask = (req) => life.queue.ask({ ...req, uncapped, projectId: p.projectId });
    const after = await writeAiNuclei(p.nucleusInputs(), before, ask);
    if (JSON.stringify(after) !== JSON.stringify(before)) writeAtomic(file, JSON.stringify(after));
  } finally {
    life.writingNuclei.delete(p.projectId);
  }
}

// Waits while perceptions are queued: they move chats between units, and the nucleus would be written twice.
export function refreshNuclei(life, p) {
  if (life.queue.status().queue > 0 || life.writingNuclei.has(p.projectId)) return;
  track(life, writeNuclei(life, p, false));
}

// A new project: the most recent conversations are perceived right away, outside the hourly cap, then tidied once.
export function startBootstrap(life, p, items) {
  const recent = [...items].sort((a, b) => b.ref.mtimeMs - a.ref.mtimeMs).slice(0, life.bootstrapLimit);
  const boot = { done: 0, total: recent.length, costUSD: 0, paid: 0 };
  life.boot.set(p.projectId, boot);
  for (const item of recent) life.inFlight.add(item.summary.sessionId);
  track(life, (async () => {
    for (const item of recent) {
      const cost = await perceiveChat(life, p, item, p.workCellOf(item), true);
      life.inFlight.delete(item.summary.sessionId);
      boot.done++;
      if (cost) {
        boot.costUSD += cost;
        boot.paid++;
      }
    }
    if (recent.length) await consolidateProject(life, p, true);
    await writeNuclei(life, p, true);
  })());
}

export function perceiveChanged(life, p, items) {
  for (const item of items) {
    const { sessionId } = item.summary;
    if (life.inFlight.has(sessionId)) continue;
    const workCell = p.workCellOf(item);
    if (alreadyPerceived(life, p, sessionId, hashOf(digestOf(item.summary, workCell)))) continue;
    life.inFlight.add(sessionId);
    track(life, (async () => {
      try {
        if ((await perceiveChat(life, p, item, workCell, false)) === null) return;
        const since = (life.since.get(p.projectId) ?? 0) + 1;
        life.since.set(p.projectId, since);
        if (shouldConsolidate(since, life.lastPass.get(p.projectId) ?? null, Date.now())) await consolidateProject(life, p, false);
      } finally {
        life.inFlight.delete(sessionId);
      }
    })());
  }
}

export function aiStatus(life, projectId) {
  const boot = life.boot.get(projectId);
  const perCall = boot?.paid ? boot.costUSD / boot.paid : PERCEPTION_USD_GUESS;
  return {
    ...life.queue.status(projectId),
    bootstrap: boot ? { done: boot.done, total: boot.total, estimatedUSD: round6(boot.total * perCall) } : null,
  };
}

