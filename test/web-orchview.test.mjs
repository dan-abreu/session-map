import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchState, orchChip, orchSection } from '../server/web/orchview.js';

// A tiny element: tag, attrs and children, enough to read what the builders draw.
const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs ?? {}, kids: kids.flat(Infinity).filter((k) => k != null && k !== false) });
const walk = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); el.kids?.forEach((k) => walk(k, out)); } return out; };
const text = (el) => walk(el).flatMap((e) => e.kids?.filter((k) => typeof k === 'string') ?? []).join(' ');
const t = Object.assign((key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key), { count: (key, n) => `${key}:${n}` });
const icon = (name) => h('svg', { 'data-icon': name });
const ctx = { h, icon, t };

const row = (sessionId, extra = {}) => ({ sessionId, status: 'closed', archived: false, node: null, parentId: null, ...extra });
const project = (conversations, extra = {}) => ({ id: 'acme', name: 'acme', conversations, chats: [], ...extra });

test('orchState: the orchestrator row, the chats it has working, and the switch (off unless the state says on)', () => {
  const p = project([row('o', { node: { kind: 'orchestrator' } }), row('a', { parentId: 'o', status: 'busy' }), row('b', { parentId: 'o' }), row('c', { status: 'busy' })]);
  const st = orchState(p);
  assert.equal(st.row.sessionId, 'o');
  assert.deepEqual([st.total, st.working], [2, 1], 'only its own chats count, not the other working chat of the project');
  assert.equal(st.tidy, false, 'a server older than the switch sends none: off, as it is by default');
  assert.equal(orchState({ ...p, tidy: true }).tidy, true);
  const none = orchState(project([row('c')]));
  assert.deepEqual([none.row, none.total, none.working], [null, 0, 0]);
});

test('orchChip: the root box says "Orchestrator", with how many chats it has working when some do', () => {
  const idle = orchChip(ctx, orchState(project([row('o', { node: { kind: 'orchestrator' } })])));
  assert.match(idle.attrs.class, /\bis-orch\b/);
  assert.doesNotMatch(idle.attrs.class, /is-working/);
  assert.equal(text(idle), 'orch.name');
  const busy = orchChip(ctx, orchState(project([row('o', { node: { kind: 'orchestrator' } }), row('a', { parentId: 'o', status: 'busy' })])));
  assert.match(busy.attrs.class, /is-working/);
  assert.equal(text(busy), 'now.orchestra:1');
  const none = orchChip(ctx, orchState(project([])));
  assert.equal(text(none), 'orch.name');
});

test('orchSection: says what the orchestrator is, offers to open or start it, and has the "Organizar sozinho" switch with its reason', () => {
  const calls = [];
  const handlers = { onOpen: () => calls.push('open'), onTidy: (on) => calls.push(['tidy', on]) };
  const fresh = orchSection(ctx, orchState(project([])), handlers);
  assert.ok(text(fresh).includes('orch.noneText'));
  const open = walk(fresh).find((e) => e.attrs['data-orch'] === 'open');
  assert.equal(text(open), 'orch.start', 'none yet: start');
  open.attrs.onclick();
  assert.deepEqual(calls, ['open']);

  const have = orchSection(ctx, orchState(project([row('o', { node: { kind: 'orchestrator' } })])), handlers);
  assert.equal(text(walk(have).find((e) => e.attrs['data-orch'] === 'open')), 'orch.open', 'there is one: open it');
  const busy = orchSection(ctx, orchState(project([row('o', { node: { kind: 'orchestrator' } }), row('a', { parentId: 'o', status: 'busy' })])), handlers);
  assert.ok(text(busy).includes('orch.working:1'));

  const sw = walk(have).find((e) => e.attrs['data-orch'] === 'tidy');
  assert.equal(sw.attrs.type, 'checkbox');
  assert.equal(sw.attrs.checked, false, 'off by default: the owner turns it on where he wants it');
  assert.ok(text(have).includes('orch.tidy') && text(have).includes('orch.tidyHint'), 'named, with what it does and that it spends');
  sw.attrs.onchange({ currentTarget: { checked: true } });
  assert.deepEqual(calls.at(-1), ['tidy', true]);
  const on = orchSection(ctx, orchState(project([], { tidy: true })), handlers);
  assert.equal(walk(on).find((e) => e.attrs['data-orch'] === 'tidy').attrs.checked, true);
});

test('the page wires it: an item of the Novo menu (mm48), the chip in the root box, the block in the project panel, the switch to the settings route', async () => {
  const { readFileSync } = await import('node:fs');
  const web = (f) => readFileSync(new URL(`../server/web/${f}`, import.meta.url), 'utf8');
  assert.match(web('index.html'), /id="openOrch"[^>]*data-i18n-title="orch\.chipTitle"/);
  const app = web('app.js');
  assert.match(app, /\$\('#openOrch'\)\.addEventListener\('click', openOrchestrator\)/);
  assert.match(app, /orchChip\(\{ h, icon, t \}, orchState\(project\)\)/, 'the root box');
  assert.match(app, /orchSection\(\{ h, icon, t \}, orchState\(p\), \{ onOpen: openOrchestrator/, 'the project panel');
  assert.match(web('api.js'), /setProjectTidy: .*'\/api\/settings\/project-tidy'/);
  assert.match(web('api.js'), /orchestratorOpen: .*'\/api\/chat\/orchestrator'/);
});

test('the first message of a new orchestrator carries the images the person attached, as any chat\'s first message does', async () => {
  const { readFileSync } = await import('node:fs');
  const chat = readFileSync(new URL('../server/web/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /api\.orchestratorOpen\(\{ projectId: context\.projectId, text, \.\.\.\(images\.length \? \{ images \} : \{\}\) \}\)/);
});
