#!/usr/bin/env node
// The release gate (fd05): nothing outdated ships. Usage:
//   node scripts/release-gate.mjs [--check | --publish | --pre-push] [--root <folder>]
// --check   everything except the screenshots' day and the suite (cheap; the normal suite runs it too).
// --publish --check plus: screenshots dated today, no done item left unticked, the whole test suite.
// --pre-push  reads the lines git hands to a pre-push hook on stdin and runs --publish only when a v* tag is pushed.
// Exit 0 when it all holds, 1 with one line per failure ("<id>: <what> — <how to fix>"), 2 for a bad command line.
// The checks only read. Exact work, no AI, no network.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseArch } from '../server/arch/parse.mjs';
import { brokenLinks, codeSpansOf, headingsOf, linksOf } from '../server/foundation/mdlinks.mjs';
import { resolvePointer } from '../server/foundation/pointers.mjs';
import { requestsOf } from '../server/web/requests.js';
import { verifyManifest } from './shots-manifest.mjs';
import { todayLocal } from './readme-shots.mjs';
import { runSync } from './sync-agents.mjs';

export const CHECK_IDS = ['versions', 'changelog', 'features', 'links', 'shots', 'invention', 'shots-date', 'ticked', 'agent-files', 'tests'];
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..');
const READMES = ['README.md', 'README.pt-BR.md'];
const SEMVER = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?';
const ARCH_DIRS = ['docs/arquitetura', 'docs/architecture', 'docs/arch'];
const BARE_EXT = new Set(['md', 'mjs', 'js', 'json', 'yml', 'yaml']);
const MAX_DOCS = 400;

const fail = (id, what, fix) => ({ id, message: `${what} — ${fix}` });
const readText = (root, rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; } };
const readJson = (root, rel) => { try { return JSON.parse(readFileSync(join(root, rel), 'utf8')); } catch { return null; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function cmpVersions(a, b) {
  const num = (v) => v.split('-')[0].split('.').map(Number);
  const [x, y] = [num(a), num(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  const [pa, pb] = [a.includes('-'), b.includes('-')];
  if (pa !== pb) return pa ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---- versions -------------------------------------------------------------------------------------------------------

const versionComment = (text) => new RegExp(`<!--\\s*session-map:version\\s+(${SEMVER})\\s*-->`).exec(text ?? '')?.[1] ?? null;

function changelogSections(text) {
  const heads = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = /^##\s+(.*?)\s*$/.exec(l);
    if (m) heads.push({ i, title: m[1], version: new RegExp(`^\\[?v?(${SEMVER})\\]?(?:\\s|$)`).exec(m[1])?.[1] ?? null });
  });
  return heads.map((h, k) => ({ ...h, body: lines.slice(h.i + 1, heads[k + 1]?.i ?? lines.length) }));
}

function checkVersions(root) {
  const out = [];
  const pkg = readJson(root, 'package.json');
  const want = pkg?.version;
  if (typeof want !== 'string') return [fail('versions', 'package.json has no version', 'set "version" to the release number')];
  const mismatch = (where, found) => out.push(fail('versions', `${where} says ${found ?? 'nothing'}, package.json says ${want}`, `make ${where} say ${want}`));
  const plugin = readJson(root, '.claude-plugin/plugin.json');
  if (!plugin) out.push(fail('versions', '.claude-plugin/plugin.json is missing or not JSON', `restore it with "version": "${want}"`));
  else if (plugin.version !== want) mismatch('.claude-plugin/plugin.json', plugin.version);
  const market = readJson(root, '.claude-plugin/marketplace.json');
  if (market) {
    if (market.version !== undefined && market.version !== want) mismatch('.claude-plugin/marketplace.json', market.version);
    for (const p of market.plugins ?? []) if (p?.version !== undefined && p.version !== want) mismatch('.claude-plugin/marketplace.json (plugins)', p.version);
  }
  const log = readText(root, 'CHANGELOG.md');
  if (log !== null) {
    const top = changelogSections(log).find((s) => s.version);
    if (top?.version !== want) mismatch('the top of CHANGELOG.md', top?.version);
  }
  for (const name of READMES) {
    const text = readText(root, name);
    if (text === null) { out.push(fail('versions', `${name} is missing`, 'restore it')); continue; }
    const found = versionComment(text);
    if (found !== want) out.push(fail('versions', found ? `the version comment of ${name} says ${found}, package.json says ${want}` : `${name} has no <!-- session-map:version ${want} --> line under its title`, `put <!-- session-map:version ${want} --> right under the title of ${name}`));
  }
  return out;
}

// ---- changelog ------------------------------------------------------------------------------------------------------

function checkChangelog(root) {
  const text = readText(root, 'CHANGELOG.md');
  if (text === null) return [fail('changelog', 'CHANGELOG.md does not exist', 'create it with a section for this version')];
  const want = readJson(root, 'package.json')?.version;
  const sections = changelogSections(text).filter((s) => s.version);
  const out = [];
  const mine = sections.find((s) => s.version === want);
  if (!mine) out.push(fail('changelog', `CHANGELOG.md has no "## ${want}" section`, `add a "## ${want}" section with what changed`));
  else if (!mine.body.some((l) => /^\s*[-*+]\s+\S/.test(l))) out.push(fail('changelog', `the "## ${want}" section of CHANGELOG.md has no item`, 'list what changed as "- " lines'));
  for (let i = 1; i < sections.length; i++) {
    if (cmpVersions(sections[i - 1].version, sections[i].version) <= 0) {
      out.push(fail('changelog', `CHANGELOG.md lists ${sections[i].version} after ${sections[i - 1].version}`, 'keep the versions newest first'));
    }
  }
  return out;
}

// ---- features -------------------------------------------------------------------------------------------------------

function pathCandidate(span, skips) {
  const s = span.trim();
  if (!/^[\w@.+-]+(?:\/[\w@.+-]+)*\/?$/.test(s) || s.includes('..')) return null;
  if (skips.some((p) => s.startsWith(p))) return null;
  const ext = /\.([A-Za-z0-9]+)$/.exec(s.replace(/\/$/, ''))?.[1]?.toLowerCase();
  if (s.includes('/')) return s.endsWith('/') || ext ? s : null;
  return ext && BARE_EXT.has(ext) && !s.startsWith('.') ? s : null;
}

function flagKnown(name, sources) {
  const plain = new RegExp(`--${name}(?![\\w-])`);
  const option = new RegExp(`(?:^|[\\s{,'"])${name}['"]?\\s*:\\s*\\{\\s*type`);
  return sources.some((t) => plain.test(t) || option.test(t));
}

async function englishTabs(root) {
  const file = join(root, 'server', 'web', 'i18n.js');
  if (!existsSync(file)) return null;
  const { LANGS } = await import(pathToFileURL(file).href);
  const names = new Set();
  for (const [k, v] of Object.entries(LANGS.en ?? {})) if (/^p?tab\./.test(k) && !k.endsWith('.label') && typeof v === 'string') names.add(v.toLowerCase());
  return names;
}

async function checkFeatures(root) {
  const out = [];
  const map = readJson(root, 'scripts/release-features.json');
  if (!map || !Array.isArray(map.features) || !Array.isArray(map.skip)) {
    return [fail('features', 'scripts/release-features.json is missing or has no "features" and "skip" lists', 'restore it from git')];
  }
  const texts = Object.fromEntries(READMES.map((n) => [n, readText(root, n)]));
  const known = new Set([...map.skip, ...map.features.map((f) => f.readme)]);

  const titles = (name) => headingsOf(texts[name] ?? '').filter((h) => h.level === 2 || h.level === 3);
  for (const h of titles('README.md')) {
    if (!known.has(h.text)) out.push(fail('features', `README.md has the title "${h.text}", which is not in the feature map`, 'add it to "features" in scripts/release-features.json with the code that does it, or to "skip" if it describes no feature'));
  }
  const [en, pt] = [titles('README.md').length, titles('README.pt-BR.md').length];
  if (en !== pt) out.push(fail('features', `README.md has ${en} ## and ### titles and README.pt-BR.md has ${pt}`, 'keep the two READMEs with the same titles, one for one'));

  const readCode = (p) => readText(root, p);
  for (const f of map.features) {
    for (const ptr of f.code ?? []) {
      const r = ptr.includes('#') ? resolvePointer(ptr, { facts: [], readCode }) : { ok: existsSync(join(root, ptr)), why: 'path-missing' };
      if (!r.ok) out.push(fail('features', `the feature "${f.readme}" points at ${ptr}, which is ${r.why === 'symbol-missing' ? 'not in that file any more' : 'not there any more'}`, 'fix the pointer in scripts/release-features.json, or take the sentence out of the README if the feature is gone'));
    }
  }

  const skillFiles = existsSync(join(root, 'skills')) ? readdirSync(join(root, 'skills')).map((n) => `skills/${n}/SKILL.md`) : [];
  const sources = ['server/main.mjs', 'server/cli.mjs', ...skillFiles].map((p) => readText(root, p) ?? '');
  const flagSkip = new Set(map.flagsSkip ?? []);
  const pathSkip = map.pathsSkip ?? [];
  const tabs = await englishTabs(root);
  for (const name of READMES) {
    const text = texts[name];
    if (text === null) continue;
    for (const m of text.matchAll(/\/session-map:([a-z][\w-]*)/g)) {
      if (!existsSync(join(root, 'skills', m[1], 'SKILL.md'))) out.push(fail('features', `${name} cites /session-map:${m[1]}, which has no skills/${m[1]}/SKILL.md`, 'add the skill or take the command out of the README'));
    }
    for (const span of codeSpansOf(text)) {
      const flag = /^--([a-z][a-z0-9-]*)/.exec(span.text.trim());
      if (flag) {
        if (!flagSkip.has(`--${flag[1]}`) && !flagKnown(flag[1], sources)) out.push(fail('features', `${name}:${span.line} cites --${flag[1]}, which server/main.mjs and server/cli.mjs do not read`, 'add the option or take it out of the README'));
        continue;
      }
      const path = pathCandidate(span.text, pathSkip);
      if (path && !existsSync(join(root, path))) out.push(fail('features', `${name}:${span.line} cites ${path}, which does not exist`, 'fix the path, or list its prefix in "pathsSkip" if it lives on the user side'));
    }
  }
  if (tabs && texts['README.md']) {
    const seen = new Set();
    for (const m of texts['README.md'].matchAll(/\b[Tt]he\s+\**([A-Z][\w-]*(?: [A-Z][\w-]*)*)\**\s+tab\b/g)) {
      if (tabs.has(m[1].toLowerCase()) || seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push(fail('features', `README.md talks about "the ${m[1]} tab", which is not a tab in the page's English dictionary`, 'fix the name or take the sentence out'));
    }
  }
  return out;
}

// ---- links ----------------------------------------------------------------------------------------------------------

function markdownFiles(root, dir, into, depth = 0) {
  if (depth > 6 || into.length > MAX_DOCS) return;
  let names;
  try { names = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return; }
  for (const e of names) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) markdownFiles(root, rel, into, depth + 1);
    else if (/\.md$/i.test(e.name)) into.push(rel);
  }
}

const isPicture = (l) => !l.external && (l.kind === 'image' || (l.kind === 'html' && /\.(?:webp|png|jpe?g|gif|svg)$/i.test(l.path)));

function checkLinks(root) {
  const rels = [...READMES, 'CONTRIBUTING.md', 'CHANGELOG.md'].filter((r) => existsSync(join(root, r)));
  markdownFiles(root, 'docs', rels);
  const files = Object.fromEntries(rels.map((r) => [r, readText(root, r) ?? '']));
  // A missing README picture is the 'shots' check's to report.
  const pictures = new Set(READMES.flatMap((n) => linksOf(files[n] ?? '').filter(isPicture).map((l) => `${n}|${l.target}`)));
  const bad = brokenLinks(files, (p) => existsSync(join(root, p))).filter((b) => !pictures.has(`${b.file}|${b.target}`));
  return bad.map((b) => fail('links', `${b.file}:${b.line} links to ${b.target}, which ${b.why === 'anchor-missing' ? 'has no such heading' : 'does not exist'}`, 'fix the link or restore the target'));
}

// ---- shots ----------------------------------------------------------------------------------------------------------

const SHOTS = 'docs/images/shots.json';
const SHOTS_FIX = 'run `npm run shots` to take them again';

function readManifest(root) {
  const text = readText(root, SHOTS);
  if (text === null) return { missing: true };
  try { return { manifest: JSON.parse(text) }; } catch { return { manifest: null }; }
}

function checkShots(root, notes) {
  const out = [];
  for (const name of READMES) {
    const text = readText(root, name);
    if (text === null) continue;
    for (const l of linksOf(text)) {
      if (!isPicture(l)) continue;
      if (l.path && !existsSync(join(root, l.path))) out.push(fail('shots', `${name}:${l.line} shows ${l.path}, which does not exist`, SHOTS_FIX));
    }
  }
  const { missing, manifest } = readManifest(root);
  if (missing) { notes.push(`${SHOTS} does not exist yet; it is written the first time the screenshots are taken (\`npm run shots\`)`); return out; }
  const version = readJson(root, 'package.json')?.version;
  const readImage = (n) => { try { return readFileSync(join(root, 'docs', 'images', n)); } catch { return null; } };
  for (const f of verifyManifest(manifest, { version, today: null, readImage, publish: false })) {
    const what = {
      'manifest-invalid': `${SHOTS} is not a screenshots manifest`,
      'image-missing': `${f.image} is in ${SHOTS} but not in docs/images`,
      'sha-differs': `${f.image} is not the picture ${SHOTS} vouches for`,
      'version-differs': `${SHOTS} is for version ${f.found}, not ${f.expected}`,
    }[f.code] ?? `${SHOTS}: ${f.code}`;
    out.push(fail('shots', what, SHOTS_FIX));
  }
  return out;
}

function checkShotsDate(root, today) {
  const { missing, manifest } = readManifest(root);
  if (missing) return [fail('shots-date', `${SHOTS} does not exist`, SHOTS_FIX)];
  const version = readJson(root, 'package.json')?.version;
  return verifyManifest(manifest, { version, today, readImage: () => Buffer.alloc(0), publish: true })
    .filter((f) => f.code === 'date-not-today')
    .map((f) => fail('shots-date', `the screenshots are dated ${f.found}, today is ${f.expected}`, SHOTS_FIX));
}

// ---- invention ------------------------------------------------------------------------------------------------------

async function checkInvention(measure) {
  try {
    const res = await (measure ?? (async () => (await import('./measure-foundation.mjs')).measure())) ();
    if (res.ok) return [];
    return (res.failures.length ? res.failures : ['the measure failed']).map((line) => fail('invention', line, 'fix the reader or its answer key; never loosen test/fixtures/repos/limits.json'));
  } catch (err) {
    return [fail('invention', `the measure of the readers could not run (${err?.message ?? err})`, 'run node scripts/measure-foundation.mjs and fix what it says')];
  }
}

// ---- ticked ---------------------------------------------------------------------------------------------------------

function readArchitecture(root) {
  for (const dir of ARCH_DIRS) {
    if (!isDir(join(root, dir))) continue;
    const files = {};
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.isFile() && /\.md$/i.test(e.name)) files[e.name] = readText(root, posix.join(dir, e.name)) ?? '';
    }
    return { dir, arch: parseArch(dir, files, 'worktree') };
  }
  return null;
}

const DONE_STATUS = /^status\s*:\s*(?:done\b|released in\b)/i;

function checkTicked(root) {
  const found = readArchitecture(root);
  if (!found) return [];
  const out = [];
  for (const part of found.arch.parts) {
    for (const g of part.groups ?? []) {
      for (const it of g.items ?? []) {
        if (it.status === 'done') continue;
        const line = (it.detail ?? []).find((d) => DONE_STATUS.test(d.trim()));
        if (line) out.push(fail('ticked', `${found.dir}/${part.id}.md: item ${it.code ?? it.title} is not ticked but its detail says "${line.trim().slice(0, 60)}"`, 'tick it with [x]'));
      }
    }
  }
  for (const r of requestsOf({ arch: found.arch }).list) {
    if (r.unconfirmed) out.push(fail('ticked', `request ${r.code} has all its work done but the registry still shows it open`, 'confirm it in the requests registry (Status: done) or reopen the work'));
  }
  return out;
}

// ---- agent files ----------------------------------------------------------------------------------------------------

// The specialist agent files follow the architecture map (id158, or68). A project that never generated them has nothing to
// keep fresh, and one whose map or files cannot be read is not this check's business: only a real drift fails.
export async function checkAgentFilesFresh(root) {
  const res = await runSync({ root, check: true }).catch(() => null);
  if (!res || res.error || res.ok || res.missing.length >= res.files) return [];
  const drift = [...res.missing, ...res.changed, ...res.stale];
  return [fail('agent-files', `${drift.length} agent file(s) no longer follow the architecture map (${drift.slice(0, 3).join(', ')}${drift.length > 3 ? ', …' : ''})`, 'run node scripts/sync-agents.mjs')];
}

// ---- tests ----------------------------------------------------------------------------------------------------------

// Node 20 does not expand a glob by itself, so the files are listed here and passed one by one.
function testFiles(root) {
  try { return readdirSync(join(root, 'test')).filter((n) => /\.test\.mjs$/.test(n)).sort().map((n) => `test/${n}`); } catch { return []; }
}

function defaultRunTests({ root, files }) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.on('error', () => done({ ok: false }));
    child.on('close', (code) => done({ ok: code === 0 }));
  });
}

async function checkTests(root, runTests) {
  const files = testFiles(root);
  if (!files.length) return [fail('tests', 'there is no test file in test/', 'restore the suite')];
  const res = await (runTests ?? defaultRunTests)({ root, files });
  return res.ok ? [] : [fail('tests', 'the test suite does not pass', 'fix the failing tests printed above')];
}

// ---- the gate -------------------------------------------------------------------------------------------------------

// -> { ok, failures: [{ id, message }], notes: [string] }. measure and runTests are injectable for the tests.
export async function runGate({ root = REPO, mode = 'check', measure, runTests, today = todayLocal() } = {}) {
  const notes = [];
  const failures = [
    ...checkVersions(root),
    ...checkChangelog(root),
    ...await checkFeatures(root),
    ...checkLinks(root),
    ...checkShots(root, notes),
    ...await checkInvention(measure),
  ];
  if (mode === 'publish') {
    failures.push(...checkShotsDate(root, today), ...checkTicked(root), ...await checkAgentFilesFresh(root), ...await checkTests(root, runTests));
  }
  return { ok: failures.length === 0, failures, notes };
}

// ---- command line ---------------------------------------------------------------------------------------------------

// A pre-push hook gets "<local ref> <local sha> <remote ref> <remote sha>" per line; only a v* tag is a release.
export const pushesReleaseTag = (stdinText) => String(stdinText ?? '').split(/\r?\n/).some((l) => /^refs\/tags\/v\S*/.test(l.trim().split(/\s+/)[0] ?? ''));

const readStdin = async () => {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
};

export async function main(argv, { stdin = readStdin, runGate: run = runGate, out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`) } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { check: { type: 'boolean' }, publish: { type: 'boolean' }, 'pre-push': { type: 'boolean' }, root: { type: 'string' } },
      allowPositionals: true, // git passes the remote's name and url to a pre-push hook
    }));
  } catch (e) {
    err(`release-gate: ${e.message}`);
    return 2;
  }
  const root = values.root ? resolve(values.root) : REPO;
  if (!isDir(root)) { err(`release-gate: ${root} is not a folder`); return 2; }
  let mode = values.publish ? 'publish' : 'check';
  if (values['pre-push']) {
    if (!pushesReleaseTag(await stdin())) return 0;
    mode = 'publish';
  }
  const res = await run({ root, mode });
  for (const n of res.notes ?? []) out(`note: ${n}`);
  for (const f of res.failures) err(`${f.id}: ${f.message}`);
  if (!res.ok) return 1;
  out(`release gate (${mode}): ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
