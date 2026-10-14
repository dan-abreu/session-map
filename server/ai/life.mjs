import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { log } from '../log.mjs';
import { brainDir, readJsonFile, writeAtomic } from '../store.mjs';
import { recordActivity } from './activity.mjs';
import { helperSettings } from './helper.mjs';
import { getKey, listKeys } from './keys.mjs';
import { projectIdOf } from '../paths.mjs';
import { othersSettings, projectClassOfId } from './others.mjs';
import { placeByAi } from './place.mjs';
import { reasonsHash, relationWhyByAi } from './relwhy.mjs';
import { runApiJSON } from './providers.mjs';
import { loadStats } from './router.mjs';
import { AiQueue } from './runner.mjs';

// The map's background AI, driven from collect: conversations no item code or file placed are shown to the AI once.
const AI_DEFAULTS = { enabled: true, model: 'haiku', maxCallsPerHour: 30 };
const lives = new Map();

const readAiConfig = (smDir) => (readJsonFile(join(smDir, 'config.json'), {}) ?? {}).ai;

const hashOf = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex');

// ai: {bin, run} replace claude (tests); {apiRun, keyOf} replace the other AIs' call and their key store.
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
    // Read on every call, so a key saved or an AI switched off from the page applies without a restart.
    others: () => othersSettings(readAiConfig(smDir), listKeys(smDir).map((k) => k.provider)),
    helper: () => helperSettings(readAiConfig(smDir)),
    stats: () => loadStats(smDir),
    // Every outside call the map makes is one line of the activity log, as the map's own (activity.mjs).
    onOutside: (call) => recordActivity(smDir, { ...call, source: 'map' }),
    apiRun: ai.apiRun ?? runApiJSON,
    keyOf: ai.keyOf ?? ((provider) => getKey(smDir, provider)),
  });
  const life = { queue, pending: new Set(), placed: new Map(), inFlight: new Set(), whys: new Map(), whyWait: new Map(), whyInFlight: new Set(), maxCalls: cfg.maxCallsPerHour, limits: { weekly: false, session: false } };
  lives.set(smDir, life);
  return life;
}

// The plan's limits, as collect reads them (sources/limits.mjs). While one is hit, no background AI call is made: a
// closed door must not be knocked on every pass (it pollutes the ledger and spends the queue for nothing).
export const setPlanLimits = (life, limits) => {
  life.limits = limits ?? { weekly: false, session: false };
};

// A limit hit holds until its reset time; the map re-reads it every pass, so a paused background wakes by itself.
const limitHit = (life) => Boolean(life.limits?.weekly?.hit || life.limits?.session?.hit);

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
  if (limitHit(life)) return;
  const seen = aiPlacements(life, p.smDir, p.projectId);
  const partIds = p.arch.parts.map((x) => x.id);
  // Sigilo por projeto: the digest leaves with the class the owner gave this project, 'client' when he gave none. Read
  // on every pass, so a change from the page applies to the next job.
  const sensitivity = projectClassOfId(readAiConfig(p.smDir), p.projectId, projectIdOf);
  for (const { sessionId, digest } of jobs) {
    const hash = hashOf({ digest, partIds });
    if (life.inFlight.has(sessionId) || seen[sessionId]?.hash === hash) continue;
    life.inFlight.add(sessionId);
    track(life, (async () => {
      try {
        const ask = (req) => life.queue.ask({ ...req, projectId: p.projectId, sensitivity });
        const partId = await placeByAi(digest, p.arch, ask, p.examples ?? []);
        if (partId === undefined) return;
        seen[sessionId] = { hash, partId };
        writeAtomic(placedFile(p.smDir, p.projectId), JSON.stringify(seen));
      } finally {
        life.inFlight.delete(sessionId);
      }
    })());
  }
}

// The AI's sentence for each relation (mm32): {"a|b": {hash, text}}, the hash being that of the reasons it was written from.
// On disk, so a restart asks nothing new; a sentence whose reasons changed is not shown and is asked again.
const WHY_PER_PASS = 5; // and never past half of the hour's calls (explainRelations)
const WHY_RETRY_MS = 10 * 60 * 1000;
const linkKey = (l) => `${l.a}|${l.b}`;
export const relationWhyFile = (smDir, projectId) => join(brainDir(smDir, projectId), 'relation-why.json');

export function aiRelationWhys(life, smDir, projectId) {
  if (!life.whys.has(projectId)) {
    const stored = readJsonFile(relationWhyFile(smDir, projectId), {});
    life.whys.set(projectId, stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {});
  }
  return life.whys.get(projectId);
}

// The relations with the sentence the AI wrote for their current reasons; the others stay as they are.
export function withRelationWhys(life, p, links) {
  if (!life.queue.enabled) return links;
  const seen = aiRelationWhys(life, p.smDir, p.projectId);
  return links.map((l) => {
    const stored = seen[linkKey(l)];
    return typeof stored?.text === 'string' && stored.hash === reasonsHash(l, p.arch) ? { ...l, why: stored.text } : l;
  });
}

// links come strongest first. A relation is asked again only when its reasons changed; a call that failed waits ten minutes.
export function explainRelations(life, p, links, { now = Date.now } = {}) {
  if (!life.queue.enabled) return;
  if (limitHit(life)) return;
  const seen = aiRelationWhys(life, p.smDir, p.projectId);
  // Placement is the map's main AI work: half of the hour's calls (and the ones already on their way) are kept for it.
  const budget = life.queue.callsLeft() - Math.floor((life.maxCalls ?? AI_DEFAULTS.maxCallsPerHour) / 2) - life.whyInFlight.size;
  if (budget <= 0) return;
  const current = new Set(links.map(linkKey));
  const flightOf = (l) => `${p.projectId}:${linkKey(l)}`;
  const jobs = links.filter((l) => {
    const hash = reasonsHash(l, p.arch);
    const failed = life.whyWait.get(flightOf(l));
    return !life.whyInFlight.has(flightOf(l)) && seen[linkKey(l)]?.hash !== hash && !(failed?.hash === hash && now() - failed.at < WHY_RETRY_MS);
  }).slice(0, Math.min(WHY_PER_PASS, budget));
  for (const link of jobs) {
    const key = linkKey(link);
    const hash = reasonsHash(link, p.arch);
    life.whyInFlight.add(flightOf(link));
    track(life, (async () => {
      try {
        const text = await relationWhyByAi(link, p.arch, (req) => life.queue.ask({ ...req, projectId: p.projectId }), p.projectId);
        if (text === undefined) return;
        if (text === null) {
          life.whyWait.set(flightOf(link), { hash, at: now() });
          return;
        }
        seen[key] = { hash, text };
        for (const k of Object.keys(seen)) if (!current.has(k)) delete seen[k];
        writeAtomic(relationWhyFile(p.smDir, p.projectId), JSON.stringify(seen));
      } finally {
        life.whyInFlight.delete(flightOf(link));
      }
    })());
  }
}

export const aiStatus = (life, projectId) => life.queue.status(projectId);
