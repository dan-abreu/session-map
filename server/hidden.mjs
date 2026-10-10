// What the owner hid from the map (mm43): conversations removed from session-map and cut-offs dismissed from the panel.
// Only session-map's own folder is written; Claude Code's transcripts and the projects are never touched.
import { join } from 'node:path';
import { readJsonFile, writeAtomic } from './store.mjs';

const REMOVED = 'removed.json';
const DISMISSED = 'cut-dismissed.json';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Removed for good: the same shape as archived.json, a list of session ids.
export function readRemoved(smDir) {
  const stored = readJsonFile(join(smDir, REMOVED), []);
  return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
}

export function addRemoved(smDir, sessionId) {
  const ids = readRemoved(smDir);
  if (ids.has(sessionId)) return;
  ids.add(sessionId);
  writeAtomic(join(smDir, REMOVED), `${JSON.stringify([...ids])}\n`);
}

// sessionId → the last activity it had when dismissed; cut off again later (a newer activity), it comes back.
export function readDismissed(smDir) {
  const stored = readJsonFile(join(smDir, DISMISSED), {});
  return isPlainObject(stored) ? stored : {};
}

export function dismissCut(smDir, sessionId, at) {
  const dismissed = readDismissed(smDir);
  dismissed[sessionId] = at;
  writeAtomic(join(smDir, DISMISSED), `${JSON.stringify(dismissed)}\n`);
}
