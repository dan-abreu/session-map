import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';
import { buildFlowModel, modelCachePath, readModelCache } from '../server/arch/flowmodel.mjs';
import { brainDir } from '../server/store.mjs';

const DIR = 'docs/architecture';
const README = '# P\n\n```mermaid\nflowchart LR\n  subgraph core["Core"]\n    A[Alpha]\n    B[Beta]\n  end\n  A --> B\n```\n';
const part = (name, path) => `# ${name}\n\nThe ${name}.\n\n## Where in the code\n\n- \`${path}\`\n`;
const FILES = {
  [`${DIR}/README.md`]: README,
  [`${DIR}/alpha.md`]: part('Alpha', 'src/a/'),
  [`${DIR}/beta.md`]: part('Beta', 'src/b/'),
  'src/a/one.mjs': "import { execFile } from 'node:child_process';\nexecFile('git', ['status'], () => {});\n",
  'src/a/two.mjs': 'export const x = 1;\n',
  'src/b/use.mjs': "import { x } from '../a/two.mjs';\nexport const go = () => fetch('https://api.github.com/x', { x });\n",
  'test/a.test.mjs': "import Stripe from 'stripe';\nnew Stripe('k');\n",
  '.env': 'API=https://secret.example.com\n',
};

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sm-flowmodel-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-flowmodel-sm-'));
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const reads = [];
  const readFile = (abs, ...rest) => {
    reads.push(abs.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').length + 1));
    return readFileSync(abs, ...rest);
  };
  return { root, smDir, reads, readFile, done: () => { rmSync(root, { recursive: true, force: true }); rmSync(smDir, { recursive: true, force: true }); } };
}

const archOf = (root) => ({ ...parseArch(DIR, Object.fromEntries(readdirSync(join(root, DIR)).map((f) => [f, readFileSync(join(root, DIR, f), 'utf8')]))), links: [] });
const snapshot = (root) => {
  const out = {};
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path);
      else out[path] = [readFileSync(join(root, path), 'utf8'), statSync(join(root, path)).mtimeMs];
    }
  };
  walk('');
  return out;
};
const node = (m, id) => m.nodes.find((n) => n.id === id);
const build = (ctx, over = {}) => buildFlowModel({ root: ctx.root, arch: archOf(ctx.root), smDir: ctx.smDir, projectId: 'p-1', source: 'worktree', readFile: ctx.readFile, ...over });

test('the first build reads the code, keeps the model in session-map storage and never touches the project', async () => {
  const ctx = setup();
  try {
    const before = snapshot(ctx.root);
    const m = await build(ctx);
    assert.deepEqual(snapshot(ctx.root), before);
    assert.ok(existsSync(join(brainDir(ctx.smDir, 'p-1'), 'flow-model.json')));
    assert.equal(modelCachePath(ctx.smDir, 'p-1'), join(brainDir(ctx.smDir, 'p-1'), 'flow-model.json'));
    assert.deepEqual(m.stats.recomputed, m.nodes.map((n) => n.id).sort());
    assert.ok(node(m, 'svc:git'));
    assert.ok(node(m, 'svc:github'));
    assert.equal(m.edges.find((e) => e.id === 'part:alpha>part:beta#flow').detected[0].file, 'src/b/use.mjs');
    assert.equal(node(m, 'svc:stripe'), undefined, 'a test file is never read for the flow');
    assert.equal(m.nodes.some((n) => n.id.includes('secret')), false);
    assert.equal(ctx.reads.includes('.env'), false, 'a secrets file is never opened');
    assert.equal(ctx.reads.includes('test/a.test.mjs'), false);
    assert.match(node(m, 'part:alpha').filesHash, /^[0-9a-f]{16}$/);
    assert.equal(node(m, 'part:alpha').files, 2);
  } finally { ctx.done(); }
});

test('a second build with nothing changed reads no code file again and writes nothing', async () => {
  const ctx = setup();
  try {
    await build(ctx);
    const cache = modelCachePath(ctx.smDir, 'p-1');
    const written = statSync(cache).mtimeMs;
    ctx.reads.length = 0;
    const m = await build(ctx);
    assert.equal(m.stats.scanned, 0);
    assert.deepEqual(m.stats.recomputed, []);
    assert.deepEqual(ctx.reads.filter((p) => p.startsWith('src/')), []);
    assert.equal(m.stats.wrote, false);
    assert.equal(statSync(cache).mtimeMs, written);
  } finally { ctx.done(); }
});

test('changing one file of a part recomputes that part only', async () => {
  const ctx = setup();
  try {
    const first = await build(ctx);
    writeFileSync(join(ctx.root, 'src/a/two.mjs'), 'export const x = 2;\nexport const y = 3;\n');
    const later = new Date(Date.now() + 5000);
    utimesSync(join(ctx.root, 'src/a/two.mjs'), later, later);
    const m = await build(ctx);
    assert.equal(m.stats.scanned, 1);
    assert.deepEqual(m.stats.recomputed, ['part:alpha']);
    assert.equal(node(m, 'part:beta').filesHash, node(first, 'part:beta').filesHash);
    assert.notEqual(node(m, 'part:alpha').filesHash, node(first, 'part:alpha').filesHash);
  } finally { ctx.done(); }
});

test('a deleted file takes its arrows and its cached scan with it', async () => {
  const ctx = setup();
  try {
    await build(ctx);
    rmSync(join(ctx.root, 'src/b/use.mjs'));
    const m = await build(ctx);
    assert.equal(node(m, 'svc:github'), undefined);
    assert.equal(m.edges.find((e) => e.id === 'part:alpha>part:beta#flow').detectedCount, 0);
    assert.equal('src/b/use.mjs' in readModelCache(ctx.smDir, 'p-1').scans, false);
  } finally { ctx.done(); }
});

test('a cache made by another catalog, scanner or version is read again from zero', async () => {
  for (const field of ['catalog', 'scanner', 'version']) {
    const ctx = setup();
    try {
      await build(ctx);
      const path = modelCachePath(ctx.smDir, 'p-1');
      const cache = JSON.parse(readFileSync(path, 'utf8'));
      cache[field] = field === 'version' ? 0 : 'old@0';
      writeFileSync(path, JSON.stringify(cache));
      const m = await build(ctx);
      assert.equal(m.stats.scanned, 3, field);
      assert.deepEqual(m.stats.recomputed, m.nodes.map((n) => n.id).sort(), field);
    } finally { ctx.done(); }
  }
});

test('a broken cache file is read again from zero', async () => {
  const ctx = setup();
  try {
    await build(ctx);
    writeFileSync(modelCachePath(ctx.smDir, 'p-1'), '{ broken');
    const m = await build(ctx);
    assert.equal(m.stats.scanned, 3);
  } finally { ctx.done(); }
});

test('no folder: only what the README declares, and nothing is written', async () => {
  const ctx = setup();
  try {
    const m = await build(ctx, { root: null, source: 'demo' });
    assert.deepEqual(m.nodes.map((n) => n.kind), ['part', 'part']);
    assert.equal(existsSync(join(ctx.smDir, 'brain')), false);
    await build(ctx);
    const kept = readFileSync(modelCachePath(ctx.smDir, 'p-1'), 'utf8');
    const gone = await build(ctx, { root: join(ctx.root, 'missing') });
    assert.deepEqual(gone.notes, ['no-folder']);
    assert.equal(gone.nodes.every((n) => n.kind === 'part'), true);
    assert.equal(readFileSync(modelCachePath(ctx.smDir, 'p-1'), 'utf8'), kept, 'a missing folder never wipes the cache');
  } finally { ctx.done(); }
});

test('a map from the main branch says its code was read from the folder as it is now', async () => {
  const ctx = setup();
  try {
    const m = await build(ctx, { source: 'main-branch' });
    assert.equal(m.source, 'main-branch');
    assert.deepEqual(m.notes, ['code-from-folder']);
    assert.equal(m.edges.find((e) => e.id === 'part:alpha>part:beta#flow').declared[0].line, null);
  } finally { ctx.done(); }
});

test('the model carries a stamp that changes only when the model does, so a page knows when to draw again', async () => {
  const ctx = setup();
  try {
    const a = await build(ctx);
    const b = await build(ctx);
    assert.match(a.stamp, /^[0-9a-f]{16}$/);
    assert.equal(b.stamp, a.stamp);
    writeFileSync(join(ctx.root, 'src/a/one.mjs'), "import { execFile } from 'node:child_process';\nexecFile('git', ['log'], () => {});\nexecFile('gh', ['auth'], () => {});\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(join(ctx.root, 'src/a/one.mjs'), later, later);
    assert.notEqual((await build(ctx)).stamp, a.stamp);
  } finally { ctx.done(); }
});

test('an import through a tsconfig alias (@/…) still joins the two parts', async () => {
  const ctx = setup();
  try {
    writeFileSync(join(ctx.root, 'tsconfig.json'), '{\n  // paths for the app\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } },\n}\n');
    writeFileSync(join(ctx.root, 'src/b/use.mjs'), "import { x } from '@/a/two.mjs';\nexport const y = x;\n");
    const m = await build(ctx);
    assert.equal(m.edges.find((e) => e.id === 'part:alpha>part:beta#flow').detected[0].file, 'src/b/use.mjs');
  } finally { ctx.done(); }
});
