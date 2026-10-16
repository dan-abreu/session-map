import { existsSync } from 'node:fs';
import { log } from '../log.mjs';
import { BLOCK_PIECES } from './blocks.mjs';
import { fdDir, readFd } from './store.mjs';

// project.foundation in /api/state (contract § 12): light, read from the files the refresh wrote, never recomputed here.
// Each block appends a piece: (read) => ({ <key>: value }), where read(name) gives a foundation file or null.
// The piece of block 1 (census, read ledger, coverage) counts first, then the pieces of blocks.mjs ("Tudo em dia?", health,
// version, care); PIECES holds what anything else adds.
export const PIECES = [];
const KEYS = ['census', 'read', 'coverage', 'uptodate', 'health', 'version', 'care'];

const COVERAGE = ['owned', 'routes', 'screens', 'tables'];

// Block 1: census.json -> census, read-ledger.json -> read, sections.json -> coverage. A file not written yet gives no key.
export function readPiece(read) {
  const out = {};
  const census = read('census.json');
  const sum = census?.sums?.total;
  if (sum) out.census = { rev: census.rev, files: sum.files, lines: sum.lines.total, noOwner: census.sums.parts?._none?.files ?? 0 };
  const percent = read('read-ledger.json')?.summary?.percent;
  if (Number.isInteger(percent)) out.read = { percent };
  const coverage = read('sections.json')?.coverage;
  if (coverage && typeof coverage === 'object') out.coverage = Object.fromEntries(COVERAGE.map((k) => [k, coverage[k] ?? null]));
  return out;
}

// null = the project was not read yet: the page says so instead of showing zeros.
export function foundationSummary(smDir, projectId, { pieces = [readPiece, ...BLOCK_PIECES, ...PIECES] } = {}) {
  if (!smDir) return null;
  try {
    if (!existsSync(fdDir(smDir, projectId))) return null;
  } catch {
    return null;
  }
  let updatedAt = null;
  const files = new Map();
  const read = (name) => {
    if (!files.has(name)) {
      const data = readFd(smDir, projectId, name, null);
      if (typeof data?.generatedAt === 'string' && (!updatedAt || data.generatedAt > updatedAt)) updatedAt = data.generatedAt;
      files.set(name, data);
    }
    return files.get(name);
  };
  const out = Object.fromEntries(KEYS.map((k) => [k, null]));
  for (const piece of pieces) {
    try {
      const part = piece(read) ?? {};
      for (const k of KEYS) if (part[k] !== undefined) out[k] = part[k];
    } catch (err) {
      log('warn', 'foundation-summary-failed', { projectId, error: err.message });
    }
  }
  if (KEYS.every((k) => out[k] === null)) return null;
  return { ...out, updatedAt };
}
