import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { log } from './log.mjs';

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

// Ids end up in file names, so anything but a plain slug is refused.
export function assertSafeName(name, what) {
  if (!SAFE_NAME.test(name)) throw new Error(`invalid ${what}: ${name}`);
  return name;
}

export function brainDir(smDir, projectId) {
  return join(smDir, 'brain', assertSafeName(projectId, 'project id'));
}

export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function readJsonFile(path, fallback) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'brain-read-failed', { path, code: err.code });
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    log('warn', 'brain-invalid-json', { path });
    return fallback;
  }
}
