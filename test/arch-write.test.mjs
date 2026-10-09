import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addItem, setStatus } from '../server/arch/write.mjs';
import { parseArch } from '../server/arch/parse.mjs';

const FIX = join(import.meta.dirname, 'fixtures');
const COUNT_RE = /itens em aberto|items open|open items/;

function sandbox(name) {
  const root = mkdtempSync(join(tmpdir(), 'sm-write-'));
  const dir = join(root, 'docs', 'arch');
  mkdirSync(dir, { recursive: true });
  cpSync(join(FIX, name), dir, { recursive: true });
  return { root, dir, file: (n) => join(dir, n), read: (n) => readFileSync(join(dir, n), 'utf8'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const itemsOf = (text) => parseArch('docs/arch', { 'x.md': text }).parts[0];
const withoutCountLine = (text) => text.split('\n').filter((l) => !COUNT_RE.test(l)).join('\n');

test('addItem appends to the end of an existing group, keeping every other byte', () => {
  const s = sandbox('arch-pt');
  try {
    const before = s.read('vitrine.md');
    const { code } = addItem(s.file('vitrine.md'), { group: 'Geral', title: 'Revisar a página de contato', detail: ['Falar com o Marcos'], who: 'com o Marcos', weight: 'important', milestone: '6' }, { dir: s.dir });
    assert.equal(code, 'vi08');
    const after = s.read('vitrine.md');
    const added = ['- [ ] **com o Marcos · etapa 6 · importante:** Revisar a página de contato `vi08`', '  - Falar com o Marcos'];
    const lines = before.split('\n');
    const at = lines.findIndex((l) => l.includes('`vi03`')) + 1;
    const expected = [...lines.slice(0, at), ...added, ...lines.slice(at)].join('\n');
    assert.equal(withoutCountLine(after), withoutCountLine(expected));
    const item = itemsOf(after).groups[0].items.at(-1);
    assert.deepEqual(item, { code: 'vi08', title: 'Revisar a página de contato', detail: ['Falar com o Marcos'], status: 'todo', who: 'com o Marcos', weight: 'important', milestone: '6', line: at + 1 });
  } finally { s.done(); }
});

test('addItem recalculates the live count line', () => {
  const s = sandbox('arch-pt');
  try {
    addItem(s.file('vitrine.md'), { group: 'Geral', title: 'Algo novo', weight: 'important' }, { dir: s.dir });
    assert.match(s.read('vitrine.md'), /7 itens em aberto: 1 bloqueia o lançamento, 2 importantes, 1 detalhe, 3 sem peso \(vale a etapa do roteiro\)\./);
  } finally { s.done(); }
});

test('addItem creates a missing group at the end of the section', () => {
  const s = sandbox('arch-pt');
  try {
    addItem(s.file('vitrine.md'), { group: 'Acessibilidade', title: 'Contraste das cores' }, { dir: s.dir });
    const p = itemsOf(s.read('vitrine.md'));
    assert.deepEqual(p.groups.map((g) => g.name), ['Geral', 'Busca', 'Acessibilidade']);
    assert.deepEqual(p.groups[2].items.map((i) => i.code), ['vi08']);
    assert.match(s.read('vitrine.md'), /\n### Acessibilidade\n\n- \[ \] Contraste das cores `vi08`\n$/);
  } finally { s.done(); }
});

test('addItem with no group goes under the section when items have no group', () => {
  const s = sandbox('arch-pt');
  try {
    assert.deepEqual(addItem(s.file('seguranca.md'), { group: '', title: 'Ligar o segundo fator' }, { dir: s.dir }), { code: 'se02' });
    assert.deepEqual(itemsOf(s.read('seguranca.md')).groups, [{ name: '', items: [
      { code: 'se01', title: 'Trocar a chave do servidor de e-mail', detail: [], status: 'todo', who: null, weight: null, milestone: null, line: 11 },
      { code: 'se02', title: 'Ligar o segundo fator', detail: [], status: 'todo', who: null, weight: null, milestone: null, line: 12 },
    ] }]);
  } finally { s.done(); }
});

test('addItem into a group heading that has no items yet sits right under it', () => {
  const s = sandbox('arch-pt');
  try {
    writeFileSync(s.file('pagamentos.md'), '# Pagamentos\n\n## O que falta\n\n### Repasse\n\n### Taxas\n\n- [ ] Ver a taxa `pa01`\n');
    addItem(s.file('pagamentos.md'), { group: 'Repasse', title: 'Escolher o banco' }, { dir: s.dir });
    assert.equal(s.read('pagamentos.md'), '# Pagamentos\n\n## O que falta\n\n### Repasse\n\n- [ ] Escolher o banco `pa02`\n\n### Taxas\n\n- [ ] Ver a taxa `pa01`\n');
  } finally { s.done(); }
});

test('addItem creates the whole section when the file has none, in the language given', () => {
  const s = sandbox('arch-pt');
  try {
    writeFileSync(s.file('entregas.md'), '# Entregas\n\nSobre.\n');
    // en01 and en02 already exist in another file of the folder, so the code skips past them.
    assert.equal(addItem(s.file('entregas.md'), { group: 'Geral', title: 'Rota de domingo' }, { dir: s.dir, lang: 'pt' }).code, 'en03');
    assert.equal(s.read('entregas.md'), '# Entregas\n\nSobre.\n\n## O que falta\n\n### Geral\n\n- [ ] Rota de domingo `en03`\n');
    writeFileSync(s.file('stalls.md'), '# Stalls\n');
    addItem(s.file('stalls.md'), { group: '', title: 'Map' }, { dir: s.dir, lang: 'en' });
    assert.equal(s.read('stalls.md'), "# Stalls\n\n## What's missing\n\n- [ ] Map `st01`\n");
  } finally { s.done(); }
});

test('addItem takes the next number past every code in the folder, not just the part', () => {
  const s = sandbox('arch-pt');
  try {
    writeFileSync(s.file('padrao.md'), '# Padrão\n\n## O que falta\n\n### Geral\n\n- [ ] Item sem código\n');
    assert.equal(addItem(s.file('padrao.md'), { group: 'Geral', title: 'Outro' }, { dir: s.dir }).code, 'pa02');
  } finally { s.done(); }
});

test('addItem keeps CRLF line endings', () => {
  const s = sandbox('arch-pt');
  try {
    writeFileSync(s.file('vitrine.md'), s.read('vitrine.md').replace(/\n/g, '\r\n'));
    addItem(s.file('vitrine.md'), { group: 'Busca', title: 'Filtro por preço', detail: ['Depois da busca'] }, { dir: s.dir });
    const after = s.read('vitrine.md');
    assert.equal(after.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(after.includes('\r\n- [ ] Filtro por preço `vi08`\r\n  - Depois da busca\r\n'), true);
  } finally { s.done(); }
});

test('addItem in english writes english tokens and leaves a file without a count line alone', () => {
  const s = sandbox('arch-en');
  try {
    addItem(s.file('storefront.md'), { group: 'Launch', title: 'Sitemap', who: 'Ana and Claude', weight: 'blocks', milestone: '3' }, { dir: s.dir });
    assert.match(s.read('storefront.md'), /- \[ \] \*\*Ana and Claude · step 3 · blocks:\*\* Sitemap `sf04`\n/);
  } finally { s.done(); }
});

test('addItem cleans fields so a request cannot add lines or break the prefix', () => {
  const s = sandbox('arch-pt');
  try {
    addItem(s.file('vitrine.md'), { group: 'Geral', title: 'Linha um\n- [x] falso `vi99`', detail: ['a\n## O que falta'], who: 'com o **Marcos**:', weight: 'important' }, { dir: s.dir });
    const p = itemsOf(s.read('vitrine.md'));
    const item = p.groups[0].items.at(-1);
    assert.deepEqual([item.code, item.title, item.detail, item.who], ['vi08', 'Linha um - [x] falso `vi99`', ['a ## O que falta'], 'com o Marcos']);
    assert.equal(p.groups.length, 2);
  } finally { s.done(); }
});

test('addItem refuses a missing title, an unknown weight and a bad milestone', () => {
  const s = sandbox('arch-pt');
  try {
    const add = (item) => addItem(s.file('vitrine.md'), { group: 'Geral', ...item }, { dir: s.dir });
    assert.throws(() => add({ title: '  ' }), { code: 'INVALID_ITEM' });
    assert.throws(() => add({ title: 'x', weight: 'huge' }), { code: 'INVALID_ITEM' });
    assert.throws(() => add({ title: 'x', milestone: 'a b c d e f g h i j k l m' }), { code: 'INVALID_ITEM' });
  } finally { s.done(); }
});

test('the writer refuses paths outside the architecture folder and files that are not parts', () => {
  const s = sandbox('arch-pt');
  const other = mkdtempSync(join(tmpdir(), 'sm-other-'));
  try {
    writeFileSync(join(other, 'x.md'), '# X\n');
    const item = { group: '', title: 'x' };
    for (const bad of [join(other, 'x.md'), join(s.dir, '..', 'vitrine.md'), join(s.dir, '..', '..', 'x.md')]) {
      assert.throws(() => addItem(bad, item, { dir: s.dir }), { code: 'OUTSIDE_ARCH_DIR' });
      assert.throws(() => setStatus(bad, 'vi01', 'done', { dir: s.dir }), { code: 'OUTSIDE_ARCH_DIR' });
    }
    writeFileSync(s.file('notes.txt'), 'x');
    assert.throws(() => addItem(s.file('notes.txt'), item, { dir: s.dir }), { code: 'NOT_A_PART' });
    assert.throws(() => addItem(s.file('README.md'), item, { dir: s.dir }), { code: 'NOT_A_PART' });
    assert.throws(() => addItem(s.file('nao-existe.md'), item, { dir: s.dir }), { code: 'NOT_A_PART' });
    mkdirSync(s.file('sub'));
    writeFileSync(s.file('sub/deep.md'), '# Deep\n');
    assert.throws(() => addItem(s.file('sub/deep.md'), item, { dir: s.dir }), { code: 'NOT_A_PART' });
    assert.equal(readFileSync(join(other, 'x.md'), 'utf8'), '# X\n');
  } finally { s.done(); rmSync(other, { recursive: true, force: true }); }
});

test('setStatus doing adds the situation to the prefix and todo takes it away again', () => {
  const s = sandbox('arch-pt');
  try {
    const before = s.read('vitrine.md');
    setStatus(s.file('vitrine.md'), 'vi02', 'doing', { dir: s.dir });
    const doing = s.read('vitrine.md');
    assert.match(doing, /^- \[ \] \*\*em andamento · com o Marcos · bloqueia:\*\* Aprovar o texto do aviso de cookies `vi02`$/m);
    assert.deepEqual(itemsOf(doing).counts, { todo: 4, doing: 2, done: 1, withUser: 2, blocks: 1 });
    setStatus(s.file('vitrine.md'), 'vi02', 'todo', { dir: s.dir });
    assert.equal(withoutCountLine(s.read('vitrine.md')), withoutCountLine(before));
  } finally { s.done(); }
});

test('setStatus on an item with no prefix creates one and removes it again; an unrecognised lead survives', () => {
  const s = sandbox('arch-pt');
  try {
    writeFileSync(s.file('vitrine.md'), `${s.read('vitrine.md')}- [ ] Item simples \`vi09\`\n`);
    const before = s.read('vitrine.md');
    setStatus(s.file('vitrine.md'), 'vi09', 'doing', { dir: s.dir });
    setStatus(s.file('vitrine.md'), 'vi05', 'doing', { dir: s.dir });
    assert.match(s.read('vitrine.md'), /^- \[ \] \*\*em andamento:\*\* Item simples `vi09`$/m);
    assert.match(s.read('vitrine.md'), /^- \[ \] \*\*em andamento:\*\* \*\*Atenção:\*\* Ajustar o `rodapé` com o logo novo `vi05`$/m);
    setStatus(s.file('vitrine.md'), 'vi09', 'todo', { dir: s.dir });
    setStatus(s.file('vitrine.md'), 'vi05', 'todo', { dir: s.dir });
    assert.equal(withoutCountLine(s.read('vitrine.md')), withoutCountLine(before));
  } finally { s.done(); }
});

test('setStatus done ticks the box, drops the situation and keeps the other tokens and the detail', () => {
  const s = sandbox('arch-pt');
  try {
    setStatus(s.file('vitrine.md'), 'vi01', 'done', { dir: s.dir });
    const text = s.read('vitrine.md');
    assert.match(text, /^- \[x\] \*\*Ana e Claude · etapa 5 do roteiro:\*\* Fotos reais dos produtores `vi01`\n  - Falta tratar as fotos grandes\.\n  - Precisa de autorização por escrito\.\n/m);
    assert.match(text, /5 itens em aberto: 1 bloqueia o lançamento, 1 importante, 1 detalhe, 2 sem peso/);
    setStatus(s.file('vitrine.md'), 'vi03', 'todo', { dir: s.dir });
    assert.match(s.read('vitrine.md'), /^- \[ \] \*\*Claude:\*\* Página de erro amigável `vi03`$/m);
  } finally { s.done(); }
});

test('setStatus in english uses the english situation word', () => {
  const s = sandbox('arch-en');
  try {
    setStatus(s.file('storefront.md'), 'sf02', 'doing', { dir: s.dir });
    assert.match(s.read('storefront.md'), /^- \[ \] \*\*in progress · blocks:\*\* Cookie notice copy `sf02`$/m);
  } finally { s.done(); }
});

test('setStatus refuses an unknown code or status and changes nothing', () => {
  const s = sandbox('arch-pt');
  try {
    const before = s.read('vitrine.md');
    assert.throws(() => setStatus(s.file('vitrine.md'), 'zz99', 'done', { dir: s.dir }), { code: 'ITEM_NOT_FOUND' });
    assert.throws(() => setStatus(s.file('vitrine.md'), 'vi01', 'paused', { dir: s.dir }), { code: 'INVALID_ITEM' });
    assert.equal(s.read('vitrine.md'), before);
  } finally { s.done(); }
});

test('a code that appears inside a fenced block is not an item', () => {
  const s = sandbox('arch-pt');
  try {
    writeFileSync(s.file('pagamentos.md'), '# Pagamentos\n\n## O que falta\n\n```md\n- [ ] Exemplo `pa09`\n```\n\n- [ ] Real `pa01`\n');
    assert.throws(() => setStatus(s.file('pagamentos.md'), 'pa09', 'done', { dir: s.dir }), { code: 'ITEM_NOT_FOUND' });
    setStatus(s.file('pagamentos.md'), 'pa01', 'done', { dir: s.dir });
    assert.match(s.read('pagamentos.md'), /- \[x\] Real `pa01`/);
  } finally { s.done(); }
});

test('the count line is kept in english wording too', () => {
  const s = sandbox('arch-en');
  try {
    writeFileSync(s.file('orders.md'), "# Orders\n\n## What's missing\n\nLive. 5 open items: 0 block launch, 0 important, 0 minor, 5 unweighted.\n\n- [ ] **with Marcos:** Pick the policy `or01`\n");
    addItem(s.file('orders.md'), { group: '', title: 'Another', weight: 'blocks' }, { dir: s.dir });
    assert.match(s.read('orders.md'), /Live\. 2 open items: 1 blocks launch, 0 important, 0 minor, 1 unweighted\./);
  } finally { s.done(); }
});
