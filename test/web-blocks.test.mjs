import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalCard, kindBlock, pointStrip } from '../server/web/blocks.js';
import { translator } from '../server/web/i18n.js';

// A DOM-free h: every element is {tag, attrs, children}.
const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((c) => c != null && c !== false) });
const walk = (node) => (node && typeof node === 'object' ? [node, ...(node.children ?? []).flatMap(walk)] : []);
const textOf = (node) => walk(node).flatMap((n) => n.children ?? []).filter((c) => typeof c === 'string').join(' | ');
const ctx = { h, icon: null, t: translator('en') };

const CLASH = { kind: 'clash', reason: 'others', vars: { a: 'feat/pay', b: 'feat/cart', ownerA: 'Ana', ownerB: 'Beto', files: 'src/pay.js' } };

test('a sign card has what, why, what to do and one button per handler it was given', () => {
  const calls = [];
  const card = signalCard(ctx, CLASH, { 'resolve-ai': () => calls.push('ai'), ignore: () => calls.push('ignore') });
  const text = textOf(card);
  for (const piece of ['Ana (feat/pay) and Beto (feat/cart) collide', 'Why it is happening', 'src/pay.js', 'What to do now', 'most advanced']) assert.ok(text.includes(piece), piece);
  const buttons = walk(card).filter((n) => n.tag === 'button');
  assert.deepEqual(buttons.map((b) => b.attrs['data-sig-act']), ['resolve-ai', 'ignore'], '"See the files" has no handler here, so it is not offered');
  assert.deepEqual(buttons.map((b) => b.attrs.class), ['btn primary', 'btn']);
  buttons[0].attrs.onclick();
  assert.deepEqual(calls, ['ai']);
});

test('a handler may word its own button, and a null handler leaves the button out', () => {
  const link = { kind: 'relation', reason: 'calm', vars: { nameA: 'A', nameB: 'B', kinds: 'x', n: 1 } };
  let ran = 0;
  const card = signalCard(ctx, link, { 'open-chats': null, 'put-on-flow': { label: 'Draw it', run: () => { ran += 1; } } });
  const buttons = walk(card).filter((n) => n.tag === 'button');
  assert.deepEqual(buttons.map((b) => b.children[0]), ['Draw it']);
  buttons[0].attrs.onclick();
  assert.equal(ran, 1);
});

test('a card with no handler at all still explains itself and shows no button row', () => {
  const card = signalCard(ctx, CLASH, {});
  assert.equal(walk(card).filter((n) => n.tag === 'button').length, 0);
  assert.ok(textOf(card).includes('What to do now'));
});

test('a kind block says its title and where its data comes from, and is left out when empty unless it says so', () => {
  const block = kindBlock(ctx, 'tasks', { vars: { file: 'docs/architecture/pay.md' } }, h('p', {}, 'one'));
  assert.ok(block.attrs.class.includes('kind-tasks'));
  const text = textOf(block);
  assert.ok(text.includes('Tasks') && text.includes('Comes from the plan: docs/architecture/pay.md'));
  assert.equal(kindBlock(ctx, 'chats', {}, null, false), null);
  assert.ok(textOf(kindBlock(ctx, 'chats', { empty: 'Nothing here yet.' })).includes('Nothing here yet.'));
  assert.ok(textOf(kindBlock(ctx, 'files', { from: 'Comes from git: the files this line of work changes.' }, h('p', {}, 'f'))).includes('this line of work'));
});

test('the strip of a box sheet: one tab per kind of information first, then the chat, in one tablist', () => {
  const picked = [];
  const strip = pointStrip(ctx, ['summary', 'tasks', 'files', 'chat'], 'summary', (tab) => picked.push(tab));
  assert.equal(strip.attrs.role, 'tablist');
  const tabs = walk(strip).filter((n) => n.tag === 'button');
  assert.deepEqual(tabs.map((b) => b.attrs['data-ptab']), ['summary', 'tasks', 'files', 'chat']);
  assert.deepEqual(tabs.map((b) => b.attrs.role), ['tab', 'tab', 'tab', 'tab']);
  assert.deepEqual(tabs.map((b) => b.attrs['aria-selected']), ['true', 'false', 'false', 'false']);
  assert.deepEqual(tabs.map((b) => b.attrs.tabindex), ['0', '-1', '-1', '-1'], 'one tab stop, the arrows move inside');
  assert.deepEqual(tabs.map((b) => b.attrs['aria-controls']), ['pointDetails', 'pointDetails', 'pointDetails', 'chatPane']);
  assert.equal(tabs[3].attrs.id, 'ptab-chat');
  assert.ok(textOf(strip).includes('Summary') && textOf(strip).includes('Chat'));
  tabs[3].attrs.onclick();
  assert.deepEqual(picked, ['chat']);
});

test('the strip words a tab its own way when asked (the root box calls its chats "Project chats")', () => {
  const strip = pointStrip(ctx, ['summary', 'chats', 'chat'], 'chat', () => {}, { chats: 'Project chats' });
  assert.ok(textOf(strip).includes('Project chats') && !textOf(strip).includes('Conversations'));
  assert.equal(walk(strip).filter((n) => n.tag === 'button').at(-1).attrs['aria-selected'], 'true');
});
