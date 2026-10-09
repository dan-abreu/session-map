import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { log } from './log.mjs';
import { costOf, loadPrices } from './cost.mjs';
import { parseCard } from './parse/card.mjs';
import { listTranscripts, readTranscript, readHelperUsage, readFullTranscript } from './sources/claude.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 280;
const PROMPTS_MAX = 20;

const archiveRoot = (smDir) => join(smDir, 'archive');
const indexPath = (smDir) => join(archiveRoot(smDir), 'index.jsonl');
const deletedPath = (smDir) => join(archiveRoot(smDir), 'deleted.json');
const copyPath = (smDir, entry) => join(archiveRoot(smDir), entry.projectDir, `${entry.sessionId}.jsonl.gz`);
const safeSegment = (s) => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && basename(s) === s && !s.includes('\\');

// Lines cut mid-write are dropped, so a crash while saving never poisons the index.
export function readIndex(smDir) {
  let text;
  try {
    text = readFileSync(indexPath(smDir), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'index-read-failed', { code: err.code });
    return [];
  }
  const entries = [];
  for (const line of text.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (UUID_RE.test(entry?.sessionId) && safeSegment(entry.projectDir)) entries.push(entry);
    } catch { /* empty or truncated line */ }
  }
  return entries;
}

function writeIndex(smDir, entries) {
  mkdirSync(archiveRoot(smDir), { recursive: true });
  const tmp = `${indexPath(smDir)}.${process.pid}.tmp`;
  writeFileSync(tmp, entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
  renameSync(tmp, indexPath(smDir));
}

// The source transcript outlives the copy (Claude keeps it ~30 days), so a deletion must be remembered
// or the next sweep would archive the conversation again.
function readDeleted(smDir) {
  try {
    const ids = JSON.parse(readFileSync(deletedPath(smDir), 'utf8'));
    return Array.isArray(ids) ? ids.filter((id) => UUID_RE.test(id)) : [];
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'deleted-read-failed', { code: err.code ?? err.name });
    return [];
  }
}

function rememberDeleted(smDir, sessionId) {
  const ids = readDeleted(smDir);
  if (ids.includes(sessionId)) return;
  mkdirSync(archiveRoot(smDir), { recursive: true });
  const tmp = `${deletedPath(smDir)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify([...ids, sessionId]));
  renameSync(tmp, deletedPath(smDir));
}

function buildEntry(ref, summary) {
  const helperUsage = readHelperUsage(join(dirname(ref.path), ref.sessionId));
  return {
    sessionId: ref.sessionId,
    projectDir: ref.projectDir,
    cwd: summary.cwd,
    title: summary.title,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    userPrompts: summary.userPrompts.slice(0, PROMPTS_MAX).map((p) => p.slice(0, TEXT_MAX)),
    card: summary.lastCardText ? parseCard(summary.lastCardText) : null,
    editedFiles: summary.editedFiles,
    commits: summary.commits,
    costUSD: costOf([...summary.usage, ...helperUsage], loadPrices()).usd,
    lastAssistantText: summary.lastAssistantText.slice(0, TEXT_MAX),
    sourceMtimeMs: ref.mtimeMs,
  };
}

// 'archived' | 'unchanged' | 'missing' | 'invalid' | 'deleted'. Safe to call from the hook and the sweep at once:
// both write the same content and the index is replaced atomically.
export function archiveTranscript(ref, smDir) {
  if (!UUID_RE.test(ref.sessionId) || !safeSegment(ref.projectDir)) return 'invalid';
  if (readDeleted(smDir).includes(ref.sessionId)) return 'deleted';
  const entries = readIndex(smDir);
  const known = entries.find((e) => e.sessionId === ref.sessionId);
  if (known?.sourceMtimeMs === ref.mtimeMs && existsSync(copyPath(smDir, known))) return 'unchanged';

  let raw;
  try {
    raw = readFileSync(ref.path);
  } catch (err) {
    if (err.code === 'ENOENT') return 'missing';
    throw err;
  }
  const summary = readTranscript(ref.path);
  if (!summary) return 'missing';

  const entry = buildEntry(ref, summary);
  const target = copyPath(smDir, entry);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, gzipSync(raw));
  renameSync(tmp, target);
  writeIndex(smDir, [...entries.filter((e) => e.sessionId !== ref.sessionId), entry]);
  return 'archived';
}

// Returns how many transcripts were (re)archived.
export function archiveAll(dir, smDir) {
  let count = 0;
  for (const ref of listTranscripts(dir)) {
    try {
      if (archiveTranscript(ref, smDir) === 'archived') count++;
    } catch (err) {
      log('warn', 'archive-failed', { sessionId: ref.sessionId, code: err.code });
    }
  }
  return count;
}

// from / to (ms): only the conversations that were running at some point inside that period.
export function searchIndex(entries, query, { project, limit = 5, from = -Infinity, to = Infinity } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = project?.toLowerCase();
  const scored = [];
  for (const e of entries) {
    if (wanted && !`${e.projectDir} ${e.cwd}`.toLowerCase().includes(wanted)) continue;
    const began = Date.parse(e.startedAt ?? e.endedAt), ended = Date.parse(e.endedAt ?? e.startedAt);
    if ((from > -Infinity || to < Infinity) && !(began <= to && ended >= from)) continue;
    const title = e.title.toLowerCase();
    const body = [...e.userPrompts, e.card ? JSON.stringify(Object.values(e.card)) : '', e.lastAssistantText, ...e.commits.map((c) => c.subject)]
      .join(' ')
      .toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const inTitle = title.includes(w);
      if (!inTitle && !body.includes(w)) { all = false; break; }
      score += inTitle ? 3 : 1;
    }
    if (all) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || String(b.e.endedAt).localeCompare(String(a.e.endedAt)));
  return scored.slice(0, limit).map((s) => s.e);
}

// The path is built from the index entry, never from the argument.
function entryOf(smDir, sessionId) {
  return UUID_RE.test(sessionId) ? readIndex(smDir).find((e) => e.sessionId === sessionId) : undefined;
}

export function readArchived(smDir, sessionId) {
  const entry = entryOf(smDir, sessionId);
  return entry ? readFullTranscript(copyPath(smDir, entry)) : [];
}

// The gzip copy of a conversation, also after Claude Code deleted its own transcript.
export function archivedPath(smDir, sessionId) {
  const entry = entryOf(smDir, sessionId);
  return entry ? copyPath(smDir, entry) : null;
}

export function deleteArchived(smDir, sessionId) {
  const entry = entryOf(smDir, sessionId);
  if (!entry) return false;
  rememberDeleted(smDir, sessionId);
  rmSync(copyPath(smDir, entry), { force: true });
  writeIndex(smDir, readIndex(smDir).filter((e) => e.sessionId !== sessionId));
  return true;
}

export function refFromPath(path, mtimeMs) {
  return { sessionId: basename(path, '.jsonl'), projectDir: basename(dirname(path)), path, mtimeMs, size: 0 };
}
