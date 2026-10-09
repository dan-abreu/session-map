import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, writeAtomic } from '../store.mjs';

// bypassPermissions is left out on purpose: a page reachable from the phone never runs tools unchecked.
export const CHAT_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'];
const BYPASS = 'bypassPermissions';
// What the page may set for every Claude on this PC (desenho-3 § 3): the everyday modes, never a bypass.
export const USER_MODES = ['default', 'acceptEdits', 'auto'];
const SETTINGS = 'settings.json';
const BACKUP = 'settings.json.session-map-bak';

// permissions.defaultMode as Claude reads it: user, then project, then local, the more specific file winning.
export function settingsMode(root, dir) {
  let found = null;
  for (const file of [join(dir, 'settings.json'), join(root, '.claude', 'settings.json'), join(root, '.claude', 'settings.local.json')]) {
    const mode = readJsonFile(file, null)?.permissions?.defaultMode;
    if (CHAT_MODES.includes(mode) || mode === BYPASS) found = mode;
  }
  if (found === BYPASS) return { mode: 'auto', downgraded: true };
  return { mode: found ?? 'default', downgraded: false };
}

// choice: what the chat header picked, "settings" (or nothing) meaning the same as Claude. null: refuse it.
export function pickMode(choice, fromSettings) {
  if (choice === undefined || choice === 'settings') return fromSettings.mode;
  return CHAT_MODES.includes(choice) ? choice : null;
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// → {text, data}; text is null for a file that does not exist. null: a file we must not rewrite (comments, odd shape).
function readSettings(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { text: null, data: {} };
    throw err;
  }
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isObject(data) || (data.permissions !== undefined && !isObject(data.permissions))) return null;
  return { text, data };
}

// Written the way the person's file was: same indentation, line ends and final newline.
function writeSettings(file, data, like) {
  const indent = /^([ \t]+)"/m.exec(like ?? '')?.[1] ?? 2;
  const eol = like?.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(data, null, indent).replace(/\n/g, eol);
  writeAtomic(file, like !== null && !/\n$/.test(like) ? body : `${body}${eol}`);
}

// The user's own settings.json, read by every Claude on this PC (VS Code and the terminal too).
// The first change keeps a byte copy, so undo can bring back what was there before session-map touched it.
export function setUserMode(dir, mode) {
  if (!USER_MODES.includes(mode)) return { ok: false, error: 'bad-mode' };
  const file = join(dir, SETTINGS);
  const current = readSettings(file);
  if (!current) return { ok: false, error: 'settings-unreadable' };
  const backup = join(dir, BACKUP);
  if (!existsSync(backup)) writeAtomic(backup, current.text ?? '{}\n');
  writeSettings(file, { ...current.data, permissions: { ...current.data.permissions, defaultMode: mode } }, current.text);
  return { ok: true, mode, previous: current.data.permissions?.defaultMode ?? null };
}

// Only defaultMode goes back: whatever else changed in the file since stays.
export function undoUserMode(dir) {
  const backup = join(dir, BACKUP);
  if (!existsSync(backup)) return { ok: false, error: 'nothing-to-undo' };
  const saved = readSettings(backup);
  const file = join(dir, SETTINGS);
  const current = readSettings(file);
  if (!saved || !current) return { ok: false, error: 'settings-unreadable' };
  const previous = saved.data.permissions?.defaultMode;
  const permissions = { ...current.data.permissions };
  if (previous === undefined) delete permissions.defaultMode;
  else permissions.defaultMode = previous;
  const data = { ...current.data, permissions };
  if (!Object.keys(permissions).length && saved.data.permissions === undefined) delete data.permissions;
  writeSettings(file, data, current.text);
  rmSync(backup, { force: true });
  return { ok: true, mode: previous ?? null };
}

// mode: the user-wide value now (null when unset or unreadable); previous: what undo would bring back.
export function userModeState(dir) {
  const current = readSettings(join(dir, SETTINGS));
  const undo = existsSync(join(dir, BACKUP));
  const saved = undo ? readSettings(join(dir, BACKUP)) : null;
  return { mode: current?.data.permissions?.defaultMode ?? null, previous: saved?.data.permissions?.defaultMode ?? null, undo };
}
