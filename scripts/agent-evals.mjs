import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeAtomic } from '../server/store.mjs';
import { deriveSpecialists } from '../server/ai/specialists.mjs';
import { loadSpecialists, testCommandOf } from '../server/ai/specialists-load.mjs';
import { DEFAULT_MAX_USD, casesFile, mineCases, reportMarkdown, runDirOf, runSpecEval, summarizeSpecEval } from '../server/ai/spec-eval.mjs';

// Proves a specialist's card on every AI that has a key (id158, or68). Three steps, the first two free:
//   node scripts/agent-evals.mjs mine [--max 30] [--root <dir>]          cases from the project's own fix commits
//   node scripts/agent-evals.mjs run --dry-run [--only a,b] [--limit N]  what a run would ask, and the worst-case price
//   node scripts/agent-evals.mjs run [--only a,b] [--max-usd 4] [--max-usd-each 2] [--limit N] [--resume <runId>]   spends money
//   node scripts/agent-evals.mjs report <runId>

const run = promisify(execFile);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { root: { type: 'string' }, max: { type: 'string' }, only: { type: 'string' }, limit: { type: 'string' }, 'max-usd': { type: 'string' }, 'max-usd-each': { type: 'string' }, 'dry-run': { type: 'boolean' }, resume: { type: 'string' }, 'sm-dir': { type: 'string' } },
  });
  const root = resolve(values.root ?? process.cwd());
  const { claudeDir } = await import('../server/sources/claude.mjs');
  const smDir = values['sm-dir'] ?? join(claudeDir(), 'session-map');
  const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);
  const money = (name) => { if (values[name] === undefined) return undefined; const n = Number(values[name]); if (!(n >= 0)) throw new Error(`--${name} must be a number of dollars`); return n; };

  if (command === 'mine') {
    const loaded = await loadSpecialists({ root });
    if (!loaded.ok) throw new Error('The architecture map must be in the working tree (docs/architecture).');
    const git = async (args) => (await run('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true })).stdout;
    const readPart = (p) => { try { return readFileSync(join(root, p.file), 'utf8'); } catch { return ''; } };
    const testCommand = testCommandOf(root);
    const cases = await mineCases({ git, arch: loaded.arch, specialistsAt: (inventory) => deriveSpecialists({ arch: loaded.arch, readPart, files: inventory, testCommand }), max: Number(values.max ?? 30) });
    writeAtomic(casesFile(smDir), `${JSON.stringify(cases, null, 1)}\n`);
    const byPart = {};
    for (const c of cases) byPart[c.partId] = (byPart[c.partId] ?? 0) + 1;
    console.log(`${cases.length} cases mined from the fix commits (kept in ${casesFile(smDir)}): ${JSON.stringify(byPart)}`);
    return;
  }

  if (command === 'run') {
    const { listKeys } = await import('../server/ai/keys.mjs');
    const { makeCaller } = await import('../server/bench/contestants.mjs');
    const options = { smDir, only: list(values.only), limit: values.limit ? Number.parseInt(values.limit, 10) : null, maxUSD: money('max-usd') ?? DEFAULT_MAX_USD, dryRun: Boolean(values['dry-run']), resume: values.resume ?? null };
    const each = money('max-usd-each');
    if (each !== undefined) options.maxUSDEach = each;
    const out = await runSpecEval(options, {
      call: makeCaller({ smDir }),
      keyedProviders: listKeys(smDir).map((k) => k.provider),
      onProgress: ({ index, total, spentUSD }) => console.log(`case ${index}/${total} · spent so far $${spentUSD}`),
    });
    for (const n of out.notes) console.log(`- ${n}`);
    if (out.dryRun) {
      console.log(`Dry run: ${out.plan.calls} questions over ${out.plan.cases} cases for ${out.plan.contestants.join(', ')}. Worst-case price $${out.plan.worstUSD}; the cap of $${options.maxUSD} comes before that.`);
      return;
    }
    const rows = summarizeSpecEval(out.results);
    const text = reportMarkdown({ runId: out.runId, rows, notes: out.notes, spentUSD: out.spentUSD });
    writeAtomic(join(out.runDir, 'report.md'), text);
    console.log(text);
    return;
  }

  if (command === 'report') {
    const runId = positionals[0];
    if (!runId) throw new Error('report takes a run id');
    const dir = runDirOf(smDir, runId);
    const file = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    console.log(reportMarkdown({ runId, rows: summarizeSpecEval(file.results), spentUSD: file.spentUSD }));
    return;
  }

  console.log('usage: node scripts/agent-evals.mjs mine | run [--dry-run] | report <runId>');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`agent-evals stopped: ${err.message}`); process.exitCode = 1; });
}
