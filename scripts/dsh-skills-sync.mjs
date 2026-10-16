#!/usr/bin/env node
// Keeps ~/.dsh/skills in step with the Claude skills the owner already has, so every engine
// (Claude Code and the DeepSeek Harness) sees the same skills. It runs by itself from a Windows
// scheduled task (scripts/dsh-skills-sync.vbs): nothing to ask, nothing to click.
//
// What it does, idempotently, every run:
//   - one junction in ~/.dsh/skills per skill found in ~/.claude/skills (skipping dot folders),
//     in session-map's repo skills/, or in the installed plugin's cache;
//   - junctions whose target vanished are removed (a skill deleted in Claude disappears here too);
//   - a real folder the owner made in ~/.dsh/skills is never touched, and wins over every source.
// Changes are one line each in ~/.dsh/skills/.sync.log.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const home = homedir();
const claudeSkills = process.env.CLAUDE_SKILLS || join(home, '.claude', 'skills');
const dshSkills = process.env.DSH_SKILLS || join(home, '.dsh', 'skills');
const pluginCache = join(home, '.claude', 'plugins', 'cache', 'session-map', 'session-map');
// The skills the session-map plugin ships (the repo's arsenal folder is MCP-only, never a skill bundle).
const SESSION_MAP_SKILLS = ['architecture', 'board', 'history', 'map'];
const LOG_FILE = join(dshSkills, '.sync.log');
const LOG_MAX = 64 * 1024;

const norm = (p) => String(p).replaceAll('/', '\\').toLowerCase().replace(/\\+$/, '');

const isJunction = (p) => {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
};

const dirsOf = (root) => {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name);
  } catch {
    return [];
  }
};

function logLine(text) {
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${text}\n`);
    if (statSync(LOG_FILE).size > LOG_MAX) {
      writeFileSync(LOG_FILE, readFileSync(LOG_FILE, 'utf8').slice(-LOG_MAX / 2));
    }
  } catch { /* logging is best-effort */ }
}

// The installed plugin's skills folder: the version marked .in_use, else the newest version dir.
function pluginSkillsDir() {
  let versions = [];
  try {
    versions = readdirSync(pluginCache, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+\.\d+\.\d+$/.test(d.name)).map((d) => d.name);
  } catch { return null; }
  if (!versions.length) return null;
  const inUse = versions.find((v) => existsSync(join(pluginCache, v, '.in_use')));
  if (inUse) return join(pluginCache, inUse, 'skills');
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return join(pluginCache, versions[0], 'skills');
}

// The first folder that really holds <name>/SKILL.md. The owner's own skill wins, then the repo
// (the canonical dev copy), then what the installed plugin ships.
function sourceOf(name) {
  for (const root of [claudeSkills, join(repoRoot, 'skills'), pluginSkillsDir()]) {
    if (!root) continue;
    const dir = join(root, name);
    try {
      if (statSync(join(dir, 'SKILL.md')).isFile()) return dir;
    } catch { /* not there */ }
  }
  return null;
}

function syncOnce() {
  mkdirSync(dshSkills, { recursive: true });
  const changes = [];
  const wanted = new Set([...SESSION_MAP_SKILLS]);
  for (const name of dirsOf(claudeSkills)) if (!name.startsWith('.')) wanted.add(name);

  for (const name of wanted) {
    const link = join(dshSkills, name);
    const source = sourceOf(name);
    if (isJunction(link)) {
      let current = null;
      try { current = norm(readlinkSync(link)); } catch { /* broken */ }
      if (!source) {
        try { rmdirSync(link); changes.push(`removed ${name} (its source is gone)`); } catch { /* gone already */ }
      } else if (current !== norm(source)) {
        rmdirSync(link);
        symlinkSync(source, link, 'junction');
        changes.push(`retargeted ${name} -> ${source}`);
      }
    } else if (existsSync(link)) {
      // A real folder the owner made here: theirs wins, never touched.
    } else if (source) {
      symlinkSync(source, link, 'junction');
      changes.push(`linked ${name} -> ${source}`);
    }
  }
  // Self-healing: any junction left pointing at nothing goes away.
  for (const name of dirsOf(dshSkills)) {
    const link = join(dshSkills, name);
    if (!isJunction(link)) continue;
    let target = null;
    try { target = readlinkSync(link); } catch { /* broken link */ }
    if (!target || !existsSync(target)) {
      try { rmdirSync(link); changes.push(`removed ${name} (broken junction)`); } catch { /* gone already */ }
    }
  }
  return changes;
}

if (process.argv[1] && fileURLToPath(import.meta.url).replaceAll('\\', '/') === String(process.argv[1]).replaceAll('\\', '/')) {
  try {
    const changes = syncOnce();
    if (changes.length) logLine(`sync: ${changes.join('; ')}`);
  } catch (err) {
    logLine(`failed: ${err.message}`);
    process.exitCode = 1;
  }
}

export { syncOnce, SESSION_MAP_SKILLS };
