import test from 'node:test';
import assert from 'node:assert/strict';
import { CARE_MODES, careQuestion, confirmWords, createCareView, diffHunk, needsConfirm, needsQuestion, outcomeOf, proposalRows } from '../server/web/careview.js';
import { hunkRows } from '../server/web/changes.js';
import texts from '../server/web/i18n-fd/care-mode.js';
import { LANGS } from '../server/web/i18n.js';

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tIn = (lang) => (key, v) => (texts[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (v && k in v ? v[k] : `{${k}}`));

test('the first-use question offers the three modes, the automatic one recommended', () => {
  const q = careQuestion(null);
  assert.deepEqual(q.options.map((o) => o.id), ['auto', 'suggest', 'look']);
  assert.deepEqual(q.options.map((o) => o.recommended), [true, false, false]);
  assert.deepEqual(q.options.map((o) => o.selected), [false, false, false], 'nothing is chosen for the owner');
  assert.equal(careQuestion('suggest').options.find((o) => o.selected).id, 'suggest');
  assert.equal(careQuestion('nonsense').options.some((o) => o.selected), false, 'an unknown mode selects nothing');
  assert.deepEqual(CARE_MODES, ['auto', 'suggest', 'look']);
});

test('the question carries its words in both languages when given a translator', () => {
  const en = careQuestion(null, tIn('en'));
  const pt = careQuestion(null, tIn('pt-BR'));
  assert.deepEqual(en.options.map((o) => o.label), ['Automatic', 'Suggest', 'Look only']);
  assert.deepEqual(pt.options.map((o) => o.label), ['Automático', 'Sugerir', 'Só olhar']);
  for (const q of [en, pt]) {
    assert.ok(q.title && !q.title.startsWith('care.'), 'title translated');
    for (const o of q.options) assert.ok(o.hint.length > 20 && !o.hint.startsWith('care.'), `${o.id} hint translated`);
  }
});

test('the mode is asked only when the project has none yet', () => {
  assert.equal(needsQuestion({ mode: null, askedAt: null }), true);
  assert.equal(needsQuestion({}), true);
  assert.equal(needsQuestion({ mode: 'look', askedAt: '2026-10-10T10:00:00Z' }), false);
  assert.equal(needsQuestion({ mode: 'auto' }), false);
  assert.equal(needsQuestion({ mode: 'wild' }), true, 'a mode the program does not know is asked again');
  assert.equal(needsQuestion(null), false, 'while the answer has not loaded nothing is asked');
});

test('the care texts are the same in en and pt-BR, with the same blanks, and repeat no other key', () => {
  assert.deepEqual(Object.keys(texts['pt-BR']).sort(), Object.keys(texts.en).sort());
  for (const [k, v] of Object.entries(texts.en)) {
    assert.ok(v.trim() && texts['pt-BR'][k].trim(), k);
    assert.deepEqual(vars(texts['pt-BR'][k]), vars(v), `${k} blanks`);
    // Merged through i18n-fd/care.js: the dictionary holds this very text, so no other key of the same name overrides it.
    assert.equal(LANGS.en[k], v, `${k} is not the care text in the dictionary`);
    assert.equal(LANGS['pt-BR'][k], texts['pt-BR'][k], `${k} is not the care text in the dictionary`);
  }
});

test('a line diff keeps the lines around the change and finds what was cut and added', () => {
  const hunk = diffHunk('a\nb\nc\nd\ne\nf\ng\n', 'a\nb\nc\nD\nE\nf\ng\n');
  assert.deepEqual(hunk.lines, [' a', ' b', ' c', '-d', '-e', '+D', '+E', ' f', ' g']);
  assert.deepEqual([hunk.oldStart, hunk.newStart], [1, 1]);
  assert.deepEqual(hunkRows(hunk).filter((r) => r.sign === '+').map((r) => r.new), [4, 5], 'numbers line up with hunkRows');
  assert.equal(diffHunk('same\n', 'same\n'), null);
  const twenty = (mid) => Array.from({ length: 20 }, (_, i) => (i === 10 ? mid : `l${i}`)).join('\n');
  const far = diffHunk(twenty('l10'), twenty('X'));
  assert.equal(far.oldStart, 8, 'three lines of context before the change');
  assert.deepEqual(far.lines, [' l7', ' l8', ' l9', '-l10', '+X', ' l11', ' l12', ' l13']);
});

test('a created file is all additions and an erased one all removals', () => {
  assert.deepEqual(diffHunk(null, 'x\ny').lines, ['+x', '+y']);
  assert.deepEqual(diffHunk('x\ny', null).lines, ['-x', '-y']);
  assert.equal(diffHunk(null, null), null);
});

const proposal = (over = {}) => ({
  op: { id: 'op:1', kind: 'doc-update', sensitive: false, files: [{ path: 'docs/api.md', after: 'new' }], why: { msg: 'watch.docCitesMissing.what' } },
  mode: 'suggest', createdAt: '2026-10-10T10:00:00Z', state: 'open', diff: [{ path: 'docs/api.md', before: 'old\n', after: 'new\n' }], ...over,
});

test('the proposals list puts the open ones first and counts lines from the diff', () => {
  const rows = proposalRows([
    proposal({ op: { id: 'op:old', kind: 'doc-update', files: [] }, state: 'accepted', createdAt: '2026-10-09T10:00:00Z' }),
    proposal({ op: { id: 'op:a', kind: 'doc-update', files: [] }, createdAt: '2026-10-09T08:00:00Z', diff: [] }),
    proposal(),
    proposal({ op: { id: 'op:never', kind: 'doc-update', files: [] }, state: 'never' }),
  ]);
  assert.deepEqual(rows.map((r) => r.opId), ['op:1', 'op:a'], 'newest open first; accepted and never are not waiting');
  assert.deepEqual([rows[0].added, rows[0].removed, rows[0].paths], [1, 1, ['docs/api.md']]);
  assert.equal(rows[0].canAccept, true);
  assert.deepEqual(proposalRows(null), []);
});

test('an operation that erases or is sensitive is the one that needs a confirmation', () => {
  assert.equal(needsConfirm({ kind: 'doc-update', files: [{ path: 'a.md', after: 'x' }] }), false);
  assert.equal(needsConfirm({ kind: 'doc-update', files: [{ path: 'a.md', after: null }] }), true);
  for (const kind of ['delete', 'publish', 'money', 'account']) assert.equal(needsConfirm({ kind, files: [] }), true, kind);
  assert.equal(needsConfirm({ kind: 'doc-update', sensitive: true, files: [] }), true);
});

test('the confirmation says what will be erased and what will be written, never the file text', () => {
  const words = confirmWords({ kind: 'delete', files: [{ path: 'docs/old.md', after: null }, { path: 'docs/index.md', after: 'secret text' }] });
  assert.deepEqual(words, { kind: 'delete', erase: ['docs/old.md'], write: ['docs/index.md'] });
  assert.ok(!JSON.stringify(words).includes('secret text'));
});

test('what the server answers to an accept becomes one of six outcomes with plain words', () => {
  const ok = (data) => ({ ok: true, status: 200, data });
  assert.equal(outcomeOf(ok({ ok: true, status: 'applied', opId: 'op:1', files: ['a.md'] })).kind, 'applied');
  assert.equal(outcomeOf(ok({ ok: true, status: 'proposed', opId: 'op:1' })).kind, 'proposed');
  assert.equal(outcomeOf(ok({ ok: false, status: 'needs-confirm' })).kind, 'needs-confirm');
  assert.equal(outcomeOf(ok({ ok: false, status: 'look-only' })).kind, 'look-only');
  assert.deepEqual(outcomeOf(ok({ ok: false, status: 'refused', error: 'secret-file' })), { kind: 'refused', error: 'secret-file', files: [] });
  assert.equal(outcomeOf({ ok: false, status: 409, data: null, error: 'needs-confirm' }).kind, 'needs-confirm', 'also when the route says it with an HTTP error');
  assert.equal(outcomeOf({ ok: false, status: 403, data: null, error: 'demo' }).kind, 'error');
  assert.equal(outcomeOf({ ok: false, status: 0, data: null, error: 'network' }).error, 'network');
  assert.equal(outcomeOf(ok(null)).kind, 'error', 'an empty answer is never read as success');
  for (const kind of ['applied', 'proposed', 'needs-confirm', 'look-only', 'refused', 'error']) assert.ok(texts.en[`care.result.${kind}`], kind);
});

function fakeFetch(answer) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  };
  return { calls, restore: () => { globalThis.fetch = saved; } };
}

test('choosing a mode writes it with PUT care, and a mode the program does not know never leaves the page', async () => {
  const f = fakeFetch({ status: 200, body: { mode: 'auto', askedAt: '2026-10-10T10:00:00Z' } });
  try {
    const view = createCareView({ h: () => ({}), t: () => tIn('en') });
    const res = await view.saveMode('acme-shop-8324f1', 'auto');
    assert.equal(res.ok, true);
    assert.equal(f.calls[0].path, '/api/foundation/acme-shop-8324f1/care');
    assert.equal(f.calls[0].init.method, 'PUT');
    assert.equal(f.calls[0].init.body, '{"mode":"auto"}');
    const bad = await view.saveMode('acme-shop-8324f1', 'wild');
    assert.equal(bad.error, 'bad-mode');
    assert.equal(f.calls.length, 1);
  } finally { f.restore(); }
});

test('accepting a proposal sends only the confirmation, never file text, and the id without the op: prefix', async () => {
  const f = fakeFetch({ status: 200, body: { ok: true, status: 'applied', opId: 'op:1', files: ['docs/api.md'] } });
  try {
    const view = createCareView({ h: () => ({}), t: () => tIn('en') });
    const out = await view.accept('acme-shop-8324f1', 'op:1', { confirm: true });
    assert.equal(out.kind, 'applied');
    assert.equal(f.calls[0].path, '/api/foundation/acme-shop-8324f1/op/1/accept');
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { confirm: true });
  } finally { f.restore(); }
});

test('every care and undo text the two files ask for exists in both languages', async () => {
  const { readFileSync } = await import('node:fs');
  const used = new Set();
  for (const file of ['careview.js', 'changes.js']) {
    const src = readFileSync(new URL(`../server/web/${file}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/'((?:care|changes\.op)\.[\w.-]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 20, 'the scan found the keys');
  const has = (lang, key) => key in texts[lang] || `${key}.other` in texts[lang] || key in LANGS[lang];
  for (const key of used) for (const lang of ['en', 'pt-BR']) assert.ok(has(lang, key), `${lang} ${key}`);
  for (const mode of CARE_MODES) for (const lang of ['en', 'pt-BR']) {
    assert.ok(texts[lang][`care.mode.${mode}`] && texts[lang][`care.mode.${mode}.hint`], `${lang} ${mode}`);
  }
  for (const kind of ['delete', 'publish', 'money', 'account']) assert.ok(texts.en[`care.confirm.kind.${kind}`] && texts['pt-BR'][`care.confirm.kind.${kind}`], kind);
});
