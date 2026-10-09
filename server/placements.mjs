// The owner's own word on a conversation (mm21): the project and part it belongs to and the title it goes by. It wins over
// every automatic rule and teaches the AI placer. One small file: {sessionId: {root?, partId?, title?}}.
import { join } from 'node:path';
import { readJsonFile, writeAtomic } from './store.mjs';

export const TITLE_MAX = 120;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fileOf = (smDir) => join(smDir, 'placements.json');

function clean(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const out = {};
  if (typeof entry.root === 'string' && entry.root) out.root = entry.root;
  if (entry.partId === null || (typeof entry.partId === 'string' && entry.partId)) out.partId = entry.partId;
  if (typeof entry.title === 'string' && entry.title.trim()) out.title = entry.title.trim().slice(0, TITLE_MAX);
  return Object.keys(out).length ? out : null;
}

export function readPlacements(smDir) {
  const stored = readJsonFile(fileOf(smDir), {});
  const out = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const [id, entry] of Object.entries(stored)) {
    const ok = UUID_RE.test(id) && clean(entry);
    if (ok) out[id] = ok;
  }
  return out;
}

// patch: root (the target project's folder), partId (a part id, or null for "no part"), title ('' gives the automatic one
// back). A field left out keeps what was there.
export function setPlacement(smDir, sessionId, patch) {
  const all = readPlacements(smDir);
  const next = { ...all[sessionId] };
  if ('root' in patch) next.root = patch.root;
  if ('partId' in patch) next.partId = patch.partId;
  if ('title' in patch) next.title = patch.title;
  const entry = clean(next);
  if (entry) all[sessionId] = entry;
  else delete all[sessionId];
  writeAtomic(fileOf(smDir), `${JSON.stringify(all)}\n`);
  return entry;
}
