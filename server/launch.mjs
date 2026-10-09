import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { log } from './log.mjs';

// The Microsoft Store alias lives in WindowsApps, which is not always on the PATH of a server started from a shell.
function hasWtDefault(env = process.env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'));
  return dirs.some((d) => existsSync(join(d, 'wt.exe')));
}

const psQuote = (s) => `'${String(s).replaceAll("'", "''")}'`;
const shQuote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const appleString = (s) => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
// wt.exe reads ";" as "next command" even inside one argument.
const wtArg = (s) => String(s).replaceAll(';', '\\;');

function detach(spawner, cmd, args, cwd) {
  const child = spawner(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
  child.on?.('error', (err) => log('warn', 'launch-failed', { cmd, code: err.code }));
  child.unref?.();
  return { cmd, args };
}

// argv is run as is, never through a shell of ours; values come from the server's own state.
export function newTerminal(cwd, argv, { platform = process.platform, spawner = spawn, hasWt = hasWtDefault } = {}) {
  if (platform === 'win32') {
    if (hasWt()) return detach(spawner, 'wt.exe', ['-d', wtArg(cwd), ...argv.map(wtArg)], cwd);
    return detach(spawner, 'powershell.exe', ['-NoExit', '-Command', `& ${argv.map(psQuote).join(' ')}`], cwd);
  }
  if (platform === 'darwin') {
    const script = `cd ${shQuote(cwd)} && ${argv.map(shQuote).join(' ')}`;
    return detach(spawner, 'osascript', ['-e', `tell application "Terminal" to do script "${appleString(script)}"`], cwd);
  }
  return detach(spawner, 'x-terminal-emulator', ['-e', ...argv], cwd);
}

// Windows: `start` takes a window title first, so "" goes before the URL.
export function openUrl(url, { platform = process.platform, spawner = spawn } = {}) {
  if (platform === 'win32') return detach(spawner, 'cmd.exe', ['/c', 'start', '', url]);
  return detach(spawner, platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
  });
}

export async function processName(pid, { platform = process.platform } = {}) {
  if (platform === 'win32') {
    const out = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    return /^"([^"]*)"/.exec(out?.trim() ?? '')?.[1] ?? '';
  }
  return (await run('ps', ['-p', String(pid), '-o', 'comm=']))?.trim() ?? '';
}

// No /F: a polite stop; Windows may refuse it for some console programs, and then the action reports failure.
export async function killProcess(pid, { platform = process.platform } = {}) {
  if (platform === 'win32') return (await run('taskkill', ['/PID', String(pid)])) !== null;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
