// Foundation routes of block B1 (fd01, fd02, id77): the census, its statement, the repository tree, the read ledger,
// the facts and the generated sections, plus POST refresh. Contract of a route file: http/index.mjs (token, header,
// --demo and unknown project are gated there). A file not written yet answers null; nothing here writes.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_MAX, isSecretsFile, safeResolve } from '../../files.mjs';
import { ledgerSummary, lineCharsOf } from '../ledger.mjs';
import { startRefresh } from '../refresh.mjs';
import { repoTree } from '../repotree.mjs';
import { generatedBlock } from '../sections.mjs';
import { fail, pathParam } from './common.mjs';

const KINDS = new Set(['route', 'screen', 'table', 'relation', 'queue', 'job', 'integration', 'env', 'function', 'call', 'import', 'export']);
const LOG_FILE = 'census-log.jsonl';

// ?folder= without its trailing slash; '' and '.' mean the whole repository.
function folderParam(ctx) {
  const raw = pathParam(ctx.query.get('folder'));
  if (raw === null) return null;
  const folder = raw.replace(/\/+$/, '');
  return folder === '' || folder === '.' ? null : folder;
}

// ?since= is a census rev: a whole number or nothing.
function sinceParam(ctx) {
  const raw = ctx.query.get('since');
  if (raw === null) return undefined;
  if (!/^\d{1,9}$/.test(raw)) fail(400, 'bad-since');
  return Number(raw);
}

function kindParam(ctx) {
  const raw = ctx.query.get('kind');
  if (raw === null) return null;
  if (!KINDS.has(raw)) fail(400, 'bad-kind');
  return raw;
}

// The statement, one JSON line per census rev. A torn last line (written while read) is skipped, not a 500.
function readLog(ctx) {
  let text;
  try {
    text = readFileSync(join(ctx.dir, LOG_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (Number.isInteger(parsed?.rev)) lines.push(parsed);
    } catch { /* half-written line */ }
  }
  return lines;
}

const censusOf = (ctx) => {
  const census = ctx.read('census.json', null);
  return Array.isArray(census?.files) ? census : null;
};

function census(ctx) {
  const folder = folderParam(ctx);
  const part = ctx.query.get('part');
  const data = censusOf(ctx);
  if (!data || (folder === null && part === null)) return data;
  const files = data.files.filter((f) => (folder === null || f.path.startsWith(`${folder}/`))
    && (part === null || (part === '_none' ? f.included && !f.owner : f.owner === part)));
  return { ...data, files };
}

function censusLog(ctx) {
  const since = sinceParam(ctx);
  const lines = readLog(ctx);
  if (!lines || since === undefined) return lines;
  return lines.filter((l) => l.rev > since);
}

// The text of a partly read file, for counting its read lines. Never a secret, never outside the root, never too big;
// under --demo there is no repository, so a partly read file counts as unread (the ledger module's own rule).
function lineCharsFrom(ctx) {
  return (path) => {
    if (ctx.demo || isSecretsFile(path)) return null;
    const abs = safeResolve(ctx.project.root, path);
    if (!abs || isSecretsFile(abs)) return null;
    try {
      if (statSync(abs).size > FILE_MAX) return null;
      return lineCharsOf(readFileSync(abs, 'utf8'));
    } catch {
      return null;
    }
  };
}

function ledger(ctx) {
  const data = ctx.read('read-ledger.json', null);
  if (!data || typeof data !== 'object') return null;
  const current = censusOf(ctx);
  if (!current) return data;
  return { ...data, summary: ledgerSummary(data, current, { lineChars: lineCharsFrom(ctx) }) };
}

// The facts without the reader's cache (files[*].raw and .ws, kept only for the next incremental round).
function facts(ctx) {
  const kind = kindParam(ctx);
  const file = pathParam(ctx.query.get('file'));
  const data = ctx.read('facts.json', null);
  if (!data || !Array.isArray(data.facts)) return null;
  const list = data.facts.filter((f) => (kind === null || f.kind === kind)
    && (file === null || f.file === file || (Array.isArray(f.refs) && f.refs.some((r) => r?.file === file))));
  const wanted = file === null && kind === null ? null : new Set(file === null ? list.map((f) => f.file) : [file]);
  const files = {};
  for (const [path, e] of Object.entries(data.files ?? {})) {
    if (wanted && !wanted.has(path)) continue;
    files[path] = { sha: e?.sha ?? null, extractor: e?.extractor ?? null, factIds: Array.isArray(e?.factIds) ? e.factIds : [] };
  }
  return { version: data.version, generatedAt: data.generatedAt, censusRev: data.censusRev, files, facts: list };
}

// One part: its lists, the gaps among them (a folder with no owner belongs to _none) and its generated block.
function sections(ctx) {
  const part = ctx.query.get('part');
  const data = ctx.read('sections.json', null);
  if (!data || typeof data !== 'object' || part === null) return data;
  const own = data.parts?.[part];
  if (!own) return { ...data, parts: {}, gaps: [], block: null };
  const ids = new Set(Object.values(own).flat().map((i) => i?.id));
  const gaps = (data.gaps ?? []).filter((g) => ids.has(g.id) || (part === '_none' && g.reason === 'no-owner'));
  const block = generatedBlock(own, ctx.project.arch?.lang, data.censusRev);
  return { ...data, parts: { [part]: own }, gaps, block };
}

// `project.fresh` carries totals only; repoTree takes the paths when they come as a list. Under --demo the root is made
// up, so the tree is drawn from the census alone, without asking git.
async function tree(ctx) {
  const since = sinceParam(ctx);
  const data = censusOf(ctx);
  if (!data) return null;
  return repoTree(ctx.project.root, data, {
    since, log: readLog(ctx) ?? [], fresh: ctx.project.fresh,
    ...(ctx.demo ? { list: async () => null } : {}),
  });
}

function refresh(ctx) {
  return startRefresh(ctx.project, ctx.smDir);
}

export const routes = [
  { method: 'GET', path: 'census', run: census },
  { method: 'GET', path: 'census/log', run: censusLog },
  { method: 'GET', path: 'tree', run: tree },
  { method: 'GET', path: 'ledger', run: ledger },
  { method: 'GET', path: 'facts', run: facts },
  { method: 'GET', path: 'sections', run: sections },
  { method: 'POST', path: 'refresh', run: refresh },
];
