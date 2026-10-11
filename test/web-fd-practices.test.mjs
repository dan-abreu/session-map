// The Good practices screen and the Library screen (B5-T14, fd boas-praticas + biblioteca). The pure functions are tested on
// the --demo files joined with the real library, the way the route joins them; the two views are drawn on a tiny element
// tree with the real api.js over a fake fetch, so no browser is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gapsOf, loadLibrary, selectFor, sharedKnowledgeDir, staleOf, statusOf } from '../server/foundation/library.mjs';
import { effectiveProfile } from '../server/foundation/profile.mjs';
import { LANGS, translator } from '../server/web/i18n.js';
import { askText, createPracticesView, filterByState, groupByFront, ladderHeader, practiceRows, reasonKey } from '../server/web/practicesview.js';
import { createLibraryView, libraryRows } from '../server/web/libraryview.js';

const DEMO = new URL('../demo/foundation/acme-shop-8324f1/', import.meta.url);
const demo = (name) => JSON.parse(readFileSync(new URL(name, DEMO), 'utf8'));
const PROJECT = { id: 'acme-shop-8324f1', name: 'Acme shop' };
const TODAY = new Date('2026-10-10T12:00:00Z');

// The route joins the texts of the library by id (http/guide.mjs practicesView); the test does the same joining.
const { packages } = loadLibrary({ sharedDir: sharedKnowledgeDir(), localDir: null });
const defs = new Map(packages.flatMap((p) => p.items.map((i) => [i.id, i])));
const TEXT_KEYS = ['title', 'what', 'why', 'how', 'doneWhen'];
function routed(practices = demo('practices.json')) {
  return {
    ...practices,
    items: practices.items.map((it) => {
      const def = defs.get(it.id);
      return { ...it, text: def ? Object.fromEntries(TEXT_KEYS.map((k) => [k, def[k] ?? null])) : null, source: def?.source ?? null, effort: def?.effort ?? null, standard: def?.standard ?? [] };
    }),
  };
}
// GET /api/library?project= as the route builds it (http/guide.mjs library).
function libraryAnswer() {
  const raw = demo('profile.json');
  const profile = effectiveProfile(raw.detected, raw.owner);
  const chosen = selectFor(profile, packages);
  return {
    packages: chosen.map((p) => ({ id: p.id, kind: p.kind, title: p.title, status: statusOf(p, TODAY), checkedAt: p.checkedAt, disclaimer: p.disclaimer ?? null, itemCount: p.items.length, source: 'shared' })),
    gaps: gapsOf(profile, packages), stale: staleOf(chosen, TODAY), invalid: [],
  };
}
const row = (over = {}) => ({ id: 'x.one', pkg: 'general-quality', front: 'quality', ladder: 'N1', severity: 'R', state: 'pass', reason: null, evidence: [], attested: null, ...over });

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

const PRACTICES_URL = `GET /api/foundation/${PROJECT.id}/practices`;
const LIBRARY_URL = `GET /api/library?project=${PROJECT.id}`;
const ATTEST_URL = (id) => `POST /api/foundation/${PROJECT.id}/practice/${id}`;

// ================= pure: ladderHeader =================

test('ladderHeader: the level with an asterisk when provisional, and how far the next step is', () => {
  const head = ladderHeader(demo('practices.json'));
  assert.deepEqual([head.level, head.provisional, head.label, head.next, head.nextPercent], ['N0', true, 'N0*', 'N1', 0]);
  assert.deepEqual(head.counts, { pass: 6, fail: 14, unverified: 162, na: 8 });
  const sure = ladderHeader({ ladder: { level: 'N2', provisional: false, nextPercent: 99 }, items: [row()] });
  assert.deepEqual([sure.label, sure.next, sure.nextPercent], ['N2', 'N3', 99]);
});

test('ladderHeader: no level yet, the top level and a missing file are each told apart', () => {
  const none = ladderHeader({ ladder: { level: null, provisional: false, nextPercent: 40 }, items: [] });
  assert.deepEqual([none.level, none.label, none.next, none.nextPercent], [null, null, 'N0', 40]);
  const top = ladderHeader({ ladder: { level: 'N4', provisional: false, nextPercent: null }, items: [] });
  assert.deepEqual([top.label, top.next, top.nextPercent], ['N4', null, null]);
  assert.equal(ladderHeader(null), null, 'a file nobody wrote is "not read yet", not level zero');
  assert.equal(ladderHeader({ items: [] }), null);
  assert.equal(ladderHeader({ ladder: { level: 'N9', provisional: false } }), null, 'a level this screen does not know is not drawn');
  assert.equal(ladderHeader({ ladder: { level: 'N1', nextPercent: 'many' }, items: [] }).nextPercent, null);
});

// ================= pure: practiceRows =================

test('practiceRows: the texts in the language asked, the id as the title when the library had none', () => {
  const rows = practiceRows(routed(), 'en');
  assert.equal(rows.length, 190);
  const readme = rows.find((r) => r.id === 'org.readme');
  assert.match(readme.title, /README/);
  assert.ok(readme.what && readme.why && readme.how && readme.doneWhen);
  assert.notEqual(practiceRows(routed(), 'pt-BR').find((r) => r.id === 'org.readme').title, readme.title);
  const bare = practiceRows(demo('practices.json'), 'en')[0];
  assert.equal(bare.title, bare.id);
  assert.equal(bare.why, null);
  assert.deepEqual(practiceRows(null, 'en'), []);
});

test('practiceRows: a state this screen does not know is "not verified", never "in place" or "missing"', () => {
  const rows = practiceRows({ items: [row({ id: 'a.a', state: 'maybe' }), row({ id: 'a.b', state: 'pass' }), null, 5, { id: '' }] }, 'en');
  assert.deepEqual(rows.map((r) => [r.id, r.state]), [['a.a', 'unverified'], ['a.b', 'pass']]);
});

test('practiceRows: the source keeps its trust mark, and only an https link is kept', () => {
  const doc = routed({ items: [row({ id: 'org.readme' })] });
  const src = practiceRows(doc, 'en', { dates: { 'other-package': '2026-09-01' } })[0].source;
  assert.equal(src.trust, 'V');
  assert.match(src.url, /^https:/);
  assert.equal(src.checkedAt, null, 'the date is the package\'s; this one is not in the dates given');
  const withDate = practiceRows(routed({ items: [row({ id: 'org.readme', pkg: 'general-organization' })] }), 'en', { dates: { 'general-organization': '2026-09-01' } })[0];
  assert.equal(withDate.source.checkedAt, '2026-09-01');
  const odd = { items: [row({ source: { name: 'x', url: 'javascript:alert(1)', trust: 'Z' } })] };
  const s = practiceRows(odd, 'en')[0].source;
  assert.equal(s.url, null, 'a link that is not https is never drawn as a link');
  assert.equal(s.trust, 'NV', 'an unknown mark falls to the weakest');
  assert.equal(practiceRows({ items: [row()] }, 'en')[0].source, null);
});

// ================= pure: groupByFront / filterByState =================

test('groupByFront: fronts in a fixed order, urgent first inside, and "does not apply" is never a failure', () => {
  const rows = practiceRows({ items: [
    row({ id: 'q.1', front: 'quality', state: 'pass' }), row({ id: 'q.2', front: 'quality', state: 'na', reason: 'not-applicable' }),
    row({ id: 'q.3', front: 'quality', state: 'fail' }), row({ id: 'q.4', front: 'quality', state: 'unverified', reason: 'needs-human' }),
    row({ id: 's.1', front: 'security', state: 'unverified', reason: 'no-data' }), row({ id: 'z.1', front: 'weird', state: 'pass' }),
    row({ id: 'o.1', front: 'organization', state: 'pass' }),
  ] }, 'en');
  const groups = groupByFront(rows);
  assert.deepEqual(groups.map((g) => g.front), ['organization', 'quality', 'security', 'other']);
  const quality = groups.find((g) => g.front === 'quality');
  assert.deepEqual(quality.rows.map((r) => r.id), ['q.3', 'q.4', 'q.1', 'q.2']);
  assert.deepEqual(quality.counts, { pass: 1, fail: 1, unverified: 1, na: 1 });
  assert.deepEqual(groupByFront([]), []);
});

test('groupByFront: a lower rung comes before a higher one, because that is the order of work', () => {
  const rows = practiceRows({ items: [row({ id: 'a.3', ladder: 'N3', state: 'fail' }), row({ id: 'a.0', ladder: 'N0', state: 'pass' }), row({ id: 'a.1', ladder: 'N1', state: 'fail' })] }, 'en');
  assert.deepEqual(groupByFront(rows)[0].rows.map((r) => r.id), ['a.0', 'a.1', 'a.3']);
});

test('filterByState: one state, or all; "does not apply" is its own filter and not part of "missing"', () => {
  const rows = practiceRows(routed(), 'en');
  assert.equal(filterByState(rows, 'all').length, 190);
  assert.equal(filterByState(rows, 'fail').length, 14);
  assert.equal(filterByState(rows, 'na').length, 8);
  assert.ok(filterByState(rows, 'fail').every((r) => r.state === 'fail'));
  assert.equal(filterByState(rows, 'pass').length, 6);
  assert.equal(filterByState(rows, 'nonsense').length, 190, 'a filter nobody knows shows everything instead of nothing');
});

// ================= pure: reasons and the ask =================

test('every reason of the contract has its words in both languages, and an unknown one has a generic text', () => {
  const REASONS = ['no-data', 'needs-human', 'stale-source', 'attest-expired', 'no-token', 'no-network', 'tool-missing', 'not-applicable'];
  for (const lang of ['en', 'pt-BR']) {
    for (const reason of REASONS) {
      assert.ok(LANGS[lang][`guide.reason.${reason}`]?.trim(), `${lang} guide.reason.${reason}`);
      assert.equal(reasonKey({ state: reason === 'not-applicable' ? 'na' : 'unverified', reason }), `guide.reason.${reason}`);
    }
    assert.ok(LANGS[lang]['guide.reason.unknown']?.trim());
  }
  assert.equal(reasonKey({ state: 'unverified', reason: 'from-mars' }), 'guide.reason.unknown');
  assert.equal(reasonKey({ state: 'unverified', reason: null }), 'guide.reason.unknown');
  assert.equal(reasonKey({ state: 'na', reason: null }), 'guide.reason.not-applicable');
  assert.equal(reasonKey({ state: 'pass', reason: null }), null);
  assert.equal(reasonKey({ state: 'fail', reason: null }), null);
});

test('askText: the practice written as a request for the chat, in the language of the page, asking for a plan first', () => {
  const r = practiceRows(routed(), 'en').find((x) => x.id === 'org.readme');
  const en = askText(r, translator('en'));
  assert.match(en, /^Help me with this best practice/);
  assert.ok(en.includes(r.title) && en.includes(r.how));
  assert.match(en, /wait for my OK/);
  const pt = askText(practiceRows(routed(), 'pt-BR').find((x) => x.id === 'org.readme'), translator('pt-BR'));
  assert.match(pt, /^Me ajude com esta boa prática/);
  assert.match(pt, /espere o meu OK/);
  assert.doesNotMatch(askText(row({ title: 'Only a title', what: null, why: null, how: null, doneWhen: null }), translator('en')), /null|undefined/);
});

// ================= Practices view =================

test('the Practices screen shows the level with an asterisk, how far the next step is, and the practices by area', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: { status: 200, body: libraryAnswer() } }, async () => {
    const done = view.render(root);
    assert.match(textOf(root), /Reading the good practices/);
    await done;
  });
  const head = textOf(withClass(root, 'fdp-level')[0]);
  assert.match(head, /N0\*/);
  assert.match(head, /0 %/);
  assert.match(head, /N1/);
  assert.match(textOf(root), /not verified/i, 'the asterisk is explained');
  const groups = withClass(root, 'fdp-front');
  assert.equal(groups.length, 8);
  assert.match(textOf(groups[0]), /Organization/);
  assert.equal(withClass(root, 'fdp-item').length, 190);
});

test('each practice carries one of the four seals and the reason when it was not verified', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, () => view.render(root));
  const ids = ['ops.run-command', 'org.readme'];
  const pass = withClass(root, 'fdp-item').find((n) => n.attrs['data-item'] === ids[0]);
  assert.match(textOf(pass), /In place/);
  const states = new Set(withClass(root, 'fdp-item').map((n) => (n.attrs.class.match(/is-(\w+)/) ?? [])[1]));
  assert.deepEqual([...states].sort(), ['fail', 'na', 'pass', 'unverified']);
  const unverified = withClass(root, 'fdp-item').find((n) => n.attrs.class.includes('is-unverified'));
  assert.match(textOf(withClass(unverified, 'fdp-reason')[0]), /\S/);
  const na = withClass(root, 'fdp-item').find((n) => n.attrs.class.includes('is-na'));
  assert.match(textOf(na), /Does not apply/);
  assert.match(textOf(withClass(na, 'fdp-reason')[0]), /\S/);
});

test('"does not apply" is not counted as missing on screen', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  const doc = routed({ ...demo('practices.json'), items: [row({ id: 'a.1', state: 'na', reason: 'not-applicable' }), row({ id: 'a.2', state: 'na', reason: 'not-applicable' }), row({ id: 'a.3', state: 'pass' })] });
  await withFetch({ [PRACTICES_URL]: { status: 200, body: doc }, [LIBRARY_URL]: 'network' }, () => view.render(root));
  const front = withClass(root, 'fdp-front')[0];
  assert.match(textOf(front), /0 missing/);
  assert.match(textOf(front), /2 do not apply/);
  const failBtn = withClass(root, 'fdp-filter').find((b) => b.attrs['data-state'] === 'fail');
  assert.match(textOf(failBtn), /0/);
});

test('the filter keeps one state at a time and says which one is on', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, () => view.render(root));
  const filters = withClass(root, 'fdp-filter');
  assert.deepEqual(filters.map((b) => b.attrs['data-state']), ['all', 'fail', 'unverified', 'pass', 'na']);
  assert.equal(filters[0].attrs['aria-pressed'], 'true');
  filters.find((b) => b.attrs['data-state'] === 'fail').attrs.onclick();
  assert.equal(withClass(root, 'fdp-item').length, 14);
  assert.ok(withClass(root, 'fdp-item').every((n) => n.attrs.class.includes('is-fail')));
  const now = withClass(root, 'fdp-filter');
  assert.equal(now.find((b) => b.attrs['data-state'] === 'fail').attrs['aria-pressed'], 'true');
  assert.equal(now.find((b) => b.attrs['data-state'] === 'all').attrs['aria-pressed'], 'false');
});

test('an open practice shows what it is, why, how, when it is done, the evidence and the source with its mark and date', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: { status: 200, body: libraryAnswer() } }, () => view.render(root));
  const item = withClass(root, 'fdp-item').find((n) => n.attrs['data-item'] === 'ops.run-command');
  const body = textOf(withClass(item, 'fdp-body')[0]);
  for (const word of ['Why', 'How', 'Done when', 'Evidence', 'README.md:32', 'Source', 'Convention']) assert.ok(body.includes(word), word);
  assert.match(body, /\d{4}-\d{2}-\d{2}/, 'the package date is there');
  const readme = withClass(root, 'fdp-item').find((n) => n.attrs['data-item'] === 'org.readme');
  assert.match(textOf(withClass(readme, 'fdp-body')[0]), /Verified source/);
  const link = walk(readme).find((n) => n.tag === 'a');
  assert.match(link.attrs.href, /^https:/);
  assert.match(link.attrs.rel, /noopener/);
});

test('opening a practice survives the next poll', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, async () => {
    await view.render(root);
    const item = () => withClass(root, 'fdp-item').find((n) => n.attrs['data-item'] === 'ops.run-command');
    assert.ok(!item().attrs.open, 'closed to begin with');
    item().attrs.ontoggle({ target: { open: true } });
    await view.refresh(root);
    assert.ok(item().attrs.open, 'still open after the redraw');
  });
});

test('"Ask for help" opens the chat on the project with the practice as the request', async () => {
  for (const lang of ['en', 'pt-BR']) {
    const { ctx, calls } = ctxFor({ t: translator(lang) });
    const view = createPracticesView(ctx);
    const root = h('div');
    await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, () => view.render(root));
    const item = withClass(root, 'fdp-item').find((n) => n.attrs['data-item'] === 'org.readme');
    buttons(item).find((b) => (b.attrs.class ?? '').includes('fdp-help')).attrs.onclick();
    assert.deepEqual(calls.chat[0].node, { kind: 'project' });
    assert.match(calls.chat[0].text, lang === 'en' ? /^Help me with this best practice/ : /^Me ajude com esta boa prática/);
  }
});

test('with no openChat the help button is not drawn; a practice that does not apply has no help either', async () => {
  const { ctx } = ctxFor({ openChat: undefined });
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, () => view.render(root));
  assert.equal(withClass(root, 'fdp-help').length, 0);
  const { ctx: ctx2 } = ctxFor();
  const view2 = createPracticesView(ctx2);
  const root2 = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, () => view2.render(root2));
  const na = withClass(root2, 'fdp-item').find((n) => n.attrs.class.includes('is-na'));
  assert.equal(withClass(na, 'fdp-help').length, 0);
  const pass = withClass(root2, 'fdp-item').find((n) => n.attrs.class.includes('is-pass'));
  assert.equal(withClass(pass, 'fdp-help').length, 0, 'what is already in place needs no help');
});

test('"Attest" asks for a note and a validity, sends them, and redraws with the answer of the route', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  const id = 'fin.unit-economics';
  const after = routed();
  after.items = after.items.map((it) => (it.id === id ? { ...it, state: 'pass', reason: null, attested: { at: '2026-10-10T10:00:00.000Z', expiresAt: '2027-01-08T10:00:00.000Z', note: 'Checked with Ana' } } : it));
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network', [ATTEST_URL(id)]: { status: 200, body: after } }, async (calls) => {
    await view.render(root);
    const item = () => withClass(root, 'fdp-item').find((n) => n.attrs['data-item'] === id);
    assert.equal(withClass(item(), 'fdp-attest').length, 0);
    buttons(item()).find((b) => (b.attrs.class ?? '').includes('fdp-attest-btn')).attrs.onclick();
    const form = withClass(item(), 'fdp-attest')[0];
    assert.ok(form, 'the form opens inside the practice');
    const note = walk(form).find((n) => n.tag === 'textarea');
    note.attrs.oninput({ target: { value: 'Checked with Ana' } });
    const days = walk(form).find((n) => n.tag === 'select');
    assert.deepEqual(walk(days).filter((n) => n.tag === 'option').map((o) => o.attrs.value), ['30', '90', '180', '365']);
    assert.equal(walk(days).find((n) => n.tag === 'option' && n.attrs.selected)?.attrs.value, '90');
    days.attrs.onchange({ target: { value: '180' } });
    await buttonWith(form, 'Save attest').attrs.onclick();
    await settle();
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.path, `/api/foundation/${PROJECT.id}/practice/${id}`);
    assert.deepEqual(post.body, { action: 'attest', note: 'Checked with Ana', days: 180 });
    assert.equal(withClass(item(), 'fdp-attest').length, 0);
    assert.match(item().attrs.class, /is-pass/);
    assert.match(textOf(item()), /2027-01-08/, 'the date it holds until is shown');
  });
});

test('a refused attest shows the problem in words and keeps what was typed', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  const id = 'fin.unit-economics';
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network', [ATTEST_URL(id)]: { status: 400, body: { error: 'bad-idea' } } }, async (calls) => {
    await view.render(root);
    const item = () => withClass(root, 'fdp-item').find((n) => n.attrs['data-item'] === id);
    buttons(item()).find((b) => (b.attrs.class ?? '').includes('fdp-attest-btn')).attrs.onclick();
    walk(item()).find((n) => n.tag === 'textarea').attrs.oninput({ target: { value: 'kept' } });
    await buttonWith(item(), 'Save attest').attrs.onclick();
    await settle();
    assert.match(textOf(withClass(item(), 'fdp-attest')[0]), /not valid|Something went wrong/i);
    assert.equal(walk(item()).find((n) => n.tag === 'textarea').attrs.value, 'kept');
    // A poll must not wipe the form: it does not even ask the route.
    const asked = calls.length;
    await view.refresh(root);
    assert.equal(calls.length, asked);
    assert.equal(withClass(item(), 'fdp-attest').length, 1);
  });
});

test('"Attest" is offered only where a person can confirm: not on what is in place by itself or does not apply', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, () => view.render(root));
  const has = (cls) => withClass(root, 'fdp-item').filter((n) => n.attrs.class.includes(cls)).map((n) => withClass(n, 'fdp-attest-btn').length);
  assert.ok(has('is-unverified').every((n) => n === 1));
  assert.ok(has('is-fail').every((n) => n === 0));
  assert.ok(has('is-na').every((n) => n === 0));
  assert.ok(has('is-pass').every((n) => n === 0), 'a pass that nobody attested is the program\'s own finding');
});

test('a network error is a state with words and a retry; not read yet says so; an empty file is not an error', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: 'network', [LIBRARY_URL]: 'network' }, () => view.render(root));
  assert.match(textOf(root), new RegExp(LANGS.en['err.network'].slice(0, 12)));
  assert.equal(withClass(root, 'fdp-item').length, 0);
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, async () => {
    await buttonWith(root, 'Try again').attrs.onclick();
  });
  assert.equal(withClass(root, 'fdp-item').length, 190);
  const root2 = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: null }, [LIBRARY_URL]: 'network' }, () => view.render(root2));
  assert.match(textOf(root2), /not read yet/i);
  const root3 = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: { version: 1, items: [], ladder: null } }, [LIBRARY_URL]: 'network' }, () => view.render(root3));
  assert.equal(withClass(root3, 'fdp-level').length, 0);
  assert.match(textOf(root3), /No practices/i);
});

test('the fixed notice shows when practices of law or money are there', async () => {
  const { ctx } = ctxFor();
  const view = createPracticesView(ctx);
  const root = h('div');
  await withFetch({ [PRACTICES_URL]: { status: 200, body: routed() }, [LIBRARY_URL]: 'network' }, () => view.render(root));
  assert.match(textOf(withClass(root, 'fdg-notice')[0]), /not an opinion from a professional/i);
  const root2 = h('div');
  const plain = routed({ ...demo('practices.json'), items: [row({ id: 'org.readme', front: 'organization' })] });
  await withFetch({ [PRACTICES_URL]: { status: 200, body: plain }, [LIBRARY_URL]: 'network' }, () => view.render(root2));
  assert.equal(withClass(root2, 'fdg-notice').length, 0);
});

// ================= pure: libraryRows =================

test('libraryRows: a package with its kind, state, date of the check and fixed notice', () => {
  const rows = libraryRows(libraryAnswer(), 'en');
  assert.ok(rows.packages.length >= 5);
  const lgpd = rows.packages.find((p) => p.id === 'legal-lgpd-br');
  assert.ok(lgpd, 'a project with personal data and BR gets the privacy-law package');
  assert.match(lgpd.title, /\S/);
  assert.equal(lgpd.status, 'confirmed');
  assert.match(lgpd.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(lgpd.disclaimer, /not/i, 'the package\'s own notice');
  assert.ok(lgpd.itemCount > 0);
  assert.notEqual(libraryRows(libraryAnswer(), 'pt-BR').packages.find((p) => p.id === 'legal-lgpd-br').title, lgpd.title);
});

test('libraryRows: gaps and stale carry the request for the chat; invalid files are listed', () => {
  const answer = {
    packages: [{ id: 'stack-next', kind: 'stack', title: { en: 'Next', 'pt-BR': 'Next' }, status: 'stale-source', checkedAt: '2026-01-01', disclaimer: null, itemCount: 3, source: 'shared' }],
    gaps: [{ kind: 'stack', name: 'rails', request: { text: 'Research best-practice guidance for rails' } }, { kind: 'type', name: 'x', request: {} }],
    stale: [{ id: 'stack-next', daysOld: 282, request: { text: 'Recheck stack-next' } }],
    invalid: [{ file: 'broken.json', error: 'bad json' }, null],
  };
  const rows = libraryRows(answer, 'en');
  assert.deepEqual(rows.gaps.map((g) => [g.kind, g.name, g.ask]), [['stack', 'rails', 'Research best-practice guidance for rails']], 'a gap with no request cannot open a chat, so it is not offered');
  assert.deepEqual(rows.stale.map((s) => [s.id, s.title, s.daysOld, s.ask]), [['stack-next', 'Next', 282, 'Recheck stack-next']]);
  assert.deepEqual(rows.invalid, [{ file: 'broken.json', error: 'bad json' }]);
  assert.equal(rows.packages[0].status, 'stale-source');
});

test('libraryRows: an unknown status is never shown as confirmed; no data is null, not empty', () => {
  const rows = libraryRows({ packages: [{ id: 'a', kind: 'general', title: null, status: 'blessed', checkedAt: 'soon', itemCount: 'many' }] }, 'en');
  assert.equal(rows.packages[0].status, 'recheck');
  assert.equal(rows.packages[0].title, 'a');
  assert.equal(rows.packages[0].checkedAt, null);
  assert.equal(rows.packages[0].itemCount, 0);
  assert.equal(libraryRows(null, 'en'), null);
  assert.deepEqual(libraryRows({}, 'en'), { packages: [], gaps: [], stale: [], invalid: [] });
});

// ================= Library view =================

test('the Library lists the packages that apply, each with its state, its date and its notice', async () => {
  const { ctx } = ctxFor();
  const view = createLibraryView(ctx);
  const root = h('div');
  await withFetch({ [LIBRARY_URL]: { status: 200, body: libraryAnswer() } }, async (calls) => {
    const done = view.render(root);
    assert.match(textOf(root), /Reading the library/);
    await done;
    assert.equal(calls[0].path, `/api/library?project=${PROJECT.id}`);
  });
  const pkgs = withClass(root, 'fdl-pkg');
  assert.equal(pkgs.length, libraryAnswer().packages.length);
  const lgpd = pkgs.find((p) => p.attrs['data-pkg'] === 'legal-lgpd-br');
  assert.match(textOf(lgpd), /Confirmed/);
  assert.match(textOf(lgpd), /2026-/);
  assert.match(textOf(withClass(lgpd, 'fdl-notice')[0]), /not/i);
});

test('a gap offers "Research", which opens the chat with the request ready', async () => {
  const { ctx, calls } = ctxFor();
  const view = createLibraryView(ctx);
  const root = h('div');
  const answer = { ...libraryAnswer(), gaps: [{ kind: 'stack', name: 'rails', request: { text: 'Research best-practice guidance for rails' } }] };
  await withFetch({ [LIBRARY_URL]: { status: 200, body: answer } }, () => view.render(root));
  const gap = withClass(root, 'fdl-gap')[0];
  assert.match(textOf(gap), /rails/);
  buttonWith(gap, 'Research').attrs.onclick();
  assert.deepEqual(calls.chat, [{ node: { kind: 'project' }, text: 'Research best-practice guidance for rails' }]);
});

test('an out-of-date package says "recheck" and its button opens the chat with the recheck request', async () => {
  const { ctx, calls } = ctxFor();
  const view = createLibraryView(ctx);
  const root = h('div');
  const base = libraryAnswer();
  const first = base.packages[0];
  const answer = {
    ...base, gaps: [],
    packages: [{ ...first, status: 'stale-source' }, ...base.packages.slice(1)],
    stale: [{ id: first.id, daysOld: 400, request: { text: `Recheck ${first.id}` } }],
  };
  await withFetch({ [LIBRARY_URL]: { status: 200, body: answer } }, () => view.render(root));
  assert.match(textOf(withClass(root, 'fdl-pkg').find((p) => p.attrs['data-pkg'] === first.id)), /Recheck/);
  const stale = withClass(root, 'fdl-stale')[0];
  assert.match(textOf(stale), /400/);
  buttonWith(stale, 'Recheck').attrs.onclick();
  assert.deepEqual(calls.chat, [{ node: { kind: 'project' }, text: `Recheck ${first.id}` }]);
});

test('files that could not be read are listed with the reason; with nothing to show the sections are not drawn', async () => {
  const { ctx } = ctxFor();
  const view = createLibraryView(ctx);
  const root = h('div');
  await withFetch({ [LIBRARY_URL]: { status: 200, body: { ...libraryAnswer(), gaps: [], stale: [], invalid: [{ file: 'local-x.json', error: 'bad json' }] } } }, () => view.render(root));
  assert.match(textOf(withClass(root, 'fdl-invalid')[0]), /local-x\.json/);
  assert.equal(withClass(root, 'fdl-gap').length, 0);
  assert.equal(withClass(root, 'fdl-stale').length, 0);
  const root2 = h('div');
  await withFetch({ [LIBRARY_URL]: { status: 200, body: { ...libraryAnswer(), gaps: [], stale: [], invalid: [] } } }, () => view.render(root2));
  assert.equal(withClass(root2, 'fdl-invalid').length, 0);
});

test('with no openChat the Library draws no button that does nothing', async () => {
  const { ctx } = ctxFor({ openChat: undefined });
  const view = createLibraryView(ctx);
  const root = h('div');
  const answer = { ...libraryAnswer(), gaps: [{ kind: 'stack', name: 'rails', request: { text: 'Research rails' } }], stale: [{ id: 'stack-next', daysOld: 400, request: { text: 'Recheck' } }] };
  await withFetch({ [LIBRARY_URL]: { status: 200, body: answer } }, () => view.render(root));
  assert.equal(buttons(root).length, 0);
  assert.match(textOf(withClass(root, 'fdl-gap')[0]), /rails/);
});

test('the Library: network error, not read yet, and the poll that does not wipe the page', async () => {
  const { ctx } = ctxFor();
  const view = createLibraryView(ctx);
  const root = h('div');
  await withFetch({ [LIBRARY_URL]: 'network' }, () => view.render(root));
  assert.match(textOf(root), new RegExp(LANGS.en['err.network'].slice(0, 12)));
  await withFetch({ [LIBRARY_URL]: { status: 200, body: libraryAnswer() } }, async () => {
    await buttonWith(root, 'Try again').attrs.onclick();
  });
  assert.ok(withClass(root, 'fdl-pkg').length > 0);
  await withFetch({ [LIBRARY_URL]: 'network' }, () => view.refresh(root));
  assert.ok(withClass(root, 'fdl-pkg').length > 0, 'a failed poll keeps what was already on screen');
  const root2 = h('div');
  await withFetch({ [LIBRARY_URL]: { status: 200, body: null } }, () => view.render(root2));
  assert.match(textOf(root2), /not read yet/i);
});

test('the texts of both screens exist in both languages', () => {
  for (const lang of ['en', 'pt-BR']) {
    for (const key of ['prac.title', 'prac.lede', 'prac.level', 'prac.filter.all', 'prac.attest', 'prac.attest.save', 'prac.sev.E', 'lib.title', 'lib.lede', 'lib.research', 'lib.recheck', 'lib.notice', 'guide.reason.unknown']) {
      assert.ok(LANGS[lang][key]?.trim(), `${lang} ${key}`);
    }
  }
});
