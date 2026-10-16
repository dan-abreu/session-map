// Puts the guard and the book hooks into ~/.claude/settings.json, pointing at this repo, so the policy holds in every
// Claude Code session on this PC until the plugin release carries the same hooks (or34). Run again: nothing changes.
//   node scripts/install-user-hooks.mjs [--remove] [--file <settings.json>]
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT_S = 60;
// Ours are told apart by the script and the --user flag in the command line.
const isOurs = (h) => /server[\\/]chat[\\/](?:guard|book)-hook\.mjs/.test(String(h?.command ?? '')) && /--user\b/.test(String(h.command));
const groupIsOurs = (g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs);

export function wantedHooks(repo = REPO, node = process.execPath) {
  const slash = (p) => p.replace(/\\/g, '/');
  const run = (script, flags) => [{ type: 'command', command: `"${slash(node)}" "${slash(join(repo, 'server', 'chat', script))}" ${flags}`, timeout: TIMEOUT_S }];
  return {
    PreToolUse: { matcher: 'Agent|Task|Skill|Edit|Write|MultiEdit|Workflow|Read', hooks: run('guard-hook.mjs', '--user') },
    Stop: { hooks: run('book-hook.mjs', '--stop --user') },
    SessionStart: { matcher: 'compact', hooks: run('book-hook.mjs', '--compact --user') },
  };
}

// settings (parsed) -> a new object with our hooks in place of any older copy of them; every other key as it was.
export function addHooks(settings, wanted = wantedHooks()) {
  const out = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const [event, group] of Object.entries(wanted)) {
    const list = Array.isArray(out.hooks[event]) ? [...out.hooks[event]] : [];
    const at = list.findIndex((g) => groupIsOurs(g) && g.matcher === group.matcher);
    if (at >= 0) list[at] = group;
    else list.push(group);
    out.hooks[event] = list;
  }
  return out;
}

export function removeHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return settings;
  const out = { ...settings, hooks: {} };
  for (const [event, list] of Object.entries(settings.hooks)) {
    if (!Array.isArray(list)) { out.hooks[event] = list; continue; }
    const kept = list.filter((g) => !groupIsOurs(g));
    if (kept.length) out.hooks[event] = kept;
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

// → true when the file changed. Keeps the file's own indentation; writes a temp file and renames it over.
export function updateFile(file, { remove = false, wanted } = {}) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const settings = text.trim() ? JSON.parse(text) : {};
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  ';
  const next = JSON.stringify(remove ? removeHooks(settings) : addHooks(settings, wanted), null, indent) + (text.endsWith('\n') || !text ? '\n' : '');
  if (next === text) return false;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, file);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--file');
  const file = at > 0 ? resolve(process.argv[at + 1]) : join(homedir(), '.claude', 'settings.json');
  const remove = process.argv.includes('--remove');
  console.log(`${updateFile(file, { remove }) ? (remove ? 'removed from' : 'written to') : 'no change in'} ${file}`);
}
