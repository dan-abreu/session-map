import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../server/collect.mjs';
import { changeDetailOf, changesOf } from '../server/changes-state.mjs';
import { projectIdOf } from '../server/paths.mjs';
import { keepSnapshots, readSnapshot } from '../server/snapshots.mjs';

const NOW = new Date('2026-10-09T12:00:00Z');
const A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MIN = 60_000;
const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T00:00:00Z' } });

const ARCH = {
  'docs/architecture/README.md': '# Parts\n\n## Front\n\n- [Shop](shop.md)\n\n## Back office\n\n- [Billing](billing.md)\n',
  'docs/architecture/shop.md': '# Shop\n\nThe cart.\n\n## Where in the code\n\n- `src/shop/`\n',
  'docs/architecture/billing.md': '# Billing\n\nInvoices.\n\n## Where in the code\n\n- `src/billing/`\n',
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

let n = 0;
function pair(cwd, ago, name, input, result, model = 'claude-opus-4') {
  const id = `tu${++n}`;
  return [
    { sessionId: A, cwd, timestamp: iso(ago), type: 'assistant', message: { id: `m${n}`, model, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } },
    { sessionId: A, cwd, timestamp: iso(ago), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, ...(result ? { toolUseResult: result } : {}) },
  ];
}

test('collect turns every step that touched a file into a change of the right project and part, with who did it', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-chg-')));
  const dir = join(base, 'claude');
  const smDir = join(base, 'sm');
  mkdirSync(dir);
  mkdirSync(smDir);
  try {
    const shop = repo(join(base, 'shop'), { ...ARCH, 'src/shop/cart.js': 'a\nb\nc\n', 'src/billing/old.js': 'gone\nsoon\n' });
    // The conversation edits the cart and removes an old file; its helper writes a new invoice file.
    writeFileSync(join(shop, 'src', 'shop', 'cart.js'), 'a\nB\nc\nd\n');
    unlinkSync(join(shop, 'src', 'billing', 'old.js'));
    writeFileSync(join(shop, 'src', 'billing', 'invoice.js'), 'one\ntwo\n');
    writeFileSync(join(shop, 'notes.txt'), 'by hand\n');
    const cart = join(shop, 'src', 'shop', 'cart.js');
    const lines = [
      { type: 'ai-title', aiTitle: 'Cart and invoices', sessionId: A },
      { sessionId: A, cwd: shop, timestamp: iso(30 * MIN), type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'fix the cart' }] } },
      ...pair(shop, 5 * MIN, 'Edit', { file_path: cart, old_string: 'b', new_string: 'B' }, { filePath: cart, structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+B', ' c', '+d'] }] }),
      ...pair(shop, 4 * MIN, 'Bash', { command: 'git rm -q src/billing/old.js' }, { stdout: '' }),
      { sessionId: A, cwd: shop, timestamp: iso(MIN), type: 'assistant', message: { id: 'last', model: 'claude-opus-4', role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 10, output_tokens: 10 } } },
    ];
    const projDir = join(dir, 'projects', 'shop');
    mkdirSync(join(projDir, A, 'subagents'), { recursive: true });
    const file = join(projDir, `${A}.jsonl`);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const invoice = join(shop, 'src', 'billing', 'invoice.js');
    const helper = pair(shop, 2 * MIN, 'Write', { file_path: invoice, content: 'one\ntwo\n' }, { type: 'create', filePath: invoice, content: 'one\ntwo\n', structuredPatch: [] }, 'claude-haiku-4');
    writeFileSync(join(projDir, A, 'subagents', 'agent-h1.jsonl'), helper.map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(join(projDir, A, 'subagents', 'agent-h1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Write the invoice', model: 'haiku' }));
    const t = (NOW.getTime() - MIN) / 1000;
    utimesSync(file, t, t);

    const state = await collect({ dir, smDir, now: NOW, isAlive: () => true, ai: { bin: null } });
    const project = state.projects.find((p) => p.id === projectIdOf(shop));
    assert.ok(project);
    const rows = changesOf(state, project.id);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));

    assert.deepEqual(Object.keys(byPath).sort(), ['notes.txt', 'src/billing/invoice.js', 'src/billing/old.js', 'src/shop/cart.js']);
    const edit = byPath['src/shop/cart.js'];
    assert.deepEqual([edit.kind, edit.added, edit.removed, edit.partId, edit.sessionId, edit.title, edit.model, edit.agent, edit.state, edit.inFolder],
      ['edit', 2, 1, 'shop', A, 'Cart and invoices', 'claude-opus-4', null, 'pending', true]);
    const made = byPath['src/billing/invoice.js'];
    assert.deepEqual([made.kind, made.added, made.partId, made.agent], ['create', 2, 'billing', { label: 'Write the invoice', model: 'claude-haiku-4' }]);
    assert.deepEqual([byPath['src/billing/old.js'].kind, byPath['src/billing/old.js'].partId], ['delete', 'billing']);
    assert.deepEqual([byPath['notes.txt'].sessionId, byPath['notes.txt'].kind], [null, 'create'], 'a file made by hand shows with nobody from the conversations');

    assert.deepEqual(project.fresh.parts.shop, { files: 1, lines: 3 }, 'the box of the cart lights: one file, three lines in the last minutes');
    assert.equal(project.fresh.parts.billing.files, 2);
    assert.ok(!JSON.stringify(state.projects).includes('"useAt"'), 'where a step sits in its transcript stays on the server');

    const detail = await changeDetailOf(state, project.id, edit.id);
    assert.deepEqual(detail.hunks[0].lines, [' a', '-b', '+B', ' c', '+d']);
    const gone = await changeDetailOf(state, project.id, byPath['src/billing/old.js'].id);
    assert.deepEqual(gone.before, 'gone\nsoon\n', 'a removed file keeps its previous content');
    const hand = await changeDetailOf(state, project.id, byPath['notes.txt'].id);
    assert.deepEqual(hand.hunks[0].lines, ['+by hand']);
    assert.equal(await changeDetailOf(state, project.id, 'nope'), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// A token shaped like a real key, built in pieces so no scanner mistakes the test for a leak.
const TOKEN = ['sk', 'ant', 'api03', 'Zq8Xw2Lm4Np6Rt0Yv'].join('-');

async function shopWith(files) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-kept-')));
  const dir = join(base, 'claude');
  const smDir = join(base, 'sm');
  mkdirSync(smDir);
  const shop = repo(join(base, 'shop'), { ...ARCH, ...files });
  const projDir = join(dir, 'projects', 'shop');
  mkdirSync(join(projDir, A), { recursive: true });
  const file = join(projDir, `${A}.jsonl`);
  const lines = [
    { type: 'ai-title', aiTitle: 'Kept content', sessionId: A },
    { sessionId: A, cwd: shop, timestamp: iso(30 * MIN), type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'tidy up' }] } },
  ];
  const t = (NOW.getTime() - MIN) / 1000;
  const write = (more = []) => {
    lines.push(...more);
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    utimesSync(file, t, t);
  };
  write();
  const pass = async () => {
    const state = await collect({ dir, smDir, now: NOW, isAlive: () => true, ai: { bin: null } });
    const project = state.projects.find((p) => p.id === projectIdOf(shop));
    const rows = changesOf(state, project.id);
    return { state, project, byPath: (path) => rows.find((r) => r.path === path) };
  };
  // Files written now get a time a few minutes before NOW, as they would have been written before the pass.
  const put = (rel, text) => {
    mkdirSync(join(shop, rel, '..'), { recursive: true });
    writeFileSync(join(shop, rel), text);
    const at = (NOW.getTime() - 3 * MIN) / 1000;
    utimesSync(join(shop, rel), at, at);
  };
  const filesUnder = (root) => readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'));
  return { base, smDir, shop, write, pass, put, filesUnder, done: () => rmSync(base, { recursive: true, force: true }) };
}

test('the before and after never shows a key: not in a file not saved yet, not in a removed saved file', async () => {
  const s = await shopWith({ 'src/shop/cfg.js': 'const a = 1;\n', 'src/billing/old.js': `const key = "${TOKEN}";\n` });
  try {
    s.put('src/shop/cfg.js', `const a = 1;\nconst key = "${TOKEN}";\n`);
    unlinkSync(join(s.shop, 'src', 'billing', 'old.js'));
    s.write(pair(s.shop, 2 * MIN, 'Bash', { command: 'git rm -q src/billing/old.js' }, { stdout: '' }));
    const { state, project, byPath } = await s.pass();
    const edited = await changeDetailOf(state, project.id, byPath('src/shop/cfg.js').id);
    assert.deepEqual(edited.hunks[0].lines.filter((l) => l.startsWith('+')), ['+const key = "…";']);
    const gone = await changeDetailOf(state, project.id, byPath('src/billing/old.js').id);
    assert.equal(gone.before, 'const key = "…";\n');
  } finally {
    s.done();
  }
});

test('a file written, edited and removed keeps the content it had last, not the one it was written with', async () => {
  const s = await shopWith({});
  try {
    const abs = join(s.shop, 'src', 'shop', 'new.js');
    s.write(pair(s.shop, 10 * MIN, 'Write', { file_path: abs, content: 'v1\n' }, { type: 'create', filePath: abs, content: 'v1\n', structuredPatch: [] }));
    s.write(pair(s.shop, 8 * MIN, 'Edit', { file_path: abs, old_string: 'v1', new_string: 'v2 latest' }, { filePath: abs, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-v1', '+v2 latest'] }] }));
    s.put('src/shop/new.js', 'v2 latest\n');
    await s.pass();
    unlinkSync(abs);
    s.write(pair(s.shop, 2 * MIN, 'Bash', { command: 'rm src/shop/new.js' }, { stdout: '' }));
    const { state, project, byPath } = await s.pass();
    const gone = await changeDetailOf(state, project.id, byPath('src/shop/new.js').id);
    assert.equal(gone.before, 'v2 latest\n');
    assert.ok(!existsSync(join(s.shop, '.session-map')) && s.filesUnder(s.smDir).some((t) => t === 'v2 latest\n'), 'the copy lives in the session-map folder, never in the project');
  } finally {
    s.done();
  }
});

test('a file written then edited and removed before any pass saw it says its content was not kept, never the first version', async () => {
  const s = await shopWith({});
  try {
    const abs = join(s.shop, 'src', 'shop', 'new.js');
    s.write([
      ...pair(s.shop, 10 * MIN, 'Write', { file_path: abs, content: 'v1\n' }, { type: 'create', filePath: abs, content: 'v1\n', structuredPatch: [] }),
      ...pair(s.shop, 8 * MIN, 'Edit', { file_path: abs, old_string: 'v1', new_string: 'v2 latest' }, { filePath: abs, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-v1', '+v2 latest'] }] }),
      ...pair(s.shop, 2 * MIN, 'Bash', { command: 'rm src/shop/new.js' }, { stdout: '' }),
    ]);
    const { state, project, byPath } = await s.pass();
    const gone = await changeDetailOf(state, project.id, byPath('src/shop/new.js').id);
    assert.deepEqual(gone, { hunks: [], error: 'not-kept' });
  } finally {
    s.done();
  }
});

test('a file made and removed by hand, never saved, shows as removed with what it had; a secrets file is never copied', async () => {
  const s = await shopWith({});
  try {
    s.put('notes.txt', `by hand\nkey ${TOKEN}\n`);
    s.put('.env', `API_KEY=${TOKEN}\n`);
    await s.pass();
    assert.ok(s.filesUnder(s.smDir).every((t) => !t.includes(TOKEN)), 'nothing kept in the session-map folder holds the key');
    unlinkSync(join(s.shop, 'notes.txt'));
    const { state, project, byPath } = await s.pass();
    const gone = byPath('notes.txt');
    assert.deepEqual([gone.kind, gone.sessionId, gone.removed, gone.state], ['delete', null, 2, 'pending']);
    assert.equal((await changeDetailOf(state, project.id, gone.id)).before, 'by hand\nkey …\n');
  } finally {
    s.done();
  }
});

test('a changed file that is saved again drops its copy: the version history holds it', async () => {
  const s = await shopWith({ 'src/shop/cart.js': 'a\n' });
  try {
    s.put('src/shop/cart.js', 'a\nb\n');
    await s.pass();
    assert.ok(s.filesUnder(s.smDir).includes('a\nb\n'));
    git(s.shop, 'commit', '-q', '-am', 'save');
    await s.pass();
    assert.ok(!s.filesUnder(s.smDir).includes('a\nb\n'));
  } finally {
    s.done();
  }
});

test('a copy of a removed file goes a month after the file was last seen', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-keep-')));
  try {
    const root = join(base, 'p');
    const dir = join(base, 'kept');
    mkdirSync(root);
    writeFileSync(join(root, 'a.txt'), 'one\n');
    const day = 24 * 60 * MIN;
    const t0 = NOW.getTime();
    keepSnapshots(dir, root, [{ path: 'a.txt', kind: 'create' }], t0, 30 * day);
    unlinkSync(join(root, 'a.txt'));
    assert.deepEqual(keepSnapshots(dir, root, [], t0 + day, 30 * day).map((g) => [g.path, g.removed]), [['a.txt', 1]]);
    assert.equal(readSnapshot(dir, 'a.txt', t0 + day), 'one\n');
    assert.deepEqual(keepSnapshots(dir, root, [], t0 + 32 * day, 30 * day), []);
    assert.equal(readSnapshot(dir, 'a.txt', t0 + 32 * day), null);
    assert.deepEqual(readdirSync(dir), ['index.json']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
