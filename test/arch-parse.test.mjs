import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';

const FIX = join(import.meta.dirname, 'fixtures');
const load = (name) => Object.fromEntries(readdirSync(join(FIX, name)).map((f) => [f, readFileSync(join(FIX, name, f), 'utf8')]));
const arch = (name, dir) => parseArch(dir, load(name));
const part = (a, id) => a.parts.find((p) => p.id === id);

test('mermaid subgraphs become layers and nodes match files by name without accents or case', () => {
  const a = arch('arch-pt', 'docs/arquitetura');
  assert.equal(a.source, 'worktree');
  assert.equal(a.dir, 'docs/arquitetura');
  assert.equal(a.lang, 'pt');
  assert.deepEqual(a.layers.map((l) => [l.name, l.partIds]), [
    ['Por onde as pessoas entram', ['vitrine', 'app-do-entregador']],
    ['O que faz funcionar', ['cesta-e-pedidos', 'pagamentos']],
    ['O que sustenta', ['seguranca']],
  ]);
  assert.equal(a.parts.length, 5);
  assert.equal(part(a, 'seguranca').file, 'docs/arquitetura/seguranca.md');
  assert.equal(part(a, 'seguranca').name, 'Segurança');
});

test('heading layers match parts by link, by bold name and by plain name; unknown links are ignored', () => {
  const a = arch('arch-en', 'docs/architecture');
  assert.equal(a.lang, 'en');
  assert.deepEqual(a.layers.map((l) => [l.name, l.partIds]), [
    ['Entry points', ['storefront', 'courier-app']],
    ['Engine', ['orders', 'payments']],
  ]);
});

test('parts that no layer mentions land in a fallback layer', () => {
  const files = load('arch-pt');
  files['README.md'] = '# Partes\n\n## Camada\n\n- [Vitrine](vitrine.md)\n';
  const a = parseArch('docs/arquitetura', files);
  assert.deepEqual(a.layers.map((l) => l.name), ['Camada', 'Outros']);
  assert.equal(a.layers[1].partIds.length, 4);
});

test('a folder without README still lists its files as parts', () => {
  const files = load('arch-pt');
  delete files['README.md'];
  const a = parseArch('docs/arquitetura', files);
  assert.equal(a.parts.length, 5);
  assert.equal(a.layers.length, 1);
});

test('a part reads name, about and code paths (only text with a slash, in backticks)', () => {
  const p = part(arch('arch-pt', 'docs/arquitetura'), 'vitrine');
  assert.equal(p.name, 'Vitrine');
  assert.match(p.about, /^A vitrine é o site onde o cliente vê/);
  assert.doesNotMatch(p.about, /Versão/);
  assert.deepEqual(p.codePaths, ['apps/site/src/paginas/', 'packages/core/src/filtro-de-bairro.ts']);
  const bullets = part(arch('arch-pt', 'docs/arquitetura'), 'app-do-entregador');
  assert.deepEqual(bullets.codePaths, ['apps/entregador/', 'apps/entregador/src/rota/']);
});

test('items carry status, who, milestone, weight, code, detail and line', () => {
  const p = part(arch('arch-pt', 'docs/arquitetura'), 'vitrine');
  assert.deepEqual(p.groups.map((g) => [g.name, g.items.length]), [['Geral', 3], ['Busca', 4]]);
  const [fotos, cookies, erro] = p.groups[0].items;
  assert.deepEqual(fotos, {
    code: 'vi01', title: 'Fotos reais dos produtores',
    detail: ['Falta tratar as fotos grandes.', 'Precisa de autorização por escrito.'],
    status: 'doing', who: 'Ana e Claude', weight: null, milestone: '5', line: 32,
  });
  assert.deepEqual([cookies.status, cookies.who, cookies.weight, cookies.title], ['todo', 'com o Marcos', 'blocks', 'Aprovar o texto do aviso de cookies']);
  assert.deepEqual([erro.status, erro.who], ['done', 'Claude']);
});

test('a bold lead without recognised tokens and a code that is not trailing stay in the title', () => {
  const [busca, atencao, cor, detalhe] = part(arch('arch-pt', 'docs/arquitetura'), 'vitrine').groups[1].items;
  assert.deepEqual([busca.weight, busca.code], ['important', 'vi04']);
  assert.equal(atencao.title, '**Atenção:** Ajustar o `rodapé` com o logo novo');
  assert.equal(atencao.code, 'vi05');
  assert.equal(cor.title, 'Trocar a cor do botão **principal** `vi06` e depois conferir');
  assert.equal(cor.code, null);
  assert.equal(detalhe.weight, 'detail');
});

test('counts: open items by status, items with a person and blockers', () => {
  const p = part(arch('arch-pt', 'docs/arquitetura'), 'vitrine');
  assert.deepEqual(p.counts, { todo: 5, doing: 1, done: 1, withUser: 2, blocks: 1 });
});

test('items outside any group (no ### heading) parse and "Nada em aberto" gives zero', () => {
  const a = arch('arch-pt', 'docs/arquitetura');
  assert.deepEqual(part(a, 'seguranca').groups.map((g) => [g.name, g.items.map((i) => i.code)]), [['', ['se01']]]);
  assert.deepEqual(part(a, 'cesta-e-pedidos').groups, []);
  assert.equal(part(a, 'pagamentos').counts.withUser, 1);
});

test('english sections and tokens are understood', () => {
  const a = arch('arch-en', 'docs/architecture');
  const sf = part(a, 'storefront');
  assert.deepEqual(sf.codePaths, ['apps/site/', 'packages/core/src/catalog/']);
  const [photos, cookies, error] = sf.groups[0].items;
  assert.deepEqual([photos.status, photos.who, photos.milestone, photos.detail], ['doing', 'Ana and Claude', '2', ['Compress large photos first.']]);
  assert.equal(cookies.weight, 'blocks');
  assert.equal(error.status, 'done');
  const or = part(a, 'orders');
  assert.deepEqual([or.groups[0].items[0].who, or.counts.withUser], ['with Marcos', 1]);
  assert.deepEqual(part(a, 'courier-app').groups, []);
});

test('no files at all gives an empty architecture', () => {
  assert.deepEqual(parseArch(null, {}, 'none'), { source: 'none', dir: null, lang: 'en', layers: [], parts: [] });
});

test('a part lists the other parts its file links to, never itself or a file outside the map', () => {
  const files = {
    'README.md': '# Map\n',
    'checkout.md': '# Checkout\n\nTakes the basket to [Payments](payments.md) and back to [the shop](./storefront.md#top).\nSee [itself](checkout.md), [elsewhere](../other.md) and [a site](https://x.test/a.md).\n',
    'payments.md': '# Payments\n\nCharges the card.\n',
    'storefront.md': '# Storefront\n\nShows products. Uses [Payments](payments.md) and [Payments again](payments.md).\n',
  };
  const a = parseArch('docs/architecture', files);
  assert.deepEqual(part(a, 'checkout').refs, ['payments', 'storefront']);
  assert.deepEqual(part(a, 'payments').refs, []);
  assert.deepEqual(part(a, 'storefront').refs, ['payments']);
});
