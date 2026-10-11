// The Route screen and the Profile card (B5-T13, fd rota + perfil). The pure functions are tested on the --demo files; the
// two views are drawn on a tiny element tree, with the real api.js over a fake fetch, so no browser is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary, sharedKnowledgeDir } from '../server/foundation/library.mjs';
import { effectiveProfile, questionsFor } from '../server/foundation/profile.mjs';
import { LANGS, translator } from '../server/web/i18n.js';
import { createCompassView, frontRows, nextCards, stageStrip } from '../server/web/compassview.js';
import { createProfileView, profileRows, questionsOf } from '../server/web/profileview.js';
import guide from '../server/web/i18n-fd/guide.js';

const DEMO = new URL('../demo/foundation/acme-shop-8324f1/', import.meta.url);
const demo = (name) => JSON.parse(readFileSync(new URL(name, DEMO), 'utf8'));
const PROJECT = { id: 'acme-shop-8324f1', name: 'Acme shop' };

// The route joins the texts of the library by id (http/guide.mjs); the test does the same joining so the cards are real.
const { packages } = loadLibrary({ sharedDir: sharedKnowledgeDir(), localDir: null });
const defs = new Map(packages.flatMap((p) => p.items.map((i) => [i.id, i])));
const TEXT_KEYS = ['title', 'what', 'why', 'how', 'doneWhen'];
function routed(compass = demo('compass.json')) {
  return {
    ...compass,
    next3: compass.next3.map((n) => ({ ...n, text: Object.fromEntries(TEXT_KEYS.map((k) => [k, defs.get(n.itemId)?.[k] ?? null])) })),
    notices: [],
  };
}
const profileAnswer = (p = demo('profile.json')) => ({ ...p, effective: effectiveProfile(p.detected, p.owner), questions: questionsFor(p) });

// ----- the tiny element tree -----
const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); } });
const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const withClass = (n, cls) => walk(n).filter((x) => (x.attrs.class ?? '').split(/\s+/).includes(cls));
const buttons = (n) => walk(n).filter((x) => x.tag === 'button');
const buttonWith = (n, word) => buttons(n).find((b) => textOf(b).includes(word));
const settle = () => new Promise((r) => setTimeout(r, 0));

// A fake fetch that answers by path; a handler may be an object { status, body } or a function of the request.
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

const ctxFor = (over = {}) => {
  const calls = { chat: [], go: [] };
  const ctx = {
    h, icon, t: translator('en'), fmt: { relative: (iso) => iso }, state: () => ({}), project: () => PROJECT, tech: false,
    goTo: (area, sub) => calls.go.push([area, sub]), openChat: (req) => calls.chat.push(req), ...over,
  };
  return { ctx, calls };
};

const COMPASS_URL = `GET /api/foundation/${PROJECT.id}/compass`;
const PROFILE_URL = `GET /api/foundation/${PROJECT.id}/profile`;
const PUT_PROFILE = `PUT /api/foundation/${PROJECT.id}/profile`;

// ================= pure: stageStrip =================

test('stageStrip marks past stages done, the current one, and the rest next', () => {
  const strip = stageStrip(demo('compass.json'));
  assert.deepEqual(strip.map((s) => s.key), ['idea', 'prototype', 'first-client', 'growth', 'company']);
  assert.deepEqual(strip.map((s) => s.status), ['done', 'current', 'next', 'next', 'next']);
  const now = strip.find((s) => s.current);
  assert.deepEqual([now.key, now.origin, now.reason], ['prototype', 'guessed', 'level-below-n2']);
  assert.equal(strip.filter((s) => s.origin).length, 1, 'only the current stage says where it came from');
});

test('stageStrip: the owner answer is shown as the owner, and a stage nobody knows marks none', () => {
  const owner = demo('compass.json');
  owner.stage = { key: 'growth', origin: 'owner', reason: 'owner' };
  const strip = stageStrip(owner);
  assert.equal(strip.find((s) => s.current).origin, 'owner');
  const odd = demo('compass.json');
  odd.stage = { key: 'galaxy', origin: 'guessed', reason: 'x' };
  assert.equal(stageStrip(odd).some((s) => s.current), false, 'never an invented place');
  assert.deepEqual(stageStrip(null), []);
  assert.deepEqual(stageStrip({}), [], 'a file with no stages draws no strip');
});

// ================= pure: frontRows =================

test('frontRows keeps the order, the counts and a seal; "ok" is shown as in place and unknown as not verified', () => {
  const rows = frontRows(demo('compass.json'));
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], { front: 'organization', state: 'warning', mark: 'warning', pass: 1, fail: 1, unverified: 15, total: 17 });
  const mixed = { fronts: [{ front: 'quality', state: 'ok', pass: 4, fail: 0, unverified: 0 }, { front: 'legal', state: 'na', pass: 0, fail: 0, unverified: 0 }, { front: 'finance', state: 'made-up', pass: 1, fail: 0, unverified: 0 }] };
  const m = frontRows(mixed);
  assert.deepEqual(m.map((r) => r.mark), ['pass', 'na', 'unverified']);
  assert.equal(m[1].total, 0);
  assert.deepEqual(frontRows(null), []);
});

// ================= pure: nextCards =================

test('nextCards: three cards with the title, why, how, done-when in the language asked', () => {
  const cards = nextCards(routed(), 'en');
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.itemId), ['org.gitignore', 'org.readme', 'qual.lockfile']);
  assert.match(cards[0].title, /gitignore/i);
  assert.ok(cards[0].why && cards[0].how && cards[0].doneWhen);
  const pt = nextCards(routed(), 'pt-BR');
  assert.notEqual(pt[0].title, cards[0].title);
  assert.match(pt[0].ask.text, /^Me ajude/);
  assert.match(cards[0].ask.text, /^Help me/);
  assert.equal(cards[0].role, 'technology');
  assert.deepEqual(cards[0].skills, ['session-map:architecture']);
});

test('nextCards: a card with no text from the route still shows, with its id as the title; the example is only the project\'s own', () => {
  const raw = nextCards(demo('compass.json'), 'en');
  assert.equal(raw[0].title, 'org.gitignore');
  assert.equal(raw[0].why, null);
  assert.equal(raw[0].example, null);
  const withEx = routed();
  withEx.next3[0].text.example = { en: 'Your route GET /orders has no check.', 'pt-BR': 'A sua rota GET /orders não tem checagem.' };
  assert.equal(nextCards(withEx, 'en')[0].example, 'Your route GET /orders has no check.');
  assert.equal(nextCards(withEx, 'pt-BR')[0].example, 'A sua rota GET /orders não tem checagem.');
  assert.equal(nextCards(withEx, 'en')[1].example, null);
});

test('nextCards: a missing language falls back to English; junk is dropped; no data gives no cards', () => {
  const c = routed();
  delete c.next3[0].text.title['pt-BR'];
  assert.equal(nextCards(c, 'pt-BR')[0].title, c.next3[0].text.title.en);
  const junk = { next3: [null, 7, { itemId: '' }, { itemId: 'a.b', front: 'quality', ask: { text: 5 } }] };
  const cards = nextCards(junk, 'en');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].ask, null, 'an ask with no text cannot open a chat');
  assert.deepEqual(nextCards(null, 'en'), []);
});

// ================= pure: profileRows / questionsOf =================

test('profileRows: every detected item comes with the file and line it came from', () => {
  const rows = profileRows(profileAnswer());
  const bull = rows.detected.find((r) => r.name === 'bullmq');
  assert.deepEqual([bull.group, bull.version, bull.evidence], ['stacks', '5.0.0', [{ file: 'apps/worker/package.json', line: 6 }]]);
  const pay = rows.detected.find((r) => r.group === 'signals' && r.name === 'payments');
  assert.deepEqual(pay.evidence.map((e) => `${e.file}:${e.line}`), ['packages/adapters/package.json:6', 'packages/adapters/src/payments.ts:1']);
  assert.deepEqual(rows.detected.filter((r) => r.group === 'types').map((r) => r.name), ['web', 'api']);
  assert.ok(rows.detected.filter((r) => r.group === 'types').every((r) => r.evidence.length === 0));
  const team = rows.detected.find((r) => r.group === 'team');
  assert.deepEqual([team.name, team.authors], ['solo', 1]);
});

test('profileRows: what the owner said wins and is marked as the owner\'s', () => {
  const p = profileAnswer();
  p.owner = { ...p.owner, types: ['mobile'], team: 'team' };
  const rows = profileRows(p);
  assert.deepEqual(rows.detected.filter((r) => r.group === 'types').map((r) => [r.name, r.overridden]), [['mobile', true]]);
  const team = rows.detected.find((r) => r.group === 'team');
  assert.deepEqual([team.name, team.overridden], ['team', true]);
});

test('profileRows: answers list the owner\'s values; nothing yet read gives null, not zero', () => {
  const rows = profileRows(profileAnswer());
  const byKey = Object.fromEntries(rows.answers.map((a) => [a.key, a]));
  assert.equal(byKey.country.value, 'BR');
  assert.equal(byKey.money.value, 'subscription');
  assert.equal(byKey.stage.answered, false);
  assert.equal(byKey.audience.kind, 'multi');
  assert.equal(byKey.country.kind, 'text');
  assert.equal(byKey.stage.kind, 'single');
  assert.equal(profileRows(null), null);
  assert.deepEqual(profileRows({ detected: null, owner: {}, questions: [] }).detected, [], 'a profile with no detection yet has no rows');
});

test('questionsOf: the open questions come from the server and keep the closed options', () => {
  const qs = questionsOf(profileAnswer());
  assert.deepEqual(qs.map((q) => q.key), ['audience', 'stage']);
  assert.deepEqual(qs.find((q) => q.key === 'stage').options, ['idea', 'prototype', 'first-client', 'growth', 'company']);
  assert.equal(qs.find((q) => q.key === 'audience').kind, 'multi');
  const odd = questionsOf({ questions: [{ key: 'shoe-size', options: null }, { key: 'country', options: null }, 'x', null] });
  assert.deepEqual(odd.map((q) => q.key), ['country'], 'a question this screen cannot show is left out');
  assert.deepEqual(questionsOf(null), []);
});

// ================= Route view =================

test('the Route draws the five stages with "you are here", where it came from, and three actions', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({ [COMPASS_URL]: { status: 200, body: routed() } }, async () => {
    const done = view.render(root);
    assert.match(textOf(root), /Reading the route/);
    await done;
  });
  const strip = withClass(root, 'fdg-stage');
  assert.equal(strip.length, 5);
  const here = strip.filter((s) => s.attrs['aria-current'] === 'step');
  assert.equal(here.length, 1);
  assert.match(textOf(here[0]), /Prototype/);
  assert.match(textOf(root), /guessed/i);
  assert.equal(withClass(root, 'fdg-card').length, 3);
  const first = withClass(root, 'fdg-card')[0];
  assert.match(textOf(first), /gitignore/i);
  assert.match(textOf(first), /Why/);
  assert.match(textOf(first), /Done when/);
  assert.equal(withClass(root, 'fdg-fronts').length, 0, 'the areas with counts are for the full mode');
});

test('"Ask for help" opens the chat on the project with the ask in English, or in Portuguese when the page is', async () => {
  for (const lang of ['en', 'pt-BR']) {
    const { ctx, calls } = ctxFor({ t: translator(lang) });
    const view = createCompassView(ctx);
    const root = h('div');
    await withFetch({ [COMPASS_URL]: { status: 200, body: routed() } }, () => view.render(root));
    const help = buttons(withClass(root, 'fdg-card')[1]).find((b) => (b.attrs.class ?? '').includes('fdg-help'));
    help.attrs.onclick();
    assert.equal(calls.chat.length, 1);
    assert.deepEqual(calls.chat[0].node, { kind: 'project' });
    assert.match(calls.chat[0].text, lang === 'en' ? /^Help me with this best practice/ : /^Me ajude com esta boa prática/);
    assert.match(calls.chat[0].text, /readme/i);
  }
});

test('with no openChat the help button is not drawn (nothing that does nothing)', async () => {
  const { ctx } = ctxFor({ openChat: undefined });
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({ [COMPASS_URL]: { status: 200, body: routed() } }, () => view.render(root));
  assert.equal(walk(root).filter((n) => (n.attrs.class ?? '').includes('fdg-help')).length, 0);
});

test('in the full mode the areas show with their counts', async () => {
  const { ctx } = ctxFor({ tech: () => true });
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({ [COMPASS_URL]: { status: 200, body: routed() } }, () => view.render(root));
  const rows = withClass(root, 'fdg-front');
  assert.equal(rows.length, 8);
  assert.match(textOf(rows[0]), /Organization/);
  assert.match(textOf(rows[0]), /1 in place/);
  assert.match(textOf(rows[0]), /15 not verified/);
});

test('"Not this one" opens the question; choosing a stage writes the owner\'s answer and redraws', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  const after = routed();
  after.stage = { key: 'growth', origin: 'owner', reason: 'owner' };
  let saved = false;
  await withFetch({
    [COMPASS_URL]: () => ({ status: 200, body: saved ? after : routed() }),
    [PUT_PROFILE]: () => { saved = true; return { status: 200, body: {} }; },
  }, async (calls) => {
    await view.render(root);
    assert.equal(withClass(root, 'fdg-pick').length, 0);
    buttonWith(root, 'Not this one').attrs.onclick();
    assert.equal(withClass(root, 'fdg-pick').length, 1);
    const radios = walk(root).filter((n) => n.tag === 'input' && n.attrs.type === 'radio');
    assert.deepEqual(radios.map((r) => r.attrs.value), ['idea', 'prototype', 'first-client', 'growth', 'company']);
    radios.find((r) => r.attrs.value === 'growth').attrs.onchange({ target: { value: 'growth' } });
    await buttonWith(root, 'Save').attrs.onclick();
    await settle();
    const put = calls.find((c) => c.method === 'PUT');
    assert.deepEqual(put.body, { owner: { stage: 'growth' } });
    assert.equal(withClass(root, 'fdg-pick').length, 0);
    assert.match(textOf(withClass(root, 'fdg-stage').find((s) => s.attrs['aria-current'] === 'step')), /Growth/);
    assert.match(textOf(root), /You chose/);
  });
});

test('when the owner chose the stage, "Back to the program\'s guess" clears it', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  const owned = routed();
  owned.stage = { key: 'growth', origin: 'owner', reason: 'owner' };
  await withFetch({
    [COMPASS_URL]: { status: 200, body: owned },
    [PUT_PROFILE]: { status: 200, body: {} },
  }, async (calls) => {
    await view.render(root);
    buttonWith(root, 'Not this one').attrs.onclick();
    await buttonWith(root, "program's guess").attrs.onclick();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { owner: { stage: null } });
  });
});

test('a refused answer shows the problem in words and keeps the question open', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({
    [COMPASS_URL]: { status: 200, body: routed() },
    [PUT_PROFILE]: { status: 400, body: { ok: false, error: 'bad-owner' } },
  }, async () => {
    await view.render(root);
    buttonWith(root, 'Not this one').attrs.onclick();
    walk(root).find((n) => n.tag === 'input' && n.attrs.value === 'company').attrs.onchange({ target: { value: 'company' } });
    await buttonWith(root, 'Save').attrs.onclick();
    assert.match(textOf(withClass(root, 'fdg-pick')[0]), /not valid/i);
  });
});

test('a network error is a state with words and a retry, not an empty screen', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({ [COMPASS_URL]: 'network' }, () => view.render(root));
  assert.ok(textOf(root).length > 20);
  assert.match(textOf(root), new RegExp(LANGS.en['err.network'].slice(0, 12)));
  assert.equal(withClass(root, 'fdg-card').length, 0);
  await withFetch({ [COMPASS_URL]: { status: 200, body: routed() } }, async () => {
    await buttonWith(root, 'Try again').attrs.onclick();
  });
  assert.equal(withClass(root, 'fdg-card').length, 3);
});

test('not read yet (null) says so, with no zero and no strip', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({ [COMPASS_URL]: { status: 200, body: null } }, () => view.render(root));
  assert.match(textOf(root), /not read yet/i);
  assert.equal(withClass(root, 'fdg-stage').length, 0);
  assert.equal(withClass(root, 'fdg-card').length, 0);
});

test('the fixed notice "guidance, not an opinion" shows only when the route brings legal or finance', async () => {
  const plain = routed();
  const withLegal = routed();
  withLegal.next3[2] = { ...withLegal.next3[2], front: 'legal' };
  for (const [body, expected] of [[plain, 0], [withLegal, 1]]) {
    const { ctx } = ctxFor();
    const view = createCompassView(ctx);
    const root = h('div');
    await withFetch({ [COMPASS_URL]: { status: 200, body } }, () => view.render(root));
    assert.equal(withClass(root, 'fdg-notice').length, expected);
  }
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({ [COMPASS_URL]: { status: 200, body: { ...routed(), notices: [{ pkg: 'legal-lgpd-br', text: { en: 'Not legal advice.', 'pt-BR': 'Não é parecer.' } }] } } }, () => view.render(root));
  assert.match(textOf(withClass(root, 'fdg-notice')[0]), /Not legal advice/);
});

test('refresh reloads the route in place', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  let n = 0;
  await withFetch({ [COMPASS_URL]: () => { n += 1; return { status: 200, body: routed() }; } }, async () => {
    await view.render(root);
    await view.refresh(root);
  });
  assert.equal(n, 2);
  assert.equal(withClass(root, 'fdg-card').length, 3);
});

// ================= Profile view =================

test('the Profile card lists what was found, each with where it came from, and the open questions', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() } }, () => view.render(root));
  const text = textOf(root);
  assert.match(text, /bullmq/);
  assert.match(text, /apps\/worker\/package\.json:6/);
  assert.match(text, /packages\/adapters\/src\/payments\.ts:1/);
  assert.match(text, /Where it came from/i);
  const open = withClass(root, 'fdg-question');
  assert.deepEqual(open.map((q) => q.attrs['data-key']), ['audience', 'stage']);
  const answered = withClass(root, 'fdg-answer').map((a) => a.attrs['data-key']);
  assert.ok(answered.includes('country') && answered.includes('money'));
});

test('answering a single-choice question writes only that key', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  const body = profileAnswer();
  await withFetch({ [PROFILE_URL]: { status: 200, body }, [PUT_PROFILE]: { status: 200, body: profileAnswer({ ...demo('profile.json'), owner: { ...demo('profile.json').owner, stage: 'growth' } }) } }, async (calls) => {
    await view.render(root);
    const q = withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'stage');
    walk(q).find((n) => n.tag === 'input' && n.attrs.value === 'growth').attrs.onchange({ target: { value: 'growth' } });
    await buttons(q).find((b) => textOf(b).includes('Save')).attrs.onclick();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { owner: { stage: 'growth' } });
    assert.deepEqual(withClass(root, 'fdg-question').map((n) => n.attrs['data-key']), ['audience'], 'the answered question leaves the open list');
  });
});

test('a multiple-choice question sends the list, and an empty choice cannot be saved', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() }, [PUT_PROFILE]: { status: 200, body: profileAnswer() } }, async (calls) => {
    await view.render(root);
    const q = withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'audience');
    const save = buttons(q).find((b) => textOf(b).includes('Save'));
    assert.equal(save.attrs.disabled, true);
    const boxes = walk(q).filter((n) => n.tag === 'input' && n.attrs.type === 'checkbox');
    boxes.find((b) => b.attrs.value === 'kids').attrs.onchange({ target: { value: 'kids', checked: true } });
    boxes.find((b) => b.attrs.value === 'health').attrs.onchange({ target: { value: 'health', checked: true } });
    await buttons(withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'audience')).find((b) => textOf(b).includes('Save')).attrs.onclick();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { owner: { audience: ['kids', 'health'] } });
  });
});

test('a country is typed as two letters and sent in capitals; "Change" opens an answered one', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() }, [PUT_PROFILE]: { status: 200, body: profileAnswer() } }, async (calls) => {
    await view.render(root);
    const row = withClass(root, 'fdg-answer').find((n) => n.attrs['data-key'] === 'country');
    assert.match(textOf(row), /BR/);
    buttons(row).find((b) => textOf(b).includes('Change')).attrs.onclick();
    const edit = withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'country');
    const input = walk(edit).find((n) => n.tag === 'input' && n.attrs.type === 'text');
    assert.equal(input.attrs.maxlength, 2);
    input.attrs.oninput({ target: { value: 'us' } });
    await buttons(edit).find((b) => textOf(b).includes('Save')).attrs.onclick();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { owner: { country: 'US' } });
  });
});

test('a refused profile answer shows the problem in words; the demo write refusal too', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() }, [PUT_PROFILE]: { status: 403, body: { ok: false, error: 'demo' } } }, async () => {
    await view.render(root);
    const q = withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'stage');
    walk(q).find((n) => n.tag === 'input' && n.attrs.value === 'idea').attrs.onchange({ target: { value: 'idea' } });
    await buttons(q).find((b) => textOf(b).includes('Save')).attrs.onclick();
    const err = textOf(withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'stage'));
    assert.match(err, new RegExp(LANGS.en['err.demo'].slice(0, 10)));
  });
});

test('profile: not read yet and network errors are states with words', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: null } }, () => view.render(root));
  assert.match(textOf(root), /not read yet/i);
  assert.equal(withClass(root, 'fdg-question').length, 0);
  await withFetch({ [PROFILE_URL]: 'network' }, () => view.refresh(root));
  assert.match(textOf(root), new RegExp(LANGS.en['err.network'].slice(0, 12)));
  assert.ok(buttonWith(root, 'Try again'));
});

test('an unfinished detection (null detected) still shows the questions', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  const bare = profileAnswer({ version: 1, detected: null, owner: { country: null, laws: [], money: null, audience: [], stage: null, types: [], team: null }, askedAt: null });
  await withFetch({ [PROFILE_URL]: { status: 200, body: bare } }, () => view.render(root));
  assert.ok(withClass(root, 'fdg-question').length >= 4);
  assert.match(textOf(root), /Nothing found/i);
});

// ================= texts =================

test('every text the two screens ask for exists in English and Portuguese, with the same blanks', () => {
  const keys = new Set();
  const stages = ['idea', 'prototype', 'first-client', 'growth', 'company'];
  const reasons = ['owner', 'few-files', 'no-data', 'level-below-n2', 'level-n2', 'level-n3', 'level-n4', 'unknown'];
  const fronts = ['organization', 'quality', 'security', 'operation', 'legal', 'product', 'marketing', 'finance'];
  const opts = {
    money: ['subscription', 'sale', 'ads', 'marketplace', 'free', 'personal'], audience: ['kids', 'health', 'business', 'general'],
    team: ['solo', 'team'], type: ['web', 'api', 'mobile', 'library', 'cli', 'game', 'data'],
    signal: ['personal-data', 'payments', 'login', 'uploads', 'location'],
  };
  stages.forEach((s) => keys.add(`rota.stage.${s}`));
  reasons.forEach((r) => keys.add(`rota.reason.${r}`));
  fronts.forEach((f) => keys.add(`rota.front.${f}`));
  for (const [group, list] of Object.entries(opts)) list.forEach((o) => keys.add(`profile.${group}.${o}`));
  ['country', 'money', 'audience', 'stage', 'team', 'laws', 'types'].forEach((k) => { keys.add(`profile.q.${k}`); });
  ['types', 'stacks', 'signals', 'team', 'deploy'].forEach((g) => { keys.add(`profile.group.${g}`); keys.add(`profile.from.${g}`); });
  keys.add('err.bad-owner');
  assert.deepEqual([...keys].filter((k) => !(k in LANGS.en) || !(k in LANGS['pt-BR'])), []);
  assert.deepEqual(Object.keys(guide.en).sort(), Object.keys(guide['pt-BR']).sort());
  for (const lang of ['en', 'pt-BR']) assert.ok(LANGS[lang]['rota.lang'], lang);
  assert.equal(LANGS.en['rota.lang'], 'en');
  assert.equal(LANGS['pt-BR']['rota.lang'], 'pt-BR');
});

// ================= more behavior found by changing the code on purpose =================

test('a poll (refresh) does not close or wipe an open question', async () => {
  const { ctx } = ctxFor();
  const view = createCompassView(ctx);
  const root = h('div');
  await withFetch({ [COMPASS_URL]: { status: 200, body: routed() } }, async (calls) => {
    await view.render(root);
    buttonWith(root, 'Not this one').attrs.onclick();
    await view.refresh(root);
    assert.equal(calls.length, 1, 'no new read while the question is open');
    assert.equal(withClass(root, 'fdg-pick').length, 1);
  });
});

test('a multiple choice is sent in the order of the closed list, whatever order it was ticked', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() }, [PUT_PROFILE]: { status: 200, body: profileAnswer() } }, async (calls) => {
    await view.render(root);
    const q = withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'audience');
    const boxes = walk(q).filter((n) => n.tag === 'input' && n.attrs.type === 'checkbox');
    boxes.find((b) => b.attrs.value === 'health').attrs.onchange({ target: { value: 'health', checked: true } });
    boxes.find((b) => b.attrs.value === 'kids').attrs.onchange({ target: { value: 'kids', checked: true } });
    await buttons(q).find((b) => textOf(b).includes('Save')).attrs.onclick();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { owner: { audience: ['kids', 'health'] } });
  });
});

test('"Clear answer" sends null for that key only', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() }, [PUT_PROFILE]: { status: 200, body: profileAnswer() } }, async (calls) => {
    await view.render(root);
    const row = withClass(root, 'fdg-answer').find((n) => n.attrs['data-key'] === 'money');
    buttons(row).find((b) => textOf(b).includes('Change')).attrs.onclick();
    const edit = withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'money');
    await buttons(edit).find((b) => textOf(b).includes('Clear')).attrs.onclick();
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { owner: { money: null } });
  });
});

test('the kind of project and the team can always be corrected, even with no answer yet', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() } }, () => view.render(root));
  const rows = withClass(root, 'fdg-answer');
  const keys = rows.map((n) => n.attrs['data-key']);
  assert.ok(keys.includes('types') && keys.includes('team'));
  assert.ok(!keys.includes('laws'), 'a law nobody asked for is not offered');
  assert.match(textOf(rows.find((n) => n.attrs['data-key'] === 'types')), /Using what was found/);
});

test('a poll does not wipe a typed profile answer, but reloads when nothing was touched', async () => {
  const { ctx } = ctxFor();
  const view = createProfileView(ctx);
  const root = h('div');
  await withFetch({ [PROFILE_URL]: { status: 200, body: profileAnswer() } }, async (calls) => {
    await view.render(root);
    await view.refresh(root);
    assert.equal(calls.length, 2, 'untouched: the poll reads again');
    const q = withClass(root, 'fdg-question').find((n) => n.attrs['data-key'] === 'stage');
    walk(q).find((n) => n.tag === 'input' && n.attrs.value === 'idea').attrs.onchange({ target: { value: 'idea' } });
    await view.refresh(root);
    assert.equal(calls.length, 2, 'touched: the poll leaves it alone');
  });
});
