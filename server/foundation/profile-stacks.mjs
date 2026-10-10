import { readFileSync, statSync } from 'node:fs';
import { isSecretsFile, safeResolve } from '../files.mjs';

// Project profile, part 1: which stacks (with version and the manifest line), which types of project. Pure: it works on the
// census and on text it is handed. The only way to the disk is readTextOf(root), which refuses secrets and paths outside
// the root. Everything is exact (a table, a regex, a count); nothing here asks an AI.

const MAX_TEXT = 1024 * 1024;
const NPM_SECTIONS = [['dependencies', false], ['devDependencies', true], ['peerDependencies', false], ['optionalDependencies', false]];
const COMPOSER_SECTIONS = [['require', false], ['require-dev', true]];

// ponytail: a deliberate table, not a guess. Only packages listed here become a "stack"; every dependency still reaches
// depsOf, so a detector can ask for any package by name. One line per ecosystem: package name -> stack name.
const STACKS = {
  npm: {
    next: 'next', react: 'react', vue: 'vue', nuxt: 'nuxt', svelte: 'svelte', '@sveltejs/kit': 'sveltekit', '@angular/core': 'angular',
    astro: 'astro', '@remix-run/react': 'remix', 'solid-js': 'solid', preact: 'preact',
    express: 'express', fastify: 'fastify', '@nestjs/core': 'nestjs', koa: 'koa', hono: 'hono', '@hapi/hapi': 'hapi', '@adonisjs/core': 'adonis',
    prisma: 'prisma', '@prisma/client': 'prisma', 'drizzle-orm': 'drizzle', typeorm: 'typeorm', sequelize: 'sequelize', mongoose: 'mongoose',
    bullmq: 'bullmq', tailwindcss: 'tailwind', vite: 'vite', typescript: 'typescript', electron: 'electron',
    'react-native': 'react-native', expo: 'expo', '@capacitor/core': 'capacitor',
    phaser: 'phaser', '@babylonjs/core': 'babylon',
    commander: 'commander', yargs: 'yargs', '@oclif/core': 'oclif', cac: 'cac',
  },
  composer: { php: 'php', 'laravel/framework': 'laravel', 'symfony/framework-bundle': 'symfony', 'livewire/livewire': 'livewire', 'filament/filament': 'filament' },
  pub: { flutter_riverpod: 'riverpod', riverpod: 'riverpod', flutter_bloc: 'bloc', firebase_core: 'firebase', drift: 'drift' },
  pip: {
    django: 'django', flask: 'flask', fastapi: 'fastapi', sqlalchemy: 'sqlalchemy', click: 'click', typer: 'typer',
    pandas: 'pandas', numpy: 'numpy', 'scikit-learn': 'scikit-learn', pyspark: 'pyspark', 'apache-airflow': 'airflow', 'dbt-core': 'dbt',
    polars: 'polars', torch: 'torch', tensorflow: 'tensorflow', jupyter: 'jupyter',
  },
};

// ponytail: convention. Which stacks say which type of project (README: types are web api mobile library cli game data).
// Plain `react` says web only when the project is not mobile (react-native brings react along).
const WEB = new Set(['next', 'vue', 'nuxt', 'svelte', 'sveltekit', 'angular', 'astro', 'remix', 'solid', 'preact']);
const API = new Set(['express', 'fastify', 'nestjs', 'koa', 'hono', 'hapi', 'adonis', 'laravel', 'symfony', 'django', 'flask', 'fastapi']);
const MOBILE = new Set(['flutter', 'react-native', 'expo', 'capacitor']);
const CLI = new Set(['commander', 'yargs', 'oclif', 'cac', 'click', 'typer']);
const GAME = new Set(['phaser', 'babylon']);
const DATA = new Set(['pandas', 'numpy', 'scikit-learn', 'pyspark', 'airflow', 'dbt', 'polars', 'torch', 'tensorflow', 'jupyter']);
const GAME_FILE = /(^|\/)(project\.godot|ProjectSettings\/ProjectVersion\.txt)$|\.uproject$/;
const DATA_FILE = /\.ipynb$|(^|\/)dbt_project\.yml$/;
const TYPE_ORDER = ['web', 'api', 'mobile', 'library', 'cli', 'game', 'data'];

const baseOf = (path) => path.split('/').pop();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The version as written in the manifest, without the operator; null when the spec is not a version (a tag, a path, a
// workspace link, a git URL, "*"). Never a guess.
export function versionOf(spec) {
  if (typeof spec !== 'string') return null;
  const first = spec.trim().split(/\s*\|\|\s*/)[0].split(',')[0].trim().replace(/^[\^~<>=!v\s]+/, '');
  const m = /^(\d+(?:\.(?:\d+|x|\*))*(?:[-+][0-9A-Za-z.+-]*)?)/.exec(first);
  return m ? m[1] : null;
}

// The only door to the text of the project: refuses .env (anything isSecretsFile says), paths outside the root and links
// that lead out of it (safeResolve), directories and files over 1 MB. Anything it cannot read is null.
export function readTextOf(root) {
  return (rel) => {
    if (isSecretsFile(rel)) return null;
    const abs = safeResolve(root, rel);
    if (!abs) return null;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_TEXT) return null;
      return readFileSync(abs, 'utf8');
    } catch { return null; }
  };
}

// ---------- the readers, one per manifest ----------

function jsonDeps(text, sections, eco) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const lines = text.split(/\r?\n/);
  const deps = [];
  for (const [section, dev] of sections) {
    const group = data[section];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const head = new RegExp(`"${escapeRe(section)}"\\s*:`);
    const start = Math.max(0, lines.findIndex((l) => head.test(l)));
    for (const [name, spec] of Object.entries(group)) {
      if (/^(ext|lib)-/.test(name)) continue;
      const key = new RegExp(`"${escapeRe(name)}"\\s*:`);
      let at = lines.findIndex((l, i) => i >= start && key.test(l));
      if (at < 0) at = start;
      deps.push({ name, version: versionOf(spec), line: at + 1, dev, eco });
    }
  }
  return { data, deps };
}

function readPackageJson(text) {
  const parsed = jsonDeps(text, NPM_SECTIONS, 'npm');
  if (!parsed) return null;
  const { data } = parsed;
  const isPrivate = data.private === true;
  const entry = ['main', 'module', 'exports', 'types', 'typings'].some((k) => data[k] != null);
  return { deps: parsed.deps, stacks: [], pkg: { private: isPrivate, publishable: !isPrivate && entry, bin: data.bin != null } };
}

function readComposer(text) {
  const parsed = jsonDeps(text, COMPOSER_SECTIONS, 'composer');
  if (!parsed) return null;
  const { data } = parsed;
  const bin = Array.isArray(data.bin) ? data.bin.length > 0 : typeof data.bin === 'string';
  return { deps: parsed.deps, stacks: [], pkg: { private: false, publishable: data.type === 'library', bin } };
}

// pubspec.yaml: a small line reader (indent decides the level); enough for dependencies, environment and publish_to.
function readPubspec(text) {
  const deps = [];
  const env = {};
  let section = null;
  let child = null;
  let flutter = false;
  let publishNone = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(^|\s)#.*$/, '');
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      section = top ? top[1] : null;
      child = null;
      if (top && top[1] === 'publish_to' && top[2].trim().replace(/['"]/g, '') === 'none') publishNone = true;
      return;
    }
    child ??= indent;
    if (indent !== child) return;
    const m = /^\s+([A-Za-z_][\w.-]*):\s*(.*)$/.exec(line);
    if (!m) return;
    const value = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (section === 'environment') env[m[1]] = { version: versionOf(value), line: i + 1 };
    else if (section === 'dependencies' || section === 'dev_dependencies') {
      if (m[1] === 'flutter' && section === 'dependencies') flutter = { line: i + 1 };
      deps.push({ name: m[1], version: versionOf(value), line: i + 1, dev: section === 'dev_dependencies', eco: 'pub' });
    }
  });
  const stacks = [];
  if (flutter) stacks.push({ name: 'flutter', version: env.flutter?.version ?? null, line: env.flutter?.line ?? flutter.line });
  if (env.sdk) stacks.push({ name: 'dart', version: env.sdk.version, line: env.sdk.line });
  return { deps, stacks, pkg: { private: publishNone, publishable: !flutter && !publishNone, bin: false } };
}

function readRequirements(text) {
  const deps = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(^|\s)#.*$/, '').split(';')[0].trim();
    if (!line || /^[-.\/]/.test(line) || line.includes('://')) return;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (m) deps.push({ name: m[1].toLowerCase().replaceAll('_', '-'), version: versionOf(m[2]), line: i + 1, dev: false, eco: 'pip' });
  });
  return { deps, stacks: [], pkg: null };
}

function readNvmrc(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'));
  if (at < 0) return null;
  return { deps: [], stacks: [{ name: 'node', version: versionOf(lines[at].trim()), line: at + 1 }], pkg: null };
}

const READERS = [
  [(n) => n === 'package.json', readPackageJson],
  [(n) => n === 'composer.json', readComposer],
  [(n) => n === 'pubspec.yaml' || n === 'pubspec.yml', readPubspec],
  [(n) => /^requirements[\w.-]*\.txt$/.test(n), readRequirements],
  [(n) => n === '.nvmrc', readNvmrc],
];

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const byVersion = (a, b) => {
  if (a.version === b.version) return 0;
  if (a.version === null) return 1;
  if (b.version === null) return -1;
  return a.version.localeCompare(b.version, 'en', { numeric: true });
};

// Reads every manifest of the census once. Returns { stacks, deps, packages }; pass it as `scan` to the other functions to
// avoid reading twice. `deps` is for the detectors that ask for a package by name; the caller does not persist it.
export function scanManifests({ census, readText } = {}) {
  const deps = [];
  const stacks = [];
  const packages = [];
  const files = (census?.files ?? []).filter((f) => f && f.included && typeof f.path === 'string' && !isSecretsFile(f.path));
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const reader = READERS.find(([match]) => match(baseOf(f.path)));
    if (!reader) continue;
    let text;
    try { text = readText(f.path); } catch { continue; }
    if (typeof text !== 'string') continue;
    const read = reader[1](text);
    if (!read) continue;
    const sha = f.sha ?? null;
    for (const d of read.deps) {
      deps.push({ name: d.name, version: d.version, file: f.path, line: d.line, sha, dev: d.dev, eco: d.eco });
      const stack = STACKS[d.eco]?.[d.name];
      if (stack) stacks.push({ name: stack, version: d.version, file: f.path, line: d.line });
    }
    for (const s of read.stacks) stacks.push({ name: s.name, version: s.version, file: f.path, line: s.line });
    if (read.pkg) packages.push({ file: f.path, ...read.pkg });
  }
  const seen = new Set();
  const unique = stacks.filter((s) => {
    const key = `${s.name}@${s.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => byName(a, b) || byVersion(a, b) || (a.file < b.file ? -1 : 1));
  deps.sort((a, b) => byName(a, b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return { stacks: unique, deps, packages };
}

export const stacksOf = ({ census, readText, scan } = {}) => (scan ?? scanManifests({ census, readText })).stacks;
export const depsOf = ({ census, readText, scan } = {}) => (scan ?? scanManifests({ census, readText })).deps;

// Types of project, by closed rules over the stacks, the route facts, the manifests and a few file names. Not evidence-based
// per type (the contract keeps them as plain strings); the stacks and the files they come from carry the evidence.
export function typesOf({ census, facts = [], stacks = [], packages = [] } = {}) {
  const names = new Set(stacks.map((s) => s.name));
  const any = (set) => [...names].some((n) => set.has(n));
  const paths = (census?.files ?? []).filter((f) => f && f.included).map((f) => f.path);
  const mobile = any(MOBILE);
  const web = any(WEB) || (names.has('react') && !mobile) || (!mobile && paths.some((p) => baseOf(p) === 'index.html'));
  const api = facts.some((f) => f.kind === 'route') || any(API);
  const cli = packages.some((p) => p.bin) || any(CLI);
  const library = !(web || api || mobile || cli) && packages.some((p) => p.publishable);
  const game = any(GAME) || paths.some((p) => GAME_FILE.test(p));
  const data = any(DATA) || paths.some((p) => DATA_FILE.test(p));
  const on = { web, api, mobile, library, cli, game, data };
  return TYPE_ORDER.filter((t) => on[t]);
}
