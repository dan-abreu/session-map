// The Ideas screen (B5-T15, fd15). The pure functions are tested against the server's own rules (canMarkDone, stagesFor)
// and the --demo file; the view is drawn on a tiny element tree with the real api.js over a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canMarkDone, evaluateIdea, levelOf, newIdea } from '../server/foundation/ideas.mjs';
import { defaultStandard, stagesFor } from '../server/foundation/standard.mjs';
import { LANGS, translator } from '../server/web/i18n.js';
import { checkRows, createIdeasView, doneBlockers, ideaSummary, stageRows } from '../server/web/ideasview.js';

const DEMO = new URL('../demo/foundation/acme-shop-8324f1/', import.meta.url);
const demo = (name) => JSON.parse(readFileSync(new URL(name, DEMO), 'utf8'));
const PROJECT = { id: 'acme-shop-8324f1', name: 'Acme shop' };
const NOW = '2026-10-10T12:00:00.000Z';
const STD = defaultStandard();
const TEXTS = new Map(STD.map((c) => [c.id, c.text]));

// What the route answers for one idea (http/guide.mjs ideaView): checks with their text, stages, level, canDone.
function routed(idea, practices = []) {
  const inputs = { standard: STD, profile: null, practices, now: NOW };
  const ev = evaluateIdea(idea, inputs);
  return {
    ...ev,
    checks: ev.checks.map((c) => ({ ...c, text: TEXTS.get(c.id) ?? null })),
    stages: stagesFor({ size: ev.size, sensitive: ev.sensitive, profile: null }),
    level: levelOf(ev),
    canDone: canMarkDone(ev),
  };
}
const doc = (...ideas) => ({ version: 1, generatedAt: NOW, ideas });
const subscription = () => routed(newIdea('cobrar por assinatura', { now: NOW }));
const check = (over = {}) => ({ id: '03.x', stage: '03', severity: 'E', state: 'pass', reason: null, evidence: [], attest: null, text: 'A thing', ...over });
const withChecks = (checks, over = {}) => ({ id: 'idea:aaaaaaaa', text: 'x', size: 'small', sensitive: [], origin: { size: 'guessed', sensitive: 'guessed' }, status: 'open', doneAt: null, acceptedUnverified: [], checks, ...over });

// ----- the tiny element tree -----
const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const withClass = (n, cls) => walk(n).filter((x) => (x.attrs.class ?? '').split(/\s+/).includes(cls));
const buttons = (n) => walk(n).filter((x) => x.tag === 'button');
const settle = () => new Promise((r) => setTimeout(r, 0));

async function withFetch(routes, fn) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    const found = routes[`${init?.method} ${path}`];
    const answer = typeof found === 'function' ? found(init) : found;
    if (answer === 'network' || !answer) throw new TypeError('failed');
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  };
  try { await fn(calls); } finally { globalThis.fetch = saved; }
}

const ctxFor = (over = {}) => ({ h, icon, t: translator('en'), fmt: {}, state: () => ({}), project: () => PROJECT, tech: false, goTo() {}, openChat() {}, ...over });
const IDEAS_URL = `GET /api/foundation/${PROJECT.id}/ideas`;
const NEW_URL = `POST /api/foundation/${PROJECT.id}/idea`;
const ONE_URL = (id) => `POST /api/foundation/${PROJECT.id}/idea/${encodeURIComponent(id)}`;
const ok = (body) => ({ status: 200, body });

// ================= pure =================

test('doneBlockers says what the server says: canMarkDone, on the demo ideas and on hand-made ones', () => {
  const cases = [
    ...demo('ideas.json').ideas.map((i) => routed(i)),
    withChecks([check({ state: 'fail' }), check({ id: '03.y', state: 'unverified' })]),
    withChecks([check({ id: '03.y', state: 'unverified' })], { acceptedUnverified: ['03.y'] }),
    withChecks([check({ id: '03.y', state: 'unverified' })]),
    withChecks([check({ state: 'fail', severity: 'R' }), check({ id: '03.z', state: 'unverified', severity: 'A' })]),
    withChecks([check({ state: 'na' })]),
    withChecks([]),
  ];
  for (const idea of cases) assert.deepEqual(doneBlockers(idea), canMarkDone(idea));
});

test('doneBlockers does not break on a damaged idea', () => {
  for (const bad of [null, undefined, {}, { checks: 'x' }, { checks: [null, 3] }]) assert.deepEqual(doneBlockers(bad), { ok: true, failed: [], unverified: [] });
});

test('ideaSummary gives size, sensitive kinds, where they came from and the level', () => {
  const s = ideaSummary(subscription());
  assert.equal(s.size, 'large');
  assert.deepEqual(s.sensitive, ['money']);
  assert.equal(s.sizeFrom, 'guessed');
  assert.equal(s.provisional, true);
  assert.ok(s.counts.unverified > 0);
  assert.equal(s.counts.fail, 0);
  const owner = ideaSummary(withChecks([], { origin: { size: 'owner', sensitive: 'owner' } }));
  assert.equal(owner.sizeFrom, 'owner');
  assert.equal(ideaSummary(null), null);
});

test('stageRows splits the stages that apply from the hidden ones, each with its reason', () => {
  const { applied, hidden } = stageRows(subscription());
  assert.equal(applied.length + hidden.length, 14);
  assert.ok(applied.some((s) => s.stage === '12') && applied.some((s) => s.stage === '13'));
  for (const s of [...applied, ...hidden]) assert.ok(s.reason?.key?.startsWith('fdi.reason.'), s.stage);
  const small = stageRows(routed(newIdea('corrigir o texto do botão', { now: NOW })));
  assert.deepEqual(small.applied.map((s) => s.stage), ['03', '04', '06']);
  assert.ok(small.hidden.every((s) => s.reason.key === 'fdi.reason.outOfSize'));
  assert.deepEqual(stageRows({}), { applied: [], hidden: [] });
});

test('every reason the server can give has words in both languages', () => {
  const profile = { detected: { types: ['library'] }, owner: { money: 'personal' } };
  const reasons = [];
  for (const size of ['trivial', 'large']) for (const sensitive of [[], ['money', 'auth']]) reasons.push(...stagesFor({ size, sensitive, profile }).map((s) => s.reason));
  const rows = stageRows({ stages: reasons.map((r, i) => ({ stage: String(i), applies: true, reason: r })) }).applied;
  const keys = new Set(rows.map((s) => s.reason.key));
  assert.ok(keys.size >= 4);
  for (const lang of Object.keys(LANGS)) for (const k of keys) assert.ok(LANGS[lang][k], `${lang} ${k}`);
});

test('checkRows: by stage, essential first, an unknown state is "not verified", and "does not apply" is apart', () => {
  const rows = checkRows(withChecks([
    check({ id: '04.b', stage: '04', severity: 'A' }), check({ id: '03.b', severity: 'R' }), check({ id: '03.a', severity: 'E', state: 'weird' }),
    check({ id: '03.n', state: 'na', reason: 'not-applicable' }),
  ]));
  assert.deepEqual(rows.map((r) => r.id), ['03.a', '03.b', '03.n', '04.b']);
  assert.equal(rows[0].state, 'unverified');
  assert.equal(rows[0].title, 'A thing');
  assert.equal(rows[2].state, 'na');
  assert.deepEqual(checkRows(withChecks([])), []);
  assert.deepEqual(checkRows(null), []);
});

// ================= the view =================

test('the Ideas screen shows the box, and with no ideas file it says so without breaking', async () => {
  const view = createIdeasView(ctxFor());
  const root = h('div');
  await withFetch({ [IDEAS_URL]: ok(null) }, () => view.render(root));
  assert.equal(withClass(root, 'fdi-text').length, 1);
  assert.match(textOf(root), /No ideas yet/);
  assert.equal(withClass(root, 'fdi-idea').length, 0);
});

test('a failed read shows the error and a retry, and the box stays', async () => {
  const view = createIdeasView(ctxFor());
  const root = h('div');
  await withFetch({ [IDEAS_URL]: 'network' }, () => view.render(root));
  assert.ok(withClass(root, 'fdg-failed').length);
  assert.equal(withClass(root, 'fdi-text').length, 1);
  assert.ok(buttons(root).some((b) => /Try again/.test(textOf(b))));
});

test('typing an idea posts it and shows size and the sensitive kind, with the stages and the fixed notice', async () => {
  const view = createIdeasView(ctxFor());
  const root = h('div');
  const created = subscription();
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc()), [NEW_URL]: ok(created) }, async (c) => {
    calls = c;
    await view.render(root);
    withClass(root, 'fdi-text')[0].attrs.oninput({ target: { value: 'cobrar por assinatura' } });
    // from now on the read has the idea
    const prev = globalThis.fetch;
    globalThis.fetch = async (p, i) => (i?.method === 'GET' && p.endsWith('/ideas') ? { ok: true, status: 200, json: async () => doc(created) } : prev(p, i));
    withClass(root, 'fdi-add')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { text: 'cobrar por assinatura' });
  const card = withClass(root, 'fdi-idea')[0];
  assert.match(textOf(withClass(card, 'fdi-size')[0]), /Large/);
  assert.match(textOf(withClass(card, 'fdi-kind')[0]), /Money/);
  const names = withClass(card, 'fdi-stage').map(textOf).join(' | ');
  assert.match(names, /Legal/);
  assert.match(names, /Financial/);
  assert.match(textOf(card), /Guidance, not an opinion from a professional/);
});

test('an empty box posts nothing', async () => {
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc()) }, async (c) => {
    calls = c;
    await view.render(root);
    withClass(root, 'fdi-add')[0].attrs.onclick();
    await settle();
  });
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('the hidden stages show why they are hidden', async () => {
  const view = createIdeasView(ctxFor());
  const root = h('div');
  await withFetch({ [IDEAS_URL]: ok(doc(routed(newIdea('corrigir o texto do botão', { now: NOW })))) }, () => view.render(root));
  const hidden = withClass(root, 'fdi-hidden-stage');
  assert.equal(hidden.length, 11);
  assert.match(textOf(hidden[0]), /size/i);
  assert.equal(withClass(root, 'fdi-stage').length, 3);
});

test('each check has one of the four seals, the evidence or the reason, and Attest only when unverified', async () => {
  const idea = withChecks([
    check({ id: '03.p', state: 'pass', evidence: [{ file: 'README.md', line: 4 }] }),
    check({ id: '03.f', state: 'fail', evidence: [] }),
    check({ id: '03.u', state: 'unverified', reason: 'needs-human' }),
    check({ id: '03.n', state: 'na', reason: 'not-applicable' }),
  ]);
  const view = createIdeasView(ctxFor());
  const root = h('div');
  await withFetch({ [IDEAS_URL]: ok(doc(idea)) }, () => view.render(root));
  const rows = withClass(root, 'fdi-check');
  assert.equal(rows.length, 4);
  const by = (id) => rows.find((r) => r.attrs['data-check'] === id);
  assert.match(textOf(by('03.p')), /README\.md:4/);
  assert.match(textOf(by('03.u')), /person/i);
  assert.equal(withClass(by('03.u'), 'fdi-attest-btn').length, 1);
  for (const id of ['03.p', '03.f', '03.n']) assert.equal(withClass(by(id), 'fdi-attest-btn').length, 0, id);
  assert.match(textOf(by('03.n')), /Does not apply/);
});

test('Attest posts the check, the note and the days', async () => {
  const idea = withChecks([check({ id: '03.u', state: 'unverified', reason: 'needs-human' })]);
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc(idea)), [ONE_URL(idea.id)]: ok(idea) }, async (c) => {
    calls = c;
    await view.render(root);
    withClass(root, 'fdi-attest-btn')[0].attrs.onclick();
    withClass(root, 'fdi-note-input')[0].attrs.oninput({ target: { value: 'Ana checked it' } });
    withClass(root, 'fdi-save')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { action: 'attest', checkId: '03.u', note: 'Ana checked it', days: 90 });
});

test('"Mark as ready" is off while an essential check fails', async () => {
  const idea = withChecks([check({ state: 'fail' })]);
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc(idea)) }, async (c) => {
    calls = c;
    await view.render(root);
    const done = withClass(root, 'fdi-done')[0];
    assert.equal(done.attrs.disabled, true);
    assert.match(textOf(withClass(root, 'fdi-blocked')[0]), /1/);
    done.attrs.onclick?.();
    await settle();
  });
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('with only "not verified" left it asks for an explicit yes ("stays provisional") before it posts', async () => {
  const idea = withChecks([check({ id: '03.u', state: 'unverified', reason: 'needs-human' }), check({ id: '03.ok', state: 'pass' })]);
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc(idea)), [ONE_URL(idea.id)]: ok({ ...idea, status: 'done' }) }, async (c) => {
    calls = c;
    await view.render(root);
    const done = withClass(root, 'fdi-done')[0];
    assert.ok(!done.attrs.disabled);
    done.attrs.onclick();
    assert.equal(calls.filter((x) => x.method === 'POST').length, 0, 'the first click only asks');
    assert.match(textOf(withClass(root, 'fdi-confirm')[0]), /provisional/i);
    withClass(root, 'fdi-confirm-no')[0].attrs.onclick();
    assert.equal(withClass(root, 'fdi-confirm').length, 0);
    withClass(root, 'fdi-done')[0].attrs.onclick();
    withClass(root, 'fdi-confirm-yes')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { action: 'done', acceptUnverified: true });
});

test('with nothing pending it marks ready straight away, without the confirmation', async () => {
  const idea = withChecks([check({ state: 'pass' })]);
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc(idea)), [ONE_URL(idea.id)]: ok({ ...idea, status: 'done' }) }, async (c) => {
    calls = c;
    await view.render(root);
    withClass(root, 'fdi-done')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { action: 'done' });
});

test('a ready idea offers to reopen it', async () => {
  const idea = { ...withChecks([check()]), status: 'done', doneAt: NOW };
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc(idea)), [ONE_URL(idea.id)]: ok({ ...idea, status: 'open' }) }, async (c) => {
    calls = c;
    await view.render(root);
    assert.equal(withClass(root, 'fdi-done').length, 0);
    withClass(root, 'fdi-reopen')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { action: 'reopen' });
});

test('"Change" lets the person set the size and the kinds, and posts a resize', async () => {
  const idea = subscription();
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc(idea)), [ONE_URL(idea.id)]: ok(idea) }, async (c) => {
    calls = c;
    await view.render(root);
    withClass(root, 'fdi-change')[0].attrs.onclick();
    withClass(root, 'fdi-size-select')[0].attrs.onchange({ target: { value: 'medium' } });
    const boxes = withClass(root, 'fdi-kind-box');
    assert.equal(boxes.length, 7);
    boxes.find((b) => b.attrs['data-kind'] === 'auth').attrs.onchange({ target: { checked: true } });
    withClass(root, 'fdi-resize-save')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { action: 'resize', size: 'medium', sensitive: ['auth', 'money'] });
});

test('an idea with no applicable check does not break the screen', async () => {
  const view = createIdeasView(ctxFor());
  const root = h('div');
  const bare = { id: 'idea:bbbbbbbb', text: 'only words', size: 'small', sensitive: [], status: 'open', checks: [] };
  await withFetch({ [IDEAS_URL]: ok(doc(bare)) }, () => view.render(root));
  assert.equal(withClass(root, 'fdi-idea').length, 1);
  assert.match(textOf(root), /No checks apply/);
  assert.ok(!withClass(root, 'fdi-done')[0].attrs.disabled);
});

test('a server refusal on a write is shown in words', async () => {
  const idea = withChecks([check({ state: 'pass' })]);
  const view = createIdeasView(ctxFor());
  const root = h('div');
  await withFetch({ [IDEAS_URL]: ok(doc(idea)), [ONE_URL(idea.id)]: { status: 409, body: { error: 'essential-failed' } } }, async () => {
    await view.render(root);
    withClass(root, 'fdi-done')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.match(textOf(withClass(root, 'fdg-error')[0]), /essential|ready/i);
});

test('the poll does not wipe what is being typed, and a second render does not duplicate', async () => {
  const view = createIdeasView(ctxFor());
  const root = h('div');
  let calls;
  await withFetch({ [IDEAS_URL]: ok(doc()), [NEW_URL]: ok(subscription()) }, async (c) => {
    calls = c;
    await view.render(root);
    withClass(root, 'fdi-text')[0].attrs.oninput({ target: { value: 'half an idea' } });
    await view.refresh(root);
    await view.refresh(root);
    assert.equal(withClass(root, 'fdi-box').length, 1);
    withClass(root, 'fdi-add')[0].attrs.onclick();
    await settle(); await settle();
  });
  assert.deepEqual(calls.find((x) => x.method === 'POST').body, { text: 'half an idea' });
});

test('it works in Portuguese too, with the text of the standard as written', async () => {
  const view = createIdeasView(ctxFor({ t: translator('pt-BR') }));
  const root = h('div');
  await withFetch({ [IDEAS_URL]: ok(doc(subscription())) }, () => view.render(root));
  assert.match(textOf(withClass(root, 'fdi-size')[0]), /Grande/);
  assert.match(textOf(withClass(root, 'fdi-kind')[0]), /Dinheiro/);
});

test('the demo ideas draw without error in both languages', async () => {
  for (const lang of ['en', 'pt-BR']) {
    const view = createIdeasView(ctxFor({ t: translator(lang) }));
    const root = h('div');
    await withFetch({ [IDEAS_URL]: ok(doc(...demo('ideas.json').ideas)) }, () => view.render(root));
    assert.equal(withClass(root, 'fdi-idea').length, 2);
  }
});
