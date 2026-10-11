import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { startDriver } from '../server/chat/driver.mjs';

// Ending a chat by force (hub.close at a restart's deadline) must end what its claude started too: on Windows a kill
// reaches only claude itself, and a long Bash or test run would go on changing files while the chat is resumed.

function fakeChild() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 4321, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: 0 });
  child.kill = () => { child.killed += 1; };
  return child;
}

const driverOn = (platform, run) => {
  const child = fakeChild();
  const driver = startDriver({ bin: 'claude', args: [], cwd: '.', env: {}, onEvent: () => {}, spawner: () => child, platform, run });
  return { child, driver };
};

test('on Windows a kill ends claude\'s whole process tree with taskkill', () => {
  const calls = [];
  const { child, driver } = driverOn('win32', (cmd, args, opts, done) => { calls.push([cmd, args, opts.windowsHide]); done(null); });
  driver.kill();
  assert.deepEqual(calls, [['taskkill', ['/T', '/F', '/PID', '4321'], true]]);
  assert.equal(child.killed, 0);
});

test('when taskkill fails, or off Windows, the process itself is killed', () => {
  const failing = driverOn('win32', (cmd, args, opts, done) => done(new Error('not found')));
  failing.driver.kill();
  assert.equal(failing.child.killed, 1);
  const calls = [];
  const linux = driverOn('linux', (...a) => calls.push(a));
  linux.driver.kill();
  assert.deepEqual([calls.length, linux.child.killed], [0, 1]);
});
