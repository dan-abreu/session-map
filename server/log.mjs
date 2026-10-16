// The program's professional log (server.md sv19) and the projects' records (watcher-and-alerts.md wa11).
//
// log(level, event, fields) writes one JSON line to stderr, as it always has, and — once configureLog({ dir }) is
// called — also appends it to <dir>/logs/session-map-YYYY-MM-DD.jsonl (one file per local day, pruned after
// LOG_KEEP_DAYS). Line schema v1, documented in <dir>/logs/schema.json:
//   {"v":1,"ts":"<ISO-8601>","level":"info|warn|error","event":"<name>", ...fields}
// Before the file write, fields whose names look like secrets are dropped and string values are masked with
// ai/redact.mjs and cut to FIELD_MAX: the page token and personal data never land in a file another AI may read.
// The stderr copy keeps the line as given (the person's terminal). A failed file write is reported on stderr and
// turns the sink off until the next configureLog: a full disk never stops the server.
//
// recordProject(smDir, projectId, event, fields) keeps the projects' records (wa11): one JSON line per event in
// <smDir>/logs/projects/<projectId>.jsonl, bounded like the AI activity file, so any AI can read what was done in
// a project even when the AI that did it forgot to say.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './ai/redact.mjs';

export const LOG_KEEP_DAYS = 30;
export const FIELD_MAX = 1000;
export const PROJECT_MAX_LINES = 2000;
const PROJECT_SLACK = 200;
export const PROJECT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const EVENT_RE = /^[a-z][a-z-]{0,29}$/;
const DAY_FILE_RE = /^session-map-\d{4}-\d{2}-\d{2}\.jsonl$/;
// The token arrives inside the page links as ?k=…: masked by name, whatever redact sees around it.
const TOKEN_IN_URL = /([?&]k=)[^&\s]+/g;
const DROP_KEY_RE = /\b(?:token|key|secret|passw|auth|bearer|api[-_]?key)/i;

let logDir = null; // the logs folder, null until configureLog
let fileDay = null; // the day of the open day file (local date)
const projectCounts = new Map();

const dayStamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// One value as it may be written to a file: strings masked and cut, numbers and booleans as they are, everything
// else dropped (the log is flat).
function cleanForFile(value) {
  if (typeof value === 'string') return redact(value.replace(TOKEN_IN_URL, '$1[secret]')).slice(0, FIELD_MAX);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

// The file copy of one event: schema v1, secret-named fields gone, string values masked.
function fileRow(ts, level, event, fields) {
  const row = { v: 1, ts, level, event };
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (typeof k !== 'string' || !k || k.length > 60 || DROP_KEY_RE.test(k)) continue;
    const cleaned = cleanForFile(v);
    if (cleaned !== undefined) row[k] = cleaned;
  }
  return row;
}

// One stderr warn, written directly (never through log, so a broken sink cannot loop into itself).
function stderrWarn(event, extra = {}) {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event, ...extra })}\n`);
}

// The schema every reader finds next to the files: written once, never rewritten over a reader's notes.
function writeSchemaDoc(dir) {
  const file = join(dir, 'schema.json');
  if (existsSync(file)) return;
  writeFileSync(file, `${JSON.stringify({
    version: 1,
    program: 'session-map',
    files: {
      'session-map-YYYY-MM-DD.jsonl': 'one JSON line per event: {v, ts, level (info|warn|error), event, ...fields}; fields named like secrets are dropped and string values are masked and cut to 1000 characters',
      'projects/<projectId>.jsonl': 'one JSON line per project event: {v, ts, level, event, project, ...fields}; the newest 2000 lines are kept',
    },
    kept: 'day files are pruned after 30 days; project files keep the newest 2000 lines',
  }, null, 2)}\n`);
}

// Day files older than LOG_KEEP_DAYS leave the folder.
function pruneOld(dir) {
  const cutoff = `session-map-${dayStamp(new Date(Date.now() - LOG_KEEP_DAYS * 86_400_000))}.jsonl`;
  for (const name of readdirSync(dir)) {
    if (DAY_FILE_RE.test(name) && name < cutoff) rmSync(join(dir, name), { force: true });
  }
}

// Turns the file sink on ({ dir: smDir }) or off ({ dir: null }). The demo never calls it with a dir: it never
// touches the disk.
export function configureLog({ dir } = {}) {
  if (!dir) {
    logDir = null;
    fileDay = null;
    return;
  }
  try {
    const folder = join(dir, 'logs');
    mkdirSync(folder, { recursive: true });
    writeSchemaDoc(folder);
    pruneOld(folder);
    logDir = folder;
    fileDay = dayStamp();
  } catch (err) {
    logDir = null;
    fileDay = null;
    stderrWarn('log-file-unavailable', { error: String(err?.message ?? err) });
  }
}

function writeFileLine(ts, level, event, fields) {
  if (!logDir) return;
  try {
    const day = dayStamp(new Date(ts));
    if (day !== fileDay) {
      pruneOld(logDir);
      fileDay = day;
    }
    appendFileSync(join(logDir, `session-map-${day}.jsonl`), `${JSON.stringify(fileRow(ts, level, event, fields))}\n`);
  } catch (err) {
    logDir = null;
    stderrWarn('log-file-failed', { error: String(err?.message ?? err) });
  }
}

export function log(level, event, fields = {}) {
  const ts = new Date().toISOString();
  process.stderr.write(`${JSON.stringify({ ts, level, event, ...fields })}\n`);
  writeFileLine(ts, level, event, fields);
}

// The projects' records (wa11): one JSON line per event, bounded. Invalid ids and events are refused, a failed
// write is reported once per process and never throws.
export function recordProject(smDir, projectId, event, fields = {}) {
  if (!smDir || typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) return;
  if (typeof event !== 'string' || !EVENT_RE.test(event)) return;
  const file = join(smDir, 'logs', 'projects', `${projectId}.jsonl`);
  const ts = new Date().toISOString();
  const row = { ...fileRow(ts, 'info', event, fields), project: projectId };
  try {
    mkdirSync(join(smDir, 'logs', 'projects'), { recursive: true });
    let n = projectCounts.get(file);
    if (n === undefined) {
      try { n = readFileSync(file, 'utf8').split('\n').filter(Boolean).length; } catch { n = 0; }
    }
    appendFileSync(file, `${JSON.stringify(row)}\n`);
    n += 1;
    if (n > PROJECT_MAX_LINES + PROJECT_SLACK) {
      const kept = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-PROJECT_MAX_LINES);
      writeFileSync(file, `${kept.join('\n')}\n`);
      n = kept.length;
    }
    projectCounts.set(file, n);
  } catch (err) {
    stderrWarn('project-log-failed', { project: projectId, error: String(err?.message ?? err) });
  }
}

// The newest lines of the program log (sv19), across the day files, newest first. since: ISO-8601; level and event
// filter by exact value; limit is capped at READ_LIMIT_MAX.
const READ_LIMIT_MAX = 1000;
export function readLog(dir, { since = null, level = null, event = null, limit = 200 } = {}) {
  const n = Math.min(Math.max(Number.isInteger(limit) ? limit : 200, 1), READ_LIMIT_MAX);
  const rows = [];
  let names;
  try { names = readdirSync(join(dir, 'logs')).filter((f) => DAY_FILE_RE.test(f)).sort(); } catch { return rows; }
  for (let i = names.length - 1; i >= 0 && rows.length < n; i--) {
    let lines;
    try { lines = readFileSync(join(dir, 'logs', names[i]), 'utf8').split('\n').filter(Boolean); } catch { continue; }
    for (let j = lines.length - 1; j >= 0 && rows.length < n; j--) {
      let row;
      try { row = JSON.parse(lines[j]); } catch { continue; }
      if (!row || typeof row !== 'object') continue;
      if (level !== null && row.level !== level) continue;
      if (event !== null && row.event !== event) continue;
      if (since !== null && typeof row.ts === 'string' && row.ts < since) continue;
      rows.push(row);
    }
  }
  return rows;
}

// The newest lines of one project's record (wa11).
export function readProjectLog(smDir, projectId, { since = null, limit = 200 } = {}) {
  if (!smDir || typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) return [];
  const n = Math.min(Math.max(Number.isInteger(limit) ? limit : 200, 1), READ_LIMIT_MAX);
  const rows = [];
  let lines;
  try { lines = readFileSync(join(smDir, 'logs', 'projects', `${projectId}.jsonl`), 'utf8').split('\n').filter(Boolean); } catch { return rows; }
  for (let j = lines.length - 1; j >= 0 && rows.length < n; j--) {
    let row;
    try { row = JSON.parse(lines[j]); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    if (since !== null && typeof row.ts === 'string' && row.ts < since) continue;
    rows.push(row);
  }
  return rows;
}
