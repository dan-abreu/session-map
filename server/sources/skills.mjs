import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.mjs';
import { normalizePath } from '../paths.mjs';

const DESCRIPTION_MAX = 200;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'skills-json-failed', { path });
    return {};
  }
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(' ');
    } else value = value.replace(/^(["'])(.*)\1$/, '$2');
    out[kv[1]] = value;
  }
  return out;
}

function readSkillsDir(dir, origin, plugin, enabled) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    let text;
    try {
      text = readFileSync(join(dir, e.name, 'SKILL.md'), 'utf8');
    } catch {
      continue;
    }
    const fm = frontmatter(text);
    const name = fm.name || e.name;
    skills.push({
      name,
      description: (fm.description ?? '').slice(0, DESCRIPTION_MAX),
      origin,
      plugin,
      enabled,
      command: plugin ? `/${plugin}:${name}` : `/${name}`,
      // Weight (mm52): the name and description ride along with every request; SKILL.md is read in full when opened.
      listingBytes: Buffer.byteLength(name) + Buffer.byteLength(fm.description ?? ''),
      fullBytes: Buffer.byteLength(text),
    });
  }
  return skills;
}

// Without `claude plugin list`, settings (user, then project, then local; later wins) say what is on.
function pluginsFromSettings(root, dir) {
  const enabledMap = {};
  for (const file of [join(dir, 'settings.json'), join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')]) {
    Object.assign(enabledMap, readJson(file).enabledPlugins);
  }
  const installed = readJson(join(dir, 'plugins', 'installed_plugins.json')).plugins ?? {};
  return Object.entries(installed).flatMap(([id, entries]) => {
    const entry = Array.isArray(entries) ? entries[0] : null;
    return entry?.installPath ? [{ id, enabled: enabledMap[id] === true, installPath: entry.installPath }] : [];
  });
}

// Where each marketplace came from: the repository (owner/repo), the address or the folder it was added from.
function marketplaceSources(root, dir) {
  const out = {};
  const files = [join(dir, 'settings.json'), join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')];
  const groups = [readJson(join(dir, 'plugins', 'known_marketplaces.json')), ...files.map((f) => readJson(f).extraKnownMarketplaces ?? {})];
  for (const group of groups) {
    for (const [name, entry] of Object.entries(group)) {
      const src = entry?.source ?? {};
      const from = src.repo ?? src.url ?? src.path;
      if (typeof from === 'string' && from) out[name] = from;
    }
  }
  return out;
}

export function listPlugins(root, dir, { pluginList } = {}) {
  const here = normalizePath(root);
  const sources = marketplaceSources(root, dir);
  return (pluginList ?? pluginsFromSettings(root, dir)).filter(
    (p) => p.installPath && (p.scope !== 'project' || !p.projectPath || normalizePath(p.projectPath) === here),
  ).map((p) => {
    const [name, market = ''] = String(p.id ?? '').split('@');
    const skills = readSkillsDir(join(p.installPath, 'skills'), 'plugin', name, p.enabled === true);
    return {
      ...p, name,
      // Declared repository first; without one the marketplace's own name is all that is known.
      from: sources[market] ?? market,
      skillCount: skills.length,
      listingBytes: skills.reduce((n, k) => n + k.listingBytes, 0),
      skillBytes: skills.reduce((n, k) => n + k.fullBytes, 0),
    };
  });
}

export function listSkills(root, dir, { pluginList } = {}) {
  const plugins = listPlugins(root, dir, { pluginList });
  return [
    ...readSkillsDir(join(dir, 'skills'), 'user', null, true),
    ...readSkillsDir(join(root, '.claude', 'skills'), 'project', null, true),
    ...plugins.flatMap((p) => readSkillsDir(join(p.installPath, 'skills'), 'plugin', p.id.split('@')[0], p.enabled === true)),
  ];
}
