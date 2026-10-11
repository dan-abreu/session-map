import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { practicesFocus, focusInputs, FOCUS_BYTES } from '../server/foundation/practices-focus.mjs';
import { writeFd } from '../server/foundation/store.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
// The same token shape the transcript reader counts as an item code.
const CODE_TOKENS = /(?<![\w-])([a-z]{1,4}(?:-[a-z]{1,4})?\d{1,4})(?![\w-])/gi;
const T = (en, pt = en) => ({ en, 'pt-BR': pt });

let n = 0;
function item(over = {}) {
  n += 1;
  return { id: `t.item${n}`, front: 'quality', ladder: 'N1', severity: 'R', effort: 1, title: T(`Do thing number ${n}`), what: T(`What ${n} means in short.`), ...over };
}
const pkg = (id, items, over = {}) => ({ version: 1, id, kind: 'general', title: T(id), applies: {}, items, ...over });
const row = (it, pk, state = 'fail') => ({ id: it.id, pkg: pk.id, front: it.front, ladder: it.ladder, severity: it.severity, state, reason: state === 'fail' ? null : 'needs-human', evidence: [], attested: null });
const practicesOf = (rows) => ({ version: 1, generatedAt: '2026-10-10T12:00:00.000Z', profileHash: 'abc', items: rows, ladder: {} });
const profile = (stacks) => ({ detected: { types: ['web'], stacks, signals: [], team: { kind: 'solo', authors: 1 }, deploy: [] }, owner: {} });
const stack = (name, file) => ({ name, version: '1.0.0', file, line: 3 });
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const bullets = (s) => s.split('\n').filter((l) => l.startsWith('- ')).length;

// Next in apps/web, Fastify in apps/api, a general package with a quality and a legal item.
const nextItem = item({ front: 'security', severity: 'E', title: T('Check who asks inside every Server Action', 'Conferir quem pede em cada Server Action') });
const nextPkg = pkg('stack-next', [nextItem], { kind: 'stack', applies: { stacks: ['next'] } });
const apiItem = item({ front: 'security', severity: 'E', title: T('Validate every Fastify body') });
const apiPkg = pkg('stack-fastify', [apiItem], { kind: 'stack', applies: { stacks: ['fastify'] } });
const qItem = item({ front: 'quality', severity: 'R', title: T('Run the tests on every change') });
const lItem = item({ front: 'legal', severity: 'E', title: T('Publish a privacy notice') });
const genPkg = pkg('general-x', [qItem, lItem]);
const PACKAGES = [nextPkg, apiPkg, genPkg];
const PROFILE = profile([stack('next', 'apps/web/package.json'), stack('fastify', 'apps/api/package.json')]);
const ALL = practicesOf([row(nextItem, nextPkg), row(apiItem, apiPkg), row(qItem, genPkg), row(lItem, genPkg)]);
const WEB = { id: 'web', name: 'Web', codePaths: ['apps/web/'] };

test('a part with Next files gets the Next items and the general fronts asked, not another stack nor another front', () => {
  const text = practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: WEB, lang: 'en' });
  assert.match(text, /Check who asks inside every Server Action/);
  assert.match(text, /Run the tests on every change/);
  assert.ok(!/Fastify/.test(text), 'a stack the part does not use');
  assert.ok(!/privacy notice/.test(text), 'a front nobody asked for');
});

test('the fronts asked can change, and the stack follows the part: the api part gets Fastify', () => {
  const api = { id: 'api', name: 'Api', codePaths: ['apps/api/src/routes/'] };
  const text = practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: api, fronts: ['legal'] });
  assert.match(text, /Validate every Fastify body/);
  assert.match(text, /privacy notice/);
  assert.ok(!/Server Action/.test(text));
  assert.ok(!/Run the tests/.test(text), 'quality was not asked this time');
});

test('a stack found in a manifest at the root belongs to every part', () => {
  const rootProfile = profile([stack('next', 'package.json')]);
  const text = practicesFocus({ practices: ALL, packages: PACKAGES, profile: rootProfile, part: { name: 'Anything', codePaths: ['src/'] } });
  assert.match(text, /Server Action/);
});

test('no failing item, or only passing, n/a or other-stack ones, means no block', () => {
  const rows = [row(nextItem, nextPkg, 'pass'), row(qItem, genPkg, 'na'), row(apiItem, apiPkg, 'fail')];
  assert.equal(practicesFocus({ practices: practicesOf(rows), packages: PACKAGES, profile: PROFILE, part: WEB }), '');
  assert.equal(practicesFocus({ practices: null, packages: PACKAGES, profile: PROFILE, part: WEB }), '');
  assert.equal(practicesFocus({ practices: ALL, packages: [], profile: PROFILE, part: WEB }), '', 'no texts, nothing to say');
  assert.equal(practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: null }), '');
});

test('an unverified item is shown as not checked, and a failing one comes first', () => {
  const a = item({ severity: 'E', title: T('Unchecked essential thing') });
  const b = item({ severity: 'A', title: T('Failing advanced thing') });
  const p = pkg('general-order', [a, b]);
  const text = practicesFocus({ practices: practicesOf([row(a, p, 'unverified'), row(b, p, 'fail')]), packages: [p], profile: PROFILE, part: WEB, lang: 'en' });
  assert.ok(text.indexOf('Failing advanced thing') < text.indexOf('Unchecked essential thing'));
  assert.match(text, /Unchecked essential thing.*not checked/i);
});

test('within one state the essential comes before the recommended, whatever the step', () => {
  const r = item({ severity: 'R', ladder: 'N0', title: T('Recommended low') });
  const e = item({ severity: 'E', ladder: 'N3', title: T('Essential high') });
  const p = pkg('general-sev', [r, e]);
  const text = practicesFocus({ practices: practicesOf([row(r, p), row(e, p)]), packages: [p], profile: PROFILE, part: WEB });
  assert.ok(text.indexOf('Essential high') < text.indexOf('Recommended low'));
});

test('never more than four items, nor than 700 bytes, however many fail and however long their texts', () => {
  const many = Array.from({ length: 12 }, (_, i) => item({ severity: 'E', title: T(`A rather long title for a failing practice ${'x'.repeat(40)}${i}`), what: T('y'.repeat(300)) }));
  const p = pkg('general-many', many);
  const text = practicesFocus({ practices: practicesOf(many.map((m) => row(m, p))), packages: [p], profile: PROFILE, part: WEB, limit: 99 });
  assert.equal(FOCUS_BYTES, 700);
  assert.ok(bytes(text) <= 700 && text.length > 0);
  assert.ok(bullets(text) <= 4);
  const accents = item({ severity: 'E', title: T('t', 'ação ação ação ação ação ação ação ação ação ação'), what: T('w', 'ç'.repeat(400)) });
  const q = pkg('general-acc', [accents]);
  const pt = practicesFocus({ practices: practicesOf([row(accents, q)]), packages: [q], profile: PROFILE, part: WEB, lang: 'pt' });
  assert.ok(bytes(pt) <= 700, 'bytes, not characters');
  assert.match(pt, /ação/);
  assert.ok(!pt.includes('�'), 'a cut never splits a letter');
  const six = Array.from({ length: 6 }, () => item({ severity: 'E' }));
  const f = pkg('general-six', six);
  assert.equal(bullets(practicesFocus({ practices: practicesOf(six.map((m) => row(m, f))), packages: [f], profile: PROFILE, part: WEB })), 4);
  assert.equal(bullets(practicesFocus({ practices: practicesOf(six.map((m) => row(m, f))), packages: [f], profile: PROFILE, part: WEB, limit: 2 })), 2);
  assert.equal(bullets(practicesFocus({ practices: practicesOf(six.map((m) => row(m, f))), packages: [f], profile: PROFILE, part: WEB, limit: 99 })), 4, 'a bigger limit never passes four');
});

test('the language of the map picks the text: pt and pt-BR give Portuguese, anything else English', () => {
  const pt = practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: WEB, lang: 'pt' });
  assert.match(pt, /Conferir quem pede/);
  assert.equal(pt, practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: WEB, lang: 'pt-BR' }));
  assert.match(practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: WEB, lang: 'fr' }), /Check who asks/);
});

test('the block holds nothing the transcript reader would count as an item code', () => {
  const coded = item({ severity: 'E', title: T('Reach level N2 with HTTP2 on'), what: T('see a1 and ab12') });
  const clean = item({ severity: 'R', title: T('A plain one') });
  const p = pkg('general-codes', [coded, clean]);
  const text = practicesFocus({ practices: practicesOf([row(coded, p), row(clean, p)]), packages: [p], profile: PROFILE, part: WEB });
  assert.deepEqual([...text.matchAll(CODE_TOKENS)].map((m) => m[1]), []);
  assert.match(text, /A plain one/);
  assert.ok(!/N2/.test(text));
  for (const lang of ['en', 'pt']) assert.deepEqual([...practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: WEB, lang }).matchAll(CODE_TOKENS)], []);
});

test('the same input gives the same text, byte for byte', () => {
  const run = () => practicesFocus({ practices: ALL, packages: PACKAGES, profile: PROFILE, part: WEB, lang: 'en' });
  assert.equal(run(), run());
});

test('focusInputs reads practices.json, the profile and the library; no practices.json means null', async () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-focus-'));
  try {
    assert.equal(focusInputs(smDir, 'p-1'), null, 'no practices.json yet');
    writeFd(smDir, 'p-1', 'practices.json', ALL);
    mkdirSync(join(smDir, 'knowledge'), { recursive: true });
    const inputs = focusInputs(smDir, 'p-1');
    assert.equal(inputs.practices.items.length, 4);
    assert.ok(inputs.packages.some((p) => p.id === 'stack-next'), 'the shared library of the repository');
    assert.ok('profile' in inputs);
  } finally {
    await rm(smDir, { recursive: true, force: true });
  }
});

// ---- inside a real chat start ----------------------------------------------------------------------------------------

function stateOf(root) {
  const part = { id: 'web', name: 'Web', file: 'docs/architecture/web.md', about: 'The site.', codePaths: ['apps/web/'], groups: [] };
  const state = { projects: [{ id: 'demo-abc123', name: 'demo', root, arch: { source: 'worktree', dir: 'docs/architecture', lang: 'en', layers: [], parts: [part] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  return state;
}

async function withHub(fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-focus-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-focus-sm-'));
  const hub = createChatHub({ smDir, dir: root, bin: FAKE });
  try { await fn({ hub, state: stateOf(root), smDir }); } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function firstReply(hub, state, body) {
  const res = await hub.start({ projectId: 'demo-abc123', text: 'Go', ...body }, state);
  assert.equal(res.status, 200);
  const events = await new Promise((resolve, reject) => {
    const seen = [];
    const timer = setTimeout(() => reject(new Error('timed out')), 8000);
    hub.subscribe(res.body.chatKey, { write(e) { seen.push(e); if (e.type === 'turn-end') { clearTimeout(timer); resolve(seen); } }, end() {} });
  });
  return events.filter((e) => e.type === 'text' && !e.data.partial).map((e) => e.data.text).join('\n');
}

test('a chat opened on a part of the map carries the practices of that subject in its first request', async () => {
  await withHub(async ({ hub, state, smDir }) => {
    // The hub reads the real shared library, so the real Next item is the one that gets named.
    writeFd(smDir, 'demo-abc123', 'profile.json', { version: 1, ...profile([stack('next', 'apps/web/package.json')]) });
    writeFd(smDir, 'demo-abc123', 'practices.json', practicesOf([{ id: 'next.actions-check-access', pkg: 'stack-next', front: 'security', ladder: 'N2', severity: 'E', state: 'fail', reason: null, evidence: [], attested: null }]));
    const reply = await firstReply(hub, state, { node: { kind: 'part', partId: 'web' } });
    assert.match(reply, /Check who is asking inside every Server Action/);
    assert.ok(reply.indexOf('Server Action') < reply.indexOf('session-map:architecture'), 'before the upkeep rule');
  });
});

test('with no practices.json a chat starts exactly as before', async () => {
  await withHub(async ({ hub, state }) => {
    const reply = await firstReply(hub, state, { node: { kind: 'part', partId: 'web' } });
    assert.ok(!/good practices|boas práticas/i.test(reply));
    assert.match(reply, /Part of the architecture: Web/);
  });
});
