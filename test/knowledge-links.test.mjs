import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStandard, unknownStandardRefs } from '../server/foundation/standard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWLEDGE = join(ROOT, 'knowledge');

function packages() {
  if (!existsSync(KNOWLEDGE)) return [];
  const out = [];
  for (const f of readdirSync(KNOWLEDGE).filter((n) => n.endsWith('.json'))) {
    try { out.push(JSON.parse(readFileSync(join(KNOWLEDGE, f), 'utf8'))); } catch { /* the package-format test reports broken files */ }
  }
  return out;
}

test('every `standard` id used by a knowledge package exists in docs/standard', () => {
  const bad = unknownStandardRefs(packages(), loadStandard(join(ROOT, 'docs', 'standard')));
  assert.deepEqual(bad, [], `unknown standard ids: ${JSON.stringify(bad)}`);
});

test('the check itself fails on a package that points at a missing standard id', () => {
  const std = loadStandard(join(ROOT, 'docs', 'standard'));
  const bad = unknownStandardRefs([{ id: 'stack-x', items: [{ id: 'x.y', standard: ['05.nao-existe-mesmo'] }] }], std);
  assert.equal(bad.length, 1);
});
