import { fileURLToPath } from 'node:url';
import { NO_FORCE_PUSH, commandOf, isDestructive, isForcePush, snapshot as takeSnapshot } from './safety.mjs';

// The guard of every page chat (pc16): a PreToolUse hook Claude Code runs before its own permission check, in every
// permission mode. The relay (hub.mjs ask()) only sees what auto mode leaves to it; this sees every shell step. It denies
// a force push, and for the Autonomous way snapshots before a destructive step. It never allows anything.
export const GUARD_HOOK = fileURLToPath(new URL('./guard-hook.mjs', import.meta.url));
// Claude Code gives the hook this long (s); the snapshot is given up a while before, so the step is never held past it.
const HOOK_TIMEOUT_S = 60;
const SNAPSHOT_WAIT_MS = 45_000;

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// input: the hook's JSON from Claude Code. → the answer to print, or null to say nothing (the step goes on to the
// permission check as before). A failed or slow snapshot never stops the step.
export async function guardStep(input, { snapshotOn = false, snapshot = takeSnapshot, waitMs = SNAPSHOT_WAIT_MS } = {}) {
  const command = commandOf(String(input?.tool_name ?? ''), input?.tool_input);
  if (isForcePush(command)) return deny(NO_FORCE_PUSH);
  if (snapshotOn && isDestructive(command) && typeof input?.cwd === 'string') {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, waitMs); });
    await Promise.race([Promise.resolve().then(() => snapshot(input.cwd)).catch(() => null), late]);
    clearTimeout(timer);
  }
  return null;
}

// The value of claude's --settings: the hook on the shell steps. Forward slashes: the hook line runs in a shell.
export function guardSettings({ snapshot }) {
  const slash = (p) => p.replace(/\\/g, '/');
  const command = `"${slash(process.execPath)}" "${slash(GUARD_HOOK)}"${snapshot ? ' --snapshot' : ''}`;
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] }] } });
}
