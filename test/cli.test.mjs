import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadState, renderState, run } from '../server/cli.mjs';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));

test('renderState draws layers and parts with their marks, counts, chats and branches', () => {
  const lines = renderState(DEMO, { lang: 'en' }).split('\n');
  const line = (name) => lines.find((l) => l.includes(name));
  assert.match(line('Where people come in'), /^Where people come in {2}\d+\/\d+ done/, 'a layer starts the line at column 0');
  assert.match(line('Storefront'), /^ {2}! Storefront {2}2\/6 done · 2 with you · 1 blocking · 1 chat · \$2\.90$/, 'items with a person mark the part');
  assert.match(line('Orders and cart'), /^ {2}● Orders and cart/, 'a working chat marks the part');
  assert.match(line('Courier app'), /^ {2}○ Courier app/);
  assert.match(line('feat/typo-search'), /^ {4}! feat\/typo-search {2}Rui Costa · 4 commits/, 'a clashing branch hangs under its part');
  assert.ok(!lines.some((l) => l.includes('feat/magic-link')), 'merged branches are left out');
  assert.ok(lines.includes('Not on the map: 1 chat'));
  assert.ok(lines.includes('No architecture map yet · 3 chats'), 'the notes app has no map');
  assert.match(lines[0], /\$12\.00/,'the header carries today’s cost');
  const waiting = lines.slice(lines.findIndex((l) => l === 'Waiting for you'));
  assert.ok(waiting.some((l) => l.includes('Approve the cookie banner text') && l.includes('Storefront')));
  assert.ok(waiting.some((l) => l.includes('Retry failed payments')));
});

test('renderState keeps a project to its own tree and the waiting list of the project', () => {
  const only = renderState(DEMO, { lang: 'en', project: 'NOTES' });
  assert.ok(only.includes('notes-app'));
  assert.ok(!only.includes('acme-shop') && !only.includes('Storefront'));
  const none = renderState(DEMO, { lang: 'en', project: 'zzz' });
  assert.match(none, /No project matches "zzz"/);
  assert.ok(none.includes('acme-shop') && none.includes('notes-app'), 'it names the projects there are');
});

test('renderState speaks Portuguese, shows branches that are growing and handles an empty machine', () => {
  const pt = renderState(DEMO, { lang: 'pt-BR' });
  assert.ok(pt.includes('Esperando você'));
  assert.ok(pt.includes('feat/typo-search'), 'branches that are still growing hang under their part');
  assert.ok(pt.includes('com você'));
  assert.ok(!pt.includes('feat/magic-link'), 'merged branches are left out');
  assert.match(renderState({ ...DEMO, projects: [], waitingCount: 0 }, { lang: 'en' }), /No Claude Code conversations/);
});

test('loadState asks the running server first and reads the history itself when it is not there', async () => {
  const seen = [];
  const fetchFn = async (url) => { seen.push(url); return { ok: true, json: async () => ({ from: 'server' }) }; };
  assert.deepEqual(await loadState({ port: 4001, fetchFn, collectFn: async () => ({ from: 'collect' }) }), { state: { from: 'server' }, source: 'server' });
  assert.deepEqual(seen, ['http://127.0.0.1:4001/api/state']);
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.deepEqual(await loadState({ port: 4001, fetchFn: down, collectFn: async () => ({ from: 'collect' }) }), { state: { from: 'collect' }, source: 'files' });
  const broken = async () => ({ ok: false, json: async () => ({}) });
  assert.equal((await loadState({ port: 4001, fetchFn: broken, collectFn: async () => ({ from: 'collect' }) })).source, 'files');
});

function harness(argv, extra = {}) {
  let out = '';
  const code = run(argv, { err: { write() {} }, out: { write: (s) => { out += s; } }, getState: async () => ({ state: DEMO, source: 'server' }), env: { LANG: 'en_US.UTF-8' }, ...extra });
  return code.then((c) => ({ code: c, out }));
}

test('run prints the tree, or the State with --json, filtered by --project', async () => {
  const plain = await harness([]);
  assert.equal(plain.code, 0);
  assert.ok(plain.out.includes('Storefront') && plain.out.includes('Waiting for you'));
  const json = await harness(['--json', '--project', 'notes']);
  const parsed = JSON.parse(json.out);
  assert.deepEqual(parsed.projects.map((p) => p.name), ['notes-app']);
  assert.equal(parsed.totals.today, DEMO.totals.today);
  const missing = await harness(['--project', 'zzz']);
  assert.equal(missing.code, 1);
  assert.equal((await harness(['--nope'])).code, 2);
  assert.ok((await harness([], { env: { LANG: 'pt_BR.UTF-8' } })).out.includes('Esperando você'));
});

test('--watch redraws on a timer until stopped', async () => {
  const stop = new AbortController();
  let rounds = 0;
  let out = '';
  const code = await run(['--watch'], {
    out: { write: (s) => { out += s; } }, getState: async () => ({ state: DEMO, source: 'server' }), env: {}, signal: stop.signal,
    wait: async (ms) => { assert.equal(ms, 5000); if (++rounds === 2) stop.abort(); },
  });
  assert.equal(code, 0);
  assert.equal(out.split('\x1b[2J').length - 1, 2, 'cleared and redrew twice');
});

test('the real command runs from a shell and answers --help', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../server/cli.mjs', import.meta.url)), '--help'], { encoding: 'utf8' });
  assert.match(out, /--watch/);
  assert.match(out, /--json/);
  assert.match(out, /--project/);
});
