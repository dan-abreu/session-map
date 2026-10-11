import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath } from './paths.mjs';
import { writeAtomic } from './store.mjs';

// The map's own work (the AI placing conversations, the foundation's count) runs only on a project the person works on
// now, or on one they asked to keep always up to date: the AI's tokens are not spent on projects nobody touches.

export const ACTIVE_MS = 30 * 60_000;
const ALWAYS = 'always';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Worked on: a conversation runs now, the page's chat hub drives one, or one moved in the last ACTIVE_MS.
export function isWorking({ items, liveById, driving = new Set(), nowMs }) {
  return items.some((i) => {
    const id = i.summary.sessionId;
    return liveById.get(id)?.status === 'busy' || driving.has(id) || nowMs - i.ref.mtimeMs < ACTIVE_MS;
  });
}

// Only the person's own config.json says "always": a file inside a project (which may be shared) cannot spend for them.
export const alwaysOn = (userConfig, root) => userConfig?.projects?.[normalizePath(root)]?.background === ALWAYS;

export const backgroundOf = ({ always, working }) => ({ always, working, on: always || working });

// The projects the 5-minute sweep reads: a project with no answer is left alone.
export const sweepable = (projects) => projects.filter((p) => p.background?.on === true);

export function setBackground(smDir, root, always) {
  if (typeof always !== 'boolean') return { ok: false, error: 'bad-background' };
  const file = join(smDir, 'config.json');
  let config = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: 'config-unreadable' };
  }
  if (!isObject(config)) return { ok: false, error: 'config-unreadable' };
  const key = normalizePath(root);
  const projects = isObject(config.projects) ? { ...config.projects } : {};
  const { background: _, ...rest } = isObject(projects[key]) ? projects[key] : {};
  projects[key] = always ? { ...rest, background: ALWAYS } : rest;
  if (!Object.keys(projects[key]).length) delete projects[key];
  writeAtomic(file, `${JSON.stringify({ ...config, projects }, null, 2)}\n`);
  return { ok: true, always };
}

// "Organize on its own" (orchestrator or18): the orchestrator's tidy pass on this project, off until the person turns
// it on for that project (the owner's choice on 2026-10-11: it spends on Opus, so only where he wants it).
export const tidyOn = (userConfig, root) => userConfig?.projects?.[normalizePath(root)]?.tidy === true;

export function setTidy(smDir, root, on) {
  if (typeof on !== 'boolean') return { ok: false, error: 'bad-tidy' };
  const file = join(smDir, 'config.json');
  let config = {};
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, error: 'config-unreadable' };
  }
  if (!isObject(config)) return { ok: false, error: 'config-unreadable' };
  const key = normalizePath(root);
  const projects = isObject(config.projects) ? { ...config.projects } : {};
  projects[key] = { ...(isObject(projects[key]) ? projects[key] : {}), tidy: on };
  writeAtomic(file, `${JSON.stringify({ ...config, projects }, null, 2)}\n`);
  return { ok: true, tidy: on };
}
