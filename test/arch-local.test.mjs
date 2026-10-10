import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArch } from '../server/arch/parse.mjs';
import { withLocalParts } from '../server/arch/local.mjs';
import { archFlow, exportMermaid } from '../server/arch/flow.mjs';

// The owner's requests and the operation (id76): a registry of requests and the work that changes no code are parts
// with a role, read like the others but left out of the Flow; a project whose repository has none keeps them in
// session-map's own folder, never in the repository.
const REGISTRY = `# Pedidos

Tudo o que o dono pediu.

## O que falta

- [ ] Ver os pedidos \`pe01\`
  - Pedido: 2026-10-10 05:10 — "enxergar os meus pedidos"
  - Onde foi: \`op01\`.
  - Situação: em andamento.
- [x] Chat embaixo \`pe02\`
  - Pedido: 2026-10-10 03:00 — "chat perdido no final"
  - Situação: feito (publicado na v0.2.4).
`;
const OPERATION = `# Operação

O trabalho que não muda o programa.

## O que falta

- [ ] **com a Ana:** Configurar o R2 \`op01\`
`;
const PART = `# Site

O site.

## O que falta

- [ ] Uma página \`si01\`
`;
const README = '# Arquitetura\n\n```mermaid\nflowchart LR\n  subgraph l1["Entrada"]\n    S[Site]\n  end\n```\n';

test('a part whose items mostly carry an "Asked" line is a registry of requests; operation.md / operacao.md is the operation', () => {
  const arch = parseArch('docs/arquitetura', { 'README.md': README, 'site.md': PART, 'pedidos.md': REGISTRY, 'operacao.md': OPERATION });
  const role = Object.fromEntries(arch.parts.map((p) => [p.id, p.role ?? null]));
  assert.deepEqual(role, { operacao: 'operation', pedidos: 'requests', site: null });
});

test('the Flow draws the program only: no box for the requests or the operation', () => {
  const arch = parseArch('docs/arquitetura', { 'README.md': README, 'site.md': PART, 'pedidos.md': REGISTRY, 'operacao.md': OPERATION });
  const labels = archFlow(arch).nodes.map((n) => n.label);
  assert.deepEqual(labels, ['Site']);
  assert.ok(!exportMermaid(arch).includes('Pedidos') && !exportMermaid(arch).includes('Operação'));
});

test('parts kept in session-map\'s folder join the map in a layer of their own, marked local, with their absolute file', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-local-'));
  try {
    const arch = parseArch('docs/arquitetura', { 'README.md': README, 'site.md': PART });
    assert.equal(withLocalParts(arch, smDir, 'shop-1'), arch, 'no folder: the map is untouched');
    mkdirSync(join(smDir, 'projects', 'shop-1'), { recursive: true });
    writeFileSync(join(smDir, 'projects', 'shop-1', 'pedidos.md'), REGISTRY);
    writeFileSync(join(smDir, 'projects', 'shop-1', 'operacao.md'), OPERATION);
    writeFileSync(join(smDir, 'projects', 'shop-1', 'site.md'), PART.replace('O site.', 'Outro site.'));
    const out = withLocalParts(arch, smDir, 'shop-1');
    const local = out.parts.filter((p) => p.local);
    assert.deepEqual(local.map((p) => [p.id, p.role]), [['operacao', 'operation'], ['pedidos', 'requests']], 'the repository\'s own part wins over a local one with the same id');
    assert.equal(out.parts.find((p) => p.id === 'site').about, 'O site.');
    assert.deepEqual(out.layers.at(-1), { id: 'local', name: 'Pedidos e operação', partIds: ['operacao', 'pedidos'] });
    assert.ok(local.every((p) => p.file.startsWith(smDir.replaceAll('\\', '/'))), 'a chat edits the file where it lives');
    assert.equal(withLocalParts({ source: 'none', parts: [], layers: [] }, smDir, 'shop-1').parts.length, 0, 'a project with no map waits for one');
  } finally {
    rmSync(smDir, { recursive: true, force: true });
  }
});
