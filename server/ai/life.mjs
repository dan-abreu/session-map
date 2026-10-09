import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { brainDir, readJsonFile, writeUnits } from '../brain/cells.mjs';
import { appendEvents, readEvents } from '../brain/events.mjs';
import { log } from '../log.mjs';
import { applyChanges, consolidate, shouldConsolidate } from './consolidate.mjs';
import { digestOf } from './digest.mjs';
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
  const life = { queue, bootstrapLimit: cfg.bootstrapLimit, pending: new Set(), perceived: new Map(), inFlight: new Set(), boot: new Map(), since: new Map(), lastPass: new Map() };
  lives.set(smDir, life);
  return life;
}

function track(life, job) {
  const p = job.catch((err) => log('warn', 'ai-job-failed', { error: err.message }));
  life.pending.add(p);
  p.finally(() => life.pending.delete(p));
}

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
  life.perceived.set(sessionId, hashOf(digest));
  if (!perception) return null;
  const before = unitsNow(p.smDir, p.projectId);
  saveUnits(p.smDir, p.projectId, before, applyPerception(before, { sessionId, files: digest.files }, perception, new Date().toISOString()));
  return answer?.costUSD ?? 0;
}

async function consolidateProject(life, p, uncapped) {
  const ask = (req) => life.queue.ask({ ...req, uncapped, projectId: p.projectId });
  const changes = await consolidate(unitsNow(p.smDir, p.projectId), readEvents(p.smDir, p.projectId), ask);
  const before = unitsNow(p.smDir, p.projectId);
  const { units, events } = applyChanges(before, changes, new Date().toISOString());
  saveUnits(p.smDir, p.projectId, before, units);
  appendEvents(p.smDir, p.projectId, events);
  life.since.set(p.projectId, 0);
  life.lastPass.set(p.projectId, Date.now());
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
  })());
}

export function perceiveChanged(life, p, items) {
  for (const item of items) {
    const { sessionId } = item.summary;
    if (life.inFlight.has(sessionId)) continue;
    const workCell = p.workCellOf(item);
    if (life.perceived.get(sessionId) === hashOf(digestOf(item.summary, workCell))) continue;
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

