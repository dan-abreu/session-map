import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';
import { applyImport, archFlow, deleteDraft, exportMermaid, importOp, planImport, readDraft, writeDraft } from '../server/arch/flow.mjs';
import { listProposals, listUndo, undoOp, writeCare } from '../server/foundation/care.mjs';
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
// Every apply goes through the care mode (fd14): its own session-map folder, the mode given in memory unless a test says otherwise.
const careOf = (mode = 'auto') => ({ id: 'feira-abc123', smDir: mkdtempSync(join(tmpdir(), 'sm-flow-care-')), mode });
// applyImport in auto, answered as before the care mode: the operation id is random, so it is checked here and left out.
function apply(args) {
  const { status, opId, ...out } = applyImport({ care: careOf(), ...args });
  if (status === 'applied') assert.match(opId, /^op:[a-z0-9._-]+$/i);
  if (status === 'unchanged') assert.equal(opId, null);
  return out;
}
// Every path and every byte under a folder: equal hashes = the folder is byte-identical.
function treeHash(dir) {
  const hash = createHash('sha256');
  for (const rel of readdirSync(dir, { recursive: true }).map(String).sort()) {
    const abs = join(dir, rel);
    hash.update(`${rel.replaceAll('\\', '/')}\0`);
    if (statSync(abs).isFile()) hash.update(readFileSync(abs));
  }
  return hash.digest('hex');
}

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

// fl05: a README with no diagram at all shows the automatic draft, and "Save to project" must be able to write it.
test('the automatic draft of a README with no diagram is a change that can be saved, and saving it makes it the README own', () => {
  const root = project();
  const readme = join(root, DIR, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/```mermaid[\s\S]*?```\r?\n?/, ''));
  const arch = archOf(root);
  assert.equal(arch.mermaid, null, 'no diagram in this README');
  const draft = exportMermaid(arch);
  const plan = planImport(arch, draft);
  assert.equal(plan.unchanged, false, 'there is something to save');
  assert.equal(plan.diagramChanged, true);
  assert.deepEqual([plan.partsNew, plan.partsMoved, plan.partsMissing, plan.edgesAdded, plan.edgesRemoved].map((l) => l.length), [0, 0, 0, 0, 0], 'no part or arrow changes');
  const out = apply({ root, arch, text: draft });
  assert.deepEqual(out, { ok: true, changed: true, files: [`${DIR}/README.md`] });
  assert.match(readFileSync(readme, 'utf8'), /```mermaid\nflowchart LR/);
  assert.equal(planImport(archOf(root), draft).unchanged, true, 'saved: the next preview has nothing left to say');
});

// Seen in a real test: the drawing carried 3 dotted relations that were written to the README as arrows, but the preview
// counted only the 2 arrows that were really new.
test('the preview lists the relations an imported drawing turns into README arrows as their own line', () => {
  const root = project();
  const readme = join(root, DIR, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/\n[ \t]*\w+ --> \w+/g, ''));
  const arch = archOf(root);
  const exported = exportMermaid(arch);
  const same = planImport(arch, exported);
  assert.equal(same.unchanged, true);
  assert.deepEqual(same.edgesFromRelations, [], 'nothing is written, so nothing to list');
  const drawn = printFlow(connect(parseFlow(exported), 'VIT', 'CES'));
  const plan = planImport(arch, drawn);
  assert.deepEqual(plan.edgesAdded, [{ from: 'Vitrine', to: 'Cesta e pedidos' }], 'the new arrow is still its own line');
  assert.deepEqual(plan.edgesFromRelations, [{ from: 'Pagamentos', to: 'Segurança' }]);
  const out = apply({ root, arch, text: drawn });
  assert.equal(out.ok, true);
  assert.match(readFileSync(readme, 'utf8'), /PAG -\.-> SEG/, 'the relation really went into the README');
});

test('the preview has no relation line when the README already drew its arrows', () => {
  const arch = archOf(project());
  const plan = planImport(arch, printFlow(connect(parseFlow(exportMermaid(arch)), 'VIT', 'PAG')));
  assert.deepEqual(plan.edgesFromRelations, []);
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
  const out = apply({ root, arch, text: printFlow(m) });
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
  const out = apply({ root, arch, text: printFlow(m), skip: ['banco_parceiro'] });
  assert.deepEqual(out.files, ['docs/arquitetura/README.md']);
  assert.ok(!existsSync(join(root, DIR, 'banco-parceiro.md')));
  assert.match(readFileSync(join(root, DIR, 'README.md'), 'utf8'), /banco_parceiro\["Banco parceiro"\]/);
});

test('apply with nothing to change writes nothing', () => {
  const root = project();
  const arch = archOf(root);
  const stamp = statSync(join(root, DIR, 'README.md')).mtimeMs;
  assert.deepEqual(apply({ root, arch, text: exportMermaid(arch) }), { ok: true, changed: false, files: [] });
  assert.equal(statSync(join(root, DIR, 'README.md')).mtimeMs, stamp);
});

test('apply keeps the README line endings and never overwrites a file with the new part\'s name', () => {
  const root = project();
  const readme = join(root, DIR, 'README.md');
  writeFileSync(readme, readFileSync(readme, 'utf8').replace(/\n/g, '\r\n'));
  writeFileSync(join(root, DIR, 'notas-fiscais.md'), 'not a part yet');
  const arch = { ...archOf(root), parts: archOf(root).parts.filter((p) => p.id !== 'notas-fiscais') };
  const out = apply({ root, arch, text: printFlow(addBox(parseFlow(exportMermaid(arch)), 'Notas fiscais', 'motor')) });
  assert.deepEqual(out.files, ['docs/arquitetura/README.md', 'docs/arquitetura/notas-fiscais-2.md']);
  assert.equal(readFileSync(join(root, DIR, 'notas-fiscais.md'), 'utf8'), 'not a part yet');
  const text = readFileSync(readme, 'utf8');
  assert.ok(!/[^\r]\n/.test(text), 'every line still ends in CRLF');
});

test('apply refuses a map read from the main branch and a folder outside the project', () => {
  const root = project();
  const arch = archOf(root);
  const text = printFlow(addBox(parseFlow(exportMermaid(arch)), 'X', null));
  assert.deepEqual(apply({ root, arch: { ...arch, source: 'main-branch' }, text }), { ok: false, error: 'arch-not-here' });
  assert.deepEqual(apply({ root, arch: { ...arch, dir: '../outside' }, text }), { ok: false, error: 'bad-path' });
  assert.deepEqual(apply({ root, arch: { ...arch, dir: 'docs/../../outside' }, text }), { ok: false, error: 'bad-path' });
});

test('apply on a project with no map yet creates the folder with a README holding the diagram', () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-flow-none-'));
  const arch = { source: 'none', dir: null, lang: 'en', mermaid: null, layers: [], parts: [], links: [] };
  const out = apply({ root, arch, text: 'flowchart LR\n  subgraph app["App"]\n    web[Web]\n  end' });
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
  const out = apply({ root, arch, text: exportMermaid(arch).replace('VIT --> CES', 'VIT -->|sends orders to| CES') });
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
  assert.deepEqual(apply({ root, arch, text: labelled }).files, ['docs/arquitetura/README.md']);
  const once = readFileSync(path, 'utf8');
  assert.equal(outside(once), outside(original));
  assert.match(once, /subgraph entrada\["Por onde as #96;#96;#96;pessoas#96;#96;#96; entram"\]/);
  arch = archOf(root);
  assert.match(arch.mermaid, /VIT -->\|run #96;#96;#96; now\| CES/, 'the whole block is read back');
  const again = exportMermaid(arch).replace('|run #96;#96;#96; now|', '|calls|');
  assert.deepEqual(apply({ root, arch, text: again }).files, ['docs/arquitetura/README.md']);
  assert.equal(outside(readFileSync(path, 'utf8')), outside(original));
  assert.match(readFileSync(path, 'utf8'), /VIT -->\|calls\| CES/);
  const before = readFileSync(path, 'utf8');
  const fenced = `${exportMermaid(arch)}\n\`\`\`\n## Injected heading\n\`\`\``;
  assert.deepEqual(planImport(arch, fenced), { ok: false, error: 'fence-in-drawing' });
  assert.deepEqual(apply({ root, arch, text: fenced }), { ok: false, error: 'fence-in-drawing' });
  assert.equal(readFileSync(path, 'utf8'), before);
});

// ---- the Flow writes through the care mode (fd14, B3-T19) ----------------------------------------

const newPart = (arch) => printFlow(addBox(parseFlow(exportMermaid(arch)), 'Notas fiscais', 'motor'));

test('importOp builds the operation (README block and skeletons not skipped) and writes nothing', () => {
  const root = project();
  const before = treeHash(root);
  const arch = archOf(root);
  const out = importOp({ root, arch, text: newPart(arch) });
  assert.equal(out.ok, true);
  assert.equal(out.op.kind, 'flow-import');
  assert.deepEqual(out.op.files.map((f) => f.path), ['docs/arquitetura/README.md', 'docs/arquitetura/notas-fiscais.md']);
  assert.match(out.op.files[0].after, /NF\["Notas fiscais"\]|notas_fiscais\["Notas fiscais"\]/);
  assert.match(out.op.files[1].after, /^# Notas fiscais\n/);
  assert.ok(out.op.files.every((f) => typeof f.after === 'string'), 'the Flow never deletes');
  assert.deepEqual(importOp({ root, arch, text: newPart(arch), skip: ['notas_fiscais'] }).op.files.map((f) => f.path), ['docs/arquitetura/README.md']);
  assert.deepEqual(importOp({ root, arch, text: exportMermaid(arch) }), { ok: true, op: null });
  assert.deepEqual(importOp({ root, arch: { ...arch, source: 'main-branch' }, text: newPart(arch) }), { ok: false, error: 'arch-not-here' });
  assert.deepEqual(importOp({ root, arch: { ...arch, dir: '../outside' }, text: newPart(arch) }), { ok: false, error: 'bad-path' });
  assert.equal(treeHash(root), before, 'building the operation touches nothing');
});

test('look only: the project stays byte-identical and apply answers look-only, with the mode given or read from care.json', () => {
  const root = project();
  const before = treeHash(root);
  const arch = archOf(root);
  const look = careOf('look');
  const out = applyImport({ root, arch, text: newPart(arch), care: look });
  assert.deepEqual({ ...out, opId: typeof out.opId }, { ok: false, changed: false, status: 'look-only', error: 'look-only', opId: 'string', files: ['docs/arquitetura/README.md', 'docs/arquitetura/notas-fiscais.md'] });
  const unasked = { id: 'feira-abc123', smDir: mkdtempSync(join(tmpdir(), 'sm-flow-care-')) };
  assert.equal(applyImport({ root, arch, text: newPart(arch), care: unasked }).status, 'look-only', 'not asked yet = look');
  writeCare(unasked.smDir, unasked.id, 'look');
  assert.equal(applyImport({ root, arch, text: newPart(arch), care: unasked }).status, 'look-only');
  assert.equal(treeHash(root), before, 'nothing written');
  assert.deepEqual(listUndo(look.smDir, look.id), []);
});

test('apply without the care mode writes nothing', () => {
  const root = project();
  const before = treeHash(root);
  const arch = archOf(root);
  assert.throws(() => applyImport({ root, arch, text: newPart(arch) }), /care/);
  assert.throws(() => applyImport({ root, arch, text: newPart(arch), care: { id: 'feira-abc123' } }), /care/);
  assert.equal(treeHash(root), before);
});

test('auto: apply writes, records an undo, and undo gives the project back byte for byte', () => {
  const root = project();
  const before = treeHash(root);
  const arch = archOf(root);
  const care = careOf('auto');
  const out = applyImport({ root, arch, text: newPart(arch), care });
  assert.equal(out.status, 'applied');
  assert.deepEqual(out.files, ['docs/arquitetura/README.md', 'docs/arquitetura/notas-fiscais.md']);
  assert.ok(existsSync(join(root, DIR, 'notas-fiscais.md')));
  const [record] = listUndo(care.smDir, care.id, { root });
  assert.equal(record.id, out.opId);
  assert.equal(record.kind, 'flow-import');
  assert.equal(record.mode, 'auto');
  assert.equal(record.undoable, true);
  assert.equal(undoOp({ id: care.id, root }, out.opId, { smDir: care.smDir, confirm: true }).ok, true);
  assert.equal(treeHash(root), before, 'README back and the new part file gone');
});

test('suggest: the owner clicking Apply is the accept, so it writes and records an undo, no proposal left open', () => {
  const root = project();
  const arch = archOf(root);
  const care = careOf('suggest');
  const out = applyImport({ root, arch, text: newPart(arch), care });
  assert.equal(out.status, 'applied');
  assert.match(readFileSync(join(root, DIR, 'README.md'), 'utf8'), /Notas fiscais/);
  assert.equal(listUndo(care.smDir, care.id)[0].mode, 'suggest');
  assert.deepEqual(listProposals(care.smDir, care.id), []);
});

test('the same drawing applied twice under the care mode: the second has nothing to change and records nothing', () => {
  const root = project();
  const arch = archOf(root);
  const care = careOf('auto');
  const text = newPart(arch);
  assert.equal(applyImport({ root, arch, text, care }).status, 'applied');
  const again = applyImport({ root, arch: archOf(root), text, care });
  assert.deepEqual(again, { ok: true, changed: false, status: 'unchanged', opId: null, files: [] });
  assert.equal(listUndo(care.smDir, care.id).length, 1);
});
