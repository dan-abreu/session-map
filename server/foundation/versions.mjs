// Versions always in sight (fd09), the reading side: the version the code declares (with file and line), the last tag, the
// next number to publish, the main pieces of every package and the Node the project asks for. Everything exact comes from
// files and git; what only the network knows (advisories, end of life, latest) comes from the online cache the other module
// saved, and without it every piece says `verified: false` with the reason. Contract: 00-contratos.md § 9 + bloco-4b § 5.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSecretsFile } from '../files.mjs';
import { readFd, writeFd } from './store.mjs';
import { commitsSince, lastTag, listedFiles } from './versions-git.mjs';
import { MAIN_PIECES, compareSemver, floorOfRange, mismatchOf, nextVersion, parseSemver, relationOf, warningOf } from './versions-core.mjs';

const FILE_MAX = 1_000_000;
const OTHERS_MAX = 20;
const PIECES_MAX = 200;
const NAMES = ['VERSION', 'package.json', 'pubspec.yaml', 'composer.json'];
const NODE_FILES = ['.nvmrc', '.node-version'];
const WANTED = new Set([...NAMES, ...NODE_FILES]);
// Folders that hold other people's code: a manifest in there is not the project's.
const FOREIGN = new Set(['node_modules', 'vendor', 'vendors', 'third_party', 'third-party', 'bower_components', '.venv', 'venv', 'pods', '.dart_tool', '.git']);
const NPM_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const COMPOSER_SECTIONS = ['require', 'require-dev'];
const piecesOf = (...ecosystems) => new Map(MAIN_PIECES.filter((p) => ecosystems.includes(p.ecosystem)).map((p) => [p.name, p.ecosystem]));
const NPM_PIECES = piecesOf('npm');
const COMPOSER_PIECES = new Map([...piecesOf('packagist'), ['php', 'runtime']]);

const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const depthOf = (p) => p.split('/').length - 1;
const ownVersion = () => {
  try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? null; } catch { return null; }
};

// ---------- reading a manifest ----------

// 1-based line of the key at `path` (['version'], ['dependencies', 'next']) in a JSON text, or null. A small scanner instead of
// a search by text: the same name can appear in several sections, and a minified file has everything on line 1.
export function jsonKeyLine(text, path) {
  const stack = [];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { line++; continue; }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') { s += text[j + 1] ?? ''; j += 2; } else { s += text[j]; j++; }
      }
      const top = stack[stack.length - 1];
      if (top?.obj && top.expectKey) {
        top.key = s;
        top.expectKey = false;
        if (stack.length === path.length && stack.every((f, k) => f.key === path[k])) return line;
      }
      i = j;
    } else if (c === '{') stack.push({ obj: true, key: null, expectKey: true });
    else if (c === '[') stack.push({ obj: false, key: null, expectKey: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',' && stack[stack.length - 1]?.obj) stack[stack.length - 1].expectKey = true;
  }
  return null;
}

function parseJson(text) {
  try {
    const data = JSON.parse(text.replace(/^﻿/, ''));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

const unquote = (s) => s.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();

// pubspec.yaml: the top-level `version:` and the `environment:` block (sdk, flutter). A line scan: this is not a YAML parser.
function pubspecOf(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const out = { version: null, versionLine: null, env: {} };
  let inEnv = false;
  lines.forEach((raw, i) => {
    if (/^\S/.test(raw)) {
      inEnv = /^environment\s*:\s*(#.*)?$/.test(raw);
      const m = /^version\s*:\s*(.+)$/.exec(raw);
      if (m && out.version === null) { out.version = unquote(m[1]); out.versionLine = i + 1; }
      return;
    }
    if (!inEnv) return;
    const m = /^\s+(sdk|flutter)\s*:\s*(.+)$/.exec(raw);
    if (m && !(m[1] in out.env)) out.env[m[1]] = { range: unquote(m[2]), line: i + 1 };
  });
  return out;
}

const firstLine = (text) => text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) ?? null;

// ---------- finding the manifests ----------

async function candidatePaths(root, census) {
  let paths;
  if (census && Array.isArray(census.files)) paths = census.files.filter((f) => f.included).map((f) => f.path);
  else paths = (await listedFiles(root)) ?? NAMES.concat(NODE_FILES).filter((n) => existsSync(join(root, n)));
  return paths
    .map((p) => String(p).replaceAll('\\', '/'))
    .filter((p) => WANTED.has(baseOf(p)) && !isSecretsFile(p) && !p.split('/').some((seg) => FOREIGN.has(seg.toLowerCase())))
    .sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// ---------- the answer ----------

const declared = (source, version, file, line) => ({ source, version, file, line });

function pieceFrom(name, ecosystem, range, file, line, sources) {
  const found = warningOf({ name, ecosystem, version: typeof range === 'string' ? range : null }, sources);
  return {
    name, ecosystem, version: floorOfRange(range), range: typeof range === 'string' ? range : null, file, line,
    warning: found.warning, verified: found.verified, reason: found.reason, latest: found.latest,
  };
}

function nodeAnswer({ required, running, sources }) {
  const base = { running, required: required?.text ?? null, source: required?.source ?? null };
  const floor = floorOfRange(required?.text) ?? floorOfRange(running);
  const v = parseSemver(floor ?? '');
  const cycles = sources?.eol?.node;
  const answered = v && Array.isArray(cycles) && cycles.some((c) => [`${v.major}.${v.minor}`, String(v.major)].includes(String(c?.cycle)));
  if (!answered) return { ...base, eol: null, verified: false };
  return { ...base, eol: warningOf({ name: 'node', ecosystem: 'runtime', version: floor }, sources).warning?.kind === 'eol', verified: true };
}

function liveOf(cache) {
  const l = cache?.live;
  if (!l || typeof l !== 'object') return null;
  return { url: l.url ?? null, version: l.version ?? null, match: l.match ?? null, checkedAt: l.checkedAt ?? null };
}

function selfOf(current, cache) {
  const latest = parseSemver(cache?.selfVersion?.latest ?? '') ? String(cache.selfVersion.latest) : null;
  const newer = latest && current ? compareSemver(latest, current) : null;
  return { current: current ?? null, latest, newer: newer === null ? null : newer > 0, verified: latest !== null };
}

// root: the project folder. census: the last census (optional; without it git lists the files). smDir + id: where versions.json
// is written and versions-online.json is read from (both optional: without them nothing is written or merged).
// cache: the online answer, handed in by a caller that already has it. readFile and nodeRunning are injectable for tests.
export async function versionsOf({
  root, census = null, smDir = null, id = null, now = new Date(), cache,
  readFile = readFileSync, nodeRunning = process.versions.node, selfVersion = ownVersion(),
}) {
  const online = cache !== undefined ? cache : smDir && id ? readFd(smDir, id, 'versions-online.json', null) : null;
  const raw = online?.sources ?? (online && (online.vulns || online.eol || online.latest) ? online : null);
  const sources = raw && typeof raw === 'object' ? { ...raw, now: now.toISOString() } : null;

  const read = (path) => {
    try {
      const text = readFile(join(root, path), 'utf8');
      return typeof text === 'string' && text.length <= FILE_MAX ? text : null;
    } catch { return null; }
  };

  const claims = []; // every version a file declares, in the order that decides which one is "the code"
  const pieces = [];
  const seen = new Set();
  const addPiece = (name, ecosystem, range, file, line) => {
    const key = `${file}\0${name}`;
    if (seen.has(key) || pieces.length >= PIECES_MAX) return;
    seen.add(key);
    pieces.push(pieceFrom(name, ecosystem, range, file, line, sources));
  };
  let engines = null; // first `engines.node` found, root first
  let nvm = null;

  const paths = await candidatePaths(root, census);
  const rank = (p) => NAMES.indexOf(baseOf(p));
  for (const path of [...paths].sort((a, b) => depthOf(a) - depthOf(b) || rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    const name = baseOf(path);
    const text = read(path);
    if (text === null) continue;
    if (name === 'VERSION') {
      const v = firstLine(text);
      if (v && v.length <= 50) claims.push(declared('VERSION', v, path, text.split(/\r?\n/).findIndex((l) => l.trim() === v) + 1));
    } else if (NODE_FILES.includes(name)) {
      const v = firstLine(text);
      if (v && v.length <= 50 && nvm === null && !path.includes('/')) nvm = { text: v, source: path };
    } else if (name === 'pubspec.yaml') {
      const p = pubspecOf(text);
      if (p.version) claims.push(declared('pubspec.yaml', p.version, path, p.versionLine));
      if (p.env.sdk) addPiece('dart', 'runtime', p.env.sdk.range, path, p.env.sdk.line);
      if (p.env.flutter) addPiece('flutter', 'runtime', p.env.flutter.range, path, p.env.flutter.line);
    } else {
      const data = parseJson(text);
      if (!data) continue;
      if (typeof data.version === 'string' && data.version.trim() && data.version.length <= 50) {
        claims.push(declared(name, data.version.trim(), path, jsonKeyLine(text, ['version'])));
      }
      const [sections, wanted] = name === 'package.json' ? [NPM_SECTIONS, NPM_PIECES] : [COMPOSER_SECTIONS, COMPOSER_PIECES];
      for (const section of sections) {
        const block = data[section];
        if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
        for (const [dep, range] of Object.entries(block)) {
          if (wanted.has(dep) && typeof range === 'string') addPiece(dep, wanted.get(dep), range, path, jsonKeyLine(text, [section, dep]));
        }
      }
      const engine = name === 'package.json' && data.engines && typeof data.engines.node === 'string' ? data.engines.node.trim() : '';
      if (engine && engine.length <= 50 && engines === null) engines = { text: engine, source: path };
    }
  }
  const required = engines ?? nvm;
  pieces.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  const tag = await lastTag(root);
  const tagVersion = tag && parseSemver(tag) ? tag.replace(/^v/, '') : null;
  const first = claims[0] ?? null;
  const code = first
    ? { version: first.version, source: first.source, file: first.file, line: first.line, others: [] }
    : tagVersion ? { version: tagVersion, source: 'tag', file: null, line: null, others: [] } : null;
  if (code) {
    code.others = claims.filter((c) => c !== first && c.version !== code.version).slice(0, OTHERS_MAX)
      .map((c) => ({ source: c.source, version: c.version, file: c.file, line: c.line }));
  }

  const relation = relationOf(code?.version ?? null, tag);
  const commits = tag ? await commitsSince(root, tag) : [];
  const out = {
    version: 1,
    generatedAt: now.toISOString(),
    code,
    tag,
    relation,
    mismatch: mismatchOf(relation),
    live: liveOf(online),
    pieces,
    node: nodeAnswer({ required, running: nodeRunning, sources }),
    selfVersion: selfOf(selfVersion, online),
    // Without a tag there is nothing to measure "after" from: no suggestion, rather than the whole history counted.
    next: tag ? nextVersion(tag, commits, code?.version ?? null) : null,
  };
  const answer = JSON.parse(JSON.stringify(out));

  if (smDir && id) {
    const prev = readFd(smDir, id, 'versions.json', null);
    const same = (a, b) => JSON.stringify({ ...a, generatedAt: 0 }) === JSON.stringify({ ...b, generatedAt: 0 });
    if (prev && same(prev, answer)) return prev;
    writeFd(smDir, id, 'versions.json', answer);
  }
  return answer;
}
