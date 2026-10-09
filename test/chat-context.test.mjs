import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextOf } from '../server/chat/context.mjs';
import { parseArch } from '../server/arch/parse.mjs';

const fixture = (name) => {
  const dir = fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
  return Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
};
const project = (arch) => ({ id: 'feira-abc123', name: 'feira', root: '/work/feira', mainBranch: 'main', arch });
const PT = project(parseArch('docs/arquitetura', fixture('arch-pt')));
const EN = project(parseArch('docs/architecture', fixture('arch-en')));
const NONE = project({ source: 'none', dir: null, lang: 'en', layers: [], parts: [] });
// The same token shape the transcript reader counts as an item code: a context must not cite codes it does not mean.
const CODE_TOKENS = /(?<![\w-])([a-z]{1,4}(?:-[a-z]{1,4})?\d{1,4})(?![\w-])/gi;
const codesIn = (text) => [...text.matchAll(CODE_TOKENS)].map((m) => m[1]);
const all = (ctx) => ctx.sections.join('\n\n');

test('an item: the path on the map, the part, the item with its detail, its file and its code', () => {
  const ctx = contextOf(PT, { kind: 'item', partId: 'vitrine', code: 'vi01' });
  assert.equal(ctx.error, undefined);
  assert.equal(ctx.part.id, 'vitrine');
  const text = all(ctx);
  for (const piece of ['Fotos reais dos produtores', 'docs/arquitetura/vitrine.md', 'Não guarda dados de pagamento']) assert.ok(text.includes(piece), piece);
  assert.ok(text.includes('feira › Por onde as pessoas entram › Vitrine › Geral'), 'path through layer, part and group');
  assert.ok(text.includes('`vi01`'), 'the code, so the conversation is placed on the part');
  const item = PT.arch.parts.find((p) => p.id === 'vitrine').groups[0].items[0];
  for (const line of item.detail) assert.ok(text.includes(line.trim()), 'detail lines go along');
  assert.deepEqual([...new Set(codesIn(text))], ['vi01'], 'no other code is cited');
});

test('the upkeep rule goes with every point of an existing map, in the language of the map', () => {
  const pt = all(contextOf(PT, { kind: 'part', partId: 'pagamentos' }));
  assert.match(pt, /O que falta/);
  assert.match(pt, /em andamento/);
  assert.match(pt, /- \[x\]/);
  assert.match(pt, /docs\/arquitetura\//);
  assert.match(pt, /session-map:architecture/);
  const en = all(contextOf(EN, { kind: 'part', partId: EN.arch.parts[0].id }));
  assert.match(en, /What's missing/);
  assert.match(en, /in progress/);
  assert.ok(!/em andamento/.test(en));
  assert.deepEqual(codesIn(pt), [], 'a part context cites no item code');
});

test('a group and a layer name their place; an item without a code is found by its line', () => {
  const group = all(contextOf(PT, { kind: 'group', partId: 'vitrine', group: 'Busca' }));
  assert.ok(group.includes('feira › Por onde as pessoas entram › Vitrine › Busca'));
  assert.ok(group.includes('Busca por nome de produtor'), 'the open items of the group are listed');
  const layer = contextOf(PT, { kind: 'layer', layerId: 'motor' });
  assert.equal(layer.part, null, 'a layer is not one part');
  const text = all(layer);
  assert.ok(text.includes('O que faz funcionar'));
  for (const name of ['Cesta e pedidos', 'Pagamentos']) assert.ok(text.includes(name), name);

  const part = PT.arch.parts.find((p) => p.id === 'vitrine');
  const noCode = { ...part, groups: [{ name: 'Geral', items: [{ code: null, title: 'Sem código', detail: [], status: 'todo', who: null, weight: null, milestone: null, line: 42 }] }] };
  const p2 = project({ ...PT.arch, parts: [noCode] });
  assert.ok(all(contextOf(p2, { kind: 'item', partId: 'vitrine', line: 42 })).includes('Sem código'));
});

test('a new idea: the AI reads the map, proposes part and group, shows the line and writes only after the OK', () => {
  const ctx = contextOf(PT, { kind: 'idea' });
  assert.equal(ctx.part, null);
  const text = all(ctx);
  assert.match(text, /docs\/arquitetura\/README\.md/);
  assert.match(text, /new part/i);
  assert.match(text, /OK/);
  assert.match(text, /O que falta/);
  for (const p of PT.arch.parts) assert.ok(text.includes(p.file), p.file);
  assert.deepEqual(codesIn(text), [], 'no example code that would place the chat on a part');
});

test('creating the map: study, propose, wait for the OK, then write the convention; nothing before', () => {
  const ctx = contextOf(NONE, { kind: 'create-arch' });
  assert.equal(ctx.error, undefined);
  const text = all(ctx);
  for (const piece of ['docs/architecture', 'docs/arquitetura', 'README.md', 'subgraph', 'How it works', 'Where in the code', 'Rules that must not break', "What's missing", 'Como funciona', 'Onde está no código', 'Regras que não podem quebrar', 'O que falta']) {
    assert.ok(text.includes(piece), piece);
  }
  assert.match(text, /OK/);
  assert.match(text, /nothing/i);
  assert.deepEqual(codesIn(text), []);
});

test('refusals: unknown kind, part, layer, group or item; a map that is missing or already there', () => {
  assert.deepEqual(contextOf(PT, { kind: 'cell' }), { error: 'bad-node', status: 400 });
  assert.deepEqual(contextOf(PT, null), { error: 'bad-node', status: 400 });
  assert.deepEqual(contextOf(PT, { kind: 'part', partId: 'ghost' }), { error: 'unknown-part', status: 404 });
  assert.deepEqual(contextOf(PT, { kind: 'layer', layerId: 'ghost' }), { error: 'unknown-layer', status: 404 });
  assert.deepEqual(contextOf(PT, { kind: 'group', partId: 'vitrine', group: 'ghost' }), { error: 'unknown-group', status: 404 });
  assert.deepEqual(contextOf(PT, { kind: 'item', partId: 'vitrine', code: 'zz99' }), { error: 'unknown-item', status: 404 });
  assert.deepEqual(contextOf(PT, { kind: 'create-arch' }), { error: 'arch-exists', status: 409 });
  for (const kind of ['idea', 'part', 'layer']) assert.deepEqual(contextOf(NONE, { kind, partId: 'x', layerId: 'x' }), { error: 'no-arch', status: 409 });
});

test('a map read from the main branch is not in this folder: the chat is told not to edit it here', () => {
  const branch = project({ ...PT.arch, source: 'main-branch' });
  const text = all(contextOf(branch, { kind: 'part', partId: 'pagamentos' }));
  assert.match(text, /main/);
  assert.match(text, /do not edit/i);
  assert.ok(!/before you start/i.test(text), 'no instruction to write items');
});

test('a new idea gets no order to write before the OK: the upkeep rule for new requests stays out', () => {
  const text = all(contextOf(PT, { kind: 'idea' }));
  assert.ok(!/before you start/i.test(text), 'no "becomes an item before you start" rule against "only after the OK"');
  assert.match(text, /em andamento/, 'starting and ticking items still apply');
  assert.match(text, /- \[x\]/);
  assert.match(text, /cite the item's code/);
});

test('a new idea on a map read from the main branch: show the line and where it goes, never write it here', () => {
  const branch = project({ ...PT.arch, source: 'main-branch' });
  const text = all(contextOf(branch, { kind: 'idea' }));
  assert.match(text, /do not edit/i);
  assert.ok(!/\bwrite it\b/i.test(text), 'no step asks the model to write');
  assert.ok(!/Read docs\/arquitetura\/README\.md/.test(text), 'the folder is not in this working tree');
  assert.match(text, /where it goes/);
});

// Seen on Windows: a part about the README named readme.md replaced the map's README.md (names ignore case there).
test('creating the map: part files are named in lowercase with dashes and never README', () => {
  const text = all(contextOf(NONE, { kind: 'create-arch' }));
  assert.match(text, /lowercase with dashes/);
  assert.match(text, /never README\.md, in any case/);
});

test('the flow workshop: the draft goes along, the reply must end with the whole draft in a mermaid fence, and no file is edited', () => {
  const draft = 'flowchart LR\n  subgraph entrada["Por onde as pessoas entram"]\n    VIT["Vitrine"]\n  end';
  const ctx = contextOf(PT, { kind: 'flow' }, { draft });
  assert.equal(ctx.error, undefined);
  assert.equal(ctx.part, null);
  const text = all(ctx);
  assert.ok(text.includes(draft), 'the draft as it is now');
  assert.match(text, /```mermaid/);
  assert.match(text, /every reply/i);
  assert.match(text, /do not (create|edit|change)[^.]*files?/i);
  assert.ok(text.includes('Vitrine: docs/arquitetura/vitrine.md'), 'the parts, so their names are kept');
  assert.doesNotMatch(text, /em andamento/, 'no upkeep rule: the workshop writes nothing');
  const bare = all(contextOf(NONE, { kind: 'flow' }, { draft: 'flowchart LR' }));
  assert.match(bare, /no architecture map yet/i, 'a project without a map can draw one too');
});
