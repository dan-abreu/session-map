import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { readPlacements, setPlacement } from '../server/placements.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tmp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));

function project(base, name, parts) {
  const root = join(base, name);
  mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
  const readme = ['# Parts', '', '## Main', '', ...parts.map((p) => `- [${p}](${p.toLowerCase()}.md)`), ''].join('\n');
  writeFileSync(join(root, 'docs', 'architecture', 'README.md'), readme);
  for (const p of parts) writeFileSync(join(root, 'docs', 'architecture', `${p.toLowerCase()}.md`), `# ${p}\n\nAbout ${p}.\n\n## What's missing\n\n- [ ] Something \`${p.slice(0, 2).toLowerCase()}01\`\n`);
  return root;
}

function chat(dir, id, cwd, title) {
  const ts = new Date().toISOString();
  const base = { sessionId: id, cwd, gitBranch: 'main', timestamp: ts, entrypoint: 'cli' };
  const lines = [
    { type: 'ai-title', aiTitle: title, sessionId: id },
    { ...base, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
    { ...base, type: 'assistant', message: { id: `${id}-m`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'text', text: 'done.' }], usage: { input_tokens: 10, output_tokens: 10 } } },
  ];
  const projDir = join(dir, 'projects', cwd.replace(/[^a-z0-9]/gi, '-'));
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('setPlacement keeps one entry per conversation, merges fields, and an empty title gives the automatic one back', () => {
  const smDir = tmp('sm-place-');
  try {
    setPlacement(smDir, A, { title: '  Garden invoices  ' });
    setPlacement(smDir, A, { root: '/work/garden', partId: 'billing' });
    assert.deepEqual(readPlacements(smDir)[A], { root: '/work/garden', partId: 'billing', title: 'Garden invoices' });
    setPlacement(smDir, A, { partId: null });
    assert.equal(readPlacements(smDir)[A].partId, null, 'null is the owner saying "no part"');
    setPlacement(smDir, A, { title: '', partId: undefined, root: undefined });
    assert.equal(readPlacements(smDir)[A], undefined, 'nothing left: the entry goes');
    writeFileSync(join(smDir, 'placements.json'), JSON.stringify({ 'not-a-uuid': { title: 'x' }, [A]: { title: 7, partId: 3 } }));
    assert.deepEqual(readPlacements(smDir), {}, 'junk on disk is ignored');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('POST /api/conversation/:id/place moves a conversation to another project and part and renames it, only with the token', async () => {
  const base = tmp('sm-place-srv-');
  const dir = join(base, 'claude');
  const smDir = join(base, 'sm');
  const shop = project(base, 'acme-shop', ['Shop']);
  const garden = project(base, 'garden', ['Billing', 'Seeds']);
  chat(dir, A, shop, 'Long chat');
  chat(dir, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', garden, 'Seed list');
  const app = createApp({ dir, smDir, ai: { bin: null }, chat: null });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: res.headers['content-type']?.includes('json') ? JSON.parse(text) : text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const good = { cookie: `sm_token=${token}`, 'x-session-map': '1', origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' };
  const place = (body, headers = good, id = A) => call('POST', `/api/conversation/${id}/place`, body, headers);
  try {
    const before = (await call('GET', '/api/state')).body;
    const gardenId = before.projects.find((p) => p.name === 'garden').id;
    assert.equal((await place({ title: 'x' }, { ...good, cookie: '' })).status, 401);
    assert.equal((await place({ title: 'x' }, good, 'not-a-uuid')).status, 400);
    assert.equal((await place({ title: 'x' }, good, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).status, 404);
    assert.equal((await place({ projectId: 'nowhere-123' })).status, 404);
    assert.equal((await place({ projectId: gardenId, partId: 'ghost' })).body.error, 'unknown-part');
    assert.equal((await place({ title: 42 })).body.error, 'bad-place');
    assert.equal((await place({ title: 'y'.repeat(500) })).body.error, 'bad-place');

    const res = await place({ projectId: gardenId, partId: 'billing', title: 'Garden invoices' });
    assert.equal(res.status, 200);
    const after = (await call('GET', '/api/state')).body;
    const byName = Object.fromEntries(after.projects.map((p) => [p.name, p]));
    assert.equal(byName['acme-shop'], undefined, 'its only conversation left: the project is empty now');
    const row = byName.garden.conversations.find((r) => r.sessionId === A);
    assert.deepEqual([row.title, row.partId], ['Garden invoices', 'billing']);
    assert.equal(byName.garden.chats.find((c) => c.sessionId === A).partSource, 'owner');

    assert.equal((await place({ title: '' })).status, 200);
    assert.equal(readPlacements(smDir)[A].title, undefined, 'an empty title gives the automatic one back');
    assert.equal((await place({ partId: '' })).status, 200);
    assert.equal('partId' in readPlacements(smDir)[A], false, 'an empty part lets the rules place it again');
    assert.equal(readPlacements(smDir)[A].root, garden, 'and it stays in the project it was moved to');
    assert.match(readFileSync(join(smDir, 'actions.log'), 'utf8'), /"action":"place"/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(base, { recursive: true, force: true });
  }
});
