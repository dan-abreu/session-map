import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranscript, findHits, latestTodos, lineDiff, withDays } from '../server/web/transcript.js';

const dayOf = (ts) => ts.slice(0, 10);

test('withDays puts a date line before the first message of each day', () => {
  const items = [
    { type: 'user', text: 'a', ts: '2026-10-08T10:00:00Z' },
    { type: 'assistant', text: 'b', ts: '2026-10-08T10:01:00Z' },
    { type: 'tool', name: 'Read', ts: null },
    { type: 'user', text: 'c', ts: '2026-10-09T09:00:00Z' },
  ];
  assert.deepEqual(withDays(items, dayOf).map((i) => (i.type === 'day' ? `day ${i.day}` : i.text ?? i.name)), [
    'day 2026-10-08', 'a', 'b', 'Read', 'day 2026-10-09', 'c',
  ]);
  assert.deepEqual(withDays([], dayOf), []);
});

test('findHits finds the messages and steps that hold the words, ignoring case', () => {
  const items = [
    { type: 'user', text: 'Fix the Checkout' },
    { type: 'tool', name: 'Bash', input: '{"command":"npm test"}', result: 'checkout ok', step: { target: 'npm test' } },
    { type: 'assistant', text: 'Done.' },
    { type: 'question', questions: [{ question: 'Which checkout?', header: '', options: [] }], answers: null },
    { type: 'day', day: '2026-10-09' },
  ];
  assert.deepEqual(findHits(items, 'CHECKOUT'), [0, 1, 3]);
  assert.deepEqual(findHits(items, '  '), []);
});

test('latestTodos gives the last task list written, with the step being done now', () => {
  assert.equal(latestTodos([{ type: 'user', text: 'x' }]), null);
  const todos = latestTodos([
    { type: 'tool', name: 'TodoWrite', todos: [{ text: 'A', status: 'pending', active: 'Doing A' }] },
    { type: 'tool', name: 'TodoWrite', todos: [{ text: 'A', status: 'completed', active: 'Doing A' }, { text: 'B', status: 'in_progress', active: 'Doing B' }] },
  ]);
  assert.deepEqual(todos, { list: [{ text: 'A', status: 'completed', active: 'Doing A' }, { text: 'B', status: 'in_progress', active: 'Doing B' }], done: 1, now: 'Doing B' });
});

test('lineDiff marks removed and added lines around the kept ones', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), [
    { kind: 'same', text: 'a' }, { kind: 'del', text: 'b' }, { kind: 'add', text: 'B' }, { kind: 'same', text: 'c' }, { kind: 'add', text: 'd' },
  ]);
  assert.deepEqual(lineDiff('', 'new'), [{ kind: 'add', text: 'new' }]);
  const big = lineDiff(Array.from({ length: 3000 }, (_, i) => `x${i}`).join('\n'), 'y');
  assert.equal(big.filter((r) => r.kind === 'del').length, 3000, 'too big to compare: all out, then all in');
});

// Just enough DOM to read what the transcript draws.
class El {
  constructor(tag, attrs, children) { this.tag = tag; this.attrs = attrs ?? {}; this.children = children; this.listeners = {}; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
}
const h = (tag, attrs, ...kids) => new El(tag, attrs, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const walk = (el, out = []) => {
  if (el instanceof El) { out.push(el); for (const c of el.children) walk(c, out); }
  return out;
};
const text = (el) => walk(el).flatMap((e) => e.children.filter((c) => typeof c === 'string')).join(' ');
const t = () => (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);
const view = (extra = {}) => createTranscript({
  h, t, time: (ts) => `T${ts.slice(11, 16)}`, day: (d) => `D${d}`, money: (v) => `$${v.toFixed(2)}`, imageUrl: (n) => `/img/${n}`, ...extra,
});

test('a message shows its markdown, its time and the cost of the reply', () => {
  const node = view().node({ type: 'assistant', text: 'Use **this**', ts: '2026-10-09T10:05:00Z', replyCostUSD: 0.12 });
  assert.ok(walk(node).some((e) => e.tag === 'strong' && e.children.includes('this')));
  assert.match(text(node), /T10:05/);
  assert.match(text(node), /\$0\.12/);
});

test('a step folds with its words, input and result; an edit shows before and after', () => {
  const tv = view();
  const run = tv.node({ type: 'tool', name: 'Bash', ts: '2026-10-09T10:05:00Z', step: { kind: 'run', target: 'npm test' }, input: '{"command":"npm test"}', result: 'ok', isError: false });
  assert.equal(walk(run)[1].tag, 'details');
  assert.match(text(run), /step\.done\.run\(npm test\)/);
  assert.match(text(run), /ok/);
  const edit = tv.node({ type: 'tool', name: 'Edit', step: { kind: 'edit', target: 'a.ts' }, input: '{}', result: 'done', isError: false, diff: { path: 'a.ts', hunks: [{ before: 'a', after: 'b' }] } });
  const rows = walk(edit).filter((e) => /diff-(add|del)/.test(e.attrs.class ?? ''));
  assert.deepEqual(rows.map((r) => r.attrs.class.match(/diff-(add|del)/)[1]), ['del', 'add']);
  const running = tv.node({ type: 'tool', name: 'Read', step: { kind: 'read', target: 'a.ts' }, input: '{}', result: null, isError: false });
  assert.match(text(running), /live\.step\.read\(a\.ts\)/, 'a step still running reads in the present');
});

test('a question shows every option and marks the answer given', () => {
  const node = view().node({ type: 'question', ts: null, questions: [{ header: 'Phone', question: 'Which?', multiSelect: false, options: [{ label: 'New', description: 'From the site' }, { label: 'Old', description: '' }] }], answers: { 'Which?': 'New' } });
  const chosen = walk(node).filter((e) => /is-chosen/.test(e.attrs.class ?? ''));
  assert.equal(chosen.length, 1);
  assert.match(text(chosen[0]), /New/);
  assert.match(text(node), /From the site/);
});

test('images, thinking and helpers', () => {
  const opened = [];
  const tv = view({ onHelper: (agent, box) => opened.push([agent.id, box]) });
  const user = tv.node({ type: 'user', text: 'Look', ts: null, images: [{ n: 3, media: 'image/png' }] });
  assert.ok(walk(user).some((e) => e.tag === 'img' && e.attrs.src === '/img/3'));
  const think = tv.node({ type: 'thinking', text: 'Hmm', ms: 4200, ts: null });
  assert.match(text(think), /chat\.thought\(4\)/);
  const helper = tv.node({ type: 'tool', name: 'Agent', step: { kind: 'agent', target: 'Scan' }, input: '{"prompt":"raw json"}', result: 'Found', isError: false, agent: { id: 'a1', kind: 'Explore', description: 'Scan', model: 'haiku', status: 'completed', steps: 4, prompt: 'Scan **the forms**' } });
  assert.ok(walk(helper).some((e) => e.tag === 'strong' && e.children.includes('the forms')), 'what the helper was asked, in words');
  assert.doesNotMatch(text(helper), /raw json/, 'not the raw input');
  const details = walk(helper).find((e) => e.tag === 'details');
  details.listeners.toggle[0]({ target: { open: true } });
  assert.equal(opened[0][0], 'a1', 'opening the step loads the helper\'s own conversation');
});
