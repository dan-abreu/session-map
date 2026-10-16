// The chat around the map (pc18, pc19): one header line with everything else in its ⋯, a turn's steps folded into one
// line, quick replies only from options really written at the end of the last reply, one working line with Stop, the key
// hints inside the box, a run menu with three ways and a small Configurações sheet with the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChat } from '../server/web/chat.js';
import { createRunSettings } from '../server/web/runsettings.js';
import { quickReplies } from '../server/web/chatfold.js';
import { stepRuns, stepCounts } from '../server/web/views.js';
import { LANGS } from '../server/web/i18n.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---- quick replies: only what the reply really offers ----

test('quick replies: a numbered or lettered list after a question at the end of the reply becomes its options', () => {
  assert.deepEqual(quickReplies('Arrumei as setas.\n\nQual você prefere?\n1. Juntar numa seta só\n2. Mostrar cada uma').map((o) => [o.key, o.text]),
    [['1', 'Juntar numa seta só'], ['2', 'Mostrar cada uma']]);
  assert.deepEqual(quickReplies('Which one should I do?\n\na) Keep the old page\nb) Write a new one\nc) Leave it').map((o) => [o.key, o.text]),
    [['a', 'Keep the old page'], ['b', 'Write a new one'], ['c', 'Leave it']]);
  // The list may come first and the question after it, and an option may be bold with a description.
  const opts = quickReplies('Achei dois caminhos:\n\n1. **Juntar as saídas** — uma seta só por passo.\n2. **Separar** — cada saída com a sua seta.\n\nQual prefere?');
  assert.deepEqual(opts.map((o) => o.label), ['Juntar as saídas', 'Separar'], 'the bold head is the button');
  assert.equal(opts[0].text, 'Juntar as saídas — uma seta só por passo', 'the whole option is what goes');
});

test('quick replies: "X ou Y?" at the very end becomes two options, in Portuguese and English', () => {
  assert.deepEqual(quickReplies('Falta uma decisão sua: quando um passo tem muitas saídas, prefere que eu junte as setas numa só ou que mostre cada uma separada?').map((o) => o.text),
    ['Junte as setas numa só', 'Mostre cada uma separada']);
  assert.deepEqual(quickReplies('Pronto. Quer que eu salve agora ou depois?').map((o) => o.text), ['Salve agora', 'Depois']);
  assert.deepEqual(quickReplies('Done. Should I merge the arrows into one or show each one?').map((o) => o.text), ['Merge the arrows into one', 'Show each one']);
  assert.deepEqual(quickReplies('Do you want me to keep the old API or remove it?').map((o) => o.text), ['Keep the old API', 'Remove it']);
  assert.deepEqual(quickReplies('Would you like me to fix it now or later?').map((o) => o.text), ['Fix it now', 'Later']);
});

test('quick replies: a list is a set of choices only when the question asks to choose', () => {
  // The line above the list asks to choose, though the reply closes with a looser question.
  assert.deepEqual(quickReplies('Escolha uma opção:\n1. Juntar\n2. Separar\n\nO que acha?').map((o) => o.text), ['Juntar', 'Separar']);
  // A report of work done, or steps for the person, is not a set of options whatever question closes the reply.
  const reports = [
    'Resumo:\n\n1. Mudei X\n2. Mudei Y\n\nQuer que eu faça o commit?',
    'Fiz isto:\n1. Criei o arquivo\n2. Rodei os testes\n3. Atualizei a doc\n\nTudo certo, o que acha?',
    'Passos para você:\n1. Abra o terminal\n2. Rode npm test\n\nConseguiu?',
    'Done:\n1. Moved the file\n2. Ran the tests\n\nShall I commit?',
  ];
  for (const text of reports) assert.deepEqual(quickReplies(text), [], JSON.stringify(text));
});

test('quick replies: a closing question that does not point at the list leaves a report without buttons', () => {
  const reports = [
    'Terminei:\n1. Criei o arquivo\n2. Rodei os testes\n\nQual o próximo passo?',
    'Fiz 3 coisas:\n1. Mudei o título\n2. Troquei a cor\n3. Rodei os testes\n\nAlguma opção de melhoria que você queira?',
    'Done:\n1. Added the route\n2. Wrote the tests\n\nWhich branch should I push to?',
    'Os passos foram:\n1. Abrir o arquivo\n2. Salvar\n\nQuais arquivos devo revisar agora?',
    'Resumo:\n1. Mudei X\n2. Mudei Y\n\nPrefere que eu faça o commit agora?',
    // "opções" names a choice, but these were already made: only a question that picks one asks for them.
    'Mudei estas opções:\n1. Tema escuro\n2. Fonte maior\n\nFicou bom?',
  ];
  for (const text of reports) assert.deepEqual(quickReplies(text), [], JSON.stringify(text));
  // A question that points at the list keeps its buttons.
  assert.deepEqual(quickReplies('Encontrei dois problemas:\n1. O botão some\n2. A cor está errada\n\nQual deles corrijo primeiro?').map((o) => o.text),
    ['O botão some', 'A cor está errada']);
  assert.deepEqual(quickReplies('Two ways:\n1. Rebuild the map\n2. Only fix the colours\n\nWhich one do you prefer?').map((o) => o.text),
    ['Rebuild the map', 'Only fix the colours']);
  assert.deepEqual(quickReplies('Options:\n1. Keep it\n2. Drop it\n\nWhich would you like?').map((o) => o.text), ['Keep it', 'Drop it']);
});

test('quick replies: an "ou" inside a "se" or "whether" clause is no choice; its second half would send a claim', () => {
  const none = [
    'Quer que eu verifique se o arquivo existe ou se foi apagado?',
    'Quer que eu veja se o teste passa ou se falha?',
    'Posso conferir se o servidor caiu ou se só demorou?',
    'Should I check whether it exists or was deleted?',
    'Do you want me to see if it passes or fails?',
  ];
  for (const text of none) assert.deepEqual(quickReplies(text), [], JSON.stringify(text));
});

test('quick replies: "X ou Y?" needs a clear choice; a negation, a courtesy or a yes/no gives no buttons', () => {
  const none = [
    // The negation would be lost and the first button would ask for the opposite (a delete).
    'Você não quer apagar os arquivos ou prefere manter tudo?',
    "Don't you want me to delete it or keep it?",
    // Courtesy and rhetorical questions offer no choice.
    'Feito. Alguma dúvida ou comentário?',
    'Isso funciona ou não?',
    'Pronto! Posso ajudar com mais alguma coisa ou quer revisar?',
    'Anything else or should I stop?',
    // No word that asks to choose: the sides are not answers.
    'Vou usar o `foo` ou `bar`?',
    'Sim ou não?',
    // The two sides are not alike: one still carries its own "prefere".
    'Quer que eu junte as setas ou prefere revisar antes?',
  ];
  for (const text of none) assert.deepEqual(quickReplies(text), [], JSON.stringify(text));
});

test('quick replies: nothing is invented where the reply offers no explicit options', () => {
  const none = [
    'Pronto, terminei.',
    'Quer que eu continue?',
    // A list that is not a choice: a summary, with no question.
    'Fiz assim:\n1. Mudei o arquivo\n2. Rodei os testes',
    // A choice in the middle, then more text: the reply does not end on it.
    'Qual prefere?\n1. A\n2. B\n\nEnquanto isso, vou rodar os testes.',
    // One option only, or numbers out of order.
    'Qual prefere?\n1. Só esta',
    'Qual prefere?\n1. Esta\n3. Aquela',
    // Inside code.
    'Qual prefere?\n```\n1. A\n2. B\n```',
    // "ou" that is not two short alternatives.
    'Ou seja, terminou?',
    'Você prefere que eu reescreva toda a página de configurações com o novo desenho, os textos e as cores ou que eu deixe tudo como está e só corrija o erro de digitação no título principal da página?',
    'Two or three?\n\nAnyway, it works now.',
    '',
  ];
  for (const text of none) assert.deepEqual(quickReplies(text), [], JSON.stringify(text));
  assert.deepEqual(quickReplies(null), []);
});

// ---- the steps of a turn ----

const TURN = [
  { type: 'user', text: 'Fix it', ts: '2026-10-11T10:00:00.000Z' },
  { type: 'thinking', text: 'Let me look', ms: 2000, ts: '2026-10-11T10:00:01.000Z' },
  { type: 'tool', id: 't1', name: 'Read', step: { kind: 'read', target: 'a.js' }, input: '{}', result: 'x', isError: false, ts: '2026-10-11T10:00:02.000Z' },
  { type: 'tool', id: 't2', name: 'Read', step: { kind: 'read', target: 'b.js' }, input: '{}', result: 'x', isError: false, ts: '2026-10-11T10:00:03.000Z' },
  { type: 'tool', id: 't3', name: 'Read', step: { kind: 'read', target: 'a.js' }, input: '{}', result: 'x', isError: false, ts: '2026-10-11T10:00:04.000Z' },
  { type: 'tool', id: 't4', name: 'Edit', step: { kind: 'edit', target: 'a.js' }, input: '{}', result: 'ok', isError: false, ts: '2026-10-11T10:00:05.000Z' },
  { type: 'assistant', text: 'Done.', ts: '2026-10-11T10:00:06.000Z' },
];

test('a turn\'s tool and thinking rows are one run; it counts its steps, the files read and the files changed', () => {
  assert.deepEqual(stepRuns(TURN), [{ start: 1, end: 6 }]);
  assert.deepEqual(stepCounts(TURN.slice(1, 6)), { steps: 4, read: 2, changed: 1 });
  assert.deepEqual(stepRuns([TURN[0], TURN[1], TURN[6]]), [], 'thinking alone is not folded');
  const split = [TURN[0], TURN[2], { type: 'assistant', text: 'Now the edit.' }, TURN[5], { type: 'permission', state: 'asked' }, TURN[3]];
  assert.deepEqual(stepRuns(split), [{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 6 }], 'a reply or a permission between them breaks the run');
});

// ---- the sheet, with just enough DOM ----

class El {
  constructor(tag = 'div', attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs ?? {};
    this.children = children;
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = attrs?.value ?? '';
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.clientHeight = 0;
    this.dataset = {};
    this.style = {};
    this.open = Boolean(attrs?.open);
    this.classes = new Set(String(this.attrs.class ?? '').split(' ').filter(Boolean));
    this.classList = { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)), contains: (c) => this.classes.has(c) };
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, evt = {}) {
    const e = { prevented: false, preventDefault() { e.prevented = true; }, stopPropagation() {}, target: this, ...evt };
    for (const fn of this.listeners[type] ?? []) fn(e);
    return e;
  }
  replaceChildren(...cs) { this.children = cs; }
  append(...cs) { this.children.push(...cs); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  contains(other) { return walk(this).includes(other); }
  getBoundingClientRect() { return { top: 100, height: 20 }; }
  focus() { globalThis.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
}
const h = (tag, attrs, ...kids) => new El(tag, attrs, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const walk = (el, out = []) => {
  if (el instanceof El) { out.push(el); for (const c of el.children) walk(c, out); }
  return out;
};
const text = (el) => walk(el).flatMap((e) => e.children.filter((c) => typeof c === 'string')).join(' ');
const by = (el, attr, value) => walk(el).find((e) => e.attrs?.[attr] === value);

const ROLES = ['log', 'form', 'input', 'send', 'stop', 'title', 'context', 'dot', 'status', 'live', 'list', 'note', 'close', 'where', 'brain',
  'find', 'tasks', 'attach', 'filepick', 'pending', 'suggest', 'more', 'moremenu', 'tools'];
function sheet() {
  const parts = new Map(ROLES.map((r) => [r, new El()]));
  parts.get('live').children = [parts.get('status'), parts.get('stop')];
  const root = new El('aside', {}, [parts.get('title'), parts.get('more'), parts.get('moremenu'), parts.get('find'), parts.get('log'), parts.get('live'), parts.get('form')]);
  root.hidden = true;
  root.querySelector = (sel) => parts.get(/data-chat="(\w+)"/.exec(sel)?.[1]) ?? null;
  return { root, part: (r) => parts.get(r) };
}

globalThis.document ??= { activeElement: null, hidden: false, contains: () => true, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); } };
document.listeners ??= {};

const S1 = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(32);

function server(routes) {
  const calls = [];
  globalThis.fetch = async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    const hit = Object.entries(routes).find(([prefix]) => `${init.method ?? 'GET'} ${path}`.startsWith(prefix));
    const data = hit ? hit[1](body, path) : { error: 'not-found' };
    return { ok: !data.error, status: data.error ? 404 : 200, json: async () => JSON.parse(JSON.stringify(data)) };
  };
  const streams = [];
  globalThis.EventSource = class { constructor(url) { this.url = url; this.listeners = {}; streams.push(this); } addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); } close() { this.closed = true; } };
  return { calls, streams };
}
const sse = (stream, type, data, id) => { for (const fn of stream.listeners[type] ?? []) fn({ data: JSON.stringify(data), lastEventId: String(id) }); };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const tt = () => (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

function makeChat(extra = {}) {
  const s = sheet();
  const chat = createChat({ root: s.root, h, t: tt, toast() {}, errorText: (e) => e, storage: null, savedKey: null, relative: () => 'now', money: (v) => `$${v.toFixed(2)}`, ...extra });
  return { chat, ...s };
}
const history = (items, extra = {}) => ({ sessionId: S1, title: 'Arrows', mode: 'settings', chatKey: null, settings: { mode: 'default', downgraded: false }, messages: [], items, version: 'v1', ...extra });
const openOld = (chat) => chat.open({ projectId: 'shop', title: 'Arrows', subtitle: 'shop › Web › Flow', start: { sessionId: S1 } });

test('the steps of a turn fold into one row that says what was done; the rows are inside it', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history(TURN) });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  const groups = walk(part('log')).filter((e) => e.classes.has('msg-steps'));
  assert.equal(groups.length, 1);
  const summary = walk(groups[0]).find((e) => e.tag === 'summary');
  for (const words of ['chat.steps.done.other(4)', 'chat.steps.read.other(2)', 'chat.steps.changed.one(1)']) assert.ok(text(summary).includes(words), words);
  const inside = walk(groups[0]).filter((e) => e.classes.has('msg-tool') || e.classes.has('msg-thinking'));
  assert.equal(inside.length, 5, 'four steps and the thinking, folded inside');
  const top = part('log').children;
  assert.ok(top.some((e) => e.classes?.has('msg-claude')), 'the reply stays outside, in plain sight');
  assert.ok(!top.some((e) => e.classes?.has('msg-tool')), 'no step row loose in the log');
});

test('while a turn runs, its steps say "doing" and one working line with the current step and Stop sits above the box', async () => {
  const { streams } = server({ [`GET /api/chat/history/${S1}`]: () => history(TURN.slice(0, 1), { chatKey: KEY, running: true }) });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  sse(streams.at(-1), 'tool', { phase: 'use', id: 'r1', name: 'Read', input: '{}', step: { kind: 'read', target: 'arrows.js' } }, 1);
  await settle();
  assert.equal(part('live').hidden, false);
  assert.equal(part('stop').hidden, false);
  assert.ok(text(part('status')).includes('chat.live.working'));
  assert.ok(text(part('status')).includes('live.step.read(arrows.js)'), 'the step being done now');
  assert.ok(text(part('log')).includes('chat.steps.doing.one(1)'));
  sse(streams.at(-1), 'tool', { phase: 'result', id: 'r1', text: 'x', isError: false }, 2);
  sse(streams.at(-1), 'text', { text: 'Ready.' }, 3);
  sse(streams.at(-1), 'turn-end', { costUSD: 0.1 }, 4);
  await settle();
  assert.equal(part('live').hidden, false, 'the state line stays: it says what the chat is now (pc25)');
  assert.equal(part('stop').hidden, true, 'no Stop once the turn ended');
  assert.ok(text(part('status')).includes('chat.finished'), 'finished, with the summary');
});

test('quick replies show under the last reply only; a click sends that option\'s text, with "or answer in your words" under them', async () => {
  const items = [{ type: 'user', text: 'Clean the arrows' }, { type: 'assistant', text: 'Feito.\n\nQual prefere?\n1. Juntar numa seta só\n2. Mostrar cada uma' }];
  const { calls } = server({ [`GET /api/chat/history/${S1}`]: () => history(items), 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  const buttons = walk(part('log')).filter((e) => e.attrs?.['data-quick']);
  assert.deepEqual(buttons.map((b) => b.attrs['data-quick']), ['1', '2']);
  assert.ok(text(part('log')).includes('chat.quick.or'));
  buttons[0].attrs.onclick();
  await settle();
  assert.equal(calls.find((c) => c.path === '/api/chat/start').body.text, 'Juntar numa seta só');
  assert.equal(walk(part('log')).filter((e) => e.attrs?.['data-quick']).length, 0, 'gone once answered');
});

test('no quick replies for a reply without options, nor while Claude works', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history([{ type: 'user', text: 'Hi' }, { type: 'assistant', text: 'Pronto, terminei.' }]) });
  const one = makeChat();
  openOld(one.chat);
  await settle();
  assert.equal(walk(one.part('log')).filter((e) => e.attrs?.['data-quick']).length, 0);
  server({ [`GET /api/chat/history/${S1}`]: () => history([{ type: 'user', text: 'Hi' }, { type: 'assistant', text: 'Sim ou não?' }], { chatKey: KEY, running: true }) });
  const two = makeChat();
  openOld(two.chat);
  await settle();
  assert.equal(walk(two.part('log')).filter((e) => e.attrs?.['data-quick']).length, 0);
});

test('the header: a state dot with its words, the title and the part as a chip with the whole path in its tooltip', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history([{ type: 'user', text: 'Hi' }, { type: 'assistant', text: 'Prefere A ou B?' }]) });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  assert.equal(part('context').textContent, 'Flow', 'the part, not the whole path');
  assert.equal(part('context').attrs.title, 'shop › Web › Flow');
  assert.equal(part('dot').hidden, false);
  assert.equal(part('dot').dataset.state, 'waiting', 'a reply that ends asking waits for the person');
  assert.match(part('dot').attrs['aria-label'], /chat\.state\.finished/, 'the state in words, for a screen reader and the tooltip');
});

test('the dot waits by the pill\'s own rule when the page knows the conversation; the text is only the fallback', async () => {
  const ask = history([{ type: 'user', text: 'Hi' }, { type: 'assistant', text: 'Prefere A ou B?' }]);
  server({ [`GET /api/chat/history/${S1}`]: () => ask });
  // Old or archived: the pill does not count it, and the dot does not wait either.
  const old = makeChat({ waitingOf: () => false });
  openOld(old.chat);
  await settle();
  assert.equal(old.part('dot').dataset.state, 'quiet');
  // A fresh one the state has not listed yet: the reply's own question decides.
  const fresh = makeChat({ waitingOf: () => null });
  openOld(fresh.chat);
  await settle();
  assert.equal(fresh.part('dot').dataset.state, 'waiting');
  // The page's state changes at a poll: the dot follows without a new event of the chat.
  let waits = true;
  server({ [`GET /api/chat/history/${S1}`]: () => history([{ type: 'user', text: 'Hi' }, { type: 'assistant', text: 'Done.' }]) });
  const known = makeChat({ waitingOf: () => waits });
  openOld(known.chat);
  await settle();
  assert.equal(known.part('dot').dataset.state, 'waiting', 'the waiting signal of the state decides');
  waits = false;
  known.chat.refreshDot();
  assert.equal(known.part('dot').dataset.state, 'quiet');
});

const ACTIONS = (done) => (sessionId) => [
  { id: 'rename', label: 'Renomear ou mover', run: () => done.push(['rename', sessionId]) },
  { id: 'archive', label: 'Arquivar', run: () => done.push(['archive', sessionId]) },
  { id: 'open', label: 'Abrir num terminal', run: () => done.push(['open', sessionId]) },
  { id: 'delete', label: 'Apagar', run: () => done.push(['delete', sessionId]) },
];

test('the ⋯ holds every moved action: about this part, find, rename or move, archive, open in a terminal, delete, new conversation', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history(TURN) });
  const done = [];
  const { chat, part } = makeChat({ more: ACTIONS(done), about: () => () => done.push(['about']) });
  chat.open({ projectId: 'shop', title: 'Arrows', subtitle: 'Flow', start: { sessionId: S1 }, newChat: () => done.push(['new']) });
  await settle();
  assert.equal(part('more').hidden, false);
  part('more').fire('click');
  assert.equal(part('moremenu').hidden, false);
  const rows = walk(part('moremenu')).filter((e) => e.attrs.role === 'menuitem');
  assert.deepEqual(rows.map((r) => r.attrs['data-more']), ['about', 'book', 'find', 'rename', 'archive', 'open', 'delete', 'new']);
  assert.ok(text(rows[0]).includes('chat.about') && text(rows[2]).includes('chat.find') && text(rows[7]).includes('chat.moreNew'));
  rows[0].attrs.onclick();
  assert.deepEqual(done, [['about']]);
  assert.equal(part('moremenu').hidden, true, 'a choice closes it');
  part('more').fire('click');
  walk(part('moremenu')).find((e) => e.attrs['data-more'] === 'new').attrs.onclick();
  assert.deepEqual(done.at(-1), ['new']);
});

test('find lives in the ⋯ and on Ctrl F: hidden until asked, Esc puts it away', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history(TURN) });
  const { chat, part, root } = makeChat();
  openOld(chat);
  await settle();
  assert.equal(part('find').hidden, true, 'not in the way while reading');
  part('more').fire('click');
  walk(part('moremenu')).find((e) => e.attrs['data-more'] === 'find').attrs.onclick();
  assert.equal(part('find').hidden, false);
  const input = walk(part('find')).find((e) => e.tag === 'input');
  assert.equal(document.activeElement, input, 'the cursor goes to the search');
  assert.ok(walk(part('find')).some((e) => e.tag === 'select'), '"Go to" sits beside it');
  input.fire('keydown', { key: 'Escape' });
  assert.equal(part('find').hidden, true);
  const e = root.fire('keydown', { key: 'f', ctrlKey: true });
  assert.equal(e.prevented, true, 'the page\'s own find, not the browser\'s');
  assert.equal(part('find').hidden, false);
});

test('closing find in a conversation that is only read here gives the focus to the ⋯, not to a hidden box', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history(TURN) });
  const { chat, part } = makeChat();
  openOld(chat);
  await settle();
  part('more').fire('click');
  walk(part('moremenu')).find((e) => e.attrs['data-more'] === 'find').attrs.onclick();
  part('form').hidden = true;
  walk(part('find')).find((e) => e.tag === 'input').fire('keydown', { key: 'Escape' });
  assert.equal(part('find').hidden, true);
  assert.equal(document.activeElement, part('more'));
  part('form').hidden = false;
  part('more').fire('click');
  walk(part('moremenu')).find((e) => e.attrs['data-more'] === 'find').attrs.onclick();
  walk(part('find')).find((e) => e.tag === 'input').fire('keydown', { key: 'Escape' });
  assert.equal(document.activeElement, part('input'), 'where the person can write, back to the box');
});

// ---- how the conversation runs (id146): the brain's line by Send ----

const LIST_RUN = { chats: [], settings: { mode: 'default', downgraded: false }, reinforce: { limitUSD: 20, spentUSD: 3 } };
const openPart = (chat) => chat.open({ projectId: 'shop', title: 'Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
const byRun = (el, name) => by(el, 'data-run', name);

test('the brain\'s line by Send is quiet until a run event, then says the model and the reasoning; the why is in the tooltip', async () => {
  const { streams } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  part('input').value = 'Fix it';
  part('form').fire('submit');
  await settle();
  assert.equal(part('brain').hidden, true, 'nothing before the first run event');
  sse(streams.at(-1), 'run', { run: { kind: 'talk' }, model: 'claude-opus-5-5', effort: 'high', brain: { phase: 'build', why: 'money' }, costUSD: 0.1 }, 1);
  assert.equal(part('brain').hidden, false);
  const line = text(part('brain'));
  assert.ok(line.includes('Opus 5.5') && line.includes('run.effort.high') && !line.includes('run.brain.'), line);
  assert.equal(part('brain').attrs.title, 'chat.brainTitle\nchat.brainWhy(run.brain.money)', 'the why rides in the tooltip');
});

test('a new conversation sends no run of its own: the Cérebro routes, and Configurações keeps only what is left', async () => {
  const { calls } = server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  part('input').value = 'Go';
  part('form').fire('submit');
  await settle();
  assert.equal('run' in calls.find((c) => c.path === '/api/chat/start').body, false, 'no way, no model chips (id146)');
});

// ---- Configurações ----

function makeSettings(extra = {}) {
  const dialog = new El('dialog');
  const pcModes = [];
  const saved = [];
  const sheetCtl = createRunSettings({
    dialog, h, t: tt, money: (v) => `$${v.toFixed(2)}`, toast() {}, errorText: (e) => e,
    limit: { read: async () => ({ ok: true, limitUSD: 20, spentUSD: 3 }), save: async (usd) => { saved.push(usd); return { ok: true, limitUSD: usd }; } },
    onPcMode: (mode) => pcModes.push(mode),
    ...extra,
  });
  return { sheetCtl, dialog, pcModes, saved };
}

test('Configurações holds the monthly limit, the permission mode and every Claude on this PC; the ways left with the brain', async () => {
  server({ 'GET /api/chat/list': () => LIST_RUN, 'POST /api/chat/start': () => ({ chatKey: KEY }) });
  const { chat, part } = makeChat();
  openPart(chat);
  await settle();
  const { sheetCtl, dialog, pcModes, saved } = makeSettings();
  await sheetCtl.open(chat.settings());
  assert.equal(dialog.open, true);
  for (const tag of ['limit', 'limit-save', 'mode', 'pcmode']) assert.ok(by(dialog, 'data-set', tag), tag);
  assert.equal(by(dialog, 'data-set', 'self'), undefined, '"may reinforce on its own" left with the ways');
  assert.ok(text(dialog).includes('run.limitUsed($3.00,$20.00)'), 'the same numbers as the Home card');

  const field = by(dialog, 'data-set', 'limit');
  field.value = '30';
  by(dialog, 'data-set', 'limit-save').attrs.onclick();
  await settle();
  assert.deepEqual(saved, [30]);

  by(dialog, 'data-set', 'mode').value = 'acceptEdits';
  by(dialog, 'data-set', 'mode').fire('change');
  assert.equal(chat.settings().choice(), 'acceptEdits');
  by(dialog, 'data-set', 'pcmode').attrs.onclick();
  assert.deepEqual(pcModes, ['acceptEdits']);
});

test('opened from the person\'s menu with no conversation, Configurações keeps the limit and the PC\'s mode and says where the rest is', async () => {
  const { sheetCtl, dialog, pcModes } = makeSettings();
  await sheetCtl.open(null);
  assert.ok(by(dialog, 'data-set', 'limit'));
  assert.equal(by(dialog, 'data-set', 'self'), undefined);
  assert.equal(by(dialog, 'data-set', 'way-maestro'), undefined);
  assert.ok(text(dialog).includes('settings.noChat'));
  by(dialog, 'data-set', 'mode').value = 'auto';
  by(dialog, 'data-set', 'mode').fire('change');
  by(dialog, 'data-set', 'pcmode').attrs.onclick();
  assert.deepEqual(pcModes, ['auto']);
});

// ---- the page ----

const html = read('server/web/index.html');
const sheetOf = (id) => {
  const from = html.indexOf(`<aside id="${id}"`);
  return html.slice(from, html.indexOf('</aside>', from));
};

test('both sheets: one header line (dot, title, part, ⋯, ×), the working line with Stop above the box, the key hints inside it', () => {
  for (const id of ['chat', 'flowChat']) {
    const s = sheetOf(id);
    const head = s.slice(s.indexOf('chat-head'), s.indexOf('data-chat="close"') + 20);
    const order = ['data-chat="dot"', 'data-chat="title"', 'data-chat="context"', 'data-chat="more"', 'data-chat="close"'].map((r) => head.indexOf(r));
    assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), `${id}: ${order}`);
    assert.match(head, /data-chat="moremenu"[^>]*role="menu"/);
    assert.ok(!s.includes('data-chat="new"'), `${id}: New chat lives in the ⋯`);
    assert.ok(!s.includes('chat-crumbs'), `${id}: the path is the part chip's tooltip`);
    assert.ok(!s.includes('chat-keys'), `${id}: no separate hints line`);
    const box = s.slice(s.indexOf('class="chat-box"'), s.indexOf('data-chat="send"'));
    assert.match(box, /data-chat="hints"[^>]*data-i18n-title="chat\.keys"/, `${id}: the hints inside the box, the whole list as the tooltip`);
    // One piece per key, so a narrow sheet drops whole pieces and never cuts one ("/ com…").
    const hints = /<span class="chat-hints"[^>]*>([\s\S]*?)<\/span>\s*<span class="chat-cost/.exec(box)?.[1] ?? '';
    assert.deepEqual([...hints.matchAll(/data-i18n="([\w.]+)"/g)].map((m) => m[1]), ['chat.hint.send', 'chat.hint.file', 'chat.hint.command'], id);
    const live = s.slice(s.indexOf('data-chat="live"'), s.indexOf('data-chat="input"'));
    assert.ok(live.includes('data-chat="status"') && live.includes('data-chat="stop"'), `${id}: Stop sits in the working line`);
    for (const gone of ['mode', 'pcmode', 'advanced', 'manualways']) assert.ok(!s.includes(`data-chat="${gone}"`), `${id}: ${gone} moved to Configurações`);
  }
});

test('nothing in the header and the box is cut mid-word: the hints drop whole pieces, the part gives way before the title', () => {
  const css = read('server/web/style.css');
  const rule = (sel) => new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const hints = rule('.chat-hints');
  assert.doesNotMatch(hints, /text-overflow/, 'no ellipsis in the hints');
  assert.match(hints, /flex-wrap:\s*wrap/);
  assert.match(hints, /overflow:\s*hidden/);
  assert.match(rule('.chat-hints > span'), /white-space:\s*nowrap/, 'a piece never breaks');
  // The title shrinks only once the part chip has nothing left to give: a share of a pixel would already show "…".
  const shrink = (body) => Number(/flex:\s*\S+\s+([\d.e-]+)\s/.exec(body)?.[1]);
  const title = shrink(rule('.chat-head h2'));
  const part = shrink(rule('.chat-part'));
  assert.ok(part / title >= 1e5, `part ${part} / title ${title}`);
  for (const [lang, dict] of Object.entries(LANGS)) for (const k of ['chat.hint.send', 'chat.hint.file', 'chat.hint.command']) assert.ok(dict[k], `${lang}: ${k}`);
  assert.equal(LANGS['pt-BR']['chat.hint.command'], '/ comando');
});

test('the person\'s own message is the quiet bubble of the approved picture, in the chat and in History alike', () => {
  const css = read('server/web/style.css');
  const bubble = /\n\.msg-user\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(bubble, /background:\s*var\(--bg-3\)/);
  assert.match(bubble, /color:\s*var\(--ink\)/);
  assert.doesNotMatch(css, /\.msg-user\.is-hit\s*\{[^}]*var\(--ink\)/, 'a search hit lights it like any other row');
  assert.doesNotMatch(css, /\.msg-user [^{]*\{[^}]*--on-strong/, 'nothing in it is drawn for a dark fill any more');
});

test('Configurações is one sheet of the page, opened from the run menu of both chats and from the ⋯ of the bar', () => {
  assert.match(html, /<dialog id="settingsDialog"[^>]*aria-labelledby="settingsTitle"/);
  const app = read('server/web/app.js');
  assert.match(app, /createRunSettings\(/);
  assert.match(app, /openSettings: \(binding, opener\) => runSettings\.open\(binding, opener\)/);
  assert.match(app, /id: 'settings', label: t\('settings\.title'\)[^\n]*runSettings\.open\(chat\.isOpen\(\) \? chat\.settings\(\) : flow\.chatSettings\(\), \$\('#tab-more'\)\)/);
  assert.match(read('server/web/flowview.js'), /openSettings: ctx\.openSettings/);
  assert.match(app, /if \(!lookMode\) entries\.push\(\{ id: 'settings'/, 'a look-only page gets no Configurações');
  // The ⋯ of the map's chat gets every action of a conversation, in the spec's order.
  const more = app.slice(app.indexOf('function chatMore('), app.indexOf('// ---- move or rename'));
  const ids = [...more.matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['rename', 'archive', 'export', 'open', 'delete']);
  assert.match(app, /about: \(\) =>/);
});

test('the information about a box opens in place from the ⋯ and folds away its body while the person talks, keeping the tabs strip', () => {
  const css = read('server/web/style.css');
  assert.match(css, /\.point-info\[data-folded\] \.point-body\s*\{[^}]*display:\s*none/, 'folded: the body gives the room to the chat');
  assert.doesNotMatch(css, /\.point-info\[data-folded\]\s*\{[^}]*display:\s*none/, 'folded: the strip and the glance line stay, so Resumo, Arquivos… are never lost');
  assert.match(css, /\.point-info\[data-folded\] \+ \.point-split\s*\{[^}]*display:\s*none/);
});

test('every new word of the chat and Configurações exists in both languages', () => {
  const keys = [
    'chat.about', 'chat.moreNew', 'chat.findClose', 'chat.quick.label', 'chat.quick.or', 'chat.quick.send',
    'chat.live.working', 'chat.live.thinking', 'chat.live.writing', 'chat.live.starting', 'chat.stepsLabel',
    ...['done', 'doing', 'read', 'changed'].flatMap((k) => [`chat.steps.${k}.one`, `chat.steps.${k}.other`]),
    'chat.brainTitle', 'chat.brainWhy', 'chat.memoryChip',
    'settings.title', 'settings.lede', 'settings.for', 'settings.limit', 'settings.limitSame', 'settings.chat',
    'settings.permissions', 'settings.noChat', 'settings.pc',
  ];
  for (const [lang, dict] of Object.entries(LANGS)) for (const k of keys) assert.ok(typeof dict[k] === 'string' && dict[k], `${lang}: ${k}`);
  assert.equal(LANGS['pt-BR']['chat.brainTitle'], 'O cérebro roteia esta conversa: o motor, o modelo e o raciocínio da aba Cérebro');
  assert.equal(LANGS['pt-BR']['chat.quick.or'], 'Ou responda com suas palavras aqui embaixo.');
  assert.deepEqual(['send', 'file', 'command'].map((k) => LANGS['pt-BR'][`chat.hint.${k}`]), ['Enter envia', '@ arquivo', '/ comando']);
});

test('a minimized bar is that session\'s own state: the chat opens whole again', async () => {
  server({ 'GET /api/chat/list': () => LIST_RUN });
  const { chat, root } = makeChat();
  openPart(chat);
  await settle();
  root.dataset.min = '1';
  chat.close();
  chat.open({ projectId: 'shop', title: 'Checkout', intro: 'intro', start: { node: { kind: 'part', partId: 'checkout' } } });
  assert.equal(root.dataset.min, undefined, 'maximized by default');
});

test('the title of the header is the rename: one click opens rename or move', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history(TURN) });
  const done = [];
  const { chat, part } = makeChat({ more: ACTIONS(done) });
  chat.open({ projectId: 'shop', title: 'Arrows', subtitle: 'Flow', start: { sessionId: S1 } });
  await settle();
  assert.ok(part('title').classes.has('is-renamable'), 'the title reads as the rename');
  part('title').fire('click');
  assert.deepEqual(done, [['rename', S1]], 'the same rename the ⋯ offers');
});

test('the header keeps one clean line: the search icon and the ⋯, with every action inside it (pc34)', async () => {
  server({ [`GET /api/chat/history/${S1}`]: () => history(TURN) });
  const done = [];
  const { chat, part } = makeChat({ more: ACTIONS(done), about: () => () => done.push(['about']), icon: (name) => `icon:${name}` });
  chat.open({ projectId: 'shop', title: 'Arrows', subtitle: 'Flow', start: { sessionId: S1 }, newChat: () => done.push(['new']) });
  await settle();
  const tools = part('tools').children;
  assert.deepEqual(tools.map((b) => b.attrs['data-tool']), ['find'], 'one icon only: find in the conversation');
  part('more').fire('click');
  const rows = walk(part('moremenu')).filter((e) => e.attrs.role === 'menuitem');
  assert.deepEqual(rows.map((r) => r.attrs['data-more']), ['about', 'book', 'find', 'rename', 'archive', 'open', 'delete', 'new'], 'every action is one click away');
  rows.find((r) => r.attrs['data-more'] === 'rename').attrs.onclick();
  assert.deepEqual(done, [['rename', S1]]);
});

test('the chat has a tab bar: each thing opens whole, none overlaps the chat (pc34)', () => {
  const html = read('server/web/index.html');
  const sheet = html.slice(html.indexOf('<aside id="chat"'), html.indexOf('</aside>', html.indexOf('<aside id="chat"')));
  assert.match(sheet, /<div class="chat-tabbar" id="chatTabbar"/, 'the bar holds the tabs');
  assert.match(sheet, /data-chat="min"/, 'the − minimizes the sheet');
  assert.ok(sheet.indexOf('id="chatTabbar"') < sheet.indexOf('id="pointInfo"'), 'the bar sits right under the header');
  const css = read('server/web/style.css');
  assert.match(css, /\.chat \.point-info,\s*\.chat \.point-split\s*\{[^}]*display:\s*none/, 'the information opens only on its own tab');
  assert.match(css, /\.chat\[data-ctab\^="info-"\] \.point-info\s*\{[^}]*display:\s*flex/, 'its tab shows it whole');
  assert.match(css, /\.chat\[data-ctab\^="info-"\] \.chat-pane\s*\{[^}]*display:\s*none/, 'the chat gives the room');
  assert.match(css, /\.chat\[data-ctab="book"\] \.chat-book\s*\{[^}]*max-height:\s*none/, 'the book opens whole too');
  assert.match(css, /\.chat\[data-min="1"\] > :not\(\.chat-head\)\s*\{[^}]*display:\s*none/, 'the − leaves only the header');
  assert.match(css, /\.chat\[data-min="1"\]\s*\{[^}]*bottom:\s*12px/, 'minimized, it docks as a slim bar at the bottom');
  assert.match(read('server/web/app.js'), /function renderChatTabs/, 'the page draws the bar');
});
