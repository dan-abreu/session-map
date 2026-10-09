import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../server/collect.mjs';
import { footprintOf, gitRootOf, touchesOf } from '../server/footprint.mjs';
import { normalizePath, projectIdOf } from '../server/paths.mjs';

const NOW = new Date('2026-09-10T12:00:00Z');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOUR = 3_600_000;
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'sm-foot-')));
const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const ARCH = {
  'README.md': '# Parts\n\n## Front\n\n- [Shop](shop.md)\n\n## Back office\n\n- [Billing](billing.md)\n',
  'shop.md': '# Shop\n\nThe cart.\n\n## Where in the code\n\n- `src/shop/`\n',
  'billing.md': '# Billing\n\nInvoices.\n\n## Where in the code\n\n- `src/billing/`\n',
};

function repo(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

const archFiles = () => Object.fromEntries(Object.entries(ARCH).map(([k, v]) => [`docs/architecture/${k}`, v]));

function toolLine(id, i, name, file) {
  return { sessionId: id, cwd: '', timestamp: iso(HOUR), type: 'assistant', message: { id: `${id}-${i}`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: `${id}-t${i}`, name, input: { file_path: file } }] } };
}

function writeChat(dir, { id, cwd, steps, helperEdits = [] }) {
  const base = { sessionId: id, cwd, gitBranch: 'main', timestamp: iso(HOUR) };
  const lines = [
    { type: 'ai-title', aiTitle: 'Cross work', sessionId: id },
    { ...base, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'fix the invoices' }] } },
    ...steps.map(([name, file], i) => ({ ...toolLine(id, i, name, file), cwd })),
    { ...base, type: 'assistant', message: { id: `${id}-m`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 200_000, output_tokens: 40_000 } } },
  ];
  const projDir = join(dir, 'projects', cwd.replace(/[^a-z0-9]/gi, '-'));
  mkdirSync(join(projDir, id, 'subagents'), { recursive: true });
  const file = join(projDir, `${id}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(projDir, id, 'subagents', 'agent-h.jsonl'), helperEdits.map((f, i) => JSON.stringify({ ...toolLine(`${id}h`, i, 'Edit', f), cwd })).join('\n') + '\n');
  const t = (NOW.getTime() - HOUR) / 1000;
  utimesSync(file, t, t);
}

test('gitRootOf finds the repository a file lives in, the main checkout for a worktree, and nothing outside a repository', () => {
  const base = tmp();
  try {
    const main = repo(join(base, 'shop'), { 'src/a.js': 'a\n' });
    git(main, 'worktree', 'add', '-q', join(base, 'shop-wt'), '-b', 'feature');
    assert.equal(normalizePath(gitRootOf(join(main, 'src', 'a.js'))), normalizePath(main));
    assert.equal(normalizePath(gitRootOf(join(main, 'src', 'not-yet.js'))), normalizePath(main), 'a file still to be written belongs to the repository of its folder');
    assert.equal(normalizePath(gitRootOf(join(base, 'shop-wt', 'src', 'a.js'))), normalizePath(main));
    mkdirSync(join(base, 'loose'));
    assert.equal(gitRootOf(join(base, 'loose', 'x.js')), null);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('touchesOf sorts a conversation\'s files by repository: edits and what it only looked at, never libraries, binaries or the Claude folder', () => {
  const base = tmp();
  try {
    const shop = repo(join(base, 'shop'), { 'src/a.js': 'a\n', 'src/read.js': 'r\n' });
    const bank = repo(join(base, 'bank'), { 'src/b.js': 'b\n', 'src/seen.js': 's\n' });
    const claude = join(base, 'claude-home');
    const touch = touchesOf({
      root: shop, cwd: shop, skip: [claude],
      edited: [join(shop, 'src', 'a.js'), join(bank, 'src', 'b.js'), join(bank, 'node_modules', 'x.js'), join(bank, 'logo.png'), join(claude, 'memory', 'x.md'), 'src/rel.js'],
      seen: [join(shop, 'src', 'read.js'), join(bank, 'src', 'seen.js'), join(bank, 'src', 'b.js'), join(bank, 'src'), join(bank, 'gone.js')],
    });
    assert.deepEqual([...touch.keys()].sort(), [normalizePath(bank), normalizePath(shop)].sort());
    assert.deepEqual(touch.get(normalizePath(shop)).edited.sort(), ['src/a.js', 'src/rel.js']);
    assert.deepEqual(touch.get(normalizePath(shop)).seen, ['src/read.js']);
    assert.deepEqual(touch.get(normalizePath(bank)).edited, ['src/b.js']);
    assert.deepEqual(touch.get(normalizePath(bank)).seen, ['src/seen.js'], 'a folder, a missing file and an edited file are not "only looked at"');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('footprintOf shares the edits among projects and parts; with no edit at all, what it looked at gives the shares', () => {
  const homes = new Map([
    ['k:shop', { projectId: 'shop-1', name: 'shop', ownersOf: (files) => files.map((f) => (f.startsWith('src/cart') ? 'cart' : null)) }],
    ['k:bank', { projectId: 'bank-1', name: 'bank', ownersOf: (files) => files.map((f) => (f.startsWith('src/tax') ? 'tax' : 'pay')) }],
  ]);
  const touch = new Map([
    ['k:shop', { root: 's', edited: ['src/cart/a.js'], seen: ['src/x.js'] }],
    ['k:bank', { root: 'b', edited: ['src/tax/a.js', 'src/tax/b.js', 'src/pay/c.js'], seen: [] }],
    ['k:unknown', { root: 'u', edited: ['x.js'], seen: [] }],
  ]);
  assert.deepEqual(footprintOf(touch, homes), {
    edited: 4,
    places: [
      { projectId: 'bank-1', name: 'bank', edited: 3, seen: 0, share: 0.75, parts: [{ partId: 'tax', edited: 2, seen: 0, share: 0.5 }, { partId: 'pay', edited: 1, seen: 0, share: 0.25 }] },
      { projectId: 'shop-1', name: 'shop', edited: 1, seen: 1, share: 0.25, parts: [{ partId: 'cart', edited: 1, seen: 0, share: 0.25 }] },
    ],
  });
  const looked = footprintOf(new Map([['k:bank', { root: 'b', edited: [], seen: ['src/tax/a.js', 'src/pay/c.js'] }]]), homes);
  assert.deepEqual(looked.places[0].parts.map((p) => [p.partId, p.share]), [['tax', 0.5], ['pay', 0.5]]);
  assert.equal(footprintOf(new Map(), homes), null);
});

test('collect lists a conversation in every project it works in: born in one, working in the other, its parts in proportion', async () => {
  const base = tmp();
  const dir = join(base, 'claude');
  const smDir = join(base, 'sm');
  mkdirSync(dir);
  mkdirSync(smDir);
  try {
    const home = repo(join(base, 'home'), { 'src/main.js': 'm\n' });
    const shop = repo(join(base, 'shop'), { ...archFiles(), 'src/shop/cart.ts': 'a\nb\n', 'src/billing/tax.ts': 't\n', 'src/billing/rate.ts': 'r\n', 'notes/loose.txt': 'x\n' });
    writeChat(dir, {
      id: A, cwd: home,
      steps: [['Edit', join(home, 'src', 'main.js')], ['Edit', join(shop, 'src', 'shop', 'cart.ts')], ['Edit', join(shop, 'src', 'billing', 'tax.ts')], ['Read', join(shop, 'src', 'billing', 'rate.ts')]],
      helperEdits: [join(shop, 'src', 'billing', 'rate.ts')],
    });
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    writeFileSync(join(dir, 'sessions', '7.json'), JSON.stringify({ pid: 7, sessionId: A, cwd: home, status: 'busy', updatedAt: NOW.getTime(), kind: 'interactive', entrypoint: 'cli' }));

    const state = await collect({ dir, smDir, now: NOW, isAlive: () => true, ai: { bin: null } });
    const byId = new Map(state.projects.map((p) => [p.id, p]));
    const h = byId.get(projectIdOf(home));
    const s = byId.get(projectIdOf(shop));
    assert.ok(h && s, 'the project it only edits shows too, though no conversation started there');

    const row = h.conversations.find((r) => r.sessionId === A);
    assert.deepEqual(row.footprint.places.map((p) => [p.projectId, p.edited]), [[s.id, 3], [h.id, 1]]);
    assert.deepEqual(row.footprint.places[0].parts.map((p) => [p.partId, p.edited]), [['billing', 2], ['shop', 1]]);
    assert.deepEqual(h.chats.find((c) => c.sessionId === A).footprint, row.footprint);
    assert.deepEqual(s.conversations, [], 'it is listed once in its own project; elsewhere it is a visitor');

    assert.equal(s.visitors.length, 1);
    const v = s.visitors[0];
    assert.equal(v.sessionId, A);
    assert.deepEqual(v.bornIn, { projectId: h.id, name: 'home' });
    assert.equal(v.partId, 'billing', 'its main part there is where most of its edits went');
    assert.equal(v.stepPartId, 'billing', 'the file of its latest step lights its part');
    assert.equal(v.status, 'busy');
    assert.equal(v.costUSD, null, 'what it cost stays with the project it was born in');
    assert.deepEqual(s.cost, { today: 0, d7: 0, d30: 0 });
    assert.deepEqual(h.visitors, []);

    assert.deepEqual(s.arch.sizes.total, { files: 7, lines: 28 }, 'the three architecture files, three code files and one loose note');
    assert.equal(s.arch.sizes.parts.billing.files, 3, 'its two files and its architecture file');
    assert.deepEqual(s.arch.sizes.unowned, { files: 2, lines: 10, paths: ['docs/architecture/README.md', 'notes/loose.txt'] });
  } finally { rmSync(base, { recursive: true, force: true }); }
});
