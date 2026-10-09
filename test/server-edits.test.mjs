import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, editUnits } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { archiveTranscript, readIndex } from '../server/archive.mjs';
import { listTranscripts } from '../server/sources/claude.mjs';

const UNITS = [
  { id: 'body', name: 'Body', level: 'organ', parentId: null, chatIds: [], paths: [], tags: [], pinned: false },
  { id: 'pay', name: 'Pay', level: 'tissue', parentId: 'body', chatIds: [], paths: [], tags: [], pinned: false },
  { id: 'cards', name: 'Cards', level: 'cell', parentId: 'pay', chatIds: ['1'], paths: [], tags: [], pinned: false },
  { id: 'free', name: 'Free', level: 'cell', parentId: null, chatIds: [], paths: [], tags: [], pinned: false },
  { id: 'unsorted', name: 'Unsorted', level: 'cell', parentId: null, chatIds: [], paths: [], tags: [], pinned: false },
];

test('editUnits move: a person dragging a unit into a higher level pins it', () => {
  const moved = editUnits(UNITS, { op: 'move', id: 'free', parentId: 'pay' }, 'T');
  const free = moved.find((u) => u.id === 'free');
  assert.deepEqual([free.parentId, free.pinned], ['pay', true]);
  const out = editUnits(UNITS, { op: 'move', id: 'cards', parentId: null }, 'T').find((u) => u.id === 'cards');
  assert.deepEqual([out.parentId, out.pinned], [null, true], 'null takes it out to the top level');
});

test('editUnits move refuses a same or lower level parent, unknown ids and the unsorted cell', () => {
  assert.equal(editUnits(UNITS, { op: 'move', id: 'pay', parentId: 'cards' }, 'T'), null);
  assert.equal(editUnits(UNITS, { op: 'move', id: 'free', parentId: 'cards' }, 'T'), null);
  assert.equal(editUnits(UNITS, { op: 'move', id: 'free', parentId: 'ghost' }, 'T'), null);
  assert.equal(editUnits(UNITS, { op: 'move', id: 'unsorted', parentId: 'pay' }, 'T'), null);
  assert.equal(editUnits(UNITS, { op: 'move', id: 'free' }, 'T'), null, 'parentId must be given, even as null');
});

test('DELETE /api/conversation/:id removes an archived conversation, only with the token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-del-'));
  const dir = join(root, 'claude');
  const smDir = join(root, 'sm');
  cpSync(new URL('./fixtures/claude/', import.meta.url), dir, { recursive: true });
  const S1 = '11111111-1111-4111-8111-111111111111';
  const ref = listTranscripts(dir).find((r) => r.sessionId === S1);
  assert.equal(archiveTranscript(ref, smDir), 'archived');
  const gz = join(smDir, 'archive', ref.projectDir, `${S1}.jsonl.gz`);
  assert.equal(existsSync(gz), true);
  const app = createApp({ dir, smDir, ai: { bin: null }, chat: null });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (path, headers) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'DELETE', path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  const good = { cookie: `sm_token=${token}`, 'x-session-map': '1', origin: `http://127.0.0.1:${port}` };
  try {
    assert.equal(await call(`/api/conversation/${S1}`, { ...good, cookie: '' }), 401);
    assert.equal(await call('/api/conversation/not-a-uuid', good), 400);
    assert.equal(await call('/api/conversation/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', good), 404);
    assert.equal(await call(`/api/conversation/${S1}`, good), 200);
    assert.equal(readIndex(smDir).some((e) => e.sessionId === S1), false);
    assert.equal(existsSync(gz), false);
    assert.equal(archiveTranscript(ref, smDir), 'deleted', 'the next sweep does not bring it back');
    assert.equal(await call(`/api/conversation/${S1}`, good), 404);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
