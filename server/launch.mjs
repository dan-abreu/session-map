import { execFile, spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { log } from './log.mjs';

// The Microsoft Store alias lives in WindowsApps, which is not always on the PATH of a server started from a shell.
// It is a reparse point that stat (and so existsSync) refuses with EACCES; lstat reads it.
export function hasWt(env = process.env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'));
  return dirs.some((d) => {
    try { return lstatSync(join(d, 'wt.exe'), { throwIfNoEntry: false }) !== undefined; } catch { return false; }
  });
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

// argv is run as is, never through a shell of ours; values come from the server's own state. An empty argv is a plain shell.
export function newTerminal(cwd, argv, { platform = process.platform, spawner = spawn, hasWt: hasWtFn = hasWt } = {}) {
  if (platform === 'win32') {
    if (hasWtFn()) return detach(spawner, 'wt.exe', ['-d', wtArg(cwd), ...argv.map(wtArg)], cwd);
    return detach(spawner, 'powershell.exe', argv.length ? ['-NoExit', '-Command', `& ${argv.map(psQuote).join(' ')}`] : ['-NoExit'], cwd);
  }
  if (platform === 'darwin') {
    const script = [`cd ${shQuote(cwd)}`, ...(argv.length ? [argv.map(shQuote).join(' ')] : [])].join(' && ');
    return detach(spawner, 'osascript', ['-e', `tell application "Terminal" to do script "${appleString(script)}"`], cwd);
  }
  return detach(spawner, 'x-terminal-emulator', argv.length ? ['-e', ...argv] : [], cwd);
}

// Windows: the protocol handler gets the URL as is. `cmd /c start` would expand %NAME% inside it (%CD% is always set),
// and percent-encoding is made of %. The URL must hold no space or quote: rundll32 reads its raw command line.
export function openUrl(url, { platform = process.platform, spawner = spawn } = {}) {
  if (platform === 'win32') return detach(spawner, 'rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  return detach(spawner, platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

function run(cmd, args, env = process.env) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true, env }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// Epoch ms, or null when the process is gone or the time cannot be read. Used to spot a reused pid.
export async function processStart(pid, { platform = process.platform } = {}) {
  const out = platform === 'win32'
    ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${Number(pid)}).StartTime.ToUniversalTime().ToString('o')`])
    : await run('ps', ['-p', String(pid), '-o', 'lstart='], { ...process.env, LC_ALL: 'C' });
  const ms = Date.parse(out?.trim() ?? '');
  return Number.isFinite(ms) ? ms : null;
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
