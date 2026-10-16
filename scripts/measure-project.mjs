import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.mjs';
import { censusOf } from '../server/foundation/census.mjs';
import { extractAll } from '../server/foundation/extract/index.mjs';

// What the Foundation reads of a real project (fd11, fd29): the census and the extractors run in memory on the folder, and the
// numbers are the coverage — how many code files the readers understood, how many routes, screens, tables and variables they
// found, and a sample of each kind checked against the source line it points to. It only reads: nothing is written, not in
// the project and not in session-map's folder, and no AI is called.
//   node scripts/measure-project.mjs <folder> [<folder>...]

const CODE_RE = /\.(js|mjs|cjs|ts|tsx|jsx|dart|php|py|prisma|vue|svelte)$/;
const SAMPLE = 12;

// The word a fact must show on its own line: the callee of a call, the name of a function, the path of a route. A statement
// that continues on the next line (`app.get(` then the path) is the fact's line, so the name may be missing there.
const needle = (f) => {
  let t = String(f.name ?? f.id);
  if (f.kind === 'call') t = String(f.id).split('->').pop();
  t = t.split('#').pop().replace(/^\?/, '').split('.').pop();
  return t.replace(/\(.*$/, '').split(/[\s/:]+/).filter((x) => x.length > 2 && !/^(GET|POST|PUT|PATCH|DELETE|fn|env)$/.test(x)).pop() ?? '';
};

const percent = (a, b) => (b ? Math.round((100 * a) / b) : null);

// → the numbers for one folder. smDir only finds the config of the project (its `vendored` folders).
export async function measureProject(root, { smDir = join(homedir(), '.claude', 'session-map'), now = new Date() } = {}) {
  const config = loadConfig(root, smDir);
  const started = Date.now();
  const census = await censusOf(root, null, { vendored: config.vendored });
  const { facts } = extractAll(root, census, null, { now });
  const ms = Date.now() - started;
  const files = census.files.filter((f) => f.included);
  const code = files.filter((f) => CODE_RE.test(f.path));
  const withFacts = new Set(facts.map((f) => f.file));
  const understood = code.filter((f) => withFacts.has(f.path)).length;
  const kinds = {};
  for (const f of facts) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  const origins = {};
  for (const f of facts) origins[f.origin] = (origins[f.origin] ?? 0) + 1;
  const evidence = {};
  for (const kind of Object.keys(kinds)) {
    const of = facts.filter((f) => f.kind === kind);
    const step = Math.max(1, Math.floor(of.length / SAMPLE));
    const sample = [];
    for (let i = 0; i < of.length && sample.length < SAMPLE; i += step) sample.push(of[i]);
    let found = 0;
    for (const f of sample) {
      let line = null;
      try { line = readFileSync(join(root, f.file), 'utf8').split(/\r?\n/)[f.line - 1] ?? null; } catch { line = null; }
      const word = needle(f);
      if (line != null && (word === '' || line.includes(word))) found++;
    }
    evidence[kind] = { sampled: sample.length, found };
  }
  const bare = {};
  for (const f of code.filter((c) => !withFacts.has(c.path))) { const dir = f.path.split('/').slice(0, 2).join('/'); bare[dir] = (bare[dir] ?? 0) + 1; }
  return {
    root, ms,
    files: files.length, leftOut: census.excluded,
    codeFiles: code.length, codeUnderstood: understood, codeUnderstoodPct: percent(understood, code.length),
    facts: facts.length, kinds, origins, evidence,
    codeWithoutFacts: Object.entries(bare).sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

export function format(m) {
  const ev = Object.entries(m.evidence).map(([k, v]) => `${k} ${v.found}/${v.sampled}`).join(', ');
  return [
    `== ${m.root}`,
    `${m.files} files counted (left out: ${JSON.stringify(m.leftOut)}), read in ${m.ms} ms`,
    `code files ${m.codeFiles}; understood (at least one fact) ${m.codeUnderstood}${m.codeUnderstoodPct === null ? '' : ` (${m.codeUnderstoodPct}%)`}`,
    `facts ${m.facts}: ${JSON.stringify(m.kinds)}; by origin ${JSON.stringify(m.origins)}`,
    `a sample of each kind whose source line holds the fact's name: ${ev || 'nothing to sample'}`,
    m.codeWithoutFacts.length ? `code files with no fact, by folder: ${JSON.stringify(m.codeWithoutFacts)}` : null,
  ].filter(Boolean).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folders = process.argv.slice(2);
  if (!folders.length) { console.error('usage: node scripts/measure-project.mjs <folder> [<folder>...]'); process.exit(2); }
  for (const root of folders) console.log(`${format(await measureProject(root))}\n`);
}
