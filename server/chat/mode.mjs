import { join } from 'node:path';
import { readJsonFile } from '../brain/cells.mjs';

// bypassPermissions is left out on purpose: a page reachable from the phone never runs tools unchecked.
export const CHAT_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'];
const BYPASS = 'bypassPermissions';

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
