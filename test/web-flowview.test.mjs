import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partTone, partFlags, historyStart, historyPush, historyUndo, historyRedo, foldMermaid, svgNodeId, mmdFileName,
} from '../server/web/flowview.js';

const counts = (o = {}) => ({ total: 0, done: 0, doing: 0, withUser: 0, blocks: 0, ...o });

test('partTone: a chat working there first, then items in progress, all done, and the rest still to do', () => {
  assert.equal(partTone(counts({ total: 3, doing: 1 }), true), 'live');
  assert.equal(partTone(counts({ total: 3, doing: 1 }), false), 'doing');
  assert.equal(partTone(counts({ total: 2, done: 2 }), false), 'done');
  assert.equal(partTone(counts({ total: 2, done: 1 }), false), 'todo');
  assert.equal(partTone(counts(), false), 'todo', 'a part with no items is not done');
});

test('partFlags: open blockers and items waiting on a person, in that order', () => {
  assert.deepEqual(partFlags(counts({ blocks: 1, withUser: 2 })), ['blocks', 'waiting']);
  assert.deepEqual(partFlags(counts({ withUser: 1 })), ['waiting']);
  assert.deepEqual(partFlags(counts()), []);
});

test('the draft history: push, undo and redo; the same text twice is one step, and a push after undo drops the redo', () => {
  let h = historyStart('a');
  h = historyPush(h, 'b');
  h = historyPush(h, 'b');
  h = historyPush(h, 'c');
  assert.deepEqual(h, { past: ['a', 'b'], now: 'c', future: [] });
  h = historyUndo(h);
  assert.equal(h.now, 'b');
  h = historyRedo(h);
  assert.equal(h.now, 'c');
  h = historyUndo(historyUndo(h));
  assert.equal(h.now, 'a');
  assert.equal(historyUndo(h), h, 'nothing to undo');
  h = historyPush(h, 'z');
  assert.deepEqual(h, { past: ['a'], now: 'z', future: [] });
  assert.equal(historyRedo(h), h, 'nothing to redo');
});

test('the draft history keeps the last 100 steps', () => {
  let h = historyStart('0');
  for (let i = 1; i <= 150; i++) h = historyPush(h, String(i));
  assert.equal(h.past.length, 100);
  assert.equal(h.past[0], '50');
});

test('foldMermaid: a reply shows a short mark where its diagram was, and keeps the words around it', () => {
  const reply = 'Added Billing.\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\nApply when ready.';
  assert.equal(foldMermaid(reply, '[diagram]'), 'Added Billing.\n\n[diagram]\n\nApply when ready.');
  assert.equal(foldMermaid('no diagram', '[d]'), 'no diagram');
  assert.equal(foldMermaid('```mermaid\nflowchart LR\n  a\n```', '[d]'), '[d]');
  assert.equal(foldMermaid('Here:\n```mermaid\nflowchart LR\n  a --> ', '[d]'), 'Here:\n[d]', 'a fence still streaming folds too');
});

test('svgNodeId: the flowchart node an SVG group stands for, with or without the render prefix, dashes and all', () => {
  const ids = new Set(['VIT', 'my-box', 'box_2']);
  assert.equal(svgNodeId('flowchart-VIT-3', ids), 'VIT');
  assert.equal(svgNodeId('flow-1-flowchart-VIT-12', ids), 'VIT');
  assert.equal(svgNodeId('flowchart-my-box-0', ids), 'my-box');
  assert.equal(svgNodeId('flowchart-box_2-7', ids), 'box_2');
  assert.equal(svgNodeId('flowchart-other-1', ids), null);
  assert.equal(svgNodeId('', ids), null);
});

test('mmdFileName: the project name as a safe file name', () => {
  assert.equal(mmdFileName('acme-shop'), 'acme-shop-flow.mmd');
  assert.equal(mmdFileName('Minha Loja / v2'), 'minha-loja-v2-flow.mmd');
  assert.equal(mmdFileName(''), 'flow.mmd');
});
