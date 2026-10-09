import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../server/actions.mjs';
import { newTerminal } from '../server/launch.mjs';

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-af-')));
  const root = join(base, 'shop');
  const wt = join(base, 'shop-cart');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(wt, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.js'), 'x');
  writeFileSync(join(root, 'src', 'a&b (1).js'), 'x');
  writeFileSync(join(wt, 'src', 'cart.js'), 'x');
  const state = {
    projects: [{
      id: 'shop-abc123', root,
      workCells: [{ id: 'feature/cart', branch: 'feature/cart', path: wt }, { id: 'origin/fix', branch: 'fix', path: null }],
      chats: [],
    }],
  };
  const spawned = [];
  const deps = {
    state, dir: base, smDir: base, platform: 'win32', hasWt: () => true,
    spawner: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { unref() {}, on() {} }; },
  };
  return { root, wt, deps, spawned, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const urlOf = (spawned) => spawned.at(-1).args.at(-1);
const slash = (p) => p.replaceAll('\\', '/');

test('open-file hands the vscode:// link of a checked file to the system, with the line', async () => {
  const f = fixture();
  try {
    const res = await runAction({ action: 'open-file', projectId: 'shop-abc123', path: 'src/a.js', line: 7 }, f.deps);
    assert.equal(res.status, 200);
    assert.deepEqual([f.spawned.at(-1).cmd, f.spawned.at(-1).args.length, f.spawned.at(-1).args[0]], ['rundll32.exe', 2, 'url.dll,FileProtocolHandler']);
    assert.equal(urlOf(f.spawned), `vscode://file/${slash(join(f.root, 'src', 'a.js')).split('/').map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s))).join('/').replace(/^\//, '')}:7`);
    await runAction({ action: 'open-file', projectId: 'shop-abc123', workCell: 'feature/cart', path: 'src/cart.js' }, f.deps);
    assert.ok(urlOf(f.spawned).endsWith('/shop-cart/src/cart.js:1'), 'a branch with a folder opens inside it; no line means line 1');
  } finally { f.cleanup(); }
});

test('open-file leaves no shell metacharacter in the link', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'open-file', projectId: 'shop-abc123', path: 'src/a&b (1).js' }, f.deps)).status, 200);
    assert.match(urlOf(f.spawned), /^[A-Za-z0-9\-._~%:/]+$/);
    assert.ok(urlOf(f.spawned).includes('a%26b%20%281%29.js'));
  } finally { f.cleanup(); }
});

// U+0340 encodes to %CD%80, and cmd expands %CD% to its own folder: the link must never pass through cmd.
test('open-file on Windows hands the link to the protocol handler, not to cmd', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'src', 'àf.txt'), 'x');
    assert.equal((await runAction({ action: 'open-file', projectId: 'shop-abc123', path: 'src/àf.txt', line: 3 }, f.deps)).status, 200);
    const { cmd, args } = f.spawned.at(-1);
    assert.notEqual(cmd, 'cmd.exe');
    assert.deepEqual([cmd, args[0]], ['rundll32.exe', 'url.dll,FileProtocolHandler']);
    assert.ok(args[1].endsWith('/src/a%CD%80f.txt:3'), args[1]);
  } finally { f.cleanup(); }
});

test('open-file refuses what safeResolve refuses, unknown places and bad lines', async () => {
  const f = fixture();
  try {
    const open = (extra) => runAction({ action: 'open-file', projectId: 'shop-abc123', ...extra }, f.deps);
    assert.equal((await open({ path: '../x' })).status, 400);
    assert.equal((await open({ path: '%2e%2e/x' })).status, 400);
    assert.equal((await open({ path: '.git/config' })).status, 400);
    assert.equal((await open({ path: 'src/missing.js' })).status, 404);
    assert.equal((await open({ path: 'src' })).status, 404);
    assert.equal((await open({ path: 'src/a.js', workCell: 'ghost' })).status, 404);
    assert.equal((await open({ path: 'src/a.js', workCell: 'origin/fix' })).status, 200, 'a branch with no folder falls back to the project folder');
    assert.equal((await open({ path: 'src/a.js', line: '7; calc' })).status, 400);
    assert.equal((await open({ path: 'src/a.js', line: -1 })).status, 400);
    assert.equal((await runAction({ action: 'open-file', projectId: 'ghost', path: 'src/a.js' }, f.deps)).status, 404);
    assert.equal((await runAction({ action: 'open-file', path: 'src/a.js' }, f.deps)).status, 400);
    assert.equal(f.spawned.length, 1);
  } finally { f.cleanup(); }
});

test('a bare terminal opens in the branch folder or the project folder, without running claude', async () => {
  const f = fixture();
  try {
    assert.equal((await runAction({ action: 'new', bare: true, projectId: 'shop-abc123', frontId: 'feature/cart' }, f.deps)).status, 200);
    assert.deepEqual([f.spawned.at(-1).cmd, f.spawned.at(-1).args], ['wt.exe', ['-d', f.wt]]);
    assert.equal((await runAction({ action: 'new', bare: true, projectId: 'shop-abc123' }, f.deps)).status, 200);
    assert.deepEqual(f.spawned.at(-1).args, ['-d', f.root]);
    assert.equal((await runAction({ action: 'new', bare: true, projectId: 'shop-abc123', frontId: 'ghost' }, f.deps)).status, 404);
    assert.equal((await runAction({ action: 'new', bare: true, projectId: 'ghost' }, f.deps)).status, 404);
    assert.equal((await runAction({ action: 'new', bare: true }, f.deps)).status, 400);
    assert.equal(f.spawned.length, 2);
  } finally { f.cleanup(); }
});

test('newTerminal with no command opens a plain shell on every platform', () => {
  const calls = [];
  const spawner = (cmd, args, opts) => { calls.push([cmd, args, opts.cwd]); return { unref() {}, on() {} }; };
  newTerminal('/work/shop', [], { platform: 'win32', hasWt: () => false, spawner });
  newTerminal('/work/shop', [], { platform: 'darwin', spawner });
  newTerminal('/work/shop', [], { platform: 'linux', spawner });
  assert.deepEqual(calls[0], ['powershell.exe', ['-NoExit'], '/work/shop']);
  assert.equal(calls[1][0], 'osascript');
  assert.match(calls[1][1][1], /do script "cd '\/work\/shop'"/);
  assert.deepEqual(calls[2], ['x-terminal-emulator', [], '/work/shop']);
});

test('the actions log keeps the file link out of it', async () => {
  const f = fixture();
  try {
    await runAction({ action: 'open-file', projectId: 'shop-abc123', path: 'src/a.js' }, f.deps);
    const log = readFileSync(join(f.deps.smDir, 'actions.log'), 'utf8');
    assert.match(log, /"action":"open-file"/);
    assert.ok(!log.includes('vscode://'));
  } finally { f.cleanup(); }
});
