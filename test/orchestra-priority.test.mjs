import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadToken } from '../server/auth.mjs';
import { budgetOf } from '../server/budget.mjs';
import { ORCH_TOOLS, TOOL_PRIORITIES } from '../server/chat/orch-tools.mjs';
import { createOrchestra } from '../server/chat/orchestra.mjs';
import {
  PRIORITIES, addPiece, editQueue, heldOf, nearOf, ordered, priorityOf, priorityOfWeight, queueView, readQueue, readWeekUse, setOwnerPriority, weekUseOf,
} from '../server/chat/priority.mjs';
import { createApp } from '../server/main.mjs';
import { LANGS } from '../server/web/i18n.js';
import { nextList, orchSection, orchState } from '../server/web/orchview.js';

// The orchestration's priority queue (or08): urgent first, the finishing touches in the gaps, and near a limit only the
// urgent and the important start; an urgent piece held by a limit is told to the owner.

const NOW = Date.parse('2026-10-11T12:00:00Z');
const HOUR = 3_600_000;

// ---- the rules ----

test('a priority comes from the owner first, then the orchestrator, then the item\'s mark', () => {
  assert.deepEqual(['blocks', 'important', 'detail', null, 'odd'].map(priorityOfWeight), ['urgent', 'important', 'polish', 'normal', 'normal']);
  const piece = { code: 'au01', weight: 'detail', asked: null };
  assert.equal(priorityOf(piece), 'polish', 'the mark');
  assert.equal(priorityOf({ ...piece, asked: 'urgent' }), 'urgent', 'the orchestrator, relaying the person');
  assert.equal(priorityOf({ ...piece, asked: 'urgent' }, { au01: 'normal' }), 'normal', 'the owner\'s choice wins');
  assert.deepEqual(TOOL_PRIORITIES, PRIORITIES, 'the tool offers the same four');
  assert.deepEqual(ORCH_TOOLS.find((t) => t.name === 'start_chat').inputSchema.properties.priority.enum, PRIORITIES);
});

test('the line: highest first, then the oldest', () => {
  const line = ordered([
    { id: 'a', code: 'a', weight: 'detail', at: '2026-10-11T08:00:00Z' },
    { id: 'b', code: 'b', weight: null, at: '2026-10-11T09:00:00Z' },
    { id: 'c', code: 'c', weight: null, at: '2026-10-11T07:00:00Z' },
    { id: 'd', code: 'd', weight: 'blocks', at: '2026-10-11T10:00:00Z' },
    { id: 'e', code: 'e', weight: 'important', at: '2026-10-11T11:00:00Z' },
  ]);
  assert.deepEqual(line.map((p) => p.id), ['d', 'e', 'c', 'b', 'a']);
});

test('near a limit: the budget past 80% or continued past 100%, the weekly limit hit, or 90% of the week used', () => {
  const budget = (used, extra = {}) => budgetOf({ limitUSD: 10, claudeUSD: used, month: '2026-10', ...extra });
  assert.equal(nearOf({ budget: budget(5), now: NOW }), null);
  assert.equal(nearOf({ budget: budget(8), now: NOW }), 'near-budget');
  assert.equal(nearOf({ budget: budget(11, { continueMonth: '2026-10' }), now: NOW }), 'near-budget', 'continued this month: still near');
  assert.equal(nearOf({ limits: { weekly: { hit: true } }, now: NOW }), 'near-weekly');
  assert.equal(nearOf({ weekUse: { pct: 90, resetsAt: '2026-10-15T21:00:00Z' }, now: NOW }), 'near-weekly');
  assert.equal(nearOf({ weekUse: { pct: 89, resetsAt: '2026-10-15T21:00:00Z' }, now: NOW }), null);
  assert.equal(nearOf({ weekUse: { pct: 95, resetsAt: '2026-10-10T21:00:00Z' }, now: NOW }), null, 'already renewed');

  assert.equal(heldOf('normal', { near: 'near-weekly' }), 'near-weekly');
  assert.equal(heldOf('polish', { near: 'near-budget' }), 'near-budget');
  assert.equal(heldOf('important', { near: 'near-weekly' }), null, 'the important never stops at a limit');
  assert.equal(heldOf('urgent', { near: 'near-budget' }), null);
  assert.equal(heldOf('polish', { quiet: false }), 'polish', 'a finishing touch waits for a quiet project');
  assert.equal(heldOf('polish', { quiet: true, othersWait: true }), 'polish', 'and for the rest of the line');
  assert.equal(heldOf('polish', { quiet: true, othersWait: false }), null);
});

test('the weekly figure is read from Claude Code\'s account file only when it is fresh and not yet renewed', () => {
  const account = (week, fetchedAtMs = NOW - HOUR) => ({ cachedUsageUtilization: { fetchedAtMs, utilization: { seven_day: week } } });
  assert.deepEqual(weekUseOf(account({ utilization: 93.4, resets_at: '2026-10-15T21:00:00.384609+00:00' }), NOW),
    { pct: 93, resetsAt: '2026-10-15T21:00:00.384Z', fetchedAt: NOW - HOUR });
  assert.equal(weekUseOf(account({ utilization: 93, resets_at: '2026-10-15T21:00:00Z' }, NOW - 30 * HOUR), NOW), null, 'stale');
  assert.equal(weekUseOf(account({ utilization: 93, resets_at: '2026-10-11T11:00:00Z' }), NOW), null, 'renewed since');
  assert.equal(weekUseOf(account({ utilization: 'lots' }), NOW), null);
  assert.equal(weekUseOf({}, NOW), null);
  assert.equal(weekUseOf({ cachedUsageUtilization: { utilization: { seven_day: { utilization: 95 } } } }, NOW), null, 'a figure of unknown age is not trusted');
  assert.equal(weekUseOf(null, NOW), null);

  const dir = mkdtempSync(join(tmpdir(), 'sm-week-'));
  try {
    const file = join(dir, '.claude.json');
    assert.equal(readWeekUse(file, NOW), null, 'no file');
    writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: 'x@example.com' }, ...account({ utilization: 100, resets_at: '2026-10-15T21:00:00Z' }) }));
    const use = readWeekUse(file, NOW);
    assert.deepEqual(Object.keys(use).sort(), ['fetchedAt', 'pct', 'resetsAt'], 'only the weekly figure leaves it');
    assert.equal(use.pct, 100);
    writeFileSync(file, '{not json');
    assert.equal(readWeekUse(file, NOW + 1), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the line on disk: one piece per item, the owner\'s choice kept apart, and a piece taken out on request', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-queue-'));
  let n = 0;
  const id = () => `p${++n}`;
  try {
    const base = { partId: 'auth', weight: null, run: { kind: 'autonomous' }, at: '2026-10-11T10:00:00Z' };
    addPiece(smDir, 'shop', { ...base, code: 'au01', title: 'Login', instructions: 'First' }, id);
    const again = addPiece(smDir, 'shop', { ...base, code: 'au01', title: 'Login', instructions: 'Second', asked: 'urgent', at: '2026-10-11T11:00:00Z' }, id);
    assert.equal(again.id, 'p1', 'the same item is brought up to date, its place kept');
    assert.equal(readQueue(smDir, 'shop').waiting.length, 1);
    assert.equal(readQueue(smDir, 'shop').waiting[0].instructions, 'Second');
    setOwnerPriority(smDir, 'shop', 'au01', 'polish');
    addPiece(smDir, 'shop', { ...base, code: 'au01', title: 'Login', instructions: 'Third', asked: 'urgent' }, id);
    assert.equal(queueView(smDir, 'shop')[0].priority, 'polish', 'a later ask of the orchestrator never undoes the owner\'s choice');
    assert.equal(queueView(smDir, 'shop')[0].chosen, true);
    setOwnerPriority(smDir, 'shop', 'au01', null);
    assert.equal(queueView(smDir, 'shop')[0].priority, 'urgent', 'given back to the rules: the orchestrator\'s ask counts again');
    const gone = setOwnerPriority(smDir, 'shop', 'au01', 'drop');
    assert.equal(gone.code, 'au01');
    assert.deepEqual(queueView(smDir, 'shop'), []);
    assert.deepEqual(queueView(null, 'shop'), []);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

// ---- the orchestrator with a stand-in hub ----

const PROJECT = 'shop-1';
const ORCH = 'orch-1111';
const ITEMS = [
  { code: 'au01', title: 'Login', status: 'todo', weight: null },
  { code: 'au02', title: 'Reset', status: 'todo', weight: null },
  { code: 'au03', title: 'Sign out', status: 'todo', weight: null },
  { code: 'au04', title: 'Remember me', status: 'todo', weight: null },
  { code: 'au05', title: 'Crash on login', status: 'todo', weight: 'blocks' },
  { code: 'au06', title: 'Spacing of the form', status: 'todo', weight: 'detail' },
  { code: 'au07', title: 'Audit log', status: 'todo', weight: 'important' },
  { code: 'au08', title: 'Old idea', status: 'done', weight: null },
];

function setup({ running = 3, budget = null, limits = null, weekUse = null, other = false, onStart = null, chatsMax = 20, closeIdle = null } = {}) {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-orch-prio-'));
  const state = {
    limits, weekUse,
    projects: [{
      id: PROJECT, name: 'shop', root: join(smDir, 'shop'), budget,
      arch: { parts: [{ id: 'auth', name: 'Auth', groups: [{ name: 'Login', items: ITEMS.map((i) => ({ ...i })) }] }] },
      conversations: [],
    }],
  };
  const orch = { key: 'k-orch', sessionId: ORCH, projectId: PROJECT, node: { kind: 'orchestrator' }, running: true };
  const chats = [orch];
  const pages = { [ORCH]: { projectId: PROJECT, node: { kind: 'orchestrator' }, startedAt: '2026-10-01T09:00:00Z', title: 'Orchestrator' } };
  for (let i = 0; i < running; i += 1) {
    const sessionId = `run-${i}`;
    chats.push({ key: `k-run-${i}`, sessionId, projectId: PROJECT, parentId: ORCH, running: true, node: { kind: 'item', code: 'zz' } });
    pages[sessionId] = { projectId: PROJECT, parentId: ORCH, node: { kind: 'item', code: 'zz' } };
  }
  // A chat of the person's at work in the project: the project is not quiet.
  if (other) chats.push({ key: 'k-own', sessionId: 'own-1', projectId: PROJECT, running: true, node: null });
  const seen = { started: [], sent: [], alerts: [] };
  const hub = {
    live: () => chats.filter((c) => !c.ended), byKey: (key) => chats.find((c) => c.key === key) ?? null,
    driven: (id) => chats.find((c) => c.sessionId === id && !c.ended) ?? null,
    start: async (body, _state, internal) => {
      seen.started.push({ body, internal });
      if (onStart) await onStart(body);
      const n = seen.started.length;
      const chat = { key: `k-new${n}`, sessionId: `new-${n}`, projectId: body.projectId, parentId: internal?.parentId, running: true, node: body.node };
      chats.push(chat);
      pages[chat.sessionId] = { projectId: body.projectId, parentId: internal?.parentId, node: body.node, startedAt: new Date().toISOString() };
      return { status: 200, body: { chatKey: chat.key } };
    },
    send: (chat, text) => seen.sent.push({ to: chat.sessionId, text }), say: () => ({ status: 200 }), holding: () => false,
    pageChats: () => pages, closeIdle: async (id) => (closeIdle ? closeIdle(id) : false), emit: () => {}, alert: (who, kind, reason, extra) => seen.alerts.push({ who, kind, reason, ...extra }),
    transcript: () => null, driving: () => new Set(), chatsMax,
  };
  let clock = NOW;
  const orchestra = createOrchestra({ smDir, hub, readState: async () => state, every: () => null, namedMs: 200, now: () => clock });
  const call = (name, args) => orchestra.call(orch, { name, arguments: args });
  // One of the working chats ends its turn: a place frees.
  const finish = async (i = 0) => {
    const chat = chats.find((c) => c.sessionId === `run-${i}`);
    chat.running = false;
    chat.ended = true;
    orchestra.turnEnded(chat, { reply: 'Done.', isError: false });
    await orchestra.tick();
  };
  return {
    smDir, state, orchestra, call, seen, chats, pages, finish, setClock: (ms) => { clock = ms; },
    codes: () => seen.started.map((s) => s.body.node?.code), line: () => queueView(smDir, PROJECT),
    cleanup: () => rmSync(smDir, { recursive: true, force: true }),
  };
}
const parsed = (answer) => {
  assert.equal(answer.ok, true, answer.error);
  return JSON.parse(answer.text);
};
const ask = (code, extra = {}) => ({ code, instructions: `Work on ${code}.`, model: 'sonnet', effort: 'medium', ...extra });

test('with no free place the work waits in the line, and the urgent one takes the next place first', async () => {
  const s = setup({ running: 3 });
  try {
    const normal = parsed(await s.call('start_chat', ask('au01')));
    assert.deepEqual([normal.state, normal.priority, normal.ahead], ['waiting', 'normal', 0]);
    assert.match(normal.why, /^waiting: no free place now/);
    const urgent = parsed(await s.call('start_chat', ask('au02', { priority: 'urgent' })));
    assert.deepEqual([urgent.state, urgent.priority, urgent.ahead], ['waiting', 'urgent', 0], 'the urgent one goes to the front');
    assert.match(urgent.why, /It is urgent: if it cannot wait, ask the person/);
    const marked = parsed(await s.call('start_chat', ask('au05')));
    assert.deepEqual([marked.priority, marked.ahead], ['urgent', 1], 'a blocking item is urgent by its mark, after the older urgent one');
    assert.deepEqual(s.codes(), [], 'nothing started past the 3 working');
    assert.deepEqual(s.line().map((p) => [p.code, p.priority, p.why]), [['au02', 'urgent', 'place'], ['au05', 'urgent', 'place'], ['au01', 'normal', 'place']]);

    await s.finish(0);
    assert.deepEqual(s.codes(), ['au02'], 'the freed place went to the oldest urgent piece');
    assert.equal(s.seen.started[0].internal.parentId, ORCH);
    assert.deepEqual(s.seen.started[0].body.run, { kind: 'autonomous', model: 'sonnet', effort: 'medium' });
    await s.finish(1);
    await s.finish(2);
    assert.deepEqual(s.codes(), ['au02', 'au05', 'au01']);
    assert.deepEqual(s.line(), []);
    // The orchestrator learns the keys of the ones started on their turn.
    const inbox = JSON.parse((await import('node:fs')).readFileSync(join(s.smDir, 'orch-inbox.json'), 'utf8'));
    const notes = [...(inbox.notes?.[ORCH] ?? []).map((n) => n.text), ...s.seen.sent.map((m) => m.text)].join('\n');
    assert.match(notes, /waiting activity au02 \(urgent\) started on its turn, key new-1/);
  } finally { s.cleanup(); }
});

test('a free place starts the piece at once, with the same answer as before', async () => {
  const s = setup({ running: 0 });
  try {
    const opened = parsed(await s.call('start_chat', ask('au01')));
    assert.deepEqual([opened.state, opened.code, opened.model, opened.effort, opened.priority], ['working', 'au01', 'sonnet', 'medium', 'normal']);
    assert.equal(opened.key, 'new-1');
    assert.deepEqual(s.line(), []);
    assert.equal((await s.call('start_chat', ask('au02', { priority: 'soon' }))).ok, false, 'a priority off the list is refused');
  } finally { s.cleanup(); }
});

test('near the budget\'s limit only urgent and important start; the normal waits with the reason', async () => {
  const s = setup({ running: 0, budget: budgetOf({ limitUSD: 10, claudeUSD: 8.5, month: '2026-10' }) });
  try {
    const normal = parsed(await s.call('start_chat', ask('au01')));
    assert.equal(normal.state, 'waiting');
    assert.match(normal.why, /past 80%, so only urgent and important/);
    assert.equal(parsed(await s.call('start_chat', ask('au07'))).state, 'working', 'important never stops at a limit');
    assert.equal(parsed(await s.call('start_chat', ask('au02', { priority: 'urgent' }))).state, 'working');
    assert.deepEqual(s.codes(), ['au07', 'au02']);
    assert.deepEqual(s.line().map((p) => [p.code, p.why]), [['au01', 'near-budget']]);
  } finally { s.cleanup(); }
});

test('near the plan\'s weekly limit (wa09) the normal and the polish wait, and start once the week renews', async () => {
  const s = setup({ running: 0, weekUse: { pct: 96, resetsAt: '2026-10-15T21:00:00Z' } });
  try {
    assert.equal(parsed(await s.call('start_chat', ask('au01'))).state, 'waiting');
    assert.match(s.line()[0].why, /near-weekly/);
    s.state.weekUse = null;
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au01'], 'the scheduler moves the line when the limit is gone');
  } finally { s.cleanup(); }
});

test('a finishing touch waits for a quiet project and for the rest of the line', async () => {
  const s = setup({ running: 0, other: true });
  try {
    const polish = parsed(await s.call('start_chat', ask('au06')));
    assert.deepEqual([polish.state, polish.priority], ['waiting', 'polish']);
    assert.match(polish.why, /finishing touch starts only when the project is quiet/);
    s.chats.find((c) => c.key === 'k-own').running = false;
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au06'], 'quiet and nothing else waits: it starts');
  } finally { s.cleanup(); }
});

test('an urgent piece held by today\'s limit asks the owner, once; the normal ones wait in silence', async () => {
  const s = setup({ running: 0 });
  try {
    writeFileSync(join(s.smDir, 'orchestra.json'), JSON.stringify({ day: { [ORCH]: { date: '2026-10-11', count: 30 } } }));
    assert.match(parsed(await s.call('start_chat', ask('au01'))).why, /30 activity chats were started today/);
    assert.equal(parsed(await s.call('start_chat', ask('au05'))).state, 'waiting');
    // A second urgent piece behind the first: the held line is still walked, so it is told too.
    assert.equal(parsed(await s.call('start_chat', ask('au02', { priority: 'urgent' }))).state, 'waiting');
    await s.orchestra.tick();
    assert.deepEqual(s.seen.alerts.map((a) => [a.kind, a.reason, a.code, a.because]),
      [['waiting', 'urgent-day', 'au05', 'Crash on login'], ['waiting', 'urgent-day', 'au02', 'Reset']]);
    assert.equal(s.seen.alerts[0].who.sessionId, ORCH);
    assert.deepEqual(s.codes(), []);
    s.setClock(NOW + 24 * HOUR);
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au05', 'au02', 'au01'], 'a new day: the urgent first');
  } finally { s.cleanup(); }
});

test('the owner changes a priority or takes a piece out; an item done or gone leaves the line', async () => {
  const s = setup({ running: 3 });
  try {
    for (const code of ['au01', 'au02', 'au03']) parsed(await s.call('start_chat', ask(code)));
    const res = s.orchestra.prioritize({ projectId: PROJECT, code: 'au03', priority: 'urgent' }, s.state);
    assert.deepEqual([res.status, res.body], [200, { ok: true, code: 'au03', priority: 'urgent' }]);
    assert.equal(s.line()[0].code, 'au03');
    assert.equal(s.orchestra.prioritize({ projectId: PROJECT, code: 'au02', priority: 'drop' }, s.state).status, 200);
    assert.deepEqual(s.line().map((p) => p.code), ['au03', 'au01']);
    const inbox = JSON.parse((await import('node:fs')).readFileSync(join(s.smDir, 'orch-inbox.json'), 'utf8'));
    assert.match(JSON.stringify(inbox), /the person took the waiting activity au02 out of the line/);
    assert.equal(s.orchestra.prioritize({ projectId: PROJECT, code: 'au01', priority: 'soon' }, s.state).status, 400);
    assert.equal(s.orchestra.prioritize({ projectId: PROJECT, code: 'zz99', priority: 'urgent' }, s.state).status, 400);
    assert.equal(s.orchestra.prioritize({ projectId: 'nope', code: 'au01', priority: 'urgent' }, s.state).status, 404);

    s.state.projects[0].arch.parts[0].groups[0].items.find((i) => i.code === 'au03').status = 'done';
    await s.finish(0);
    assert.deepEqual(s.codes(), ['au01'], 'the done item left the line; the next one took the place');
  } finally { s.cleanup(); }
});

const waitingPiece = (code, extra = {}) => ({ code, partId: 'auth', title: code, weight: null, instructions: `Work on ${code}.`, run: { kind: 'autonomous' }, at: '2026-10-11T10:00:00Z', ...extra });

test('a piece whose start went through before a restart is not started twice', async () => {
  const s = setup({ running: 0 });
  try {
    addPiece(s.smDir, PROJECT, waitingPiece('au01'), () => 'p1');
    addPiece(s.smDir, PROJECT, waitingPiece('au02'), () => 'p2');
    editQueue(s.smDir, PROJECT, (entry) => { for (const p of entry.waiting) p.startingAt = '2026-10-11T10:00:01.000Z'; });
    // The chat on au01 was written down after that moment; au02's start never got that far.
    s.pages['done-1'] = { projectId: PROJECT, parentId: ORCH, node: { kind: 'item', code: 'au01' }, startedAt: '2026-10-11T10:00:02.000Z' };
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au02'], 'only the one that never started');
    assert.deepEqual(s.line(), []);
    const day = JSON.parse(readFileSync(join(s.smDir, 'orchestra.json'), 'utf8')).day[ORCH];
    assert.equal(day.count, 2, 'the one started before the stop still counts in today\'s 30');
  } finally { s.cleanup(); }
});

test('a piece the person takes out while the line is moving is not started', async () => {
  let s = null;
  s = setup({ running: 0, onStart: (body) => { if (body.node.code === 'au01') setOwnerPriority(s.smDir, PROJECT, 'au02', 'drop'); } });
  try {
    addPiece(s.smDir, PROJECT, waitingPiece('au01'), () => 'p1');
    addPiece(s.smDir, PROJECT, waitingPiece('au02', { at: '2026-10-11T10:00:01Z' }), () => 'p2');
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au01'], 'au02 left the line during au01\'s start');
    assert.deepEqual(s.line(), []);
  } finally { s.cleanup(); }
});

test('a start in a pass uses the newest instructions of a piece brought up to date during an earlier start', async () => {
  let s = null;
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  // au01's start takes a while: meanwhile the orchestrator brings the waiting au02 up to date.
  s = setup({ running: 0, onStart: (body) => (body.node.code === 'au01' ? gate : null) });
  try {
    addPiece(s.smDir, PROJECT, waitingPiece('au01'), () => 'p1');
    addPiece(s.smDir, PROJECT, waitingPiece('au02', { at: '2026-10-11T10:00:01Z' }), () => 'p2');
    const pass = s.orchestra.tick();
    while (!s.seen.started.length) await new Promise((resolve) => setImmediate(resolve));
    addPiece(s.smDir, PROJECT, waitingPiece('au02', { instructions: 'Newer words.' }), () => 'p3');
    release();
    await pass;
    assert.deepEqual(s.codes(), ['au01', 'au02']);
    assert.equal(s.seen.started[1].body.text, 'Newer words.');
  } finally { s.cleanup(); }
});

test('a start under way while the orchestrator brings the same waiting item up to date: both calls get the key', async () => {
  let s = null;
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  s = setup({ running: 0, onStart: () => gate });
  try {
    const one = s.call('start_chat', ask('au01'));
    while (!s.seen.started.length) await new Promise((resolve) => setImmediate(resolve));
    // The first call's pass is starting au01; the second joins the same piece and waits for the next pass.
    const two = s.call('start_chat', ask('au01', { instructions: 'Again.' }));
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const answers = [parsed(await one), parsed(await two)];
    assert.deepEqual(answers.map((a) => [a.state, a.key]), [['working', 'new-1'], ['working', 'new-1']]);
    assert.deepEqual(s.codes(), ['au01'], 'started once');
    // The second call's newer words are not lost: they wait for the new chat's first turn end.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const inbox = JSON.parse(readFileSync(join(s.smDir, 'orch-inbox.json'), 'utf8'));
    assert.deepEqual((inbox.queued?.['new-1'] ?? []).map((q) => q.text), ['Again.']);
  } finally { s.cleanup(); }
});

test('the used-up budget holds the whole line; an urgent piece asks the owner, once', async () => {
  const s = setup({ running: 0 });
  try {
    addPiece(s.smDir, PROJECT, waitingPiece('au05', { title: 'Crash on login', weight: 'blocks' }), () => 'p1');
    addPiece(s.smDir, PROJECT, waitingPiece('au01'), () => 'p2');
    s.state.projects[0].budget = budgetOf({ limitUSD: 10, claudeUSD: 12, month: '2026-10' });
    assert.equal(s.state.projects[0].budget.paused, true);
    await s.orchestra.tick();
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), []);
    assert.deepEqual(s.seen.alerts.map((a) => [a.reason, a.code, a.because]), [['urgent-paused', 'au05', 'Crash on login']]);
    assert.deepEqual(s.line().map((p) => p.why), ['paused', 'paused']);
    // The person continues the month: still near the limit, so only the urgent one starts.
    s.state.projects[0].budget = budgetOf({ limitUSD: 10, claudeUSD: 12, month: '2026-10', continueMonth: '2026-10' });
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au05']);
    assert.deepEqual(s.line().map((p) => [p.code, p.why]), [['au01', 'near-budget']]);
  } finally { s.cleanup(); }
});

test('a finishing touch is not held by a piece that left the line in the same pass', async () => {
  const s = setup({ running: 0 });
  try {
    // A normal piece whose item is already done, ahead of a finishing touch: it leaves, and the touch starts.
    addPiece(s.smDir, PROJECT, waitingPiece('au08'), () => 'p1');
    addPiece(s.smDir, PROJECT, waitingPiece('au06', { weight: 'detail', at: '2026-10-11T10:00:01Z' }), () => 'p2');
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au06']);
    assert.deepEqual(s.line(), []);
  } finally { s.cleanup(); }
});

test('a priority the person lowers while room is being made near a limit is followed', async () => {
  let s = null;
  // Every place but the reserved ones is taken by idle chats: making room closes one, and meanwhile the person lowers it.
  s = setup({
    running: 0, chatsMax: 3, budget: budgetOf({ limitUSD: 10, claudeUSD: 8.5, month: '2026-10' }),
    closeIdle: async (id) => {
      setOwnerPriority(s.smDir, PROJECT, 'au07', 'normal');
      const chat = s.chats.find((c) => c.sessionId === id);
      chat.ended = true;
      return true;
    },
  });
  try {
    s.chats.push({ key: 'k-idle', sessionId: 'idle-1', projectId: PROJECT, parentId: ORCH, running: false, node: { kind: 'item', code: 'zz' }, startedAt: '2026-10-11T09:00:00Z' });
    s.pages['idle-1'] = { projectId: PROJECT, parentId: ORCH, node: { kind: 'item', code: 'zz' } };
    addPiece(s.smDir, PROJECT, waitingPiece('au07', { weight: 'important' }), () => 'p1');
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), [], 'now normal near the budget: it waits');
    assert.deepEqual(s.line().map((p) => [p.code, p.priority, p.why]), [['au07', 'normal', 'near-budget']]);
  } finally { s.cleanup(); }
});

test('a piece the person raises while room is being made takes that room first', async () => {
  let s = null;
  s = setup({
    running: 0, chatsMax: 4,
    closeIdle: async (id) => {
      setOwnerPriority(s.smDir, PROJECT, 'au02', 'urgent');
      s.chats.find((c) => c.sessionId === id).ended = true;
      return true;
    },
  });
  try {
    s.chats.push({ key: 'k-idle', sessionId: 'idle-1', projectId: PROJECT, parentId: ORCH, running: false, node: { kind: 'item', code: 'zz' }, startedAt: '2026-10-11T09:00:00Z' });
    s.pages['idle-1'] = { projectId: PROJECT, parentId: ORCH, node: { kind: 'item', code: 'zz' } };
    addPiece(s.smDir, PROJECT, waitingPiece('au01'), () => 'p1');
    addPiece(s.smDir, PROJECT, waitingPiece('au02', { at: '2026-10-11T10:00:01Z' }), () => 'p2');
    await s.orchestra.tick();
    assert.deepEqual(s.codes(), ['au02'], 'the urgent one took the freed place');
    assert.deepEqual(s.line().map((p) => [p.code, p.why]), [['au01', 'place']]);
  } finally { s.cleanup(); }
});

test('a second call on an item already starting is told the model it really started with', async () => {
  let s = null;
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  s = setup({ running: 0, onStart: () => gate });
  try {
    const one = s.call('start_chat', ask('au01'));
    while (!s.seen.started.length) await new Promise((resolve) => setImmediate(resolve));
    const two = s.call('start_chat', ask('au01', { model: 'haiku', effort: 'low' }));
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const answers = [parsed(await one), parsed(await two)];
    assert.deepEqual(answers.map((a) => [a.key, a.model, a.effort]), [['new-1', 'sonnet', 'medium'], ['new-1', 'sonnet', 'medium']]);
  } finally { s.cleanup(); }
});

// ---- the page ----

const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs ?? {}, kids: kids.flat(Infinity).filter((k) => k != null && k !== false) });
const walk = (el, out = []) => { if (el && typeof el === 'object') { out.push(el); el.kids?.forEach((k) => walk(k, out)); } return out; };
const tk = Object.assign((key, vars) => (vars ? `${key}:${Object.values(vars).join('|')}` : key), { count: (key, n) => `${key}:${n}` });

test('"A seguir": each waiting piece with its priority, why it waits and a choice to change it', () => {
  const next = [
    { code: 'au05', title: 'Crash on login', priority: 'urgent', why: 'place' },
    { code: 'au01', title: '', priority: 'normal', why: 'near-weekly' },
    ...['b1', 'b2', 'b3', 'b4'].map((code) => ({ code, title: code, priority: 'polish', why: 'polish' })),
  ];
  const st = orchState({ id: 'p', conversations: [], orchQueue: [...next, { nope: true }] });
  assert.equal(st.next.length, 6, 'a malformed entry is left out');
  assert.equal(orchState({ id: 'p', conversations: [] }).next.length, 0, 'a server that sends no line');
  const picked = [];
  const list = nextList({ h, t: tk }, st.next, { onPriority: (...a) => picked.push(a) });
  const rows = walk(list).filter((e) => e.tag === 'li');
  assert.equal(rows.length, 5, 'the first five');
  assert.match(JSON.stringify(rows[0]), /orch\.prio\.urgent.*Crash on login.*orch\.why\.place/);
  assert.match(JSON.stringify(rows[1]), /"au01"/, 'no title: the code');
  assert.match(JSON.stringify(list), /orch\.next\.more:1/);
  const select = walk(rows[1]).find((e) => e.tag === 'select');
  assert.deepEqual(walk(select).filter((e) => e.tag === 'option').map((o) => [o.attrs.value, o.attrs.selected]),
    [['urgent', false], ['important', false], ['normal', true], ['polish', false], ['drop', false]]);
  select.attrs.onchange({ currentTarget: { value: 'urgent' } });
  assert.deepEqual(picked[0].slice(0, 2), ['au01', 'urgent']);
  assert.equal(nextList({ h, t: tk }, [], { onPriority: () => {} }), null, 'nothing waits: no list');
  const section = orchSection({ h, icon: () => null, t: tk }, st, { onOpen: () => {}, onTidy: () => {}, onPriority: () => {} });
  assert.match(JSON.stringify(section), /orch\.next\.title/);
});

test('every text of the line is in English and Portuguese', () => {
  const keys = [
    'orch.next.title', 'orch.next.more.one', 'orch.next.more.other', 'orch.prio.label', 'orch.prio.saved', 'orch.prio.dropped',
    ...[...PRIORITIES, 'drop'].map((p) => `orch.prio.${p}`),
    ...['place', 'day', 'near-budget', 'near-weekly', 'polish', 'paused'].map((w) => `orch.why.${w}`),
    ...['urgent-day', 'urgent-paused'].flatMap((r) => ['what', 'why', 'do'].map((x) => `alert.${x}.${r}`)),
  ];
  for (const lang of ['en', 'pt-BR']) for (const key of keys) assert.ok(LANGS[lang][key], `${lang} ${key}`);
  assert.equal(LANGS['pt-BR']['orch.next.title'], 'A seguir');
});

test('POST /api/chat/orchestrator with a priority hands the owner\'s choice over, behind the token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-prio-app-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-prio-sm-'));
  const calls = [];
  const chat = { orchestra: { prioritize: (body) => { calls.push(body); return { status: 200, body: { ok: true, code: body.code, priority: body.priority } }; } } };
  const app = createApp({ dir, smDir, chat, stateTtlMs: 0, collectFn: () => ({ generatedAt: new Date().toISOString(), waitingCount: 0, projects: [{ id: PROJECT, name: 'shop', root: join(dir, 'shop') }] }) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const post = (body, auth = true) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'x-session-map': '1', 'content-type': 'application/json', ...(auth ? { cookie: `sm_token=${token}` } : {}) };
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/chat/orchestrator', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  try {
    assert.equal((await post({ projectId: PROJECT, code: 'au01', priority: 'urgent' }, false)).status, 401);
    assert.deepEqual(calls, []);
    assert.deepEqual((await post({ projectId: PROJECT, code: 'au01', priority: 'urgent' })).json, { ok: true, code: 'au01', priority: 'urgent' });
    assert.deepEqual(calls, [{ projectId: PROJECT, code: 'au01', priority: 'urgent' }]);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

