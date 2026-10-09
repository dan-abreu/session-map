import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNAL_KINDS, SIGNAL_CATALOG, signalWords, clashSignal, waitingSignal, blocksSignal, errorSignal, relationSignal, costSignal, clashKey,
} from '../server/web/signals.js';
import { translator } from '../server/web/i18n.js';

const LANGS = { en: translator('en'), pt: translator('pt-BR') };

// A sample for every reason of every kind, with every placeholder a builder can fill.
const VARS = {
  a: 'feat/pay', b: 'fix/cart', ownerA: 'Ana', ownerB: 'Beto', files: 'src/pay.js, src/cart.js', tool: 'Write', title: 'Pagamento com Pix', part: 'Vitrine',
  who: 'Ana', cost: '$12.00', estimate: '$8.00', used: '$41.00', monthly: '$50.00', kinds: 'shared chat', n: 3, nameA: 'Vitrine', nameB: 'Pagamentos', pct: 50, code: 'vi03',
};

test('no kind of signal lacks what it is, why it happens and what to do, in both languages', () => {
  assert.deepEqual(SIGNAL_KINDS, ['clash', 'waiting', 'blocks', 'error', 'relation', 'cost']);
  for (const kind of SIGNAL_KINDS) {
    const reasons = Object.keys(SIGNAL_CATALOG[kind].reasons);
    assert.ok(reasons.length > 0, `${kind} has reasons`);
    for (const reason of reasons) for (const [lang, t] of Object.entries(LANGS)) {
      const words = signalWords(t, { kind, reason, vars: VARS });
      for (const field of ['what', 'why', 'todo']) {
        assert.ok(words[field].trim().length > 8, `${lang} ${kind}.${reason} ${field} is empty`);
        assert.ok(!/[{}]|\bsig\.|\balert\./.test(words[field]), `${lang} ${kind}.${reason} ${field} has a hole: ${words[field]}`);
      }
      assert.ok(words.actions.length > 0, `${kind}.${reason} has a button`);
      assert.ok(words.actions.every((a) => a.label.trim() && !/^sig\./.test(a.label)), `${kind}.${reason} button labels`);
      assert.equal(words.actions.filter((a) => a.primary).length, 1, `${kind}.${reason} has exactly one main button`);
    }
  }
});

test('the three fields are different sentences, so a sign never repeats itself', () => {
  for (const kind of SIGNAL_KINDS) for (const reason of Object.keys(SIGNAL_CATALOG[kind].reasons)) {
    const w = signalWords(LANGS.en, { kind, reason, vars: VARS });
    assert.equal(new Set([w.what, w.why, w.todo]).size, 3, `${kind}.${reason}`);
  }
});

test('a clash names both branches, both owners, the shared files and advises joining the most advanced first', () => {
  const sig = clashSignal({ kind: 'clash', branches: ['feat/pay', 'fix/cart'], owners: ['Ana', 'Beto'], files: ['src/pay.js'], sameOwner: false, workCellIds: ['w1', 'w2'] });
  assert.equal(sig.kind, 'clash');
  assert.equal(sig.reason, 'others');
  const w = signalWords(LANGS.en, sig);
  for (const piece of ['feat/pay', 'fix/cart', 'Ana', 'Beto', 'src/pay.js']) assert.ok(`${w.what} ${w.why}`.includes(piece), piece);
  assert.match(w.todo, /most advanced/i);
  assert.deepEqual(w.actions.map((a) => a.id), ['resolve-ai', 'see-files', 'ignore']);
  assert.equal(w.actions[0].primary, true);
  assert.equal(clashSignal({ branches: ['a', 'b'], owners: ['X', 'X'], sameOwner: true, files: [] }).reason, 'mine');
  assert.equal(clashSignal({ kind: 'clash', text: 'old server' }), null, 'a clash with no branches is not worded here');
});

test('clashKey is the same for the pair in either order', () => {
  assert.equal(clashKey({ workCellIds: ['b', 'a'] }), clashKey({ workCellIds: ['a', 'b'] }));
  assert.equal(clashKey({ workCellIds: ['a', 'b'] }), 'a|b');
});

test('a conversation waiting is a question, an ending question or a permission; a decision and an item have their own words', () => {
  const chat = (waiting) => ({ waiting: { strong: false, weak: false, items: [], ...waiting } });
  assert.equal(waitingSignal({ chat: chat({ strong: true }) }).reason, 'question');
  assert.equal(waitingSignal({ chat: chat({ weak: true }) }).reason, 'asks');
  assert.equal(waitingSignal({ chat: chat({ items: ['Pick the gateway'] }) }).reason, 'asks');
  assert.equal(waitingSignal({ decision: { kind: 'decision', text: 'Which gateway?' } }).reason, 'decision');
  assert.equal(waitingSignal({ decision: { kind: 'item', who: 'Ana', code: 'vi03', text: 'x' } }).reason, 'item');
  assert.equal(waitingSignal({ chat: chat({}) }), null, 'a chat that waits for nothing is no signal');
  assert.equal(waitingSignal({ permission: { tool: 'Write' } }).vars.tool, 'Write');
});

test('an item that blocks others says whether it is with the person or with Claude', () => {
  assert.equal(blocksSignal({ weight: 'blocks', status: 'todo', who: 'Ana', title: 'Pix' }, 'Vitrine').reason, 'you');
  assert.equal(blocksSignal({ weight: 'blocks', status: 'doing', who: null, title: 'Pix' }, 'Vitrine').reason, 'claude');
  assert.equal(blocksSignal({ weight: 'blocks', status: 'done', title: 'Pix' }, 'Vitrine'), null, 'a finished item blocks nothing');
  assert.equal(blocksSignal({ weight: 'important', status: 'todo', title: 'Pix' }, 'Vitrine'), null);
});

test('an error is worded by what happened, and only a failed step offers to try again', () => {
  const failed = signalWords(LANGS.pt, errorSignal('failed'));
  assert.deepEqual(failed.actions.map((a) => a.id), ['retry', 'continue']);
  for (const reason of ['stopped', 'exited', 'restart']) assert.deepEqual(signalWords(LANGS.en, errorSignal(reason)).actions.map((a) => a.id), ['continue']);
  assert.equal(errorSignal('nonsense'), null);
});

test('a relation asks for action only when both parts have work open at the same time', () => {
  const link = { a: 'vitrine', b: 'pagamentos', weight: 2, reasons: [{ kind: 'shared-chat' }, { kind: 'file-ref' }, { kind: 'shared-chat' }] };
  const calm = relationSignal(link, { nameOf: (id) => id, bothBusy: false, kindWord: (k) => k });
  assert.equal(calm.reason, 'calm');
  assert.equal(calm.vars.kinds, 'shared-chat · file-ref', 'each kind of reason once');
  assert.equal(relationSignal(link, { nameOf: (id) => id, bothBusy: true, kindWord: (k) => k }).reason, 'busy');
  const w = signalWords(LANGS.en, calm);
  assert.match(w.todo, /nothing/i);
});

test('cost is a sign only past the estimate or near the monthly budget', () => {
  assert.equal(costSignal({ costUSD: 10, estimateUSD: 8 }, { money: (v) => `$${v}`, kind: 'estimate' }).reason, 'estimate');
  assert.equal(costSignal({ costUSD: 7, estimateUSD: 8 }, { money: (v) => `$${v}`, kind: 'estimate' }), null, 'under the estimate is no news');
  assert.equal(costSignal({ costUSD: 7, estimateUSD: null }, { money: (v) => `$${v}`, kind: 'estimate' }), null, 'no estimate, nothing to exceed');
  assert.equal(costSignal({ usedUSD: 45, monthlyUSD: 50 }, { money: (v) => `$${v}`, kind: 'budget' }).reason, 'budget');
  assert.equal(costSignal({ usedUSD: 10, monthlyUSD: 50 }, { money: (v) => `$${v}`, kind: 'budget' }), null);
});
