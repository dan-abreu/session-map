// Measures the exact readers against the three invented answer keys: accuracy = expected facts found / expected,
// invention = extracted facts outside the key / extracted (a fact on the wrong line counts as an invention).
// No network, no AI: it copies each fixture repo, runs the census and the readers, and compares. Exit 1 below limits.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusOf } from '../server/foundation/census.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';
import { copyFixtureRepo, removeFixtureRepo, FIXTURE_REPOS } from '../test/fixtures/repo-copy.mjs';

export const FIXTURES = ['acme-shop', 'acme-delivery', 'acme-lib'];
const NOW = new Date('2026-10-10T12:00:00.000Z');
const keyOf = (f) => `${f.kind} | ${f.id} | ${f.file}:${f.line} | ${f.origin}`;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function score(expected, extracted) {
  const want = new Set(expected.map(keyOf));
  const got = new Set(extracted.map(keyOf));
  let found = 0;
  for (const k of want) if (got.has(k)) found++;
  let invented = 0;
  for (const k of got) if (!want.has(k)) invented++;
  return {
    expected: want.size, found, extracted: got.size, invented,
    accuracy: want.size ? found / want.size : 1,
    invention: got.size ? invented / got.size : 0,
  };
}

function byKind(list) {
  const map = new Map();
  for (const f of list) {
    if (!map.has(f.kind)) map.set(f.kind, []);
    map.get(f.kind).push(f);
  }
  return map;
}

// extract: (root, census, prev, opts) => { facts }. Injectable so a test can plant a wrong fact.
export async function measure({ fixtures = FIXTURES, extract = extractAll, limits = readJson(join(FIXTURE_REPOS, 'limits.json')) } = {}) {
  const lim = limits.extractors;
  const result = { fixtures: {}, ok: true, failures: [] };
  for (const name of fixtures) {
    const answer = readJson(join(FIXTURE_REPOS, `${name}.answer.json`));
    const expected = [...answer.facts, ...(answer.extraFacts ?? [])];
    const root = copyFixtureRepo(name);
    let facts;
    try {
      const census = await censusOf(root, null);
      facts = extract(root, census, null, { now: NOW }).facts;
    } finally { removeFixtureRepo(root); }
    const want = byKind(expected);
    const got = byKind(facts);
    const kinds = {};
    for (const kind of [...new Set([...want.keys(), ...got.keys()])].sort()) kinds[kind] = score(want.get(kind) ?? [], got.get(kind) ?? []);
    const total = score(expected, facts);
    result.fixtures[name] = { kinds, total };
    for (const [kind, row] of [...Object.entries(kinds), ['all', total]]) {
      if (row.accuracy < lim.accuracy) result.failures.push(`${name} ${kind}: accuracy ${pct(row.accuracy)} is below ${pct(lim.accuracy)}`);
      if (row.invention > lim.invention) result.failures.push(`${name} ${kind}: invention ${pct(row.invention)} is above ${pct(lim.invention)}`);
    }
  }
  result.ok = result.failures.length === 0;
  return result;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

export function formatTable(result) {
  const lines = [];
  for (const [name, { kinds, total }] of Object.entries(result.fixtures)) {
    lines.push(`${name}`, `  ${'kind'.padEnd(12)}${'expected'.padStart(9)}${'found'.padStart(7)}${'extracted'.padStart(10)}${'accuracy'.padStart(10)}${'invention'.padStart(11)}`);
    for (const [kind, r] of [...Object.entries(kinds), ['all', total]]) {
      lines.push(`  ${kind.padEnd(12)}${String(r.expected).padStart(9)}${String(r.found).padStart(7)}${String(r.extracted).padStart(10)}${pct(r.accuracy).padStart(10)}${pct(r.invention).padStart(11)}`);
    }
  }
  lines.push(result.ok ? 'OK: all fixtures within limits' : `FAIL:\n${result.failures.map((f) => `  ${f}`).join('\n')}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await measure();
  console.log(formatTable(r));
  process.exit(r.ok ? 0 : 1);
}
