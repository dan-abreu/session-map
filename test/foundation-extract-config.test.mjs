import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, VERSION, TYPES } from '../server/foundation/extract/config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repos');
const run = (path, text) => extract({ path, type: 'config', text, masked: text, workspace: { dir: '', name: 'x' }, files: [] });
const shape = (f) => ({ id: f.id, kind: f.kind, file: f.file, line: f.line, origin: f.origin, source: f.attrs.source });

function expected(repo, files) {
  const a = JSON.parse(readFileSync(join(root, `${repo}.answer.json`), 'utf8'));
  return a.facts.filter((f) => f.kind === 'env' && files.includes(f.file)).map((f) => ({
    id: f.id, kind: f.kind, file: f.file, line: f.line, origin: f.origin, source: f.attrs.source }));
}
const byId = (a, b) => (a.id < b.id ? -1 : 1);

test('declares its version and types', () => {
  assert.equal(VERSION, 'config@1');
  assert.deepEqual(TYPES, ['json', 'other']);
});

test('acme-shop .env.example and turbo.json match the answer key', () => {
  const out = [];
  for (const p of ['.env.example', 'turbo.json']) out.push(...run(p, readFileSync(join(root, 'acme-shop', p), 'utf8')).facts);
  assert.deepEqual(out.map(shape).sort(byId), expected('acme-shop', ['.env.example', 'turbo.json']).sort(byId));
});

test('acme-delivery backend/.env.example matches the answer key', () => {
  const p = 'backend/.env.example';
  const { facts } = run(p, readFileSync(join(root, 'acme-delivery', p), 'utf8'));
  assert.deepEqual(facts.map(shape).sort(byId), expected('acme-delivery', [p]).sort(byId));
});

test('a value never appears anywhere in the output', () => {
  const out = run('.env.example', 'PASSWORD=abc123\nexport TOKEN="s3cr3t-xyz"\n');
  assert.deepEqual(out.facts.map((f) => f.id), ['env:PASSWORD', 'env:TOKEN']);
  const s = JSON.stringify(out);
  assert.ok(!s.includes('abc123') && !s.includes('s3cr3t'));
});

test('comments, blank lines and non-assignments are ignored; .env.local.example works', () => {
  const { facts } = run('.env.local.example', '# A=1\n\nnot a var\n  B = 2\n1BAD=3\n');
  assert.deepEqual(facts.map((f) => [f.id, f.line]), [['env:B', 4]]);
});

test('repeated names keep one fact with the later place in refs', () => {
  const { facts } = run('.env.example', 'A=1\nA=2\n');
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].refs, [{ file: '.env.example', line: 2 }]);
});

test('secrets files return nothing, at any depth and with any separator', () => {
  for (const p of ['.env', '.env.local', 'apps/api/.env.production', 'apps\\api\\.env']) {
    assert.deepEqual(run(p, 'SECRET=abc123\n'), { facts: [], hints: [] });
  }
});

test('turbo.json reads env, globalEnv and globalPassThroughEnv, skips wildcards and bad JSON', () => {
  const t = '{\n "globalEnv": ["G"],\n "tasks": {"a": {"env": ["A", "NEXT_PUBLIC_*", "!B"]}}\n}';
  const { facts } = run('turbo.json', t);
  assert.deepEqual(facts.map((f) => [f.id, f.line, f.attrs.source]), [['env:G', 2, 'turbo'], ['env:A', 3, 'turbo']]);
  assert.deepEqual(run('turbo.json', '{ broken').facts, []);
});

test('other files give nothing', () => {
  assert.deepEqual(run('package.json', '{"env":["X"]}').facts, []);
});
