import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LANGS, translator } from '../server/web/i18n.js';

const WEB = new URL('../server/web/', import.meta.url);
const sources = readdirSync(WEB).filter((f) => /\.(js|html)$/.test(f)).map((f) => [f, readFileSync(new URL(f, WEB), 'utf8')]);

test('en and pt-BR have exactly the same keys, none empty', () => {
  const en = Object.keys(LANGS.en).sort();
  const pt = Object.keys(LANGS['pt-BR']).sort();
  assert.deepEqual(pt.filter((k) => !en.includes(k)), [], 'keys only in pt-BR');
  assert.deepEqual(en.filter((k) => !pt.includes(k)), [], 'keys only in en');
  for (const [lang, dict] of Object.entries(LANGS)) {
    for (const [k, v] of Object.entries(dict)) assert.ok(typeof v === 'string' && v.trim(), `${lang} ${k} is empty`);
  }
});

test('placeholders match between languages', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(LANGS.en)) assert.deepEqual(vars(LANGS['pt-BR'][k]), vars(LANGS.en[k]), k);
});

test('every literal key the page asks for exists', () => {
  const missing = [];
  for (const [file, text] of sources) {
    for (const m of text.matchAll(/\bt{1,2}(?:\(\))?\(\s*'([a-zA-Z][\w.-]*)'/g)) if (!(m[1] in LANGS.en)) missing.push(`${file}: ${m[1]}`);
    for (const m of text.matchAll(/\bt{1,2}(?:\(\))?\.count\(\s*'([\w.-]+)'/g)) {
      for (const form of ['one', 'other']) if (!(`${m[1]}.${form}` in LANGS.en)) missing.push(`${file}: ${m[1]}.${form}`);
    }
    for (const m of text.matchAll(/data-i18n(?:-aria|-title|-placeholder)?="([\w.-]+)"/g)) if (!(m[1] in LANGS.en)) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('keys built at runtime exist: server errors, permission states, columns, ranges', () => {
  const dynamic = [
    ...['already-open', 'busy', 'not-running', 'session-changed', 'not-claude', 'kill-refused', 'no-folder', 'live-chat', 'too-many-chats',
      'claude-not-found', 'exited', 'spawn-failed', 'ended', 'unknown-session', 'unknown-unit', 'unknown-front', 'unknown-project',
      'unknown-chat', 'bad-edit', 'bad-nucleus', 'token-required', 'network', 'demo', 'generic', 'bad-path', 'sensitive', 'not-found', 'too-large', 'binary', 'bad-line', 'bad-project', 'bad-request'].map((c) => `err.${c}`),
    'action.why.already-open', 'action.why.busy', 'action.archive', 'action.unarchive', 'action.archived', 'action.unarchived',
    ...['allowed', 'denied', 'timeout'].map((s) => `chat.perm.${s}`),
    ...['todo', 'doing', 'waiting', 'done'].flatMap((k) => [`board.${k}`, `board.${k}.empty`]),
    'stage.done', 'stage.open',
    ...['today', 'd7', 'd30'].flatMap((r) => [`costs.range.${r}`, `costs.total.${r}`]),
    ...['user', 'project', 'plugin'].map((o) => `skills.origin.${o}`),
    ...['grouped', 'fused-by-meaning', 'renamed'].map((k) => `activity.${k}`),
    ...['clash', 'card', 'decision', 'question'].map((k) => `waiting.${k}`),
  ];
  assert.deepEqual(dynamic.filter((k) => !(k in LANGS.en)), []);
});

test('the page has no leftover "not wired yet" texts', () => {
  for (const key of ['action.soon', 'tab.soon']) assert.ok(!(key in LANGS.en), key);
  for (const [file, text] of sources) assert.doesNotMatch(text, /data-soon|inertActions/, file);
});

test('translator counts with plural forms and falls back to English', () => {
  const t = translator('pt-BR');
  assert.equal(t.count('summary.chats', 1), '1 conversa');
  assert.equal(t.count('summary.chats', 3), '3 conversas');
  assert.equal(translator('xx')('tab.brain'), 'Brain');
});

// CLDR puts 0 in the "one" form for Portuguese, but nobody writes "0 conversa".
test('translator uses the plural form for zero', () => {
  assert.equal(translator('pt-BR').count('summary.chats', 0), '0 conversas');
  assert.equal(translator('en').count('summary.chats', 0), '0 conversations');
});
