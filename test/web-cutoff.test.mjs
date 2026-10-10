import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutOffEntries, continueAll, createCutPanel, PENDING_MS, SHOWN_MAX } from '../server/web/cutoff.js';

const NOW = '2026-10-09T15:00:00.000Z';
const ago = (min) => new Date(Date.parse(NOW) - min * 60_000).toISOString();
const row = (sessionId, extra = {}) => ({
  sessionId, title: `chat ${sessionId}`, origin: 'map', status: 'closed', waiting: false, updatedAt: ago(60), archived: false, cutOff: true, ...extra,
});
const project = (id, conversations, visitors = []) => ({ id, name: id, conversations, visitors, chats: [] });
const stateOf = (...projects) => ({ generatedAt: NOW, projects });

test('cutOffEntries: the cut-off rows the project owns, newest first, with their project', () => {
  const state = stateOf(project('shop', [row('a', { updatedAt: ago(30) }), row('b', { updatedAt: ago(5) }), row('fine', { cutOff: false })]), project('notes', [row('c', { updatedAt: ago(10) })]));
  const out = cutOffEntries(state);
  assert.deepEqual(out.map((e) => e.row.sessionId), ['b', 'c', 'a']);
  assert.deepEqual(out.map((e) => e.project.id), ['shop', 'notes', 'shop']);
});

test('cutOffEntries leaves out archived rows, visitors and the ids a Continue is already working on', () => {
  const state = stateOf(
    project('shop', [row('a'), row('arch', { archived: true }), row('busy', { cutOff: true, status: 'busy' })], [row('visitor')]),
    project('notes', [row('b')]),
  );
  assert.deepEqual(cutOffEntries(state).map((e) => e.row.sessionId).sort(), ['a', 'b', 'busy']);
  assert.deepEqual(cutOffEntries(state, { pending: new Set(['a']) }).map((e) => e.row.sessionId).sort(), ['b', 'busy']);
});

test('cutOffEntries never lists an id twice, and an older server with no cutOff flag lists nothing', () => {
  const state = stateOf(project('shop', [row('a', { updatedAt: ago(30) })]), project('notes', [row('a', { updatedAt: ago(5) })]));
  const out = cutOffEntries(state);
  assert.equal(out.length, 1);
  assert.equal(out[0].row.updatedAt, ago(5), 'the newest copy stays');
  const old = stateOf(project('shop', [{ ...row('x'), cutOff: undefined }]));
  assert.deepEqual(cutOffEntries(old), []);
});

test('continueAll runs one conversation after the other and stops at the first "too many"', async () => {
  const entries = ['a', 'b', 'c', 'd'].map((id) => ({ row: row(id) }));
  const log = [];
  let open = 0;
  const run = async (e) => {
    assert.equal(++open, 1, 'never two at once');
    await new Promise((r) => setTimeout(r, 1));
    open -= 1;
    log.push(e.row.sessionId);
    return e.row.sessionId === 'c' ? { ok: false, error: 'too-many-chats' } : { ok: true };
  };
  const out = await continueAll(entries, run);
  assert.deepEqual(log, ['a', 'b', 'c']);
  assert.deepEqual(out, { done: 2, left: 2, limit: true, error: null });
});

test('continueAll goes on past another error and reports the first one', async () => {
  const entries = ['a', 'b', 'c'].map((id) => ({ row: row(id) }));
  const out = await continueAll(entries, async (e) => (e.row.sessionId === 'a' ? { ok: false, error: 'live-chat' } : { ok: true }));
  assert.deepEqual(out, { done: 2, left: 0, limit: false, error: 'live-chat' });
});

// ---- the panel -------------------------------------------------------------------------------------

class El {
  constructor(tag = 'div') { Object.assign(this, { tag, attrs: {}, children: [], listeners: {}, textContent: '', hidden: false, disabled: false }); }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(c) { this.children.push(typeof c === 'string' ? Object.assign(new El('#text'), { textContent: c }) : c); }
  replaceChildren(...cs) { this.children = []; for (const c of cs) this.append(c); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  async click() { if (this.disabled) return; for (const fn of this.listeners.click ?? []) await fn({ stopPropagation() {} }); }
  get text() { return this.textContent + this.children.map((c) => c.text).join(''); }
}
function h(tag, attrs = {}, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'onclick') el.addEventListener('click', v);
    else if (v != null && v !== false) el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}
const walk = (el, out = []) => { out.push(el); el.children.forEach((c) => walk(c, out)); return out; };
const byAct = (root, act, id = null) => walk(root).filter((e) => e.attrs['data-act'] === act && (id === null || e.attrs['data-session'] === id));

function setup({ onContinue = async () => ({ ok: true }), now = () => Date.parse(NOW) } = {}) {
  const root = new El('section');
  const calls = { continue: [], dismiss: [], open: [], toasts: [] };
  const panel = createCutPanel({
    root, h, t: (key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key), icon: (name) => h('svg', { 'data-icon': name }), relative: () => '1h', phone: { matches: false }, now,
    toast: (m) => calls.toasts.push(m), errorText: (c) => `err:${c}`,
    onContinue: (e) => { calls.continue.push(e.row.sessionId); return onContinue(e); }, onDismiss: (e) => calls.dismiss.push(e.row.sessionId), onOpen: (e) => calls.open.push(e.row.sessionId),
  });
  return { root, panel, calls };
}

test('the panel is hidden with nothing cut off, and shows the title with its count, the lede and one row each otherwise', () => {
  const { root, panel } = setup();
  panel.render(stateOf(project('shop', [row('a', { cutOff: false })])));
  assert.equal(root.hidden, true);
  panel.render(stateOf(project('shop', [row('a'), row('b')])));
  assert.equal(root.hidden, false);
  assert.match(root.text, /cut\.title/);
  assert.match(root.text, /cut\.lede/);
  assert.equal(byAct(root, 'continue').length, 2);
  assert.equal(byAct(root, 'dismiss').length, 2);
  assert.equal(byAct(root, 'continue-all').length, 1, 'two or more can be continued together');
  assert.ok(walk(root).some((e) => e.attrs['data-help'] === 'cut'), 'the title carries its "?"');
  panel.render(stateOf(project('shop', [row('a')])));
  assert.equal(byAct(root, 'continue-all').length, 0, 'one needs no "all"');
});

test('a Continue click sends once, takes the row away at once, and a second click does nothing', async () => {
  let release;
  const { root, panel, calls } = setup({ onContinue: () => new Promise((r) => { release = () => r({ ok: true }); }) });
  panel.render(stateOf(project('shop', [row('a'), row('b')])));
  const btn = byAct(root, 'continue', 'a')[0];
  const first = btn.click();
  const second = btn.click();
  assert.deepEqual(calls.continue, ['a'], 'one request though clicked twice');
  assert.equal(byAct(root, 'continue', 'a').length, 0, 'the row leaves at once');
  release();
  await Promise.all([first, second]);
  assert.match(calls.toasts.at(-1), /cut\.continued/);
});

test('a "busy" answer counts as success; any other error brings the row back and says why', async () => {
  const state = stateOf(project('shop', [row('a'), row('b')]));
  const busy = setup({ onContinue: async () => ({ ok: false, error: 'busy' }) });
  busy.panel.render(state);
  await byAct(busy.root, 'continue', 'a')[0].click();
  assert.match(busy.calls.toasts.at(-1), /cut\.continued/);
  assert.equal(byAct(busy.root, 'continue', 'a').length, 0, 'it is already running: the row stays away');

  const bad = setup({ onContinue: async () => ({ ok: false, error: 'live-chat' }) });
  bad.panel.render(state);
  await byAct(bad.root, 'continue', 'a')[0].click();
  assert.equal(bad.calls.toasts.at(-1), 'err:live-chat');
  assert.equal(byAct(bad.root, 'continue', 'a').length, 1, 'the row is back');
});

test('an id stays out until a state shows its row no longer cut off, or two minutes pass', async () => {
  let at = Date.parse(NOW);
  const { root, panel } = setup({ now: () => at });
  const cut = stateOf(project('shop', [row('a'), row('b')]));
  panel.render(cut);
  await byAct(root, 'continue', 'a')[0].click();
  panel.render(cut);
  assert.equal(byAct(root, 'continue', 'a').length, 0, 'a late state that still says cut off does not bring it back');
  panel.render(stateOf(project('shop', [row('a', { cutOff: false }), row('b')])));
  panel.render(cut);
  assert.equal(byAct(root, 'continue', 'a').length, 1, 'once a state said it is going, a new cut-off shows again');

  await byAct(root, 'continue', 'b')[0].click();
  at += PENDING_MS + 1;
  panel.render(cut);
  assert.equal(byAct(root, 'continue', 'b').length, 1, 'after two minutes it may be continued again');
});

test('Continue all goes one by one and says how many it did when the limit stops it', async () => {
  let open = 0;
  const { root, panel, calls } = setup({ onContinue: async (e) => {
    assert.equal(++open, 1);
    await new Promise((r) => setTimeout(r, 1));
    open -= 1;
    return e.row.sessionId === 'c' ? { ok: false, error: 'too-many-chats' } : { ok: true };
  } });
  panel.render(stateOf(project('shop', ['a', 'b', 'c', 'd'].map((id) => row(id)))));
  await byAct(root, 'continue-all')[0].click();
  assert.deepEqual(calls.continue, ['a', 'b', 'c']);
  assert.equal(calls.toasts.at(-1), 'cut.limit:2|2');
  assert.deepEqual(byAct(root, 'continue').map((e) => e.attrs['data-session']).sort(), ['c', 'd'], 'the two left stay in the panel');
});

test('Dismiss and the title call the owner of the page, and only five rows show, then "more"', () => {
  const { root, panel, calls } = setup();
  const ids = Array.from({ length: SHOWN_MAX + 2 }, (_, i) => `r${i}`);
  panel.render(stateOf(project('shop', ids.map((id, i) => row(id, { updatedAt: ago(i + 1) })))));
  assert.equal(byAct(root, 'continue').length, SHOWN_MAX);
  assert.match(root.text, /cut\.more:2/);
  byAct(root, 'dismiss', 'r0')[0].click();
  byAct(root, 'open', 'r1')[0].click();
  assert.deepEqual(calls.dismiss, ['r0']);
  assert.deepEqual(calls.open, ['r1']);
});

test('Later folds the panel to one line for this page load, and a conversation not seen before opens it again', async () => {
  const { root, panel } = setup();
  panel.render(stateOf(project('shop', [row('a'), row('b')])));
  await byAct(root, 'later')[0].click();
  assert.equal(byAct(root, 'continue').length, 0, 'folded: no rows');
  assert.match(root.text, /cut\.folded:2/);
  panel.render(stateOf(project('shop', [row('a'), row('b')])));
  assert.match(root.text, /cut\.folded:2/, 'the same ones stay folded');
  panel.render(stateOf(project('shop', [row('a'), row('b'), row('c')])));
  assert.equal(byAct(root, 'continue').length, 3, 'a new one opens it');
});

test('the page has the places the panel and the state filters draw into, and the cut-off colours come from the tokens', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../server/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /<section class="cut" id="cutPanel" aria-labelledby="cutTitle" hidden><\/section>/);
  assert.match(html, /<div class="cv-states" id="convsStates" role="group" data-i18n-aria="convs\.states"><\/div>/);
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.cv-state\.s-cutoff \{[^}]*var\(--clash\)[^}]*var\(--clash-ink\)[^}]*var\(--clash-fill\)/);
  assert.match(css, /\.g-cutoff \{[^}]*var\(--clash-ink\)[^}]*var\(--clash-fill\)/);
  assert.match(css, /\.cut\[hidden\] \{ display: none; \}/, 'the hidden panel stays hidden though it is a grid');
});

test('Continue tells the server it comes from the cut-off panel, so a stale tab cannot start a second turn', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  assert.match(app, /onContinue: \(\{ row, project: p \}\) => api\.chatStart\(\{ projectId: p\.id, sessionId: row\.sessionId, text: t\('cut\.continueText'\), cut: true \}\)/);
});

test('the Delete confirmation opens on Cancel, so one Enter too many does not delete; Stop keeps its focus on the action', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../server/web/app.js', import.meta.url), 'utf8');
  assert.match(app, /confirmAction\(t\('action\.deleteConfirm', \{.*?\}\), t\('action\.delete'\), \{ focus: 'cancel' \}\)/);
  assert.match(app, /confirmAction\(t\('action\.stopConfirm', \{ title: c\.title \}\), t\('action\.stop'\)\)/);
  assert.match(app, /dialog\.querySelector\(focus === 'cancel' \? '\.btn:not\(\.danger\)' : '\.danger'\)\.focus\(\);/);
});

// The panel is a fixed card above the stage: an open sheet (a chat, the point panel, the waiting list...) would sit under it.
test('the cut-off panel steps aside while a sheet of the stage is open, on the desktop and on the phone', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../server/web/style.css', import.meta.url), 'utf8');
  const rule = /body:has\(\.stage \.sheet:not\(\[hidden\]\)\) \.cut \{ display: none; \}/;
  assert.match(css, rule);
  const phone = css.slice(css.lastIndexOf('@media (max-width: 719px)'));
  assert.ok(css.search(rule) < css.lastIndexOf('@media (max-width: 719px)') && !/\.cut[^{]*\{[^}]*display:/.test(phone.split('\n}\n')[0]), 'one rule for both sizes, which the phone block does not undo');
});
