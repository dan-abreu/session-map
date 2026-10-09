import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.mjs';
import { normalizePath } from './paths.mjs';

const GLOBAL_KEYS = ['budget', 'currency', 'prices'];

function readJson(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'config-read-failed', { path, code: err.code });
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    log('warn', 'config-invalid-json', { path });
    return {};
  }
}

// Precedence, lowest to highest: <root>/.claude/session-map.json, then the user's per-project entry.
// budget/currency/prices are machine-wide, so they only come from the user's file.
export function loadConfig(root, smDir) {
  const project = readJson(join(root, '.claude', 'session-map.json'));
  const user = readJson(join(smDir, 'config.json'));
  const perProject = user.projects?.[normalizePath(root)] ?? {};
  const config = { ...project, ...perProject };
  for (const key of GLOBAL_KEYS) if (user[key] !== undefined) config[key] = user[key];
  // Hand-written files: a wrong type here would otherwise throw on every poll.
  if (typeof config.roadmap !== 'string') delete config.roadmap;
  const d = config.decisions;
  if (d !== undefined && (typeof d?.heading !== 'string' || typeof d?.pendingWhen !== 'string')) delete config.decisions;
  return config;
}
