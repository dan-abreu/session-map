import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INTERNALS, runAction } from '../server/actions.mjs';
import { hasWt, newTerminal, openUrl, processStart } from '../server/launch.mjs';

const VS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TERM_CLOSED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TERM_LIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TERM_BUSY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UNKNOWN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const STARTED = Date.parse('2026-09-10T10:00:00Z');
const chat = (sessionId, entrypoint, status) => ({ sessionId, entrypoint, status, live: status !== 'closed', archived: false });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sm-act-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-act-sm-'));
  const state = {
    projects: [{
      id: 'shop-abc123', name: 'shop', root: '/work/shop',
      workCells: [{ id: 'feature/cart', branch: 'feature/cart', path: '/work/shop-cart' }, { id: 'origin/fix;rm', branch: 'fix;rm', path: null }],
      chats: [chat(VS, 'claude-vscode', 'idle'), chat(TERM_CLOSED, 'cli', 'closed'), chat(TERM_LIVE, 'cli', 'idle'), chat(TERM_BUSY, 'cli', 'busy')],
    }],
  };
  const info = (pid) => ({ projectId: 'shop-abc123', root: '/work/shop', cwd: '/work/shop/app', pid });
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map([[VS, info(11)], [TERM_CLOSED, info(null)], [TERM_LIVE, info(12)], [TERM_BUSY, info(13)]]) } });
  mkdirSync(join(dir, 'sessions'));
  const session = (pid, sessionId, status) => writeFileSync(join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, status, cwd: '/work/shop/app', startedAt: STARTED }));
  session(12, TERM_LIVE, 'idle');
  session(13, TERM_BUSY, 'busy');
  const spawned = [];
  const killed = [];
  const deps = {
    state, dir, smDir, platform: 'win32', hasWt: () => true,
    spawner: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { unref() {}, on() {} }; },
    processName: async () => 'claude.exe',
    // The process starts a moment before Claude Code writes its session file.
    processStart: async () => STARTED - 700,
    kill: async (pid) => { killed.push(pid); return true; },
  };
  const cleanup = () => { rmSync(dir, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); };
  return { dir, smDir, deps, spawned, killed, session, cleanup };
}

test('open on a VS Code chat hands the vscode:// link to the protocol handler as one argument', async () => {
  const f = fixture();
  try {
    const res = await runAction({ action: 'open', sessionId: VS }, f.deps);
    assert.equal(res.status, 200);
    assert.deepEqual(f.spawned.map((s) => [s.cmd, s.args]), [['rundll32.exe', ['url.dll,FileProtocolHandler', `vscode://anthropic.claude-code/open?session=${VS}`]]]);
  } finally { f.cleanup(); }
});

test('open on a closed terminal chat resumes it in a new Windows Terminal tab in its folder', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'open', sessionId: TERM_CLOSED }, f.deps)).status, 200);
    assert.deepEqual(f.spawned[0].cmd, 'wt.exe');
    assert.deepEqual(f.spawned[0].args, ['-d', '/work/shop/app', 'claude', '--resume', TERM_CLOSED]);
    assert.equal(f.spawned[0].opts.detached, true);
    assert.equal(f.spawned[0].opts.stdio, 'ignore');
    assert.equal(f.spawned[0].opts.shell, undefined);
  } finally { f.cleanup(); }
});

test('open on a live terminal chat is refused: resuming twice mixes the history', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'open', sessionId: TERM_LIVE }, f.deps)).status, 409);
    assert.equal(f.spawned.length, 0);
  } finally { f.cleanup(); }
});

test('new opens claude with remote control in the work cell folder, named after the branch', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'new', frontId: 'feature/cart' }, f.deps)).status, 200);
    assert.deepEqual(f.spawned[0].args, ['-d', '/work/shop-cart', 'claude', '--remote-control', 'feature/cart']);
    // A cell without a worktree opens in the project root; characters a terminal could read as syntax are replaced.
    assert.equal((await runAction({ action: 'new', frontId: 'origin/fix;rm' }, f.deps)).status, 200);
    assert.deepEqual(f.spawned[1].args, ['-d', '/work/shop', 'claude', '--remote-control', 'fix-rm']);
    assert.equal((await runAction({ action: 'new', frontId: 'nope' }, f.deps)).status, 404);
  } finally { f.cleanup(); }
});

test('close kills an idle chat whose pid still belongs to it', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'close', sessionId: TERM_LIVE }, f.deps)).status, 200);
    assert.deepEqual(f.killed, [12]);
  } finally { f.cleanup(); }
});

test('close refuses a busy chat, a reused pid and a process that is not claude', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'close', sessionId: TERM_BUSY }, f.deps)).status, 409);
    f.session(12, UNKNOWN, 'idle');
    assert.equal((await runAction({ action: 'close', sessionId: TERM_LIVE }, f.deps)).status, 409, 'pid now belongs to another session');
    f.session(12, TERM_LIVE, 'idle');
    const other = { ...f.deps, processName: async () => 'notepad.exe' };
    assert.equal((await runAction({ action: 'close', sessionId: TERM_LIVE }, other)).status, 409);
    assert.equal((await runAction({ action: 'close', sessionId: TERM_CLOSED }, f.deps)).status, 409, 'nothing running');
    assert.deepEqual(f.killed, []);
  } finally { f.cleanup(); }
});

test('archive and unarchive keep archived.json; every action is logged', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'archive', sessionId: TERM_CLOSED }, f.deps)).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(join(f.smDir, 'archived.json'), 'utf8')), [TERM_CLOSED]);
    assert.equal((await runAction({ action: 'unarchive', sessionId: TERM_CLOSED }, f.deps)).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(join(f.smDir, 'archived.json'), 'utf8')), []);
    const lines = readFileSync(join(f.smDir, 'actions.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.action, l.status]), [['archive', 200], ['unarchive', 200]]);
  } finally { f.cleanup(); }
});

test('a session outside the state is 404, a non-UUID or unknown action is 400', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'open', sessionId: UNKNOWN }, f.deps)).status, 404);
    assert.equal((await runAction({ action: 'open', sessionId: '../../etc' }, f.deps)).status, 400);
    assert.equal((await runAction({ action: 'rm', sessionId: VS }, f.deps)).status, 400);
    assert.equal((await runAction(null, f.deps)).status, 400);
    assert.equal(f.spawned.length, 0);
  } finally { f.cleanup(); }
});

test('newTerminal falls back to PowerShell without wt, and uses osascript and x-terminal-emulator elsewhere', () => {
  const calls = [];
  const spawner = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {}, on() {} }; };
  newTerminal('C:/work/o\'brien', ['claude', '--resume', 'id'], { platform: 'win32', spawner, hasWt: () => false });
  assert.equal(calls[0].cmd, 'powershell.exe');
  assert.deepEqual(calls[0].args, ['-NoExit', '-Command', "& 'claude' '--resume' 'id'"]);
  assert.equal(calls[0].opts.cwd, 'C:/work/o\'brien');
  newTerminal('/w/o\'b "x"', ['claude'], { platform: 'darwin', spawner });
  assert.equal(calls[1].cmd, 'osascript');
  assert.equal(calls[1].args[1], 'tell application "Terminal" to do script "cd \'/w/o\'\\\\\'\'b \\"x\\"\' && \'claude\'"');
  newTerminal('/w', ['claude'], { platform: 'linux', spawner });
  assert.deepEqual([calls[2].cmd, calls[2].args, calls[2].opts.cwd], ['x-terminal-emulator', ['-e', 'claude'], '/w']);
  openUrl('vscode://x', { platform: 'darwin', spawner });
  openUrl('vscode://x', { platform: 'linux', spawner });
  assert.deepEqual(calls.slice(3).map((c) => [c.cmd, c.args]), [['open', ['vscode://x']], ['xdg-open', ['vscode://x']]]);
});

test('close refuses a pid reused by a newer process with a claude-like name', async () => {
  const f = fixture();
  try {
    const reused = { ...f.deps, processName: async () => 'node.exe', processStart: async () => STARTED + 3_600_000 };
    const res = await runAction({ action: 'close', sessionId: TERM_LIVE }, reused);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'session-changed');
    const unknown = { ...f.deps, processStart: async () => null };
    assert.equal((await runAction({ action: 'close', sessionId: TERM_LIVE }, unknown)).body.error, 'session-changed', 'unknown start time is refused');
    assert.deepEqual(f.killed, []);
  } finally { f.cleanup(); }
});

test('processStart reads the real start time of a running process', async () => {
  const start = await processStart(process.pid);
  const expected = Date.now() - process.uptime() * 1000;
  assert.ok(Number.isFinite(start), 'a number of ms');
  assert.ok(Math.abs(start - expected) < 5000, `${new Date(start).toISOString()} vs ${new Date(expected).toISOString()}`);
  assert.equal(await processStart(2 ** 22 + 12345), null, 'no such process');
});

// On Windows 11 wt.exe is a Store app alias: stat on it fails with EACCES, so existsSync says false. lstat sees it.
test('hasWt finds wt.exe on the PATH or in WindowsApps, and says no when it is in neither', () => {
  const base = mkdtempSync(join(tmpdir(), 'sm-wt-'));
  try {
    const apps = join(base, 'Microsoft', 'WindowsApps');
    mkdirSync(apps, { recursive: true });
    assert.equal(hasWt({ PATH: '', LOCALAPPDATA: base }), false);
    writeFileSync(join(apps, 'wt.exe'), '');
    assert.equal(hasWt({ PATH: '', LOCALAPPDATA: base }), true);
    assert.equal(hasWt({ PATH: apps }), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('open reaches a conversation only the list knows (older than the map): VS Code by its link, a terminal one by --resume', async () => {
  const f = fixture();
  const OLD_TERM = '12121212-1212-4121-8121-121212121212';
  const OLD_VS = '13131313-1313-4131-8131-131313131313';
  try {
    const project = f.deps.state.projects[0];
    project.conversations = [
      { sessionId: OLD_TERM, origin: 'terminal', status: 'closed', live: false, chattable: true, archived: false },
      { sessionId: OLD_VS, origin: 'vscode', status: 'closed', live: false, chattable: true, archived: false },
    ];
    f.deps.state[INTERNALS].chats.set(OLD_TERM, { projectId: 'shop-abc123', root: '/work/shop', cwd: '/work/shop/old', pid: null });
    assert.equal((await runAction({ action: 'open', sessionId: OLD_TERM }, f.deps)).status, 200);
    assert.deepEqual(f.spawned[0].args.slice(-3), ['claude', '--resume', OLD_TERM]);
    assert.equal((await runAction({ action: 'open', sessionId: OLD_VS }, f.deps)).body.opened, 'vscode');
    assert.equal((await runAction({ action: 'open', sessionId: UNKNOWN }, f.deps)).status, 404);
  } finally { f.cleanup(); }
});
