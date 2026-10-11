import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTabs } from '../server/web/tabs.js';
import { LANGS, translator } from '../server/web/i18n.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const P = DEMO.projects[0];
const PART = P.arch.parts[0];
const ERRORS = ['err.title-required', 'err.bad-card', 'err.too-many', 'err.unknown-card', 'err.bad-column'];

// The same tiny document as web-convs-tabs.test.mjs: enough to build, find by #id / .class / tag and fire handlers.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.handlers = {}; this.className = ''; this.hidden = false; this.value = ''; this.parent = null; }
  append(...kids) { for (const k of kids) { const n = typeof k === 'object' ? k : Object.assign(new El('#text'), { text: String(k) }); n.parent = this; this.children.push(n); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = v; }
  toggleAttribute() {}
  addEventListener(ev, fn) { this.handlers[ev] = fn; }
  focus() {}
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  get classList() { return { toggle() {}, add() {}, remove() {} }; }
  all() { return this.children.flatMap((c) => [c, ...(c.all?.() ?? [])]); }
  match(sel) {
    if (sel[0] === '#') return this.attrs.id === sel.slice(1);
    if (sel[0] === '.') return this.className.split(/\s+/).includes(sel.slice(1));
    return this.tag === sel;
  }
  querySelector(sel) { return this.all().find((n) => n.match?.(sel)) ?? null; }
  querySelectorAll(sel) { return this.all().filter((n) => n.match?.(sel)); }
  get text() { return this._text ?? this.children.map((c) => c.text ?? '').join(''); }
  set text(v) { this._text = v; }
  set textContent(v) { this._text = v; }
  get textContent() { return this.text; }
}
function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'hidden') el.hidden = true;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const tick = () => new Promise((r) => setTimeout(r, 20));
const ev = (extra = {}) => ({ preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {}, getData: () => '' }, ...extra });
const mk = (id, title, column = 'todo', over = {}) => ({ id, title, partId: null, note: '', column, createdAt: 1, ...over });
const titles = (els) => els.map((c) => c.querySelector('.card-title').text);

// A stand-in for the server: the cards it holds, every write it was sent, and what it answers.
// gate(method, url): a promise to wait for before the server answers that request (to hold it); failUrls: urls it refuses.
function setup({ cards = {}, confirm = true, failWrites = false, gate = null, failUrls = [] } = {}) {
  const sent = [];
  const toasts = [];
  const server = JSON.parse(JSON.stringify(cards));
  globalThis.document = { activeElement: null };
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (url === '/api/cards' && method === 'GET') {
      const seen = JSON.parse(JSON.stringify(server)); // the picture at the moment the request leaves
      await gate?.(method, url);
      return reply({ ok: true, cards: seen });
    }
    sent.push({ method, url: String(url), body });
    await gate?.(method, url);
    if (failWrites || failUrls.includes(url)) return reply({ ok: false, error: 'unknown-card' }, 404);
    if (url === '/api/cards' && method === 'POST') {
      const card = mk(`new-${sent.length}`, body.title.trim(), 'todo', { partId: body.partId || null, note: body.note || '' });
      (server[body.projectId] ??= []).push(card);
      return reply({ ok: true, card });
    }
    return reply({ ok: true });
  };
  const t = translator('en');
  const tabs = createTabs({
    h, t: () => t, lang: () => 'en', fmt: { money: String, shortDate: String, relative: String },
    state: () => DEMO, project: () => P, go() {}, toast: (m) => toasts.push(m), errorText: (c) => `error:${c}`, confirm: async () => confirm,
    prefs: { archived: () => false, setArchived() {} }, range: () => null, rangeButton: () => h('button'),
    store: { get: () => 'board', set() {} },
  });
  const root = h('div');
  tabs.render('convs', root);
  const col = (k) => root.querySelector(`.col-${k}`);
  const handIn = (k) => col(k).querySelectorAll('.hand-card');
  return { tabs, root, sent, toasts, t, col, handIn };
}

test('the board shows the cards made by hand, each in its column, next to the items of the map', async () => {
  const a = setup({ cards: { [P.id]: [mk('c1', 'Call the accountant', 'todo', { partId: PART.id, note: 'before Friday' }), mk('c2', 'Pay the hosting', 'done')] } });
  await tick();
  assert.deepEqual(titles(a.handIn('todo')), ['Call the accountant']);
  assert.deepEqual(titles(a.handIn('done')), ['Pay the hosting']);
  assert.equal(a.handIn('doing').length, 0);
  const first = a.handIn('todo')[0];
  assert.ok(first.text.includes(PART.name));
  assert.ok(first.text.includes('before Friday'));
  assert.ok(first.text.includes(a.t('hand.tag')));
  const mapCards = a.root.querySelectorAll('.card').filter((c) => !c.className.includes('hand-card'));
  assert.ok(mapCards.length > 0, 'the map\'s own items are still there');
  assert.ok(mapCards.every((c) => !c.attrs.draggable), 'and they are not draggable');
  assert.equal(first.attrs.draggable, 'true');
});

test('cards of another project show only when the filter is "All projects"', async () => {
  const other = DEMO.projects[1];
  const a = setup({ cards: { [other.id]: [mk('o1', 'Someone else')] } });
  await tick();
  assert.equal(a.root.querySelectorAll('.hand-card').length, 0);
  a.root.querySelector('select').handlers.change({ target: { value: '*' } });
  assert.equal(a.root.querySelectorAll('.hand-card').length, 1);
});

test('"New card" opens a form; adding sends title, project, part and note and the card lands in "To do"', async () => {
  const a = setup();
  await tick();
  assert.equal(a.root.querySelector('#handForm'), null, 'closed at first');
  a.root.querySelector('#handNew').handlers.click();
  assert.ok(a.root.querySelector('#handForm'));
  assert.equal(a.root.querySelector('#handPart').querySelectorAll('option').length, P.arch.parts.length + 1, 'every part, and "no particular part"');
  a.root.querySelector('#handTitle').handlers.input({ target: { value: '  Send the invoices ' } });
  a.root.querySelector('#handPart').handlers.change({ target: { value: PART.id } });
  a.root.querySelector('#handNote').handlers.input({ target: { value: 'Monday' } });
  await a.root.querySelector('#handForm').handlers.submit(ev());
  await tick();
  assert.deepEqual(a.sent.map((s) => [s.method, s.url]), [['POST', '/api/cards']]);
  assert.deepEqual(a.sent[0].body, { projectId: P.id, title: 'Send the invoices', partId: PART.id, note: 'Monday' });
  assert.deepEqual(titles(a.handIn('todo')), ['Send the invoices']);
  assert.equal(a.root.querySelector('#handForm'), null, 'the form closes');
  assert.ok(a.toasts.includes(a.t('hand.added')));
});

test('adding with no title sends nothing and says why', async () => {
  const a = setup();
  await tick();
  a.root.querySelector('#handNew').handlers.click();
  a.root.querySelector('#handTitle').handlers.input({ target: { value: '   ' } });
  await a.root.querySelector('#handForm').handlers.submit(ev());
  assert.deepEqual(a.sent, []);
  assert.deepEqual(a.toasts, [a.t('hand.titleRequired')]);
  assert.ok(a.root.querySelector('#handForm'), 'the form stays open');
});

test('what was typed in the form survives the page redrawing on its own', async () => {
  const a = setup();
  await tick();
  a.root.querySelector('#handNew').handlers.click();
  a.root.querySelector('#handTitle').handlers.input({ target: { value: 'Half written' } });
  a.tabs.refresh('convs', a.root);
  await tick();
  assert.equal(a.root.querySelector('#handTitle').value, 'Half written');
  a.root.querySelector('#handCancel').handlers.click();
  assert.equal(a.root.querySelector('#handForm'), null, 'Cancel closes it');
  a.root.querySelector('#handNew').handlers.click();
  assert.equal(a.root.querySelector('#handTitle').value, '', 'and forgets it');
});

test('dragging a card onto another column moves it there and tells the server', async () => {
  const a = setup({ cards: { [P.id]: [mk('c1', 'One'), mk('c2', 'Two')] } });
  await tick();
  a.handIn('todo')[0].handlers.dragstart(ev());
  const over = ev();
  let prevented = false;
  over.preventDefault = () => { prevented = true; };
  a.col('doing').handlers.dragover(over);
  assert.equal(prevented, true, 'a column accepts a drop');
  await a.col('doing').handlers.drop(ev());
  await tick();
  assert.deepEqual(titles(a.handIn('doing')), ['One']);
  assert.deepEqual(titles(a.handIn('todo')), ['Two']);
  assert.deepEqual(a.sent.map((s) => [s.method, s.url, s.body]), [['POST', '/api/cards/c1/move', { column: 'doing', before: null }]]);
});

test('dropping a card on another card puts it before that one', async () => {
  const a = setup({ cards: { [P.id]: [mk('c1', 'One'), mk('c2', 'Two'), mk('c3', 'Three')] } });
  await tick();
  a.handIn('todo')[2].handlers.dragstart(ev());
  await a.handIn('todo')[0].handlers.drop(ev());
  await tick();
  assert.deepEqual(titles(a.handIn('todo')), ['Three', 'One', 'Two']);
  assert.deepEqual(a.sent[0].body, { column: 'todo', before: 'c1' });
});

test('the "Move to" list does the same without a mouse, and a failed save puts the card back', async () => {
  const a = setup({ cards: { [P.id]: [mk('c1', 'One')] } });
  await tick();
  const pick = a.handIn('todo')[0].querySelector('select');
  assert.ok(pick.attrs['aria-label'].includes('One'));
  await pick.handlers.change({ target: { value: 'done' } });
  await tick();
  assert.equal(a.handIn('done').length, 1);
  assert.deepEqual(a.sent[0].body, { column: 'done', before: null });

  const b = setup({ cards: { [P.id]: [mk('c1', 'One')] }, failWrites: true });
  await tick();
  await b.handIn('todo')[0].querySelector('select').handlers.change({ target: { value: 'done' } });
  await tick();
  assert.equal(b.handIn('todo').length, 1, 'it is back where it was');
  assert.equal(b.handIn('done').length, 0);
  assert.deepEqual(b.toasts, ['error:unknown-card']);
});

test('deleting asks first; yes removes the card, no leaves it', async () => {
  const yes = setup({ cards: { [P.id]: [mk('c1', 'One')] } });
  await tick();
  await yes.handIn('todo')[0].querySelector('.hand-delete').handlers.click();
  await tick();
  assert.deepEqual(yes.sent.map((s) => [s.method, s.url]), [['DELETE', '/api/cards/c1']]);
  assert.equal(yes.root.querySelectorAll('.hand-card').length, 0);

  const no = setup({ cards: { [P.id]: [mk('c1', 'One')] }, confirm: false });
  await tick();
  await no.handIn('todo')[0].querySelector('.hand-delete').handlers.click();
  await tick();
  assert.deepEqual(no.sent, []);
  assert.equal(no.root.querySelectorAll('.hand-card').length, 1);
});

test('a card whose part is no longer on the map still shows, without a part name', async () => {
  const a = setup({ cards: { [P.id]: [mk('c1', 'Orphan', 'todo', { partId: 'gone-part' })] } });
  await tick();
  assert.equal(a.handIn('todo').length, 1);
  assert.ok(a.handIn('todo')[0].text.includes(a.t('hand.noPart')));
});

test('every text of the hand cards is in English and in Portuguese', () => {
  const keys = [...Object.keys(LANGS.en).filter((k) => k.startsWith('hand.')), ...ERRORS];
  assert.ok(keys.length >= 15, 'the keys exist');
  for (const k of keys) {
    assert.ok(LANGS.en[k], `en has ${k}`);
    assert.ok(LANGS['pt-BR'][k], `pt-BR has ${k}`);
  }
});

// ----- review fixes: overlapping requests -----

// A gate that holds the requests chosen by `when` until release(); each held request waits for its own release.
function holder(when) {
  const waiting = [];
  return {
    gate: (method, url) => (when(method, url) ? new Promise((r) => waiting.push(r)) : undefined),
    release: () => waiting.splice(0).forEach((r) => r()),
    held: () => waiting.length,
  };
}

test('pressing Add twice before the server answers makes one card', async () => {
  const hold = holder((m, u) => m === 'POST' && u === '/api/cards');
  const a = setup({ gate: hold.gate });
  await tick();
  a.root.querySelector('#handNew').handlers.click();
  a.root.querySelector('#handTitle').handlers.input({ target: { value: 'Once only' } });
  const form = a.root.querySelector('#handForm');
  const first = form.handlers.submit(ev());
  const second = form.handlers.submit(ev());
  await tick();
  hold.release();
  await Promise.all([first, second]);
  await tick();
  assert.equal(a.sent.filter((s) => s.method === 'POST').length, 1);
  assert.deepEqual(titles(a.handIn('todo')), ['Once only']);
});

test('after a refused card the form can be sent again', async () => {
  const a = setup({ failUrls: ['/api/cards'] });
  await tick();
  a.root.querySelector('#handNew').handlers.click();
  a.root.querySelector('#handTitle').handlers.input({ target: { value: 'Try again' } });
  await a.root.querySelector('#handForm').handlers.submit(ev());
  await a.root.querySelector('#handForm').handlers.submit(ev());
  assert.equal(a.sent.filter((s) => s.method === 'POST').length, 2, 'the second try is not blocked for good');
});

test('a refused move puts back only that card, not a move that was saved meanwhile', async () => {
  const hold = holder((m, u) => u === '/api/cards/c1/move');
  const a = setup({ cards: { [P.id]: [mk('c1', 'One'), mk('c2', 'Two')] }, gate: hold.gate, failUrls: ['/api/cards/c1/move'] });
  await tick();
  const slow = a.handIn('todo')[0].querySelector('select').handlers.change({ target: { value: 'doing' } });
  await a.handIn('todo')[0].querySelector('select').handlers.change({ target: { value: 'done' } }); // c2, saved at once
  await tick();
  assert.deepEqual(titles(a.handIn('done')), ['Two']);
  hold.release();
  await slow;
  await tick();
  assert.deepEqual(titles(a.handIn('todo')), ['One'], 'the refused card is back');
  assert.deepEqual(titles(a.handIn('done')), ['Two'], 'the saved one stays where it was saved');
  assert.equal(a.handIn('doing').length, 0);
});

test('an answer to a "get the cards" sent before a write does not wipe that write', async () => {
  const hold = holder((m) => m === 'GET');
  const a2 = setup({ gate: hold.gate });
  await tick();
  assert.equal(hold.held(), 1, 'the first load is held');
  a2.root.querySelector('#handNew').handlers.click();
  a2.root.querySelector('#handTitle').handlers.input({ target: { value: 'Fresh' } });
  await a2.root.querySelector('#handForm').handlers.submit(ev()); // the add is saved while the get is still out
  assert.deepEqual(titles(a2.handIn('todo')), ['Fresh']);
  hold.release();
  await tick();
  assert.deepEqual(titles(a2.handIn('todo')), ['Fresh'], 'the old list does not take it away');
});

test('dropping a card onto a card of another project puts it at the end of the column, not somewhere wrong', async () => {
  const other = DEMO.projects[1];
  const a = setup({ cards: { [P.id]: [mk('x1', 'Mine'), mk('x2', 'Mine too', 'doing')], [other.id]: [mk('y1', 'Theirs', 'doing')] } });
  await tick();
  a.root.querySelector('select').handlers.change({ target: { value: '*' } });
  const target = a.handIn('doing').find((c) => c.querySelector('.card-title').text === 'Theirs');
  a.handIn('todo')[0].handlers.dragstart(ev());
  await target.handlers.drop(ev());
  await tick();
  assert.deepEqual(a.sent.map((s) => s.body), [{ column: 'doing', before: null }]);
  assert.deepEqual(titles(a.handIn('doing')).sort(), ['Mine', 'Mine too', 'Theirs']);
});
