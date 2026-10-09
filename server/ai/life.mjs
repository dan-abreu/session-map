import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { log } from '../log.mjs';
import { brainDir, readJsonFile, writeAtomic } from '../store.mjs';
import { placeByAi } from './place.mjs';
import { AiQueue } from './runner.mjs';

// The map's background AI, driven from collect: conversations no item code or file placed are shown to the AI once.
const AI_DEFAULTS = { enabled: true, model: 'haiku', maxCallsPerHour: 30 };
const lives = new Map();

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
  const life = { queue, pending: new Set(), placed: new Map(), inFlight: new Set() };
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

// What the AI already answered, per conversation: {hash, partId}. On disk, so a restart asks nothing new.
export const placedFile = (smDir, projectId) => join(brainDir(smDir, projectId), 'placed.json');

export function aiPlacements(life, smDir, projectId) {
  if (!life.placed.has(projectId)) {
    const stored = readJsonFile(placedFile(smDir, projectId), {});
    life.placed.set(projectId, stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {});
  }
  return life.placed.get(projectId);
}

// jobs: [{sessionId, digest}]. A conversation is asked again only when its digest or the list of parts changed.
export function placeChanged(life, p, jobs) {
  const seen = aiPlacements(life, p.smDir, p.projectId);
  const partIds = p.arch.parts.map((x) => x.id);
  for (const { sessionId, digest } of jobs) {
    const hash = hashOf({ digest, partIds });
    if (life.inFlight.has(sessionId) || seen[sessionId]?.hash === hash) continue;
    life.inFlight.add(sessionId);
    track(life, (async () => {
      try {
        const ask = (req) => life.queue.ask({ ...req, projectId: p.projectId });
        const partId = await placeByAi(digest, p.arch, ask);
        if (partId === undefined) return;
        seen[sessionId] = { hash, partId };
        writeAtomic(placedFile(p.smDir, p.projectId), JSON.stringify(seen));
      } finally {
        life.inFlight.delete(sessionId);
      }
    })());
  }
}

export const aiStatus = (life, projectId) => life.queue.status(projectId);
