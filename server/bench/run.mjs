#!/usr/bin/env node
// The measuring bench (or12): every chosen AI does the same session-map tasks, in the same order, under a hard money
// cap, and the owner gets accuracy and cost per right answer for each. See docs/architecture/orchestration.md.
//
//   node server/bench/run.mjs [--kinds classify,code,review,pt] [--only claude:haiku,openai:gpt-6-luna] [--limit N]
//                             [--max-usd 8] [--max-usd-each N] [--dry-run] [--resume <runId>] [--allow-deepseek-personal]
//                             [--sets-dir <dir>] [--sm-dir <dir>]
//
// Results go to <smDir>/bench/runs/<runId>/: results.json, report.md, pt-blind.md and pt-key.json.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertSafeName, writeAtomic } from '../store.mjs';
import { allowedFor, contestantsFor, estimateUSD, makeCaller, selectContestants } from './contestants.mjs';
import { runCodeItem } from './sandbox.mjs';
import { KINDS, scoreAnswer } from './score.mjs';
import { writeReports } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SETS_DIR = join(HERE, 'sets');
export const DEFAULT_MAX_USD = 8;
const CODE_KEEP_CHARS = 20_000;

export const benchDir = (smDir) => join(smDir, 'bench');
export const classifySetFile = (smDir) => join(benchDir(smDir), 'sets', 'classify.json');
export const runDirOf = (smDir, runId) => join(benchDir(smDir), 'runs', assertSafeName(runId, 'run id'));

// Failures worth asking again when a run is resumed: the way there broke, not the model's answer.
const RETRY_ERRORS = new Set(['timeout', 'network', 'spawn-failed', 'sandbox-failed', 'crashed', 'claude-not-found', 'no-key', 'http-408', 'http-429']);
const retryable = (r) => Boolean(r.skipped) || RETRY_ERRORS.has(r.error) || /^http-5\d\d$/.test(r.error ?? '');

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const usd = (n) => `US$ ${n.toFixed(2).replace('.', ',')}`;

const CODE_SCHEMA = '{"code": "<the complete ES module, exporting the function>"}';
const REVIEW_SCHEMA = '{"bugs": [{"line": 12, "why": "one short sentence"}]}';
const PT_SCHEMA = '{"text": "..."}';

// What each model is asked. The classify and pt sets carry their own prompt; code and review are framed here, and
// never show the tests or the planted bug.
export function promptFor(kind, item) {
  if (kind === 'classify') return { prompt: item.prompt, schemaHint: item.schemaHint };
  if (kind === 'pt') return { prompt: item.prompt, schemaHint: PT_SCHEMA };
  if (kind === 'code') {
    return {
      prompt: [
        'Write a JavaScript ES module for Node 24, with no dependencies and no access to files, network or other programs.',
        'It must export the function described below. Handle the edge cases the description mentions.',
        '',
        `Task: ${item.title ?? item.id}`,
        item.spec,
        '',
        'Signature:',
        item.signature,
        '',
        'Put the whole module, as plain source code, in the "code" field.',
      ].join('\n'),
      schemaHint: CODE_SCHEMA,
    };
  }
  if (kind === 'review') {
    const lines = String(item.code ?? '').replace(/\n$/, '').split('\n');
    const width = String(lines.length).length;
    return {
      prompt: [
        'Review this JavaScript file for bugs: code that makes the program behave wrongly. Ignore style, naming and missing comments.',
        'Many files have one bug, some have none. When you find none, answer with an empty list. Each line starts with its number.',
        '',
        `File: ${item.file ?? item.id}`,
        ...lines.map((l, i) => `${String(i + 1).padStart(width)}| ${l}`),
      ].join('\n'),
      schemaHint: REVIEW_SCHEMA,
    };
  }
  throw new Error(`unknown kind: ${kind}`);
}

// Models often fence the module inside the JSON string as well.
const unfence = (code) => /^\s*```[\w-]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(code)?.[1] ?? code;

function readSet(path, kind) {
  if (!existsSync(path)) return { missing: true };
  try {
    const set = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(set?.items) || (set.kind && set.kind !== kind)) return { broken: true };
    return { items: set.items.filter((i) => i && typeof i.id === 'string') };
  } catch {
    return { broken: true };
  }
}

const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};

const keyOf = (contestant, kind, itemId) => `${contestant}\u0000${kind}\u0000${itemId}`;

// One answer, scored. Only ids, the score and the short answer are kept: never the prompt.
async function answerOne({ contestant, kind, item, call, runCode }) {
  const { prompt, schemaHint } = promptFor(kind, item);
  const started = Date.now();
  const res = await call(contestant, prompt, schemaHint);
  const ms = Date.now() - started;
  const base = { contestant: contestant.id, kind, itemId: item.id, ok: Boolean(res.ok), score: 0, costUSD: round6(Number(res.costUSD) || 0), ms, error: res.ok ? null : (res.error ?? 'failed') };
  if (!res.ok) return base;
  if (kind === 'code') {
    const code = typeof res.value?.code === 'string' ? unfence(res.value.code) : null;
    if (!code) return { ...base, ok: false, error: 'no-code' };
    let run;
    try {
      run = await runCode({ code, tests: item.tests });
    } catch {
      return { ...base, error: 'sandbox-failed', answer: code.slice(0, CODE_KEEP_CHARS) };
    }
    const scored = scoreAnswer('code', item, run);
    return { ...base, ...scored, error: run.ok ? null : (run.error ?? 'tests-failed'), testMs: run.ms, answer: code.slice(0, CODE_KEEP_CHARS) };
  }
  return { ...base, ...scoreAnswer(kind, item, res.value) };
}

const skippedEntry = (contestant, kind, itemId, reason) => ({ contestant: contestant.id, kind, itemId, ok: false, score: 0, costUSD: 0, ms: 0, error: null, skipped: reason });

export async function runBench(options = {}, deps = {}) {
  const {
    smDir, setsDir = DEFAULT_SETS_DIR, kinds = KINDS, only = null, limit = null, maxUSD = DEFAULT_MAX_USD,
    dryRun = false, resume = null, allowDeepseekPersonal = false,
  } = options;
  if (!smDir) throw new Error('runBench needs smDir');
  const { call, runCode = runCodeItem, keyedProviders = [], buildClassify = null, onProgress = () => {} } = deps;
  const runId = resume ?? options.runId ?? new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const runDir = runDirOf(smDir, runId);
  const notes = [];

  const all = contestantsFor(keyedProviders);
  const { chosen, missing } = selectContestants(all, only);
  // By default no single contestant may take more than half the money, so one dear model cannot starve the rest.
  const maxUSDEach = options.maxUSDEach ?? (chosen.length > 1 ? maxUSD / 2 : maxUSD);
  for (const id of missing) notes.push(`Participante ${id} não está disponível: falta a chave dessa empresa ou o nome está errado.`);

  const sets = [];
  for (const kind of KINDS.filter((k) => kinds.includes(k))) {
    const path = kind === 'classify' ? classifySetFile(smDir) : join(setsDir, `${kind}.json`);
    let set = readSet(path, kind);
    if (set.missing && kind === 'classify' && buildClassify && !dryRun) {
      await buildClassify();
      set = readSet(path, kind);
    }
    if (!set.items) {
      notes.push(`Conjunto de tarefas "${kind}" ${set.missing ? 'não encontrado' : 'ilegível'} em ${path}: ficou de fora.`);
      continue;
    }
    if (!set.items.length) notes.push(`Conjunto de tarefas "${kind}" está vazio (${path}): nada a medir nesse tipo.`);
    sets.push({ kind, items: limit ? set.items.slice(0, limit) : set.items });
  }

  const earlierFile = resume ? readJson(join(runDir, 'results.json'), {}) : {};
  const earlier = Array.isArray(earlierFile.results) ? earlierFile.results : [];
  const reusable = new Map(earlier.filter((r) => !retryable(r)).map((r) => [keyOf(r.contestant, r.kind, r.itemId), r]));

  if (dryRun) {
    const plan = { calls: 0, worstUSD: 0, byKind: {}, contestants: chosen.map((c) => c.id) };
    for (const { kind, items } of sets) {
      plan.byKind[kind] = items.length;
      for (const item of items) {
        const { prompt } = promptFor(kind, item);
        for (const c of chosen) {
          if (!allowedFor(c, kind, { allowDeepseekPersonal }) || reusable.has(keyOf(c.id, kind, item.id))) continue;
          plan.calls++;
          plan.worstUSD += estimateUSD(c, prompt);
        }
      }
    }
    plan.worstUSD = round6(plan.worstUSD);
    return { runId, runDir, dryRun: true, plan, notes, results: [] };
  }

  writeAtomic(join(runDir, 'run.json'), `${JSON.stringify({
    runId, kinds: sets.map((s) => s.kind), contestants: chosen.map((c) => c.id), limit, maxUSD, maxUSDEach, allowDeepseekPersonal,
    sets: Object.fromEntries(sets.map((s) => [s.kind, s.items.map((i) => i.id)])), startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  // The cap is for the whole run: what earlier attempts cost counts, even for answers now asked again.
  let spent = round6(Math.max(Number(earlierFile.spentUSD) || 0, earlier.reduce((s, r) => s + (Number(r.costUSD) || 0), 0)));
  const spentEach = new Map();
  const seen = new Map(); // contestant + kind -> real costs so far, for the next estimate
  const addSeen = (r) => {
    const k = `${r.contestant}\u0000${r.kind}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(Number(r.costUSD) || 0);
    spentEach.set(r.contestant, round6((spentEach.get(r.contestant) ?? 0) + (Number(r.costUSD) || 0)));
  };
  for (const r of earlier) if (!r.skipped) addSeen(r);

  const results = [];
  const planned = new Set();
  const save = () => {
    const rest = earlier.filter((r) => !planned.has(keyOf(r.contestant, r.kind, r.itemId)));
    writeAtomic(join(runDir, 'results.json'), `${JSON.stringify({ runId, updatedAt: new Date().toISOString(), spentUSD: spent, results: [...results, ...rest] }, null, 1)}\n`);
  };
  let stopped = false;
  const stoppedEach = new Set();
  const counts = { privacy: 0, budget: 0, budgetEach: 0 };

  for (const { kind, items } of sets) {
    for (const [n, item] of items.entries()) {
      onProgress({ kind, index: n + 1, total: items.length, itemId: item.id, spentUSD: spent });
      const { prompt } = promptFor(kind, item);
      const slots = [];
      let reserved = 0;
      for (const c of chosen) {
        const key = keyOf(c.id, kind, item.id);
        planned.add(key);
        if (reusable.has(key)) { slots.push(reusable.get(key)); continue; }
        if (!allowedFor(c, kind, { allowDeepseekPersonal })) { counts.privacy++; slots.push(skippedEntry(c, kind, item.id, 'privacy')); continue; }
        if (stopped) { counts.budget++; slots.push(skippedEntry(c, kind, item.id, 'budget')); continue; }
        const est = estimateUSD(c, prompt, seen.get(`${c.id}\u0000${kind}`) ?? []);
        const overEach = stoppedEach.has(c.id) || (spentEach.get(c.id) ?? 0) + est > maxUSDEach + 1e-9;
        const overTotal = spent + reserved + est > maxUSD + 1e-9;
        // A contestant over its own, tighter cap is set aside alone: its estimate must not stop everyone else.
        if (overEach && (maxUSDEach < maxUSD || !overTotal)) {
          stoppedEach.add(c.id);
          counts.budgetEach++;
          slots.push(skippedEntry(c, kind, item.id, 'budget-each'));
          continue;
        }
        if (overTotal) {
          stopped = true;
          counts.budget++;
          slots.push(skippedEntry(c, kind, item.id, 'budget'));
          continue;
        }
        reserved += est;
        slots.push(answerOne({ contestant: c, kind, item, call, runCode }));
      }
      // The contestants of one item answer side by side; the results keep the fixed order.
      const done = await Promise.all(slots);
      for (const r of done) {
        results.push(r);
        if (r.skipped || reusable.get(keyOf(r.contestant, r.kind, r.itemId)) === r) continue;
        spent = round6(spent + r.costUSD);
        addSeen(r);
      }
      save();
    }
  }

  if (counts.budget) notes.push(`Parou no limite total de ${usd(maxUSD)}: ${counts.budget} tarefas ficaram de fora. Para continuar, rode de novo com --resume ${runId} e um limite maior.`);
  if (counts.budgetEach) notes.push(`${counts.budgetEach} tarefas ficaram de fora porque um participante chegou ao limite de ${usd(maxUSDEach)} por participante.`);
  if (counts.privacy) notes.push(`DeepSeek não recebeu as suas conversas (${counts.privacy} tarefas de classificar puladas): a empresa guarda os dados na China. Para incluir, use --allow-deepseek-personal.`);

  const finalResults = [...results, ...earlier.filter((r) => !planned.has(keyOf(r.contestant, r.kind, r.itemId)))];
  const ptItems = sets.find((s) => s.kind === 'pt')?.items ?? [];
  const rows = writeReports(runDir, { runId, results: finalResults, ptItems, notes, spentUSD: spent, maxUSD });
  return { runId, runDir, results: finalResults, rows, notes, spentUSD: spent };
}

const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      kinds: { type: 'string' },
      only: { type: 'string' },
      limit: { type: 'string' },
      'max-usd': { type: 'string' },
      'max-usd-each': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      resume: { type: 'string' },
      'allow-deepseek-personal': { type: 'boolean', default: false },
      'sets-dir': { type: 'string' },
      'sm-dir': { type: 'string' },
    },
  });
  const kinds = list(values.kinds) ?? [...KINDS];
  const unknown = kinds.filter((k) => !KINDS.includes(k));
  if (unknown.length) throw new Error(`unknown kind: ${unknown.join(', ')} (known: ${KINDS.join(', ')})`);
  const money = (name) => {
    if (values[name] === undefined) return undefined;
    const n = Number(values[name]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a number of dollars, 0 or more`);
    return n;
  };
  let limit = null;
  if (values.limit !== undefined) {
    limit = Number.parseInt(values.limit, 10);
    if (!(limit > 0)) throw new Error('--limit must be a whole number above 0');
  }
  if (values.resume !== undefined && !/^[a-z0-9][a-z0-9._-]*$/i.test(values.resume)) throw new Error('--resume takes a run id, like 2026-10-10-16-30-00');
  return {
    kinds,
    only: list(values.only),
    limit,
    maxUSD: money('max-usd') ?? DEFAULT_MAX_USD,
    maxUSDEach: money('max-usd-each'),
    dryRun: values['dry-run'],
    resume: values.resume ?? null,
    allowDeepseekPersonal: values['allow-deepseek-personal'],
    setsDir: values['sets-dir'],
    smDir: values['sm-dir'],
  };
}

async function main() {
  const [{ claudeDir }, { listKeys }] = await Promise.all([import('../sources/claude.mjs'), import('../ai/keys.mjs')]);
  const opts = parseCli(process.argv.slice(2));
  const smDir = opts.smDir ?? join(claudeDir(), 'session-map');
  const options = { ...opts, smDir, setsDir: opts.setsDir ?? DEFAULT_SETS_DIR };
  if (options.maxUSDEach === undefined) delete options.maxUSDEach;
  const deps = {
    call: makeCaller({ smDir }),
    keyedProviders: listKeys(smDir).map((k) => k.provider),
    buildClassify: async () => {
      const { buildClassifySet } = await import('./classify-build.mjs');
      const built = await buildClassifySet({ smDir });
      console.log(`Conjunto de classificar montado com ${built.total} conversas suas (fica só no seu computador).`);
    },
    onProgress: ({ kind, index, total, spentUSD }) => console.log(`[${kind}] ${index}/${total} · gasto até agora ${usd(spentUSD)}`),
  };
  const out = await runBench(options, deps);
  for (const n of out.notes) console.log(`- ${n}`);
  if (out.dryRun) {
    console.log(`Simulação: ${out.plan.calls} perguntas para ${out.plan.contestants.join(', ')}.`);
    console.log(`Tarefas por tipo: ${JSON.stringify(out.plan.byKind)}. Pior caso de gasto: ${usd(out.plan.worstUSD)}; o limite de ${usd(options.maxUSD)} para a rodada antes disso.`);
    return;
  }
  console.log(`Pronto. Gasto: ${usd(out.spentUSD)}. Relatório: ${join(out.runDir, 'report.md')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`O banco de medição parou: ${err.message}`);
    process.exitCode = 1;
  });
}
