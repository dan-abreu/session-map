import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  costRows, estimateTone, budgetTone, aiSpend, chatButtons, chatLog, visibleProject, waitingEntries, safeTunnel, changedLines, waitingCounts, clashWords,
  waitingKind, rangeStart, pcModeOffer,
} from '../server/web/views.js';

const DEMO = JSON.parse(readFileSync(new URL('../demo/state.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const shop = () => clone(DEMO.projects[0]);

test('costRows lists the conversations active in the period, most expensive first', () => {
  const state = clone(DEMO);
  const now = Date.parse(state.generatedAt);
  const d30 = costRows(state, 'd30', now);
  assert.ok(d30.length > 0);
  for (let i = 1; i < d30.length; i++) assert.ok(d30[i - 1].chat.costUSD >= d30[i].chat.costUSD);
  assert.ok(d30.every((r) => now - Date.parse(r.chat.updatedAt) <= 30 * 864e5));
  const today = costRows(state, 'today', now);
  assert.ok(today.length < d30.length);
  assert.ok(today.every((r) => new Date(r.chat.updatedAt).toDateString() === new Date(now).toDateString()));
});

test('estimateTone and budgetTone follow the thresholds of the design', () => {
  assert.equal(estimateTone(10, 10), 'ok');
  assert.equal(estimateTone(12, 10), 'warn');
  assert.equal(estimateTone(13.1, 10), 'over');
  assert.equal(estimateTone(5, null), null);
  assert.equal(budgetTone(79, 100), 'ok');
  assert.equal(budgetTone(80, 100), 'warn');
  assert.equal(budgetTone(100, 100), 'over');
});

test('aiSpend sums what the map itself spent on the AI today', () => {
  const state = clone(DEMO);
  state.projects[1].ai = null;
  const spend = aiSpend(state);
  assert.equal(spend.todayUSD, DEMO.projects[0].ai.spentUSDToday);
  assert.deepEqual(spend.projects.map((x) => x.project.id), [DEMO.projects[0].id]);
  assert.equal(aiSpend({ projects: [] }).todayUSD, 0);
});

test('chatButtons: terminal chats open only when closed, close only when idle, page chat only when not live', () => {
  const base = { entrypoint: 'cli', live: false, status: 'closed', chattable: true, archived: false, bridgeUrl: null };
  assert.deepEqual(chatButtons(base), { open: { enabled: true, reason: null }, close: null, archive: 'archive', write: 'page', phone: null });
  const liveIdle = chatButtons({ ...base, live: true, status: 'idle', chattable: false, bridgeUrl: 'https://claude.ai/code/abc' });
  assert.deepEqual(liveIdle.open, { enabled: false, reason: 'already-open' });
  assert.deepEqual(liveIdle.close, { enabled: true, reason: null });
  assert.equal(liveIdle.write, 'phone');
  assert.equal(liveIdle.phone, 'https://claude.ai/code/abc');
  const busy = chatButtons({ ...base, live: true, status: 'busy', chattable: false });
  assert.deepEqual(busy.close, { enabled: false, reason: 'busy' });
  assert.equal(busy.write, null);
  const vscode = chatButtons({ ...base, entrypoint: 'claude-vscode', live: true, status: 'idle', chattable: false });
  assert.deepEqual(vscode.open, { enabled: true, reason: null }, 'VS Code focuses the open tab');
  assert.equal(vscode.write, 'vscode');
  assert.equal(chatButtons({ ...base, archived: true }).archive, 'unarchive');
  assert.equal(chatButtons({ ...base, bridgeUrl: 'javascript:alert(1)' }).phone, null, 'only claude.ai links');
});

test('chatLog builds the conversation from the stream: partial text, tools, permissions, turn end', () => {
  const events = [
    { type: 'local-send', data: { text: 'add a test' } },
    { type: 'session', data: { sessionId: 's-1', state: 'started' } },
    { type: 'text', data: { text: 'Sure', partial: true } },
    { type: 'text', data: { text: ', on it.', partial: true } },
    { type: 'text', data: { text: 'Sure, on it.', partial: false } },
    { type: 'tool', data: { phase: 'use', id: 't1', name: 'Write', input: '{"file_path":"a.test.js"}' } },
    { type: 'permission', data: { requestId: 'r1', state: 'asked', toolName: 'Write', input: '{}' } },
    { type: 'permission', data: { requestId: 'r1', state: 'allowed' } },
    { type: 'tool', data: { phase: 'result', id: 't1', isError: false, text: 'ok' } },
    { type: 'text', data: { text: 'Done.', partial: false } },
    { type: 'turn-end', data: { subtype: 'success', isError: false } },
  ];
  const log = events.reduce(chatLog, undefined);
  assert.equal(log.sessionId, 's-1');
  assert.equal(log.running, false);
  assert.deepEqual(log.items.map((i) => i.type), ['user', 'assistant', 'tool', 'permission', 'assistant']);
  assert.equal(log.items[1].text, 'Sure, on it.');
  assert.equal(log.items[1].streaming, false);
  assert.deepEqual([log.items[2].result, log.items[2].isError], ['ok', false]);
  assert.equal(log.items[3].state, 'allowed');
  assert.equal(log.items[4].text, 'Done.');
});

test('chatLog marks a running turn, an error and the end of the process', () => {
  let log = chatLog(undefined, { type: 'local-send', data: { text: 'hi' } });
  assert.equal(log.running, true);
  log = chatLog(log, { type: 'error', data: { error: 'exited', code: 1 } });
  assert.equal(log.running, false);
  assert.equal(log.items.at(-1).type, 'error');
  log = chatLog(log, { type: 'session', data: { sessionId: 's', state: 'ended' } });
  assert.equal(log.ended, true);
});

test('chatLog: a reopened conversation starts from its history and takes the server\'s user events without doubling the page\'s own', () => {
  let log = chatLog(undefined, { type: 'history', data: { messages: [{ role: 'user', text: 'Add the error message' }, { role: 'assistant', text: 'Done.' }] } });
  assert.deepEqual(log.items.map((i) => [i.type, i.text]), [['user', 'Add the error message'], ['assistant', 'Done.']]);
  assert.equal(log.running, false);
  log = chatLog(log, { type: 'user', data: { text: 'from another tab' } });
  assert.equal(log.items.at(-1).text, 'from another tab');
  assert.equal(log.running, true, 'a message the server took means a turn is on');
  log = chatLog(log, { type: 'turn-end', data: {} });
  log = chatLog(log, { type: 'local-send', data: { text: 'and the retry' } });
  log = chatLog(log, { type: 'user', data: { text: 'and the retry' } });
  assert.equal(log.items.filter((i) => i.type === 'user' && i.text === 'and the retry').length, 1);
});

test('chatLog keeps the mode claude reports, and a resumed process is no longer ended', () => {
  let log = chatLog(undefined, { type: 'session', data: { sessionId: 's', state: 'started', mode: 'auto' } });
  assert.equal(log.mode, 'auto');
  log = chatLog(log, { type: 'mode', data: { mode: 'acceptEdits' } });
  assert.equal(log.mode, 'acceptEdits');
  log = chatLog(log, { type: 'session', data: { sessionId: 's', state: 'ended' } });
  assert.equal(log.ended, true);
  log = chatLog(log, { type: 'session', data: { sessionId: 's', state: 'started', mode: 'default' } });
  assert.equal(log.ended, false);
  assert.equal(log.mode, 'default');
});

test('visibleProject drops archived chats from the map unless asked', () => {
  const p = shop();
  const gone = p.chats[0];
  gone.archived = true;
  const v = visibleProject(p, false);
  assert.ok(!v.chats.some((c) => c.sessionId === gone.sessionId));
  assert.ok(!v.arch.parts.some((part) => part.chatIds.includes(gone.sessionId)), 'its part no longer counts it');
  assert.equal(p.arch.parts.find((part) => part.id === gone.partId).chatIds.includes(gone.sessionId), true, 'the original is left alone');
  assert.equal(visibleProject(p, true), p);
});

test('waitingEntries ranks strong questions first, then decisions and items, and skips archived chats', () => {
  const state = clone(DEMO);
  const entries = waitingEntries(state);
  assert.equal(entries.length, state.waitingCount);
  const ranks = entries.map((e) => e.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  const archived = clone(DEMO);
  const waitingChat = archived.projects.flatMap((p) => p.chats).find((c) => c.waiting.strong);
  waitingChat.archived = true;
  assert.equal(waitingEntries(archived).length, entries.length - 1);
});

test('waitingEntries can be limited to one project, so the counter follows the project that is open', () => {
  const state = clone(DEMO);
  const shopId = state.projects[0].id;
  const notesId = state.projects[1].id;
  const mine = waitingEntries(state, shopId);
  assert.equal(mine.length, waitingEntries(state).length, 'the demo waits only in its first project');
  assert.ok(mine.every((e) => e.project.id === shopId));
  assert.deepEqual(waitingEntries(state, notesId), []);
  const other = clone(DEMO);
  other.projects[1].decisions = [{ kind: 'item', text: 'Pick the logo', partId: 'x', code: 'zz01', who: 'Ana' }];
  assert.equal(waitingEntries(other, notesId).length, 1);
  assert.equal(waitingEntries(other, shopId).length, mine.length);
  assert.equal(waitingEntries(other).length, mine.length + 1);
});

test('safeTunnel lets only an https link through to a href', () => {
  assert.equal(safeTunnel('https://vscode.dev/tunnel/my-pc'), 'https://vscode.dev/tunnel/my-pc');
  for (const bad of ['http://vscode.dev/tunnel/x', 'javascript:alert(1)', ' https://x', 'vscode://file/x', '', null, undefined, 42]) assert.equal(safeTunnel(bad), null, String(bad));
});

test('changedLines turns ranges into a lookup and finds the first line', () => {
  const { has, first } = changedLines([{ from: 2, to: 3 }, { from: 7, to: 7 }]);
  assert.deepEqual([1, 2, 3, 4, 7, 8].map(has), [false, true, true, false, true, false]);
  assert.equal(first, 2);
  const none = changedLines([]);
  assert.equal(none.has(1), false);
  assert.equal(none.first, null);
});

test('waitingCounts counts the list by kind, questions first, and leaves out kinds with nothing', () => {
  const p = { id: 'p', units: [], chats: [], workCells: [] };
  const chat = (waiting) => ({ project: p, chat: { waiting: { strong: false, weak: false, items: [], ...waiting } } });
  const entries = [
    chat({ strong: true }), chat({ items: ['pick one'] }), chat({ weak: true }),
    { project: p, decision: { kind: 'decision' } }, { project: p, decision: { kind: 'clash' } }, { project: p, decision: { kind: 'clash' } },
  ];
  assert.deepEqual(waitingCounts(entries), [{ kind: 'question', n: 1 }, { kind: 'decision', n: 2 }, { kind: 'clash', n: 2 }, { kind: 'ends', n: 1 }]);
  assert.deepEqual(waitingCounts([]), []);
});

test('clashWords picks "your branches" for one owner and names both people otherwise', () => {
  assert.deepEqual(clashWords({ kind: 'clash', sameOwner: true, branches: ['a', 'b'], owners: ['Ana', 'Ana'], files: ['x.ts'] }),
    { key: 'waiting.clashMine', vars: { a: 'a', b: 'b', ownerA: 'Ana', ownerB: 'Ana', files: 'x.ts' } });
  assert.equal(clashWords({ kind: 'clash', sameOwner: false, branches: ['a', 'b'], owners: ['Ana', 'Rui'], files: ['x.ts', 'y.ts'] }).key, 'waiting.clashOthers');
  assert.equal(clashWords({ kind: 'clash', text: 'older server' }), null);
});

test('waitingKind: an item waiting on a person is its own kind, after questions and before decisions', () => {
  const p = { id: 'p' };
  assert.equal(waitingKind({ project: p, decision: { kind: 'item' } }), 'item');
  const entries = [{ project: p, decision: { kind: 'decision' } }, { project: p, decision: { kind: 'item' } }, { project: p, decision: { kind: 'item' } }];
  assert.deepEqual(waitingCounts(entries), [{ kind: 'item', n: 2 }, { kind: 'decision', n: 1 }]);
});

test('rangeStart: today starts at local midnight, 7 and 30 days count back from now', () => {
  const now = new Date(2026, 9, 9, 15, 30).getTime();
  assert.equal(rangeStart('today', now), new Date(2026, 9, 9).getTime());
  assert.equal(rangeStart('d7', now), now - 7 * 864e5);
  assert.equal(rangeStart('d30', now), now - 30 * 864e5);
});

test('pcModeOffer: only a real mode can go to the whole PC, and saying the same mode again is no change', () => {
  assert.deepEqual(pcModeOffer('settings', 'default'), { mode: null, same: false });
  assert.deepEqual(pcModeOffer('acceptEdits', 'default'), { mode: 'acceptEdits', same: false });
  assert.deepEqual(pcModeOffer('auto', 'auto'), { mode: 'auto', same: true });
  assert.deepEqual(pcModeOffer('bypassPermissions', null), { mode: null, same: false });
});
