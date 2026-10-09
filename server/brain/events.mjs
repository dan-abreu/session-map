import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { log } from '../log.mjs';
import { brainDir } from '../store.mjs';

export const eventsPath = (smDir, projectId) => join(brainDir(smDir, projectId), 'events.jsonl');

// Same branch, kind and time = same event: restarts and backfills can offer it again without duplicating it.
const keyOf = (e) => `${e.kind}|${e.workCellId}|${Date.parse(e.ts)}`;

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'events-read-failed', { path, code: err.code });
    return '';
  }
}

function parseLines(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch { /* a line still being written */ }
  }
  return events;
}

export const readEvents = (smDir, projectId) => parseLines(readText(eventsPath(smDir, projectId)));

// Returns how many events were new.
export function appendEvents(smDir, projectId, events) {
  const path = eventsPath(smDir, projectId);
  const text = readText(path);
  const seen = new Set(parseLines(text).map(keyOf));
  const fresh = events.filter((e) => {
    const key = keyOf(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!fresh.length) return 0;
  mkdirSync(dirname(path), { recursive: true });
  // A truncated last line (crash mid-write) must not swallow the next event.
  const prefix = text && !text.endsWith('\n') ? '\n' : '';
  appendFileSync(path, prefix + fresh.map((e) => `${JSON.stringify(e)}\n`).join(''));
  return fresh.length;
}
