import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { listUndo, undoOp, writeCare } from '../server/foundation/care.mjs';
import { createApp } from '../server/main.mjs';

const FIX = join(import.meta.dirname, 'fixtures', 'arch-pt');
const DIR = 'docs/arquitetura';
const folder = (root) => Object.fromEntries(readdirSync(join(root, DIR)).map((f) => [f, readFileSync(join(root, DIR, f), 'utf8')]));

// slowCollect: the first collect never finishes (a restart rereading every chat), and only the disk copy of the state answers.
async function withServer(fn, { demo = false, slowCollect = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-flowsrv-root-'));
  mkdirSync(join(root, DIR), { recursive: true });
  cpSync(FIX, join(root, DIR), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'sm-flowsrv-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-flowsrv-sm-'));
  const arch = { ...parseArch(DIR, folder(root)), links: [] };
  const state = {
    projects: [
      { id: 'feira-abc123', name: 'feira', root, arch, workCells: [], chats: [] },
      { id: 'far-def456', name: 'far', root, arch: { ...arch, source: 'main-branch' }, workCells: [], chats: [] },
    ],
  };
  const token = demo ? 'f'.repeat(64) : loadToken(smDir);
  if (slowCollect) writeFileSync(join(smDir, 'state-cache.json'), JSON.stringify(state));
  const app = createApp({ dir, smDir, demo, chat: null, token, collectFn: () => (slowCollect ? new Promise(() => {}) : state) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const host = `127.0.0.1:${port}`;
  const read = { cookie: `sm_token=${token}` };
  const write = { origin: `http://${host}`, 'x-session-map': '1', cookie: `sm_token=${token}`, 'content-type': 'application/json' };
  const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text.startsWith('{') ? JSON.parse(text) : text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await fn({ call, read, write, root, smDir, state });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    for (const d of [root, dir, smDir]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const P = '/api/arch/feira-abc123';
const withBox = (text) => text.replace('  subgraph base', '    NF["Notas fiscais"]\n  end\n  subgraph base').replace('    PAG["Pagamentos"]\n  end\n    NF', '    PAG["Pagamentos"]\n    NF');

test('export: the map as mermaid, read on this PC without the key (fl04)', async () => {
  await withServer(async ({ call, read }) => {
    const local = await call('GET', `${P}/mermaid`);
    assert.equal(local.status, 200, 'a read from 127.0.0.1 needs no key');
    assert.match(local.body.text, /^flowchart LR/);
    assert.equal((await call('GET', `${P}/draft`)).status, 200);
    assert.equal((await call('GET', `${P}/mermaid`, { headers: { host: 'evil.example:80' } })).status, 401, 'a foreign Host is not local');
    const res = await call('GET', `${P}/mermaid`, { headers: read });
    assert.equal(res.status, 200);
    assert.match(res.body.text, /^flowchart LR\n {2}subgraph entrada\["Por onde as pessoas entram"\]/);
    assert.equal((await call('GET', '/api/arch/nope/mermaid', { headers: read })).status, 404);
  });
});

test('after a restart the Flow answers from the disk copy of the state while the first collect is still running', { timeout: 10_000 }, async () => {
  await withServer(async ({ call, read, write }) => {
    const res = await call('GET', `${P}/mermaid`, { headers: read });
    assert.equal(res.status, 200);
    assert.match(res.body.text, /^flowchart LR/);
    const { text } = res.body;
    const plan = await call('POST', `${P}/mermaid/preview`, { headers: write, body: { text } });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.unchanged, true);
    assert.equal((await call('GET', `${P}/draft`, { headers: read })).status, 200);
    assert.equal((await call('GET', '/api/arch/nope/mermaid', { headers: read })).status, 404);
  }, { slowCollect: true });
});

test('preview then apply: the README block and the new part file are written, logged in actions.log; the same text again changes nothing', async () => {
  await withServer(async ({ call, read, write, root, smDir }) => {
    writeCare(smDir, 'feira-abc123', 'auto');
    const { text } = (await call('GET', `${P}/mermaid`, { headers: read })).body;
    const drawn = withBox(text);
    assert.ok(drawn.includes('NF["Notas fiscais"]'));
    assert.equal((await call('POST', `${P}/mermaid/preview`, { body: { text: drawn } })).status, 403, 'a write needs the header and the origin');
    const plan = await call('POST', `${P}/mermaid/preview`, { headers: write, body: { text: drawn } });
    assert.equal(plan.status, 200);
    assert.deepEqual(plan.body.partsNew.map((p) => p.file), ['docs/arquitetura/notas-fiscais.md']);
    assert.ok(!existsSync(join(root, DIR, 'notas-fiscais.md')), 'the preview writes nothing');
    const applied = await call('POST', `${P}/mermaid/apply`, { headers: write, body: { text: drawn } });
    assert.match(applied.body.opId, /^op:/);
    assert.deepEqual({ ...applied.body, opId: null }, { ok: true, changed: true, status: 'applied', opId: null, files: ['docs/arquitetura/README.md', 'docs/arquitetura/notas-fiscais.md'] });
    assert.match(readFileSync(join(root, DIR, 'README.md'), 'utf8'), /NF\["Notas fiscais"\]/);
    const again = await call('POST', `${P}/mermaid/apply`, { headers: write, body: { text: drawn } });
    assert.deepEqual(again.body, { ok: true, changed: false, status: 'unchanged', opId: null, files: [] });
    const logged = readFileSync(join(smDir, 'actions.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(logged.map((l) => [l.action, l.projectId, l.count, l.status]), [['flow-apply', 'feira-abc123', 2, 200], ['flow-apply', 'feira-abc123', 0, 200]]);
    assert.doesNotMatch(readFileSync(join(smDir, 'actions.log'), 'utf8'), /Notas fiscais/, 'the drawing itself is not logged');
  });
});

test('apply refuses what is not a flowchart, a map from the main branch, and text that is not text', async () => {
  await withServer(async ({ call, write }) => {
    assert.deepEqual((await call('POST', `${P}/mermaid/apply`, { headers: write, body: { text: 'pie\n "a": 1' } })).body, { ok: false, error: 'not-flowchart' });
    assert.equal((await call('POST', `${P}/mermaid/preview`, { headers: write, body: { text: 42 } })).status, 400);
    const far = await call('POST', '/api/arch/far-def456/mermaid/apply', { headers: write, body: { text: 'flowchart LR\n  a --> b' } });
    assert.deepEqual([far.status, far.body.error], [409, 'arch-not-here']);
  });
});

test('preview and apply refuse a drawing with a ``` line with a 400, writing nothing', async () => {
  await withServer(async ({ call, read, write, root }) => {
    const readme = readFileSync(join(root, DIR, 'README.md'), 'utf8');
    const { text } = (await call('GET', `${P}/mermaid`, { headers: read })).body;
    const fenced = `${text}\n\`\`\`\n## Injected\n\`\`\``;
    for (const route of ['preview', 'apply']) {
      const res = await call('POST', `${P}/mermaid/${route}`, { headers: write, body: { text: fenced } });
      assert.deepEqual([res.status, res.body], [400, { ok: false, error: 'fence-in-drawing' }], route);
    }
    assert.equal(readFileSync(join(root, DIR, 'README.md'), 'utf8'), readme);
  });
});

test('the workshop draft: starts as the export, is saved and discarded on its own, never in the README', async () => {
  await withServer(async ({ call, read, write, root, smDir }) => {
    const readme = readFileSync(join(root, DIR, 'README.md'), 'utf8');
    const first = await call('GET', `${P}/draft`, { headers: read });
    assert.equal(first.body.saved, false);
    assert.match(first.body.text, /^flowchart LR/);
    assert.equal((await call('PUT', `${P}/draft`, { headers: write, body: { text: 'flowchart LR\n  a --> b' } })).status, 200);
    assert.deepEqual((await call('GET', `${P}/draft`, { headers: read })).body, { ok: true, saved: true, text: 'flowchart LR\n  a --> b' });
    assert.ok(existsSync(join(smDir, 'brain', 'feira-abc123', 'flow-draft.mmd')));
    assert.equal(readFileSync(join(root, DIR, 'README.md'), 'utf8'), readme);
    assert.equal((await call('PUT', `${P}/draft`, { headers: write, body: { text: 'x'.repeat(70_000) } })).status, 413);
    assert.equal((await call('PUT', `${P}/draft`, { headers: write, body: {} })).status, 400);
    assert.equal((await call('DELETE', `${P}/draft`, { headers: write })).status, 200);
    assert.equal((await call('GET', `${P}/draft`, { headers: read })).body.saved, false);
  });
});

test('the demo shows the export and keeps a draft in memory, but never applies', async () => {
  await withServer(async ({ call, write, smDir }) => {
    const { projects } = (await call('GET', '/api/state')).body;
    const shop = projects.find((p) => p.arch.source === 'worktree');
    const base = `/api/arch/${shop.id}`;
    assert.match((await call('GET', `${base}/mermaid`)).body.text, /^flowchart LR/);
    assert.equal((await call('POST', `${base}/mermaid/preview`, { headers: write, body: { text: 'flowchart LR\n  a --> b' } })).status, 200);
    assert.equal((await call('POST', `${base}/mermaid/apply`, { headers: write, body: { text: 'flowchart LR\n  a --> b' } })).status, 403);
    assert.equal((await call('PUT', `${base}/draft`, { headers: write, body: { text: 'flowchart LR\n  z' } })).status, 200);
    assert.equal((await call('GET', `${base}/draft`)).body.text, 'flowchart LR\n  z');
    assert.ok(!existsSync(join(smDir, 'brain')), 'nothing on disk');
  }, { demo: true });
});

// ---- apply goes through the care mode (fd14, B3-T19) ------------------------------------------------

test('look only (or not asked yet): apply answers look-only and the project stays byte-identical', async () => {
  await withServer(async ({ call, read, write, root, smDir }) => {
    const before = JSON.stringify(folder(root));
    const drawn = withBox((await call('GET', `${P}/mermaid`, { headers: read })).body.text);
    const unasked = await call('POST', `${P}/mermaid/apply`, { headers: write, body: { text: drawn } });
    assert.deepEqual([unasked.status, unasked.body.ok, unasked.body.status, unasked.body.error, unasked.body.changed], [409, false, 'look-only', 'look-only', false]);
    writeCare(smDir, 'feira-abc123', 'look');
    const look = await call('POST', `${P}/mermaid/apply`, { headers: write, body: { text: drawn } });
    assert.deepEqual([look.status, look.body.status], [409, 'look-only']);
    assert.equal(JSON.stringify(folder(root)), before, 'nothing written');
    assert.ok(!existsSync(join(root, DIR, 'notas-fiscais.md')));
    assert.deepEqual(listUndo(smDir, 'feira-abc123'), []);
    const logged = readFileSync(join(smDir, 'actions.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(logged.map((l) => [l.action, l.count, l.status, l.mode]), [['flow-apply', 0, 409, 'look-only'], ['flow-apply', 0, 409, 'look-only']]);
  });
});

test('suggest: the Apply click writes, answers the operation id and leaves an undo that gives the README back', async () => {
  await withServer(async ({ call, read, write, root, smDir }) => {
    writeCare(smDir, 'feira-abc123', 'suggest');
    const before = folder(root);
    const drawn = withBox((await call('GET', `${P}/mermaid`, { headers: read })).body.text);
    const applied = await call('POST', `${P}/mermaid/apply`, { headers: write, body: { text: drawn } });
    assert.deepEqual([applied.status, applied.body.status, applied.body.changed], [200, 'applied', true]);
    const [record] = listUndo(smDir, 'feira-abc123', { root });
    assert.deepEqual([record.id, record.mode, record.kind, record.undoable], [applied.body.opId, 'suggest', 'flow-import', true]);
    assert.equal(undoOp({ id: 'feira-abc123', root }, applied.body.opId, { smDir, confirm: true }).ok, true);
    assert.deepEqual(folder(root), before, 'undo gives back every byte and removes the new part file');
  });
});

test('the client cannot choose the mode: a mode in the body is ignored', async () => {
  await withServer(async ({ call, read, write, root, smDir }) => {
    writeCare(smDir, 'feira-abc123', 'look');
    const drawn = withBox((await call('GET', `${P}/mermaid`, { headers: read })).body.text);
    const res = await call('POST', `${P}/mermaid/apply`, { headers: write, body: { text: drawn, mode: 'auto', care: { mode: 'auto' } } });
    assert.equal(res.body.status, 'look-only');
    assert.ok(!existsSync(join(root, DIR, 'notas-fiscais.md')));
  });
});
