import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery, ntfyRequest, toastCommand } from '../server/alerts/deliver.mjs';

const words = { title: 'Terminou · shop & <co>', body: 'Fix "it" — done\'s', action: 'Abrir conversa', url: 'http://127.0.0.1:4001/?project=shop-1&conv=a' };

test('Windows: PowerShell shows a toast whose text and link travel by environment, never inside the script', () => {
  const cmd = toastCommand('win32', words);
  assert.equal(cmd.file, 'powershell.exe');
  const script = cmd.args.at(-1);
  assert.match(script, /Windows\.UI\.Notifications/);
  assert.ok(!script.includes('shop') && !script.includes('127.0.0.1'), 'nothing of the alert is in the command line');
  const xml = cmd.env.SM_TOAST_XML;
  assert.match(xml, /activationType="protocol" launch="http:\/\/127\.0\.0\.1:4001\/\?project=shop-1&amp;conv=a"/);
  assert.match(xml, /<text>Terminou · shop &amp; &lt;co&gt;<\/text>/);
  assert.match(xml, /Fix &quot;it&quot; — done&apos;s/);
  assert.match(xml, /<action content="Abrir conversa" activationType="protocol"/);
});

test('macOS and Linux: osascript reads the text from the environment, notify-send gets plain arguments; others have none', () => {
  const mac = toastCommand('darwin', words);
  assert.equal(mac.file, 'osascript');
  assert.ok(!mac.args.join(' ').includes('shop'));
  assert.equal(mac.env.SM_TITLE, words.title);
  const linux = toastCommand('linux', words);
  assert.deepEqual([linux.file, linux.args.slice(-2)], ['notify-send', [words.title, words.body]]);
  assert.equal(toastCommand('aix', words), null);
});

test('ntfy: one JSON post to ntfy.sh on the person\'s topic, with what it was given and nothing else', () => {
  const req = ntfyRequest('sm-0123456789abcdef01234567', { title: 'session-map · shop', body: 'Terminou' });
  assert.equal(req.url, 'https://ntfy.sh/');
  assert.equal(req.init.method, 'POST');
  assert.deepEqual(JSON.parse(req.init.body), { topic: 'sm-0123456789abcdef01234567', title: 'session-map · shop', message: 'Terminou' });
});

const finished = (sessionId, extra = {}) => ({ id: 1, kind: 'finished', reason: 'answer', projectId: 'shop-1', projectName: 'shop', sessionId, title: `Secret ${sessionId}`, summary: 'private words', origin: 'terminal', ...extra });

test('delivery: grouped toasts on the PC, the phone without content, and only what the project wants', async () => {
  const calls = [];
  const posts = [];
  const deliver = createDelivery({
    platform: 'win32', baseUrl: 'http://127.0.0.1:4001',
    exec: (file, args, opts, cb) => { calls.push(opts.env.SM_TOAST_XML); cb(null); },
    fetchFn: async (url, init) => { posts.push(JSON.parse(init.body)); return { ok: true }; },
  });
  const prefs = { desktop: true, ntfy: { enabled: true, topic: 'sm-0123456789abcdef01234567' }, perProject: { 'blog-2': { finished: false } }, lang: 'en' };
  await deliver([finished('a'), finished('b'), finished('c', { projectId: 'blog-2', projectName: 'blog' })], prefs);
  assert.equal(calls.length, 1, 'two alerts of one project make one toast; the muted project none');
  assert.match(calls[0], /2 jobs finished · shop/);
  assert.match(calls[0], /launch="http:\/\/127\.0\.0\.1:4001\/\?project=shop-1"/, 'a group opens the project, a single alert its conversation');
  assert.deepEqual(posts, [{ topic: 'sm-0123456789abcdef01234567', title: 'session-map · shop', message: '2 jobs finished' }]);
  assert.ok(!JSON.stringify(posts).includes('Secret') && !JSON.stringify(posts).includes('private'));
});

test('delivery: switched off means silent, and a failing toast or post never throws', async () => {
  let n = 0;
  const off = createDelivery({ platform: 'win32', baseUrl: 'http://x', exec: () => { n++; }, fetchFn: async () => { n++; } });
  await off([finished('a')], { desktop: false, ntfy: { enabled: false, topic: null }, perProject: {} });
  assert.equal(n, 0);
  const broken = createDelivery({ platform: 'win32', baseUrl: 'http://x', exec: (f, a, o, cb) => cb(new Error('no shell')), fetchFn: async () => { throw new Error('offline'); } });
  await broken([finished('a')], { desktop: true, ntfy: { enabled: true, topic: 'sm-0123456789abcdef01234567' }, perProject: {} });
});
