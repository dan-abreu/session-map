import { join } from 'node:path';
import { brainDir, readJsonFile, writeAtomic } from '../store.mjs';

// One file, or one file inside one subfolder (proposals/, undo/): names reach the disk, so nothing that could climb out.
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;

export function fdDir(smDir, projectId) {
  return join(brainDir(smDir, projectId), 'foundation');
}

export function fdParts(name) {
  const parts = String(name).split('/');
  if (parts.length > 2 || !parts.every((p) => SEGMENT.test(p) && !p.includes('..'))) throw new Error(`invalid foundation file: ${name}`);
  return parts;
}

export function fdPath(smDir, projectId, name) {
  const parts = fdParts(name);
  return join(fdDir(smDir, projectId), ...parts);
}

// A file written by a newer reader is not understood here: the caller redoes it from zero (contract § 0).
export function readFd(smDir, projectId, name, fallback) {
  const data = readJsonFile(fdPath(smDir, projectId, name), fallback);
  if (data && typeof data === 'object' && typeof data.version === 'number' && data.version !== 1) return fallback;
  return data;
}

export function writeFd(smDir, projectId, name, data) {
  writeAtomic(fdPath(smDir, projectId, name), JSON.stringify(data));
}
