// The Logs tab (id159, mm61): the numbers from logs.js and the page from logsview.js, drawn on a tiny element tree.
// The rows have the shape of the real log measured on 2026-10-16: 95 lines in two days, 14 of them warnings of two kinds
// (the OpenAI price list refused with http-403, ten times; DeepSeek's answer cut, four times).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupProblems, reasonOf, routineRows, sinceOf, projectLine, rowsSignature, PROBLEM_EVENTS, ROUTINE_EVENTS, PROJECT_KINDS } from '../server/web/logs.js';
import { createLogsView } from '../server/web/logsview.js';
import { createAreas } from '../server/web/areas.js';
import { LANGS, translator } from '../server/web/i18n.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const row = (ts, level, event, fields = {}) => ({ v: 1, ts, level, event, ...fields });
// Newest first, as the route answers.
function programRows() {
  const out = [];
  out.push(row('2026-10-16T11:30:00.000Z', 'info', 'listening', { port: 4321 }));
  out.push(row('2026-10-16T09:00:00.000Z', 'warn', 'ai-api-failed', { provider: 'deepseek', error: 'answer-cut' }));
  for (let i = 0; i < 3; i++) out.push(row(`2026-10-15T0${i + 1}:54:00.000Z`, 'warn', 'ai-api-failed', { provider: 'deepseek', error: 'answer-cut' }));
  for (let i = 0; i < 10; i++) out.push(row(`2026-10-14T1${i}:32:00.000Z`, 'warn', 'ai-prices-failed', { provider: 'openai', error: 'http-403' }));
  out.push(row('2026-10-14T09:00:00.000Z', 'info', 'restarting', { chats: 0 }));
  return out;
}

test('the same problem is one group: counts, first and last time, newest lines kept, and whether it still happens', () => {
  const groups = groupProblems(programRows(), { now: NOW });
  assert.equal(groups.length, 2);
  const [deepseek, openai] = groups; // newest last-time first
  assert.equal(deepseek.event, 'ai-api-failed');
  assert.equal(deepseek.count, 4);
  assert.equal(deepseek.provider, 'deepseek');
  assert.equal(deepseek.recent, true, 'seen 3 hours before NOW');
  assert.equal(openai.count, 10);
  assert.equal(openai.first, '2026-10-14T10:32:00.000Z');
  assert.equal(openai.last, '2026-10-14T19:32:00.000Z');
  assert.equal(openai.recent, false, 'last seen two days before NOW');
  assert.equal(openai.raw.length, 5, 'only the newest lines are kept');
});

test('an error group comes before a warning one, whatever its time', () => {
  const rows = [row('2026-10-16T10:00:00.000Z', 'warn', 'ai-api-failed'), row('2026-10-10T10:00:00.000Z', 'error', 'request-failed', { path: '/api/x' })];
  assert.deepEqual(groupProblems(rows, { now: NOW }).map((g) => g.level), ['error', 'warn']);
});

test('lines that are not problems, or have no event, never form a group', () => {
  assert.deepEqual(groupProblems([row('2026-10-16T10:00:00.000Z', 'info', 'listening'), null, { level: 'warn' }], { now: NOW }), []);
  assert.deepEqual(groupProblems(null), []);
  assert.deepEqual(routineRows(programRows()).map((r) => r.event), ['listening', 'restarting']);
  assert.equal(sinceOf(programRows()), '2026-10-14T09:00:00.000Z');
  assert.equal(sinceOf([]), null);
});

test('the reason of a line is said by key: http codes, a cut answer, a missing connection, anything else as the program wrote it', () => {
  assert.deepEqual(reasonOf({ error: 'http-403' }), { key: 'logs.why.http403', vars: { code: 403 } });
  assert.deepEqual(reasonOf({ error: 'http-503' }), { key: 'logs.why.http5xx', vars: { code: 503 } });
  assert.deepEqual(reasonOf({ error: 'http-418' }), { key: 'logs.why.http', vars: { code: 418 } });
  assert.equal(reasonOf({ error: 'answer-cut' }).key, 'logs.why.answer-cut');
  assert.equal(reasonOf({ error: 'quota-daily' }).key, 'logs.why.quota');
  assert.equal(reasonOf({ code: 'EACCES' }).key, 'logs.why.denied');
  assert.deepEqual(reasonOf({ error: 'x'.repeat(300) }).vars.error.length, 160);
  assert.equal(reasonOf({ event: 'listening' }), null);
});

test('a project line is the watcher\'s kind and what it said', () => {
  assert.deepEqual(projectLine({ ts: 't', event: 'waiting', title: ' Which port? ' }), { kind: 'waiting', known: true, said: 'Which port?', ts: 't' });
  assert.equal(projectLine({ event: 'strange' }).known, false);
  assert.equal(projectLine({ event: 'finished', summary: 'Done', title: 5 }).said, 'Done');
  assert.equal(rowsSignature([{ ts: 'a' }, { ts: 'b' }]), '2:a');
  assert.notEqual(rowsSignature(null), rowsSignature([{ ts: 'a' }]));
  assert.notEqual(rowsSignature(null), rowsSignature([]), 'no answer is not an empty answer');
});

test('every sentence the page may choose exists in English and Portuguese', () => {
  const keys = new Set([
    ...Object.keys(PROBLEM_EVENTS).map((e) => `logs.event.${e}`),
    ...ROUTINE_EVENTS.map((e) => `logs.event.${e}`),
    ...PROJECT_KINDS.map((k) => `logs.kind.${k}`),
    ...['http401', 'http403', 'http429', 'http5xx', 'http', 'answer-cut', 'network', 'timeout', 'invalid-answer', 'quota', 'denied', 'disk-full', 'other'].map((w) => `logs.why.${w}`),
    'logs.level.warn', 'logs.level.error', 'logs.times.one', 'logs.times.other', 'tab.logs', 'soon.logs.what',
  ]);
  for (const key of keys) for (const lang of ['en', 'pt-BR']) assert.ok(LANGS[lang][key], `${lang} ${key}`);
  // Every reasonOf key is one of the above.
  for (const e of ['http-401', 'http-403', 'http-429', 'http-500', 'http-404', 'answer-cut', 'network', 'timeout', 'invalid-answer', 'quota-x', 'EACCES', 'ENOSPC', 'zzz']) {
    assert.ok(keys.has(reasonOf({ error: e }).key), e);
  }
});

// ---- the page, on a tiny element tree ----------------------------------------------------------------------------

const kids = (c) => c.flat(Infinity).filter((x) => x != null && x !== false);
const h = (tag, attrs = {}, ...children) => ({ tag, attrs: attrs ?? {}, children: kids(children), replaceChildren(...c) { this.children = kids(c); this.draws = (this.draws ?? 0) + 1; } });
const icon = (name, cls) => h('svg', { class: cls, 'data-icon': name });
const textOf = (n) => (typeof n === 'string' ? n : n.children.map(textOf).join(' '));
const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
const withClass = (n, cls) => walk(n).filter((x) => (x.attrs.class ?? '').split(/\s+/).includes(cls));
const flush = () => new Promise((r) => setImmediate(r));

function make({ lang = 'en', program = programRows(), projectRows = [], projects = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }] } = {}) {
  const calls = { logs: [], project: [] };
  const box = { program, projectRows, programAnswer: null };
  const ctx = {
    h, icon, t: translator(lang), lang: () => lang, now: () => NOW, errorText: (c) => `ERR:${c}`, fmt: { relative: (iso) => `ago ${iso.slice(0, 10)}` },
    projects: () => projects, project: () => projects[0] ?? null,
    api: {
      logs: async (q) => { calls.logs.push(q); return box.programAnswer ?? { ok: true, rows: box.program }; },
      projectLog: async (id, q) => { calls.project.push([id, q]); return { ok: true, rows: box.projectRows[id] ?? [] }; },
    },
  };
  return { view: createLogsView(ctx), root: h('div'), calls, box };
}

test('the page puts the two problems first, in plain words, with count, reason and whether they still happen', async () => {
  const { view, root, calls } = make();
  await view.render(root);
  assert.deepEqual(calls.logs, [{ limit: 1000 }]);
  const groups = withClass(root, 'lg-group');
  assert.equal(groups.length, 2);
  const [first, second] = groups.map(textOf);
  assert.match(first, /The call to DeepSeek failed/);
  assert.match(first, /4 times/);
  assert.match(first, /the answer came back cut in the middle/);
  assert.match(first, /Still happening/);
  assert.match(second, /The price list of OpenAI could not be read/);
  assert.match(second, /10 times/);
  assert.match(second, /the service refused access \(error 403\)/);
  assert.match(second, /Not seen in the last 24 hours/);
  assert.match(textOf(root), /\d+ lines/, 'the header says how many lines it read');
  assert.equal(withClass(groups[1], 'lg-raw').length, 5, 'the technical lines open inside the group');
  assert.match(textOf(withClass(groups[1], 'lg-raw')[0]), /"event":"ai-prices-failed"/);
});

test('the same page in Portuguese says the same in Portuguese', async () => {
  const { view, root } = make({ lang: 'pt-BR' });
  await view.render(root);
  const text = textOf(root);
  assert.match(text, /Não consegui ler a lista de preços de OpenAI/);
  assert.match(text, /10 vezes/);
  assert.match(text, /o serviço recusou o acesso \(erro 403\)/);
  assert.match(text, /A chamada ao DeepSeek falhou/);
  assert.doesNotMatch(text, /logs\./, 'no key is left showing');
});

test('the routine sits in a fold of its own, newest first, each line opening into its technical form', async () => {
  const { view, root } = make();
  await view.render(root);
  const routine = withClass(root, 'lg-routine')[0];
  const lines = withClass(routine, 'lg-line');
  assert.equal(lines.length, 2);
  assert.match(textOf(lines[0]), /The program started and is listening/);
  assert.match(textOf(lines[1]), /The program is restarting/);
  assert.match(textOf(withClass(lines[0], 'lg-raw')[0]), /"port":4321/);
});

test('no problems says so calmly, with the date the diary starts', async () => {
  const { view, root } = make({ program: [row('2026-10-15T10:00:00.000Z', 'info', 'listening')] });
  await view.render(root);
  assert.equal(withClass(root, 'lg-group').length, 0);
  assert.match(textOf(root), /No problems written down/);
  assert.match(textOf(root), /Nothing failed since/);
});

test('a refused or failed read shows the program\'s own error words, never a blank page', async () => {
  const { view, root, box } = make();
  box.programAnswer = { ok: false, error: 'demo' };
  await view.render(root);
  assert.match(textOf(root), /ERR:demo/);
  assert.equal(withClass(root, 'lg-group').length, 0);
});

test('By project reads the open project\'s record, and picking another project reads that one', async () => {
  const waiting = row('2026-10-16T10:00:00.000Z', 'info', 'waiting', { project: 'alpha', title: 'Which port should it use?' });
  const { view, root, calls } = make({ projectRows: { alpha: [waiting], beta: [] } });
  await view.render(root);
  assert.deepEqual(calls.project, [['alpha', { limit: 200 }]]);
  let text = textOf(withClass(root, 'lg-sec').at(-1));
  assert.match(text, /A chat is waiting for you/);
  assert.match(text, /Which port should it use\?/);
  const select = walk(root).find((x) => x.tag === 'select');
  assert.deepEqual(select.children.map((o) => o.attrs.value), ['alpha', 'beta']);
  select.attrs.onchange({ target: { value: 'beta' } });
  await flush();
  assert.deepEqual(calls.project.at(-1), ['beta', { limit: 200 }]);
  text = textOf(withClass(root, 'lg-sec').at(-1));
  assert.match(text, /Nothing written down for this project yet/);
  assert.doesNotMatch(text, /Which port/);
});

test('a polled refresh draws again only when a new line arrived', async () => {
  const { view, root, box } = make();
  await view.render(root);
  const draws = root.draws;
  await view.refresh(root);
  assert.equal(root.draws, draws, 'same lines: no redraw');
  box.program = [row('2026-10-16T11:55:00.000Z', 'warn', 'request-failed', { path: '/api/x', error: 'boom' }), ...programRows()];
  await view.refresh(root);
  assert.equal(root.draws, draws + 1, 'a new line: one redraw');
  assert.equal(withClass(root, 'lg-group').length, 3);
  assert.match(textOf(withClass(root, 'lg-group')[0]), /A request from the page failed inside the program/);
});

test('a group the person opened stays open when the page is drawn again', async () => {
  const { view, root, box } = make();
  await view.render(root);
  const fold = walk(root).find((x) => x.tag === 'details' && x.attrs['data-key']?.startsWith('g:'));
  fold.attrs.ontoggle({ target: { open: true } });
  box.program = [row('2026-10-16T11:55:00.000Z', 'info', 'action', { kind: 'x' }), ...programRows()];
  await view.refresh(root);
  const again = walk(root).find((x) => x.tag === 'details' && x.attrs['data-key'] === fold.attrs['data-key']);
  assert.equal(again.attrs.open, true, 'still open');
});

test('the area is hung in the registry and given its own ctx by the page', () => {
  const areas = createAreas({ h, icon, t: () => translator('en'), own: {}, logs: { h, icon, t: translator('en'), api: {}, projects: () => [] } });
  assert.equal(areas.ready().logs, true);
  assert.equal(createAreas({ h, icon, t: () => translator('en'), own: {} }).ready().logs, false, 'without its ctx the area counts as not there');
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  assert.match(app, /logs: \{\s*h, icon, t: \(key, vars\) => t\(key, vars\), lang: \(\) => lang, api, errorText/, 'app.js hands the Logs view its ctx');
  const page = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  assert.match(page, /<section id="view-logs" class="view"/);
  assert.match(page, /css\/fd-logs\.css/);
});
