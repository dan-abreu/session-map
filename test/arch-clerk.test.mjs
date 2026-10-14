import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addItem, addLink, addPart, addRequest, finishItem, startItem } from '../server/arch/clerk.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { parseFlow } from '../server/web/flow.js';

// The clerk robot (am04): the AI gives the words, the clerk writes the lines in a fixed order. A fixture map in a temp folder.

const NOW = () => new Date(2026, 9, 13, 10, 30).getTime();
const OPTS = { now: NOW };

const README = `# Shop, part by part

## The map

\`\`\`mermaid
flowchart LR
    subgraph front["What you touch"]
        ST[Storefront]
    end
    subgraph back["What it works out"]
        OR[Orders]
        PY[Payments]
        ID[Ideas and requests]
        IC[Ideas and requests — closed]
    end
    ST --> OR
    OR --> PY
\`\`\`

## The parts

| Part | In one line |
|---|---|
| [Storefront](storefront.md) | The public site. |
| [Orders](orders.md) | Builds the basket. |
| [Payments](payments.md) | Charges. |
| [Ideas and requests](ideas.md) | What the owner asked. |

## How to keep this true

Add items before starting.
`;

const IDEAS = `# Ideas and requests

Every request, in the owner's words.

## Index

- Selling: id01, id02
- Paying: id03

## What's missing

### Selling

- [ ] Show the orders on the phone \`id01\`
  - Asked: 2026-10-01 10:00 — "show my orders on the phone"
  - What it means: orders readable on a small screen.
  - How to confirm it is done: open the page on the phone.
  - Where it went: not yet an item.
  - Status: new.
- [ ] Offer gift wrapping \`id02\`
  - Asked: 2026-10-02 09:00 — "gift wrapping"
  - What it means: a wrapping option.
  - How to confirm it is done: tick the box at checkout.
  - Where it went: \`or01\`.
  - Status: accepted.

### Paying

- [ ] Pay with a card \`id03\`
  - Asked: 2026-10-03 09:00 — "pay by card"
  - What it means: card payment.
  - How to confirm it is done: a test payment goes through.
  - Status: new.

### Later

`;

const CLOSED = `# Ideas and requests — closed

## What's missing

### Done

- [x] An old request \`id09\`
  - Asked: 2026-09-01 09:00 — "old"
  - What it means: old.
  - How to confirm it is done: old.
  - Where it went: \`st01\`.
  - Status: done.
`;

const STOREFRONT = `# Storefront

The public site.

## What's missing

### Pages

- [ ] Home page \`st01\`
- [ ] Product page \`st02\`
`;

const ORDERS = `# Orders

Builds the basket and follows the order.

## What's missing

### Basket

- [ ] **important:** Save the basket \`or01\`
  - From \`id02\`.
- [x] Old thing \`or02\`
  - Built on 2026-10-01: done.

### Delivery

- [ ] **in progress · Ana:** Track the courier \`or03\`
- [ ] **with Ana · blocks:** Pick the courier \`or04\`
`;

const PAYMENTS = `# Payments

Charges the customer.

## What's missing
`;

const FILES = {
  'README.md': README, 'ideas.md': IDEAS, 'ideas-closed.md': CLOSED, 'storefront.md': STOREFRONT, 'orders.md': ORDERS, 'payments.md': PAYMENTS,
};

// A project with the map in docs/architecture; every file looks old, so the 5-second rule does not get in the way.
function fixture(files = FILES) {
  const root = mkdtempSync(join(tmpdir(), 'sm-clerk-'));
  const dir = join(root, 'docs', 'architecture');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
    utimesSync(join(dir, name), new Date(2020, 0, 1), new Date(2020, 0, 1));
  }
  const read = (name) => readFileSync(join(dir, name), 'utf8');
  return { root, dir, read, done: () => rmSync(root, { recursive: true, force: true }) };
}

const withMap = (fn, files) => async () => {
  const fx = fixture(files);
  try { await fn(fx); } finally { fx.done(); }
};

const linesOf = (text) => text.split('\n');

// ---- addRequest ----

test('addRequest: the next idNNN across the whole folder, in its group, with the five lines and the index updated', withMap(async ({ root, read }) => {
  const r = await addRequest({ root, words: 'quero ver o pedido no celular', date: '2026-10-13 10:00', meaning: 'the order on a phone', confirm: 'open the order on a phone', group: 'Selling', title: 'Orders on the phone' }, OPTS);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.code, 'id10'); // id09 lives in the closed file
  const lines = linesOf(read('ideas.md'));
  const at = lines.indexOf('- [ ] Orders on the phone `id10`');
  assert.ok(at > lines.indexOf('- [ ] Offer gift wrapping `id02`'));
  assert.deepEqual(lines.slice(at, at + 6), [
    '- [ ] Orders on the phone `id10`',
    '  - Asked: 2026-10-13 10:00 — "quero ver o pedido no celular"',
    '  - What it means: the order on a phone',
    '  - How to confirm it is done: open the order on a phone',
    '  - Where it went: not yet an item.',
    '  - Status: new.',
  ]);
  assert.equal(lines[at - 1], '  - Status: accepted.', 'right after the group\'s last item');
  assert.ok(lines.includes('- Selling: id01, id02, id10'));
  assert.deepEqual(r.edits.map((e) => e.file), ['ideas.md', 'ideas.md']);
  assert.ok(r.wrote.some((w) => w.file === 'docs/architecture/ideas.md' && w.line === at + 1));
  // the file reads back as the registry with one more request
  const arch = parseArch('docs/architecture', Object.fromEntries(readdirSync(join(root, 'docs/architecture')).map((n) => [n, read(n)])));
  assert.ok(arch.parts.find((p) => p.id === 'ideas').groups.flatMap((g) => g.items).some((i) => i.code === 'id10'));
}));

test('addRequest: a new group is created at the end of the section, and an empty group gets its first request', withMap(async ({ root, read }) => {
  const a = await addRequest({ root, words: 'dark mode', meaning: 'dark colors', confirm: 'switch it', group: 'Looks', date: '2026-10-13' }, OPTS);
  assert.equal(a.ok, true, a.reason);
  const b = await addRequest({ root, words: 'maybe later', meaning: 'later', confirm: 'see it', group: 'Later', date: '2026-10-13' }, OPTS);
  assert.equal(b.ok, true, b.reason);
  assert.equal(b.code, 'id11');
  const text = read('ideas.md');
  assert.match(text, /### Later\n\n- \[ \] maybe later `id11`\n/);
  assert.match(text, /\n### Looks\n\n- \[ \] dark mode `id10`\n/);
  assert.ok(text.indexOf('### Looks') > text.indexOf('### Paying'));
  assert.ok(linesOf(text).includes('- Looks: id10'), 'a group the index lacks gets its line');
  assert.ok(linesOf(text).includes('- Later: id11'));
}));

test('addRequest: without the words, the meaning or the way to confirm it is refused and nothing changes', withMap(async ({ root, read }) => {
  const before = read('ideas.md');
  for (const bad of [{ meaning: 'm', confirm: 'c' }, { words: 'w', confirm: 'c' }, { words: 'w', meaning: 'm' }]) {
    const r = await addRequest({ root, group: 'Selling', ...bad }, OPTS);
    assert.equal(r.ok, false);
    assert.match(r.reason, /words|meaning|confirm/i);
  }
  assert.equal((await addRequest({ root, words: 'w', meaning: 'm', confirm: 'c', group: 'Selling', date: 'yesterday' }, OPTS)).ok, false);
  assert.equal(read('ideas.md'), before);
}));

test('addRequest: a project with no requests file is refused', withMap(async ({ root }) => {
  const r = await addRequest({ root, words: 'w', meaning: 'm', confirm: 'c', group: 'g' }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /requests/i);
}, { 'README.md': README, 'orders.md': ORDERS }));

// ---- addItem ----

test('addItem: the next code of the part\'s prefix, in the group, with the From line, and the request learns where it went', withMap(async ({ root, read }) => {
  const r = await addItem({ root, part: 'Orders', group: 'Basket', title: 'Show the basket total', details: ['Round to cents.', 'Show the tax too'], from: 'id01' }, OPTS);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.code, 'or05');
  const lines = linesOf(read('orders.md'));
  const at = lines.indexOf('- [ ] Show the basket total `or05`');
  assert.deepEqual(lines.slice(at, at + 4), ['- [ ] Show the basket total `or05`', '  - From `id01`.', '  - Round to cents.', '  - Show the tax too']);
  assert.equal(lines[at - 1], '  - Built on 2026-10-01: done.', 'after the last item of the group');
  // the request: a "not yet an item" value is replaced; a value with codes grows
  assert.ok(linesOf(read('ideas.md')).includes('  - Where it went: `or05`.'));
  const b = await addItem({ root, part: 'orders', group: 'Delivery', title: 'Print the label', from: 'id02' }, OPTS);
  assert.equal(b.code, 'or06');
  assert.ok(linesOf(read('ideas.md')).includes('  - Where it went: `or01`, `or06`.'));
  assert.ok(b.wrote.some((w) => w.file === 'docs/architecture/ideas.md'));
}));

test('addItem: a group that is missing is created at the end of "What\'s missing"', withMap(async ({ root, read }) => {
  const r = await addItem({ root, part: 'Storefront', group: 'Search', title: 'Search box', from: 'id01' }, OPTS);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.code, 'st03');
  assert.match(read('storefront.md'), /- \[ \] Product page `st02`\n\n### Search\n\n- \[ \] Search box `st03`\n  - From `id01`\.\n$/);
}));

test('addItem: refuses an item with no request, an unknown request, an unknown part, a registry part', withMap(async ({ root, read }) => {
  const before = read('orders.md');
  const none = await addItem({ root, part: 'Orders', group: 'Basket', title: 'x' }, OPTS);
  assert.equal(none.ok, false);
  assert.match(none.reason, /request/i);
  const ghost = await addItem({ root, part: 'Orders', group: 'Basket', title: 'x', from: 'id77' }, OPTS);
  assert.equal(ghost.ok, false);
  assert.match(ghost.reason, /id77/);
  const notRequest = await addItem({ root, part: 'Orders', group: 'Basket', title: 'x', from: 'or01' }, OPTS);
  assert.equal(notRequest.ok, false, 'an ordinary item is not a request');
  const nopart = await addItem({ root, part: 'Warehouse', group: 'Basket', title: 'x', from: 'id01' }, OPTS);
  assert.equal(nopart.ok, false);
  assert.match(nopart.reason, /Warehouse/);
  const reg = await addItem({ root, part: 'Ideas and requests', group: 'Selling', title: 'x', from: 'id01' }, OPTS);
  assert.equal(reg.ok, false);
  assert.match(reg.reason, /map_add_request|request/i);
  assert.equal((await addItem({ root, part: 'Orders', group: 'Basket', title: '  ', from: 'id01' }, OPTS)).ok, false);
  assert.equal((await addItem({ root, part: 'Orders', title: 'x', from: 'id01' }, OPTS)).ok, false, 'a group is needed');
  assert.equal(read('orders.md'), before);
}));

test('addItem: a part with no codes yet needs its prefix, which cannot belong to another part', withMap(async ({ root, read }) => {
  const noPrefix = await addItem({ root, part: 'Payments', group: 'Cards', title: 'Charge a card', from: 'id03' }, OPTS);
  assert.equal(noPrefix.ok, false);
  assert.match(noPrefix.reason, /prefix/i);
  const taken = await addItem({ root, part: 'Payments', group: 'Cards', title: 'Charge a card', from: 'id03', prefix: 'or' }, OPTS);
  assert.equal(taken.ok, false);
  const ok = await addItem({ root, part: 'Payments', group: 'Cards', title: 'Charge a card', from: 'id03', prefix: 'py' }, OPTS);
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.code, 'py01');
  assert.match(read('payments.md'), /### Cards\n\n- \[ \] Charge a card `py01`\n  - From `id03`\.\n$/);
  // a request with no "Where it went" line gets one, before its Status line
  assert.match(read('ideas.md'), /How to confirm it is done: a test payment goes through\.\n  - Where it went: `py01`\.\n  - Status: new\./);
  // and the prefix is remembered for the next item
  const next = await addItem({ root, part: 'Payments', group: 'Cards', title: 'Refund a card', from: 'id03' }, OPTS);
  assert.equal(next.code, 'py02');
}));

test('addItem: a part that the flow does not draw is refused until it is in the flow', withMap(async ({ root }) => {
  const r = await addItem({ root, part: 'Extras', group: 'Misc', title: 'x', from: 'id01' }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /flow/i);
}, { ...FILES, 'extras.md': '# Extras\n\nLoose part.\n\n## What\'s missing\n\n### Misc\n\n- [ ] Thing `ex01`\n' }));

// ---- startItem and finishItem ----

test('startItem: puts the in-progress mark on the item line only; finishItem ticks it, drops the mark and adds the Built on line', withMap(async ({ root, read }) => {
  const s = await startItem({ root, code: 'st02' }, OPTS);
  assert.equal(s.ok, true, s.reason);
  assert.ok(linesOf(read('storefront.md')).includes('- [ ] **in progress:** Product page `st02`'));
  const again = await startItem({ root, code: 'st02' }, OPTS);
  assert.equal(again.ok, true);
  assert.deepEqual(again.edits, []);
  const imp = await startItem({ root, code: 'or01' }, OPTS);
  assert.ok(linesOf(read('orders.md')).includes('- [ ] **in progress · important:** Save the basket `or01`'));
  assert.deepEqual(imp.wrote.map((w) => w.line), [9]);
  const f = await finishItem({ root, code: 'or01', note: 'basket saved in server/basket.mjs' }, OPTS);
  assert.equal(f.ok, true, f.reason);
  const lines = linesOf(read('orders.md'));
  const at = lines.indexOf('- [x] **important:** Save the basket `or01`');
  assert.ok(at > 0);
  assert.deepEqual(lines.slice(at + 1, at + 3), ['  - From `id02`.', '  - Built on 2026-10-13: basket saved in server/basket.mjs']);
  const only = await finishItem({ root, code: 'st02', note: 'done it' }, OPTS);
  assert.ok(linesOf(read('storefront.md')).includes('- [x] Product page `st02`'), 'the mark was the only token: the bold prefix goes');
  assert.ok(only.ok);
}));

test('finishItem: refuses without a note, an unknown code, an item already done; startItem refuses a done item', withMap(async ({ root, read }) => {
  const before = read('orders.md');
  for (const note of [undefined, '', '   ']) {
    const r = await finishItem({ root, code: 'or01', note }, OPTS);
    assert.equal(r.ok, false);
    assert.match(r.reason, /note/i);
  }
  assert.equal((await finishItem({ root, code: 'zz99', note: 'n' }, OPTS)).ok, false);
  assert.match((await finishItem({ root, code: 'or02', note: 'n' }, OPTS)).reason, /already/i);
  assert.match((await startItem({ root, code: 'or02' }, OPTS)).reason, /done|ticked/i);
  assert.equal(read('orders.md'), before);
}));

test('a code on two items is refused: the clerk will not guess which one', withMap(async ({ root }) => {
  const r = await startItem({ root, code: 'st01' }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /twice|duplicate|more than one/i);
}, { ...FILES, 'extras.md': '# Extras\n\n## What\'s missing\n\n- [ ] Other home `st01`\n' }));

// ---- addPart ----

test('addPart: the part file, the row of the table and the node of the flow, in one change', withMap(async ({ root, read }) => {
  const r = await addPart({ root, layer: 'back', name: 'Shipping labels', about: 'Prints the label of each parcel. It talks to the carrier.', prefix: 'sl' }, OPTS);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.edits.map((e) => e.file), ['shipping-labels.md', 'README.md', 'README.md'], 'file, then table row, then flow node');
  const part = read('shipping-labels.md');
  assert.match(part, /^# Shipping labels\n\nPrints the label of each parcel\. It talks to the carrier\.\n\n## How it works\n/);
  for (const h of ['## How it works', '## Where in the code', '## Rules that must not break', "## What's missing"]) assert.ok(part.includes(h), h);
  assert.match(part, /<!-- code prefix: sl -->/);
  const readme = read('README.md');
  assert.ok(linesOf(readme).includes('| [Shipping labels](shipping-labels.md) | Prints the label of each parcel. |'));
  assert.ok(readme.indexOf('| [Shipping labels]') > readme.indexOf('| [Ideas and requests]'), 'the row goes last');
  const arch = parseArch('docs/architecture', Object.fromEntries(readdirSync(join(root, 'docs/architecture')).map((n) => [n, read(n)])));
  const placed = arch.layers.find((l) => l.name === 'What it works out');
  assert.ok(placed.partIds.includes('shipping-labels'), 'the layer holds the new part');
  assert.ok(!arch.layers.some((l) => l.id === 'other'), 'nothing is left loose');
  const flow = parseFlow(readmeBlock(readme));
  assert.ok(flow.nodes.some((n) => n.label === 'Shipping labels' && n.layer === 'back'));
  assert.equal(new Set(flow.nodes.map((n) => n.id)).size, flow.nodes.length, 'the node id is new');
  // its first item takes the prefix it was given
  const item = await addItem({ root, part: 'Shipping labels', group: 'Start', title: 'Print one label', from: 'id01' }, OPTS);
  assert.equal(item.code, 'sl01');
}));

const readmeBlock = (text) => /```mermaid\n([\s\S]*?)```/.exec(text)[1];

test('addPart: refuses a duplicate name, a duplicate prefix, an unknown layer (unless asked to make it), and a map with no flow', withMap(async ({ root, read }) => {
  const before = read('README.md');
  const dupName = await addPart({ root, layer: 'back', name: 'orders', about: 'x', prefix: 'zz' }, OPTS);
  assert.equal(dupName.ok, false);
  assert.match(dupName.reason, /already/i);
  const dupPrefix = await addPart({ root, layer: 'back', name: 'Returns', about: 'x', prefix: 'OR' }, OPTS);
  assert.equal(dupPrefix.ok, false);
  assert.match(dupPrefix.reason, /prefix/i);
  const noLayer = await addPart({ root, layer: 'Nowhere', name: 'Returns', about: 'x', prefix: 'rt' }, OPTS);
  assert.equal(noLayer.ok, false);
  assert.match(noLayer.reason, /layer/i);
  assert.equal((await addPart({ root, layer: 'back', name: 'Bad [name]', about: 'x', prefix: 'rt' }, OPTS)).ok, false);
  assert.equal((await addPart({ root, layer: 'back', name: 'Returns', about: '', prefix: 'rt' }, OPTS)).ok, false);
  assert.equal(read('README.md'), before);
  const made = await addPart({ root, layer: 'Nowhere', newLayer: true, name: 'Returns', about: 'Takes parcels back.', prefix: 'rt' }, OPTS);
  assert.equal(made.ok, true, made.reason);
  const flow = parseFlow(readmeBlock(read('README.md')));
  const node = flow.nodes.find((n) => n.label === 'Returns');
  assert.ok(node && flow.layers.some((l) => l.id === node.layer && l.name === 'Nowhere'));
}));

test('addPart: a README with no mermaid flow is refused; the part file is not left behind', withMap(async ({ root, dir }) => {
  const r = await addPart({ root, layer: 'back', name: 'Returns', about: 'x', prefix: 'rt' }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /flow/i);
  assert.ok(!readdirSync(dir).includes('returns.md'));
}, { ...FILES, 'README.md': '# Shop\n\n| Part | In one line |\n|---|---|\n| [Orders](orders.md) | x |\n' }));

test('addPart: a table shown inside a code fence is not the table of parts', withMap(async ({ root, read }) => {
  const r = await addPart({ root, layer: 'back', name: 'Returns', about: 'Takes parcels back.', prefix: 'rt' }, OPTS);
  assert.equal(r.ok, true, r.reason);
  const lines = linesOf(read('README.md'));
  const row = lines.indexOf('| [Returns](returns.md) | Takes parcels back. |');
  assert.ok(row > lines.indexOf('| [Orders](orders.md) | Builds the basket. |'));
  assert.ok(row > lines.lastIndexOf('```'), 'after the example, not inside it');
}, { ...FILES, 'README.md': README.replace('## The parts', '## Example\n\n```markdown\n| Part | Line |\n|---|---|\n| [Sample](sample.md) | x |\n```\n\n## The parts') }));

test('addItem: two edits on one place of a file (the request sits in the part file, last of the group, with no "Where it went") are refused, not guessed', withMap(async ({ root, read }) => {
  const before = read('orders.md');
  const r = await addItem({ root, part: 'Orders', group: 'Basket', title: 'More', from: 'or09' }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /same place/);
  assert.equal(read('orders.md'), before);
}, { ...FILES, 'orders.md': `${ORDERS.replace('### Delivery', '- [ ] Odd request `or09`\n  - Asked: 2026-10-01 10:00 — "odd"\n\n### Delivery')}` }));

// ---- addLink ----

test('addLink: the arrow in the flow, with or without a label; refuses unknown parts, a self link and a repeat', withMap(async ({ root, read }) => {
  const r = await addLink({ root, from: 'Storefront', to: 'Payments', label: 'pay' }, OPTS);
  assert.equal(r.ok, true, r.reason);
  const flow = parseFlow(readmeBlock(read('README.md')));
  assert.ok(flow.edges.some((e) => e.from === 'ST' && e.to === 'PY' && e.label === 'pay'));
  assert.ok(linesOf(read('README.md')).indexOf('    ST -->|pay| PY') > linesOf(read('README.md')).indexOf('    OR --> PY'), 'after the last arrow');
  const plain = await addLink({ root, from: 'payments', to: 'orders' }, OPTS);
  assert.equal(plain.ok, true, plain.reason);
  assert.ok(linesOf(read('README.md')).includes('    PY --> OR'));
  assert.equal((await addLink({ root, from: 'Storefront', to: 'Payments' }, OPTS)).ok, false, 'already there');
  assert.equal((await addLink({ root, from: 'Storefront', to: 'Storefront' }, OPTS)).ok, false);
  const ghost = await addLink({ root, from: 'Storefront', to: 'Warehouse' }, OPTS);
  assert.equal(ghost.ok, false);
  assert.match(ghost.reason, /Warehouse/);
  const loose = await addLink({ root, from: 'Storefront', to: 'Extras' }, OPTS);
  assert.equal(loose.ok, false);
  assert.match(loose.reason, /flow/i);
}, { ...FILES, 'extras.md': '# Extras\n\n## What\'s missing\n' }));

// ---- the safe writer ----

test('the writer leaves no temp file, keeps CRLF files CRLF, and refuses a file somebody changed a moment ago', withMap(async ({ root, dir, read }) => {
  const crlf = FILES['orders.md'].replace(/\n/g, '\r\n');
  writeFileSync(join(dir, 'orders.md'), crlf);
  utimesSync(join(dir, 'orders.md'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  const r = await startItem({ root, code: 'or01' }, OPTS);
  assert.equal(r.ok, true, r.reason);
  const text = read('orders.md');
  assert.ok(text.includes('- [ ] **in progress · important:** Save the basket `or01`\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'every line ending is still CRLF');
  assert.ok(readdirSync(dir).every((n) => !n.endsWith('.tmp')));
  // a file written by someone else just now (not by the clerk)
  writeFileSync(join(dir, 'storefront.md'), `${FILES['storefront.md']}\n`);
  const fresh = await startItem({ root, code: 'st02' }, { now: () => Date.now() });
  assert.equal(fresh.ok, false);
  assert.match(fresh.reason, /moment|seconds|just/i);
  assert.ok(!read('storefront.md').includes('in progress'));
}));

test('the writer waits for nobody: two calls in a row work, because the clerk knows its own writes', withMap(async ({ root, read }) => {
  const opts = { now: () => Date.now() };
  assert.equal((await startItem({ root, code: 'st01' }, opts)).ok, true);
  const second = await finishItem({ root, code: 'st01', note: 'built' }, opts);
  assert.equal(second.ok, true, second.reason);
  assert.ok(read('storefront.md').includes('- [x] Home page `st01`'));
}));

test('a project with no map, a map on the main branch only, and a bad root are refused in plain words', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'sm-clerk-empty-'));
  try {
    const r = await startItem({ root: empty, code: 'a1' }, OPTS);
    assert.equal(r.ok, false);
    assert.match(r.reason, /architecture/i);
  } finally { rmSync(empty, { recursive: true, force: true }); }
  assert.equal((await startItem({ root: '', code: 'a1' }, OPTS)).ok, false);
});
