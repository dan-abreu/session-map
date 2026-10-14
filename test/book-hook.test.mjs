import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tidyBook } from '../server/chat/book-tidy.mjs';

const HOOK = fileURLToPath(new URL('../server/chat/book-hook.mjs', import.meta.url));
const user = (text) => ({ type: 'user', cwd: '/p', message: { role: 'user', content: text } });
const assistant = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const jsonl = (list) => `${list.map((e) => JSON.stringify(e)).join('\n')}\n`;

function runHook(flag, input, smDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, flag], { windowsHide: true, env: { ...process.env, SESSION_MAP_DIR: smDir } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, out }));
    child.stdin.end(JSON.stringify(input));
  });
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sm-book-'));
  const transcript = join(root, 't.jsonl');
  writeFileSync(transcript, jsonl([user('first request `pc28`'), assistant('done'), user('second request'), assistant('working')]));
  const bookDir = join(root, 'book', 'sess-1');
  return { root, transcript, bookDir, input: { session_id: 'sess-1', transcript_path: transcript, cwd: '/p' } };
}
const cleanup = (root) => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });

test('--stop writes the closed chapter and the index, and says nothing', async () => {
  const s = setup();
  try {
    mkdirSync(s.bookDir, { recursive: true });
    writeFileSync(join(s.bookDir, 'tidy.lock'), '1'); // a fresh lock: no tidy is spawned
    const { code, out } = await runHook('--stop', s.input, s.root);
    assert.deepEqual([code, out], [0, '']);
    assert.match(readFileSync(join(s.bookDir, 'cap-1.md'), 'utf8'), /first request/);
    assert.ok(!existsSync(join(s.bookDir, 'cap-2.md')), 'the open chapter has no file');
    const index = JSON.parse(readFileSync(join(s.bookDir, 'index.json'), 'utf8'));
    assert.deepEqual(index.chapters.map((c) => [c.n, c.closed]), [[1, true], [2, false]]);
  } finally { await cleanup(s.root); }
});

test('--compact prints the index with the chapter file path', async () => {
  const s = setup();
  try {
    const { code, out } = await runHook('--compact', s.input, s.root);
    assert.equal(code, 0);
    const ctx = JSON.parse(out).hookSpecificOutput;
    assert.equal(ctx.hookEventName, 'SessionStart');
    assert.match(ctx.additionalContext, /# Índice desta conversa/);
    assert.ok(ctx.additionalContext.includes(join(s.bookDir, 'cap-1.md').replace(/\\/g, '/')));
    const bad = await runHook('--compact', { session_id: '../x', transcript_path: s.transcript }, s.root);
    assert.deepEqual([bad.code, bad.out], [0, '']);
  } finally { await cleanup(s.root); }
});

test('tidyBook sets the title, stores a rejected chapter as nulls, keeps the old title unless the subject changed, and frees the lock', async () => {
  const s = setup();
  try {
    mkdirSync(s.bookDir, { recursive: true });
    const lock = join(s.bookDir, 'tidy.lock');
    const tidyOf = () => JSON.parse(readFileSync(join(s.bookDir, 'tidy.json'), 'utf8'));
    const answer = (value) => async () => ({ ok: true, value, costUSD: 0.01 });
    await tidyBook({ transcriptPath: s.transcript, bookDir: s.bookDir, run: answer({ title: 'Primeiro título', chapters: [{ n: 1, title: 'Cap um', summary: 'Resumo' }] }) });
    assert.equal(tidyOf().title, 'Primeiro título');
    assert.deepEqual(tidyOf().chapters[1], { title: 'Cap um', summary: 'Resumo' });
    assert.ok(!existsSync(lock));

    // Chapters 2 and 3 are closed now: one comes back inventing a file.
    writeFileSync(s.transcript, jsonl([user('a'), assistant('x'), user('b'), assistant('y'), user('c'), assistant('z'), user('d')]));
    await tidyBook({ transcriptPath: s.transcript, bookDir: s.bookDir, run: answer({
      title: 'Outro título', subjectChanged: false,
      chapters: [{ n: 2, title: 'Mexeu em invented.mjs', summary: 'x' }, { n: 3, title: 'Bom', summary: 'ok' }],
    }) });
    assert.equal(tidyOf().title, 'Primeiro título');
    assert.deepEqual(tidyOf().chapters[2], { title: null, summary: null });
    assert.equal(tidyOf().chapters[3].title, 'Bom');
    assert.equal(tidyOf().costUSD, 0.02);

    writeFileSync(s.transcript, jsonl([user('a'), user('b'), user('c'), user('d'), user('e')]));
    await tidyBook({ transcriptPath: s.transcript, bookDir: s.bookDir, run: answer({ title: 'Assunto novo', subjectChanged: true, chapters: [{ n: 4, title: 'Quatro', summary: 's' }] }) });
    assert.equal(tidyOf().title, 'Assunto novo');

    // A failed call writes nothing and still frees the lock.
    writeFileSync(s.transcript, jsonl([user('a'), user('b'), user('c'), user('d'), user('e'), user('f')]));
    const before = readFileSync(join(s.bookDir, 'tidy.json'), 'utf8');
    await tidyBook({ transcriptPath: s.transcript, bookDir: s.bookDir, run: async () => ({ ok: false, error: 'timeout' }) });
    assert.equal(readFileSync(join(s.bookDir, 'tidy.json'), 'utf8'), before);
    assert.ok(!existsSync(lock));
  } finally { await cleanup(s.root); }
});
