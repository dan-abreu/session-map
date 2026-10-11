import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiHelpers, activityStatus, activityRows, normalizeRoot, projectClassFor, whenText, whyKey, PROJECT_CLASS_ORDER } from '../server/web/aihelpers.js';
import { LANGS, translator } from '../server/web/i18n.js';
import { normalizePath } from '../server/paths.mjs';

// The "Other AIs" dialog, second half (or14): what the other AIs did (newest first, in plain words, with Claude's
// verdict and reason) and how private each project is.

const NOW = Date.parse('2026-10-10T12:00:00Z');
const item = (extra = {}) => ({ id: '0123456789ab', at: '2026-10-10T11:55:00Z', source: 'chat', kind: 'review', sensitivity: 'client', provider: 'openai', model: 'gpt-6.1-sol', ms: 900, costUSD: 0.0021, ok: true, ...extra });

// ---- the pure parts ---------------------------------------------------------------------------------------------

test('each piece of work is waiting, accepted, refused or failed; the map\'s own routine work is its own state', () => {
  assert.equal(activityStatus(item()), 'waiting');
  assert.equal(activityStatus(item({ result: { accepted: true, why: 'ok', at: 'x' } })), 'accepted');
  assert.equal(activityStatus(item({ result: { accepted: false, why: 'no', at: 'x' } })), 'refused');
  assert.equal(activityStatus(item({ ok: false, error: 'http-429' })), 'failed');
  assert.equal(activityStatus(item({ source: 'map', kind: 'place' })), 'routine');
  assert.equal(activityStatus(item({ source: 'map', ok: false })), 'failed');
});

test('a row keeps the order it was given (newest first) and carries what the page words', () => {
  const rows = activityRows([item({ id: 'a'.repeat(12) }), item({ id: 'b'.repeat(12), result: { accepted: false, why: 'It missed the null case.', at: 'x' } })]);
  assert.deepEqual(rows.map((r) => r.id), ['a'.repeat(12), 'b'.repeat(12)]);
  assert.equal(rows[1].status, 'refused');
  assert.equal(rows[1].reason, 'It missed the null case.');
  assert.equal(rows[0].provider, 'openai');
  assert.equal(rows[0].costUSD, 0.0021);
  assert.deepEqual(activityRows(null), []);
  assert.deepEqual(activityRows([{ nonsense: true }, null]), [], 'a damaged item is skipped');
});

test('the reason shown is Claude\'s verdict first, otherwise why the AI was picked', () => {
  const [a] = activityRows([item({ recommendedBy: 'Another family reviews Opus.' })]);
  assert.equal(a.reason, 'Another family reviews Opus.');
  const [b] = activityRows([item({ recommendedBy: 'Another family reviews Opus.', result: { accepted: true, why: 'Checked: right.', at: 'x' } })]);
  assert.equal(b.reason, 'Checked: right.');
  assert.equal(b.pickedBecause, 'Another family reviews Opus.');
});

test('"when" reads as minutes ago, then as a date', () => {
  assert.equal(whenText('2026-10-10T11:55:00Z', 'en', NOW), '5 minutes ago');
  assert.equal(whenText('2026-10-10T11:59:50Z', 'en', NOW), 'now');
  assert.match(whenText('2026-10-10T09:00:00Z', 'pt-BR', NOW), /3 horas/);
  assert.match(whenText('2026-09-01T09:00:00Z', 'en', NOW), /Sep/);
  assert.equal(whenText('garbage', 'en', NOW), '');
});

test('the page spells a folder the way the server does, so a project\'s saved class is found', () => {
  const here = process.platform === 'win32' ? 'windows' : 'posix';
  for (const p of ['C:\\Clients\\Shop', 'c:/clients/shop/', '/c/clients/shop', 'D:/', 'C:\\Users\\dani\\my project\\', '/home/Dani/Shop/']) {
    assert.equal(normalizeRoot(p, here), normalizePath(p), p);
  }
  // The rule is the server's, not the browser's: a Windows server reads /c/ as c: and ignores case everywhere; any other
  // keeps /c/ and the case of a folder, and only folds a drive-letter path.
  assert.equal(normalizeRoot('/c/clients/shop', 'windows'), 'c:/clients/shop');
  assert.equal(normalizeRoot('/home/Dani/Shop/', 'windows'), '/home/dani/shop');
  assert.equal(normalizeRoot('/c/clients/shop', 'posix'), '/c/clients/shop');
  assert.equal(normalizeRoot('/home/Dani/Shop/', 'posix'), '/home/Dani/Shop');
  assert.equal(normalizeRoot('C:\\Clients\\Shop', 'posix'), 'c:/clients/shop');
  assert.equal(normalizeRoot('/c/clients/shop'), 'c:/clients/shop', 'no rule given: the Windows one');
  assert.equal(projectClassFor({ '/home/Dani/Shop': 'public' }, '/home/dani/shop', 'posix'), 'client', 'two folders on a posix server');
  assert.equal(projectClassFor({ '/home/Dani/Shop': 'public' }, '/home/Dani/Shop/', 'posix'), 'public');
  const classes = { [normalizePath('C:\\Clients\\Shop')]: 'internal' };
  assert.equal(projectClassFor(classes, 'C:/CLIENTS/shop'), 'internal');
  assert.equal(projectClassFor(classes, 'C:/other'), 'client', 'not listed: the strictest');
  assert.equal(projectClassFor(undefined, 'C:/other'), 'client');
  assert.equal(projectClassFor({ 'c:/x': 'secret' }, 'C:/x'), 'client', 'an unknown class is the strictest');
  assert.deepEqual([...PROJECT_CLASS_ORDER], ['client', 'internal', 'public']);
});

test('the two new refusals of the class route have plain words', () => {
  for (const code of ['unknown-project', 'bad-project-class']) {
    const key = whyKey(code, 400);
    assert.ok(key, code);
    for (const lang of Object.values(LANGS)) assert.ok(lang[key], `${key} missing`);
  }
});

test('every word the activity and class sections use exists in both languages', () => {
  const keys = [
    'aih.act.title', 'aih.act.lede', 'aih.act.empty', 'aih.act.refresh', 'aih.act.loadFail', 'aih.act.by.chat', 'aih.act.by.map',
    'aih.act.status.accepted', 'aih.act.status.refused', 'aih.act.status.waiting', 'aih.act.status.failed', 'aih.act.status.routine',
    'aih.act.pickedBecause', 'aih.act.verdictLabel', 'aih.act.failedWhy', 'aih.act.failedGeneric', 'aih.act.cost',
    'aih.act.sens.public', 'aih.act.sens.internal', 'aih.act.sens.client',
    ...['review', 'bulk', 'code', 'read', 'portuguese', 'reasoning', 'place', 'other'].map((k) => `aih.act.kind.${k}`),
    'aih.pc.title', 'aih.pc.lede', 'aih.pc.none', 'aih.pc.saved',
    ...['client', 'internal', 'public'].flatMap((c) => [`aih.pc.${c}`, `aih.pc.${c}.hint`]),
  ];
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of keys) {
    assert.ok(LANGS.en[k], `en ${k}`);
    assert.ok(LANGS['pt-BR'][k], `pt-BR ${k}`);
    assert.deepEqual(vars(LANGS.en[k]), vars(LANGS['pt-BR'][k]), `${k} blanks`);
  }
  assert.equal(LANGS['pt-BR']['aih.act.title'], 'O que as outras IAs fizeram');
  assert.equal(LANGS.en['aih.act.title'], 'What the other AIs did');
  assert.equal(LANGS['pt-BR']['aih.pc.client'], 'Projeto de cliente (nunca sai para IAs de fora sem proteção)');
  assert.equal(LANGS['pt-BR']['aih.pc.internal'], 'Projeto meu');
  assert.equal(LANGS['pt-BR']['aih.pc.public'], 'Projeto público (código aberto)');
});

// ---- the dialog, drawn into a small stand-in for the page ----------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  return { tag, attrs: attrs ?? {}, kids: children.flat(Infinity).filter((c) => c != null && c !== false) };
}
const walk = (node, fn) => { if (node && typeof node === 'object') { fn(node); node.kids?.forEach((k) => walk(k, fn)); } };
const textOf = (node) => (typeof node === 'object' ? node.kids.map(textOf).join('') : String(node));
const all = (root, pred) => { const out = []; for (const n of root.kids) walk(n, (x) => { if (pred(x)) out.push(x); }); return out; };

function makeDialog() {
  const d = { open: false, kids: [], listeners: {}, replaceChildren(...n) { d.kids = n; }, addEventListener(e, f) { d.listeners[e] = f; }, querySelector() { return null; }, showModal() { d.open = true; }, close() { d.open = false; } };
  return d;
}

const PROVIDERS = [{ id: 'openai', name: 'OpenAI (GPT)', keyUrl: 'https://example.test/', defaultModel: 'gpt-6-luna' }];
const helpersView = (extra = {}) => ({
  ok: true, providers: PROVIDERS, keys: [], others: { enabled: true, dailyUSD: 1, off: [] }, status: { others: { providers: [], spentUSDToday: 0, dailyUSD: 1, enabled: true, capReached: false } },
  projectClass: {}, projectClassDefault: 'client', projectClasses: ['client', 'internal', 'public'], ...extra,
});

function build({ activity = { ok: true, items: [] }, view = helpersView(), projects = [], lang = 'pt-BR', save } = {}) {
  const dialog = makeDialog();
  const calls = [];
  const api = {
    aiHelpers: async () => view,
    aiActivity: async (limit) => { calls.push(['activity', limit]); return typeof activity === 'function' ? activity() : activity; },
    setAiHelper: async (body) => { calls.push(['set', body]); return save ? save(body) : { ...view, projectClass: {} }; },
  };
  const ui = createAiHelpers({ dialog, h, t: () => translator(lang), lang: () => lang, api, toast() {}, errorText: (e) => `generic:${e}`, projects: () => projects, now: () => NOW, openers: [] });
  return { dialog, ui, calls, api };
}

test('the dialog lists what the other AIs did, newest first, with who, what, when, cost, state and reason', async () => {
  const items = [
    item({ id: 'a'.repeat(12), at: '2026-10-10T11:58:00Z', kind: 'review', result: { accepted: false, why: 'It missed the null case.', at: 'x' }, recommendedBy: 'A different family reviews.' }),
    item({ id: 'b'.repeat(12), at: '2026-10-10T10:00:00Z', provider: 'gemini', model: 'gemini-3.1-flash-lite', kind: 'bulk', sensitivity: 'public', costUSD: 0 }),
    item({ id: 'c'.repeat(12), at: '2026-10-10T09:00:00Z', provider: 'deepseek', ok: false, error: 'http-429', sensitivity: 'public' }),
    item({ id: 'd'.repeat(12), at: '2026-10-10T08:00:00Z', source: 'map', kind: 'place', sensitivity: 'internal' }),
    item({ id: 'e'.repeat(12), at: '2026-10-10T07:00:00Z', result: { accepted: true, why: 'Checked against the code.', at: 'x' } }),
  ];
  const { dialog, ui, calls } = build({ activity: { ok: true, items } });
  await ui.open();
  assert.deepEqual(calls[0], ['activity', 50]);
  const section = all(dialog, (n) => n.attrs?.['data-ah-activity'] !== undefined)[0];
  assert.ok(section, 'the section is there');
  assert.equal(textOf(all(section, (n) => n.tag === 'h3')[0]), 'O que as outras IAs fizeram');
  const rows = all(section, (n) => n.attrs?.['data-ah-act'] !== undefined);
  assert.deepEqual(rows.map((r) => r.attrs['data-ah-act']), items.map((i) => i.id), 'the order given is the order shown');
  const first = textOf(rows[0]);
  assert.match(first, /OpenAI \(GPT\)/);
  assert.match(first, /segunda opinião/i);
  assert.match(first, /há 2 minutos/);
  assert.match(first, /0,0021/);
  assert.match(first, /Recusado/);
  assert.match(first, /It missed the null case\./);
  assert.match(first, /A different family reviews\./);
  assert.match(first, /cliente/i);
  assert.match(textOf(rows[1]), /Esperando/i);
  assert.match(textOf(rows[1]), /material público/i);
  assert.match(textOf(rows[2]), /Não respondeu/i);
  assert.match(textOf(rows[2]), /muitos pedidos|crédito/i, 'the failure in plain words');
  assert.match(textOf(rows[3]), /mapa/i);
  assert.match(textOf(rows[3]), /rotina/i);
  assert.match(textOf(rows[4]), /Aceito/);
  for (const r of rows) assert.ok(!/(sk-|PRIVATE)/.test(textOf(r)));
  const states = rows.map((r) => r.attrs['data-status']);
  assert.deepEqual(states, ['refused', 'waiting', 'failed', 'routine', 'accepted']);
});

test('with nothing done yet, or when the list cannot be read, the section says so in plain words', async () => {
  const empty = build({ activity: { ok: true, items: [] } });
  await empty.ui.open();
  assert.match(textOf({ kids: empty.dialog.kids }), /Nada ainda/);
  const failing = build({ activity: { ok: false, status: 403, error: 'demo' } });
  await failing.ui.open();
  assert.match(textOf({ kids: failing.dialog.kids }), /Não foi possível ler/);
  assert.ok(all(failing.dialog, (n) => n.attrs?.['data-ah-act'] !== undefined).length === 0);
});

test('the English words read the same way', async () => {
  const { dialog, ui } = build({ lang: 'en', activity: { ok: true, items: [item({ result: { accepted: true, why: 'Looks right.', at: 'x' } })] } });
  await ui.open();
  const text = textOf({ kids: dialog.kids });
  assert.match(text, /What the other AIs did/);
  assert.match(text, /second opinion/i);
  assert.match(text, /Accepted/);
  assert.match(text, /5 minutes ago/);
});

test('the refresh button reads the list again', async () => {
  let n = 0;
  const { dialog, ui, calls } = build({ activity: () => ({ ok: true, items: n++ ? [item({ id: 'f'.repeat(12) })] : [] }) });
  await ui.open();
  assert.equal(all(dialog, (x) => x.attrs?.['data-ah-act'] !== undefined).length, 0);
  const refresh = all(dialog, (x) => x.attrs?.['data-ah-refresh'] !== undefined)[0];
  await refresh.attrs.onclick();
  assert.equal(calls.filter((c) => c[0] === 'activity').length, 2);
  assert.equal(all(dialog, (x) => x.attrs?.['data-ah-act'] !== undefined).length, 1);
});

const PROJECTS = [
  { id: 'shop-1', name: 'Shop', root: 'C:/Clients/Shop' },
  { id: 'tool-2', name: 'My tool', root: 'C:\\mine\\Tool' },
  { id: 'oss-3', name: 'Open lib', root: 'C:/oss/lib' },
];

test('each project shows its data class, the strictest when nothing was chosen, with what each class means', async () => {
  const view = helpersView({ projectClass: { [normalizePath('C:/mine/Tool')]: 'internal', [normalizePath('C:/oss/lib')]: 'public' } });
  const { dialog, ui } = build({ view, projects: PROJECTS });
  await ui.open();
  const section = all(dialog, (n) => n.attrs?.['data-ah-classes'] !== undefined)[0];
  assert.ok(section);
  const text = textOf(section);
  assert.match(text, /Projeto de cliente \(nunca sai para IAs de fora sem proteção\)/);
  assert.match(text, /Projeto meu/);
  assert.match(text, /Projeto público \(código aberto\)/);
  const selects = all(section, (n) => n.tag === 'select');
  assert.equal(selects.length, 3);
  const valueOf = (s) => s.kids.find((o) => o.attrs.selected)?.attrs.value;
  assert.deepEqual(selects.map(valueOf), ['client', 'internal', 'public']);
  assert.deepEqual(selects[0].kids.map((o) => o.attrs.value), ['client', 'internal', 'public']);
  assert.match(textOf(section), /Shop/);
  assert.match(textOf(section), /My tool/);
});

test('choosing a class saves it at once for that project\'s folder, and a refusal is said in plain words', async () => {
  const saved = helpersView({ projectClass: { [normalizePath('C:/Clients/Shop')]: 'internal' } });
  const { dialog, ui, calls } = build({ view: helpersView(), projects: PROJECTS, save: () => saved });
  await ui.open();
  const select = all(dialog, (n) => n.tag === 'select' && n.attrs['data-ah-class'] === 'C:/Clients/Shop')[0];
  assert.ok(select, 'one select per project, labelled with the root');
  await select.attrs.onchange({ target: { value: 'internal' } });
  assert.deepEqual(calls.find((c) => c[0] === 'set'), ['set', { projectClass: { 'C:/Clients/Shop': 'internal' } }]);
  const after = all(dialog, (n) => n.tag === 'select' && n.attrs['data-ah-class'] === 'C:/Clients/Shop')[0];
  assert.equal(after.kids.find((o) => o.attrs.selected).attrs.value, 'internal');
  assert.match(textOf({ kids: dialog.kids }), /Guardado/);

  const bad = build({ view: helpersView(), projects: PROJECTS, save: () => ({ ok: false, status: 400, error: 'unknown-project' }) });
  await bad.ui.open();
  const s2 = all(bad.dialog, (n) => n.tag === 'select')[0];
  await s2.attrs.onchange({ target: { value: 'public' } });
  assert.match(textOf({ kids: bad.dialog.kids }), /não conhece esse projeto/i);
  assert.equal(all(bad.dialog, (n) => n.tag === 'select')[0].kids.find((o) => o.attrs.selected).attrs.value, 'client', 'the page shows what the server kept');
});

test('with no project known yet, the class section explains instead of showing an empty list', async () => {
  const { dialog, ui } = build({ projects: [] });
  await ui.open();
  const section = all(dialog, (n) => n.attrs?.['data-ah-classes'] !== undefined)[0];
  assert.match(textOf(section), /Ainda não há projetos/);
  assert.equal(all(section, (n) => n.tag === 'select').length, 0);
});
