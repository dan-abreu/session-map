import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { readCards } from '../server/cards.mjs';

const tmp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));

function project(base, name, parts) {
  const root = join(base, name);
  mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
  const readme = ['# Parts', '', '## Main', '', ...parts.map((p) => `- [${p}](${p.toLowerCase()}.md)`), ''].join('\n');
  writeFileSync(join(root, 'docs', 'architecture', 'README.md'), readme);
  for (const p of parts) writeFileSync(join(root, 'docs', 'architecture', `${p.toLowerCase()}.md`), `# ${p}\n\nAbout ${p}.\n\n## What's missing\n\n- [ ] Something \`${p.slice(0, 2).toLowerCase()}01\`\n`);
  return root;
}

function chat(dir, id, cwd) {
  const ts = new Date().toISOString();
  const base = { sessionId: id, cwd, gitBranch: 'main', timestamp: ts, entrypoint: 'cli' };
  const lines = [
    { type: 'ai-title', aiTitle: 'A chat', sessionId: id },
    { ...base, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
    { ...base, type: 'assistant', message: { id: `${id}-m`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'text', text: 'done.' }], usage: { input_tokens: 10, output_tokens: 10 } } },
  ];
  const projDir = join(dir, 'projects', cwd.replace(/[^a-z0-9]/gi, '-'));
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('/api/cards: the owner makes, moves and deletes hand cards; reads are open, writes need the token, nothing touches the project', async () => {
  const base = tmp('sm-cards-srv-');
  const dir = join(base, 'claude');
  const smDir = join(base, 'sm');
  const garden = project(base, 'garden', ['Billing', 'Seeds']);
  chat(dir, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', garden);
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
  const bad = { ...good, cookie: '' };
  try {
    const projectId = (await call('GET', '/api/state')).body.projects.find((p) => p.name === 'garden').id;
    assert.deepEqual((await call('GET', '/api/cards')).body, { ok: true, cards: {} });

    const make = (body, headers = good) => call('POST', '/api/cards', body, headers);
    assert.equal((await make({ projectId, title: 'x' }, bad)).status, 401);
    assert.equal((await make({ projectId: 'nowhere-123', title: 'x' })).status, 404);
    assert.equal((await make({ projectId, title: '  ' })).body.error, 'title-required');
    assert.equal((await make({ projectId, title: 'x', partId: 'ghost' })).body.error, 'unknown-part');
    assert.equal((await make({ projectId, title: 'x', note: 5 })).body.error, 'bad-card');
    assert.equal((await make(null)).status, 400);
    assert.deepEqual(readCards(smDir), {}, 'every refusal left the folder untouched');

    const a = (await make({ projectId, title: 'Send the invoices', partId: 'billing', note: 'Monday' })).body;
    const b = (await make({ projectId, title: 'Order seeds' })).body;
    assert.equal(a.ok, true);
    assert.deepEqual([a.card.column, a.card.partId, a.card.note], ['todo', 'billing', 'Monday']);
    assert.deepEqual((await call('GET', '/api/cards')).body.cards[projectId].map((c) => c.title), ['Send the invoices', 'Order seeds']);

    const move = (id, body, headers = good) => call('POST', `/api/cards/${id}/move`, body, headers);
    assert.equal((await move(a.card.id, { column: 'doing' }, bad)).status, 401);
    assert.equal((await move('nope', { column: 'doing' })).status, 404);
    assert.equal((await move(a.card.id, { column: 'archive' })).body.error, 'bad-column');
    assert.equal((await move(a.card.id, { column: 'doing' })).status, 200);
    assert.equal((await move(b.card.id, { column: 'doing', before: a.card.id })).status, 200);
    const cards = (await call('GET', '/api/cards')).body.cards[projectId];
    assert.deepEqual(cards.map((c) => [c.title, c.column]), [['Order seeds', 'doing'], ['Send the invoices', 'doing']]);

    assert.equal((await call('DELETE', `/api/cards/${a.card.id}`, undefined, bad)).status, 401);
    assert.equal((await call('DELETE', `/api/cards/${a.card.id}`, undefined, good)).status, 200);
    assert.equal((await call('DELETE', `/api/cards/${a.card.id}`, undefined, good)).status, 404);
    assert.deepEqual(readCards(smDir)[projectId].map((c) => c.title), ['Order seeds']);
    assert.match(readFileSync(join(smDir, 'actions.log'), 'utf8'), /"action":"card-add"/);
    assert.equal(readFileSync(join(garden, 'docs', 'architecture', 'billing.md'), 'utf8').includes('invoices'), false, 'the project\'s files are never written');
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(base, { recursive: true, force: true });
  }
});
