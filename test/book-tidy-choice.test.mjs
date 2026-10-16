import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tidyBook } from '../server/chat/book-tidy.mjs';

// The book row of the Cérebro rides on the tidy call (id146): the owner's model and level, Haiku at no named level
// when none. The row is the same knob the Cérebro tab shows for "Livro (títulos e resumos)".
const line = (type, role, text) => JSON.stringify({ type, message: { role, content: text } });

test('the book row of the Cérebro rides on the tidy call; Haiku is the default (id146)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-book-choice-'));
  const bookDir = join(dir, 'book');
  mkdirSync(bookDir);
  const transcript = join(dir, 't.jsonl');
  writeFileSync(transcript, [
    line('user', 'user', 'Fix the login'),
    line('assistant', 'assistant', 'Done.'),
    line('user', 'user', 'Now the header'),
  ].join('\n'));
  const smDir = join(dir, 'sm');
  mkdirSync(smDir);
  const seen = [];
  const run = async (prompt, opts) => {
    seen.push(opts);
    return { ok: true, value: { title: 'T', subjectChanged: false, chapters: [{ n: 1, title: 'Login', summary: 'fixed' }] }, costUSD: 0.01 };
  };
  const attempt = async () => { rmSync(join(bookDir, 'tidy.json'), { force: true }); await tidyBook({ transcriptPath: transcript, bookDir, run }); };
  try {
    process.env.SESSION_MAP_DIR = smDir;
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { book: { model: 'sonnet', effort: 'low' } } } } }));
    await attempt();
    assert.equal(seen.at(-1).model, 'sonnet', 'the owner\'s choice');
    assert.equal(seen.at(-1).effort, 'low');

    // With no choice the cheap default holds.
    rmSync(join(smDir, 'config.json'));
    await attempt();
    assert.equal(seen.at(-1).model, 'haiku', 'the default');
    assert.equal('effort' in seen.at(-1), false);

    // Junk in the file is ignored like any unreadable choice.
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { book: { model: 'gpt', effort: 'turbo' } } } } }));
    await attempt();
    assert.equal(seen.at(-1).model, 'haiku', 'an unknown model or level falls back');
    assert.equal('effort' in seen.at(-1), false);
  } finally {
    delete process.env.SESSION_MAP_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a book row on another AI asks the server first; the Claude call does the work only when the server cannot (id156)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-book-outside-'));
  const bookDir = join(dir, 'book');
  mkdirSync(bookDir);
  const transcript = join(dir, 't.jsonl');
  writeFileSync(transcript, [line('user', 'user', 'Fix the login'), line('assistant', 'assistant', 'Done.'), line('user', 'user', 'Now the header')].join('\n'));
  const smDir = join(dir, 'sm');
  mkdirSync(smDir);
  const answer = { title: 'T', subjectChanged: false, chapters: [{ n: 1, title: 'Login', summary: 'fixed' }] };
  const asked = [];
  const claude = [];
  const outsideOk = async (prompt) => { asked.push(prompt); return { ok: true, value: answer, costUSD: 0.0004 }; };
  const outsideNo = async (prompt) => { asked.push(prompt); return null; };
  const run = async (prompt, opts) => { claude.push(opts); return { ok: true, value: answer, costUSD: 0.01 }; };
  const attempt = async (outside) => { rmSync(join(bookDir, 'tidy.json'), { force: true }); await tidyBook({ transcriptPath: transcript, bookDir, run, outside }); return JSON.parse(readFileSync(join(bookDir, 'tidy.json'), 'utf8')); };
  try {
    process.env.SESSION_MAP_DIR = smDir;
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { book: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low' } } } } }));
    const done = await attempt(outsideOk);
    assert.equal(asked.length, 1, 'the server was asked');
    assert.equal(claude.length, 0, 'Claude was not');
    assert.equal(done.chapters[1].title, 'Login');
    assert.equal(done.costUSD, 0.0004, 'the cost of the other AI is the one kept');

    const fell = await attempt(outsideNo);
    assert.equal(claude.length, 1, 'the server could not take it: Claude did, as it always did');
    assert.equal(claude[0].model, 'haiku', 'and with no other AI\'s model on the Claude call');
    assert.equal('effort' in claude[0], false);
    assert.equal(fell.chapters[1].title, 'Login');

    // The row on Claude or on nothing never goes to the server.
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { book: { provider: 'claude', model: 'sonnet' } } } } }));
    const before = asked.length;
    await attempt(outsideOk);
    assert.equal(asked.length, before, 'Claude row: no ask to the server');
    assert.equal(claude.at(-1).model, 'sonnet');
  } finally {
    delete process.env.SESSION_MAP_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
