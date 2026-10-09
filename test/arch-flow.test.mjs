import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';
import { applyImport, archFlow, deleteDraft, exportMermaid, planImport, readDraft, writeDraft } from '../server/arch/flow.mjs';
import { parseFlow, printFlow, addBox, connect, moveToLayer, removeNode, addLayer } from '../server/web/flow.js';

const FIX = join(import.meta.dirname, 'fixtures', 'arch-pt');
const DIR = 'docs/arquitetura';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'sm-flow-'));
  mkdirSync(join(root, DIR), { recursive: true });
  cpSync(FIX, join(root, DIR), { recursive: true });
  return root;
}
const readFolder = (root, dir = DIR) => Object.fromEntries(readdirSync(join(root, dir)).map((f) => [f, readFileSync(join(root, dir, f), 'utf8')]));
const archOf = (root, dir = DIR) => ({ ...parseArch(dir, readFolder(root, dir)), links: [{ a: 'pagamentos', b: 'seguranca', weight: 1, since: null, reasons: [] }] });

test('export: one subgraph per layer, the parts as boxes (README ids kept) and only the README arrows when it drew some', () => {
  const arch = archOf(project());
  const text = exportMermaid(arch);
  assert.match(text, /^flowchart LR\n/);
  assert.match(text, /\n {2}subgraph entrada\["Por onde as pessoas entram"\]\n {4}VIT\["Vitrine"\]\n {4}APP\["App do entregador"\]\n {2}end\n/);
  assert.match(text, /\n {2}VIT --> CES\n {2}CES --> PAG\n {2}APP --> CES$/);
  assert.doesNotMatch(text, /-\.->/);
  const model = archFlow(arch);
  assert.equal(model.nodes.length, 5);
});

test('export: the relations session-map found fill in, dotted, only when the README drew no arrows', () => {
  const root = project();
  const readme = join(root, DIR, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/\n[ \t]*\w+ --> \w+/g, ''));
  const arch = archOf(root);
  assert.equal(parseFlow(arch.mermaid).edges.length, 0);
  assert.match(exportMermaid(arch), /\n {2}PAG -\.-> SEG$/);
  assert.equal(planImport(arch, exportMermaid(arch)).unchanged, true);
});

test('export of a map without a README diagram still draws every part in its layer', () => {
  const arch = { source: 'worktree', dir: 'docs/architecture', lang: 'en', mermaid: null, links: [], layers: [{ id: 'engine', name: 'Engine', partIds: ['orders', 'end'] }], parts: [{ id: 'orders', name: 'Orders' }, { id: 'end', name: 'End user' }] };
  assert.equal(exportMermaid(arch), 'flowchart LR\n  subgraph engine["Engine"]\n    orders["Orders"]\n    end_box["End user"]\n  end');
});

test('export → import changes nothing', () => {
  const arch = archOf(project());
  const plan = planImport(arch, exportMermaid(arch));
  assert.equal(plan.ok, true);
  assert.equal(plan.unchanged, true);
  for (const k of ['layersNew', 'partsNew', 'partsMoved', 'partsMissing', 'edgesAdded', 'edgesRemoved']) assert.deepEqual(plan[k], [], k);
});

test('the preview lists new parts, parts that change layer, parts left out, new layers and arrows', () => {
  const arch = archOf(project());
  let m = parseFlow(exportMermaid(arch));
  m = addBox(m, 'Notas fiscais', 'motor');
  m = addLayer(m, 'Fora do app');
  m = addBox(m, 'Banco parceiro', 'fora_do_app');
  m = moveToLayer(m, 'SEG', 'entrada');
  m = removeNode(m, 'APP');
  m = connect(m, 'PAG', 'notas_fiscais');
  const plan = planImport(arch, printFlow(m));
  assert.equal(plan.unchanged, false);
  assert.deepEqual(plan.layersNew, [{ id: 'fora_do_app', name: 'Fora do app' }]);
  assert.deepEqual(plan.partsNew, [
    { nodeId: 'notas_fiscais', name: 'Notas fiscais', layer: 'O que faz funcionar', file: 'docs/arquitetura/notas-fiscais.md' },
    { nodeId: 'banco_parceiro', name: 'Banco parceiro', layer: 'Fora do app', file: 'docs/arquitetura/banco-parceiro.md' },
  ]);
  assert.deepEqual(plan.partsMoved, [{ partId: 'seguranca', name: 'Segurança', from: 'O que sustenta', to: 'Por onde as pessoas entram' }]);
  assert.deepEqual(plan.partsMissing, [{ partId: 'app-do-entregador', name: 'App do entregador' }]);
  assert.deepEqual(plan.edgesAdded, [{ from: 'Pagamentos', to: 'Notas fiscais' }]);
  assert.deepEqual(plan.edgesRemoved, [{ from: 'App do entregador', to: 'Cesta e pedidos' }]);
});

test('the preview refuses text that is not a flowchart, or one without boxes', () => {
  const arch = archOf(project());
  assert.deepEqual(planImport(arch, 'pie title x\n "a": 1'), { ok: false, error: 'not-flowchart' });
  assert.deepEqual(planImport(arch, 'flowchart LR'), { ok: false, error: 'empty-flowchart' });
});

test('apply rewrites only the README mermaid block and writes a skeleton file for each new part, deleting nothing', () => {
  const root = project();
  const before = readFolder(root);
  const arch = archOf(root);
  let m = parseFlow(exportMermaid(arch));
  m = addBox(m, 'Notas fiscais', 'motor');
  m = moveToLayer(m, 'SEG', 'entrada');
  m = removeNode(m, 'APP');
  const out = applyImport({ root, arch, text: printFlow(m) });
  assert.deepEqual(out, { ok: true, changed: true, files: ['docs/arquitetura/README.md', 'docs/arquitetura/notas-fiscais.md'] });
  const after = readFolder(root);
  for (const [name, text] of Object.entries(before)) if (name !== 'README.md') assert.equal(after[name], text, `${name} untouched`);
  assert.ok('app-do-entregador.md' in after, 'a part left out of the drawing is never deleted');
  const [headBefore, tailBefore] = before['README.md'].split(/```mermaid[\s\S]*?```/);
  const [headAfter, tailAfter] = after['README.md'].split(/```mermaid[\s\S]*?```/);
  assert.equal(headAfter, headBefore);
  assert.equal(tailAfter, tailBefore);
  const reread = parseArch(DIR, after);
  assert.deepEqual(reread.layers.find((l) => l.name === 'Por onde as pessoas entram').partIds, ['vitrine', 'seguranca']);
  const fresh = reread.parts.find((p) => p.id === 'notas-fiscais');
  assert.equal(fresh.name, 'Notas fiscais');
  assert.ok(fresh.about.length > 10);
  assert.match(after['notas-fiscais.md'], /## Onde está no código/);
  assert.match(after['notas-fiscais.md'], /## O que falta/);
  assert.ok(reread.layers.find((l) => l.name === 'O que faz funcionar').partIds.includes('notas-fiscais'));
});

test('apply leaves a box the person chose to keep only in the drawing without a file', () => {
  const root = project();
  const arch = archOf(root);
  const m = addBox(parseFlow(exportMermaid(arch)), 'Banco parceiro', 'motor');
  const out = applyImport({ root, arch, text: printFlow(m), skip: ['banco_parceiro'] });
  assert.deepEqual(out.files, ['docs/arquitetura/README.md']);
  assert.ok(!existsSync(join(root, DIR, 'banco-parceiro.md')));
  assert.match(readFileSync(join(root, DIR, 'README.md'), 'utf8'), /banco_parceiro\["Banco parceiro"\]/);
});

test('apply with nothing to change writes nothing', () => {
  const root = project();
  const arch = archOf(root);
  const stamp = statSync(join(root, DIR, 'README.md')).mtimeMs;
  assert.deepEqual(applyImport({ root, arch, text: exportMermaid(arch) }), { ok: true, changed: false, files: [] });
  assert.equal(statSync(join(root, DIR, 'README.md')).mtimeMs, stamp);
});

test('apply keeps the README line endings and never overwrites a file with the new part\'s name', () => {
  const root = project();
  const readme = join(root, DIR, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/\n/g, '\r\n'));
  writeFileSync(join(root, DIR, 'notas-fiscais.md'), 'not a part yet');
  const arch = { ...archOf(root), parts: archOf(root).parts.filter((p) => p.id !== 'notas-fiscais') };
  const out = applyImport({ root, arch, text: printFlow(addBox(parseFlow(exportMermaid(arch)), 'Notas fiscais', 'motor')) });
  assert.deepEqual(out.files, ['docs/arquitetura/README.md', 'docs/arquitetura/notas-fiscais-2.md']);
  assert.equal(readFileSync(join(root, DIR, 'notas-fiscais.md'), 'utf8'), 'not a part yet');
  const text = readFileSync(readme, 'utf8');
  assert.ok(!/[^\r]\n/.test(text), 'every line still ends in CRLF');
});

test('apply refuses a map read from the main branch and a folder outside the project', () => {
  const root = project();
  const arch = archOf(root);
  const text = printFlow(addBox(parseFlow(exportMermaid(arch)), 'X', null));
  assert.deepEqual(applyImport({ root, arch: { ...arch, source: 'main-branch' }, text }), { ok: false, error: 'arch-not-here' });
  assert.deepEqual(applyImport({ root, arch: { ...arch, dir: '../outside' }, text }), { ok: false, error: 'bad-path' });
  assert.deepEqual(applyImport({ root, arch: { ...arch, dir: 'docs/../../outside' }, text }), { ok: false, error: 'bad-path' });
});

test('apply on a project with no map yet creates the folder with a README holding the diagram', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-flow-none-'));
  const arch = { source: 'none', dir: null, lang: 'en', mermaid: null, layers: [], parts: [], links: [] };
  const out = applyImport({ root, arch, text: 'flowchart LR\n  subgraph app["App"]\n    web[Web]\n  end' });
  assert.deepEqual(out.files, ['docs/architecture/README.md', 'docs/architecture/web.md']);
  const made = parseArch('docs/architecture', readFolder(root, 'docs/architecture'));
  assert.deepEqual(made.layers.map((l) => [l.name, l.partIds]), [['App', ['web']]]);
  assert.match(readFileSync(join(root, 'docs/architecture/web.md'), 'utf8'), /## What's missing/);
});

test('the workshop draft lives in the brain folder and never touches the README until applied', () => {
  const root = project();
  const smDir = mkdtempSync(join(tmpdir(), 'sm-flow-brain-'));
  const readme = readFileSync(join(root, DIR, 'README.md'), 'utf8');
  assert.equal(readDraft(smDir, 'shop-abc123'), null);
  writeDraft(smDir, 'shop-abc123', 'flowchart LR\n  a --> b');
  assert.equal(readDraft(smDir, 'shop-abc123'), 'flowchart LR\n  a --> b');
  assert.ok(existsSync(join(smDir, 'brain', 'shop-abc123', 'flow-draft.mmd')));
  assert.equal(readFileSync(join(root, DIR, 'README.md'), 'utf8'), readme);
  deleteDraft(smDir, 'shop-abc123');
  assert.equal(readDraft(smDir, 'shop-abc123'), null);
  assert.throws(() => writeDraft(smDir, '../x', 'flowchart LR'));
});

test('the preview counts a change to the drawing itself even when parts, layers and arrows stay the same', () => {
  const arch = archOf(project());
  const exported = exportMermaid(arch);
  assert.equal(planImport(arch, exported).diagramChanged, false);
  const edits = {
    direction: exported.replace('flowchart LR', 'flowchart TB'),
    'arrow label': exported.replace('VIT --> CES', 'VIT -->|sends orders to| CES'),
    'arrow kind': exported.replace('VIT --> CES', 'VIT -.-> CES'),
    shape: exported.replace('VIT["Vitrine"]', 'VIT("Vitrine")'),
    'extra line': `${exported}\n  classDef hot fill:#f00`,
    'part box renamed': exported.replace('VIT["Vitrine"]', 'VIT["Loja"]'),
  };
  for (const [name, text] of Object.entries(edits)) {
    const plan = planImport(arch, text);
    assert.equal(plan.ok, true, name);
    assert.equal(plan.diagramChanged, true, name);
    assert.equal(plan.unchanged, false, name);
  }
});

test('the preview counts a free box taken out of the drawing as a change', () => {
  const root = project();
  const readme = join(root, DIR, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace('    APP --> CES\n', '    APP --> CES\n    EXT[Banco externo]\n'));
  const arch = archOf(root);
  const plan = planImport(arch, exportMermaid(arch).replace(/\n.*EXT\["Banco externo"\]/, ''));
  assert.equal(plan.diagramChanged, true);
  assert.equal(plan.unchanged, false);
});

test('apply writes a change to the drawing itself into the README block', () => {
  const root = project();
  const arch = archOf(root);
  const out = applyImport({ root, arch, text: exportMermaid(arch).replace('VIT --> CES', 'VIT -->|sends orders to| CES') });
  assert.deepEqual(out, { ok: true, changed: true, files: ['docs/arquitetura/README.md'] });
  assert.match(readFileSync(join(root, DIR, 'README.md'), 'utf8'), /VIT -->\|sends orders to\| CES/);
});

test('backticks never leave the README block: a label keeps the rest of the README byte for byte, a fence line is refused', () => {
  const root = project();
  const path = join(root, DIR, 'README.md');
  const original = readFileSync(path, 'utf8');
  const outside = (s) => s.replace(/```mermaid[ \t]*\r?\n[\s\S]*?^```[ \t]*$/m, '<block>');
  let arch = archOf(root);
  const labelled = exportMermaid(arch).replace('"Por onde as pessoas entram"', '"Por onde as ```pessoas``` entram"').replace('VIT --> CES', 'VIT -->|run ``` now| CES');
  assert.deepEqual(applyImport({ root, arch, text: labelled }).files, ['docs/arquitetura/README.md']);
  const once = readFileSync(path, 'utf8');
  assert.equal(outside(once), outside(original));
  assert.match(once, /subgraph entrada\["Por onde as #96;#96;#96;pessoas#96;#96;#96; entram"\]/);
  arch = archOf(root);
  assert.match(arch.mermaid, /VIT -->\|run #96;#96;#96; now\| CES/, 'the whole block is read back');
  const again = exportMermaid(arch).replace('|run #96;#96;#96; now|', '|calls|');
  assert.deepEqual(applyImport({ root, arch, text: again }).files, ['docs/arquitetura/README.md']);
  assert.equal(outside(readFileSync(path, 'utf8')), outside(original));
  assert.match(readFileSync(path, 'utf8'), /VIT -->\|calls\| CES/);
  const before = readFileSync(path, 'utf8');
  const fenced = `${exportMermaid(arch)}\n\`\`\`\n## Injected heading\n\`\`\``;
  assert.deepEqual(planImport(arch, fenced), { ok: false, error: 'fence-in-drawing' });
  assert.deepEqual(applyImport({ root, arch, text: fenced }), { ok: false, error: 'fence-in-drawing' });
  assert.equal(readFileSync(path, 'utf8'), before);
});
