#!/usr/bin/env node
// The measuring bench (or12): every chosen AI does the same session-map tasks, in the same order, under a hard money
// cap, and the owner gets accuracy and cost per right answer for each. See docs/architecture/orchestration.md.
//
//   node server/bench/run.mjs [--kinds classify,code,review,pt,plan] [--only claude:haiku,openai:gpt-6-luna] [--limit N]
//                             [--max-usd 8] [--max-usd-each N] [--dry-run] [--resume <runId>] [--allow-deepseek-personal]
//                             [--redo <contestants>] [--new-money]
//   --redo asks again every answer of these contestants (their request settings changed); --new-money makes the caps count
//   only what this run spends, so a resumed run is not stopped by what it already cost. openai:gpt-6-astra takes part only
//   when named in --only.
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
export const routingFileOf = (smDir) => join(benchDir(smDir), 'routing.json');

// Failures worth asking again when a run is resumed: the way there broke, not the model's answer. ('timeout' is the
// call's own; code that runs too long in the sandbox is 'tests-timeout', the answer's fault, and is kept.)
const RETRY_ERRORS = new Set(['timeout', 'network', 'spawn-failed', 'crashed', 'claude-not-found', 'no-key', 'http-408', 'http-429', 'no-json', 'bad-output', 'answer-cut']);
// The sandbox broke on this machine: the stored answer is tested again on resume, unless it was stored cut short.
const SANDBOX_ERRORS = new Set(['sandbox-failed', 'sandbox-spawn-failed', 'sandbox-unsupported']);
const retestable = (r) => r.kind === 'code' && SANDBOX_ERRORS.has(r.error) && typeof r.answer === 'string' && !r.answerCut;
const retryable = (r) => Boolean(r.skipped) || RETRY_ERRORS.has(r.error) || /^http-5\d\d$/.test(r.error ?? '')
  || (SANDBOX_ERRORS.has(r.error) && !retestable(r));
// Failures after which the call may have been billed with no bill coming back.
const MAYBE_BILLED = new Set(['timeout', 'network', 'bad-output', 'crashed']);

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const usd = (n) => `US$ ${n.toFixed(2).replace('.', ',')}`;

const CODE_SCHEMA = '{"code": "<the complete ES module, exporting the function>"}';
const REVIEW_SCHEMA = '{"bugs": [{"line": 12, "why": "one short sentence"}]}';
const PT_SCHEMA = '{"text": "..."}';
const PLAN_SCHEMA = '{"summary": "one or two sentences", "tasks": [{"task": "what is done", "model": "haiku|sonnet|opus", "effort": "low|medium|high", "why": "one short sentence"}], "agents": 3, "waitsForApproval": true, "questions": ["at most two, only if needed"]}';
// The level each Claude model plans at (or30): the cheap one thinks little, the dear one thinks hard. Outside AIs have no such knob.
export const PLAN_EFFORT = Object.freeze({ haiku: 'low', sonnet: 'medium', opus: 'high' });

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
  if (kind === 'plan') {
    return {
      prompt: [
        "You are the planner of session-map, a tool that runs coding agents for a business owner who does not program. The owner asked, in Brazilian Portuguese:",
        '',
        `"${item.request}"`,
        '',
        'Write the plan to do this work. Do not build anything yet: the owner approves the plan first.',
        'Rules: split the work into tasks; give each task the cheapest Claude model (haiku, sonnet or opus) and effort (low, medium or high) that does it well; work on security or money gets a stronger model; use at most 10 agents. Write the plan in the language of the request.',
      ].join('\n'),
      schemaHint: PLAN_SCHEMA,
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

// What the router reads (server/ai/router.mjs loadStats): one entry per kind and contestant this run measured,
// merged into the file. A measure replaces the one already there unless that one came from a later run (run ids
// are times). A kind with no right answer is booked at its whole cost: the dearest it could be per right answer.
export function writeRouting(smDir, rows, { runId, now = new Date() } = {}) {
  const path = routingFileOf(smDir);
  const before = readJson(path, {});
  const entries = Array.isArray(before?.entries) ? before.entries.filter((e) => e && typeof e === 'object') : [];
  for (const r of rows) {
    if (!r.tried) continue;
    const entry = { kind: r.kind, contestant: r.contestant, accuracy: r.accuracy, costPerCorrectUSD: r.correct ? r.costPerCorrect : r.costUSD, n: r.tried, runId };
    const i = entries.findIndex((e) => e.kind === r.kind && e.contestant === r.contestant);
    if (i < 0) entries.push(entry);
    else if (!(typeof entries[i].runId === 'string' && entries[i].runId > runId)) entries[i] = entry;
  }
  writeAtomic(path, `${JSON.stringify({ updatedAt: now.toISOString(), entries }, null, 1)}\n`);
  return entries;
}

// The model-written code run against the item's tests. expectedTests: how many tests the reference saw.
async function testCode({ base, item, code, runCode, expectedTests }) {
  const kept = { answer: code.slice(0, CODE_KEEP_CHARS), ...(code.length > CODE_KEEP_CHARS ? { answerCut: true } : {}) };
  let run;
  try {
    run = await runCode({ code, tests: item.tests, expectedTests });
  } catch {
    return { ...base, error: 'sandbox-failed', ...kept };
  }
  const scored = scoreAnswer('code', item, run);
  return { ...base, ...scored, error: run.ok ? null : (run.error ?? 'tests-failed'), testMs: run.ms, ...kept };
}

// One answer, scored. Only ids, the score and the short answer are kept: never the prompt (its length, a plain number,
// is kept to size the next estimate). est: what was reserved for this call under the caps.
async function answerOne({ contestant, kind, item, call, runCode, est = 0, expectedTests = null }) {
  const { prompt, schemaHint } = promptFor(kind, item);
  const started = Date.now();
  const effort = kind === 'plan' && contestant.via === 'claude' ? PLAN_EFFORT[contestant.model] : undefined;
  const res = await call(contestant, prompt, schemaHint, effort ? { effort } : undefined);
  const ms = Date.now() - started;
  const error = res.ok ? null : (res.error ?? 'failed');
  const billed = Number(res.costUSD) || 0;
  // A call that broke after it was sent may have been billed though no bill came back: the reservation is booked.
  const guessed = !res.ok && billed <= 0 && MAYBE_BILLED.has(error);
  const base = {
    contestant: contestant.id, kind, itemId: item.id, promptChars: prompt.length, ok: Boolean(res.ok), score: 0,
    costUSD: round6(guessed ? est : billed), ...(guessed ? { costEstimated: true } : {}), ms, error,
  };
  if (!res.ok) return base;
  if (kind === 'code') {
    const code = typeof res.value?.code === 'string' ? unfence(res.value.code) : null;
    if (!code) return { ...base, ok: false, error: 'no-code' };
    return testCode({ base, item, code, runCode, expectedTests });
  }
  const scored = scoreAnswer(kind, item, res.value);
  return { ...base, ...scored, ...(scored.badShape ? { ok: false, error: 'bad-shape' } : {}) };
}

// A stored code answer whose test run broke on this machine is tested again, not asked again: same answer, same cost.
function retestCode(earlier, { item, runCode, expectedTests }) {
  const pick = ['contestant', 'kind', 'itemId', 'promptChars', 'costUSD', 'costEstimated', 'ms'];
  const base = { ...Object.fromEntries(pick.filter((k) => k in earlier).map((k) => [k, earlier[k]])), ok: true, score: 0, error: null };
  return testCode({ base, item, code: earlier.answer, runCode, expectedTests });
}

const skippedEntry = (contestant, kind, itemId, reason) => ({ contestant: contestant.id, kind, itemId, ok: false, score: 0, costUSD: 0, ms: 0, error: null, skipped: reason });

export async function runBench(options = {}, deps = {}) {
  const {
    smDir, setsDir = DEFAULT_SETS_DIR, kinds = KINDS, only = null, limit = null, maxUSD = DEFAULT_MAX_USD,
    dryRun = false, resume = null, allowDeepseekPersonal = false, redo = null, newMoney = false,
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
  // --redo: what these contestants answered before is thrown away and asked again (their cost stays in the books).
  const redoIds = new Set(Array.isArray(redo) ? redo : []);
  for (const id of redoIds) if (!chosen.some((c) => c.id === id)) notes.push(`--redo ${id}: esse participante não está nesta rodada (falta a chave, o nome está errado ou ficou de fora do --only); nada foi refeito para ele.`);

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
  const reusable = new Map(earlier.filter((r) => !retryable(r) && !redoIds.has(r.contestant)).map((r) => [keyOf(r.contestant, r.kind, r.itemId), r]));

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
    runId, kinds: sets.map((s) => s.kind), contestants: chosen.map((c) => c.id), limit, maxUSD, maxUSDEach, allowDeepseekPersonal, ...(redoIds.size ? { redo: [...redoIds] } : {}), ...(newMoney ? { newMoney } : {}),
    sets: Object.fromEntries(sets.map((s) => [s.kind, s.items.map((i) => i.id)])), startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  // The cap is for the whole run: what earlier attempts cost counts, even for answers now asked again. With --only,
  // what the other contestants cost is left out of it (money the file cannot put on anyone still counts), so a
  // contestant added to an old run is measured under the cap given now.
  let spent = round6(Math.max(Number(earlierFile.spentUSD) || 0, earlier.reduce((s, r) => s + (Number(r.costUSD) || 0), 0)));
  const spentEach = new Map();
  const seen = new Map(); // contestant + kind -> real bills so far ({ costUSD, chars }), for the next estimate
  const addSeen = (r) => {
    const k = `${r.contestant}\u0000${r.kind}`;
    if (!seen.has(k)) seen.set(k, []);
    // A booked reservation is not a bill: feeding it back would grow every next estimate by the margin again.
    if (!r.costEstimated) seen.get(k).push({ costUSD: Number(r.costUSD) || 0, chars: Number(r.promptChars) || 0 });
    spentEach.set(r.contestant, round6((spentEach.get(r.contestant) ?? 0) + (Number(r.costUSD) || 0)));
  };
  for (const r of earlier) if (!r.skipped) addSeen(r);
  // Each contestant's own book: it keeps the cost of answers thrown away and asked again, which the results lose.
  for (const [id, v] of Object.entries(earlierFile.spentEachUSD ?? {})) {
    if (Number.isFinite(v) && v > (spentEach.get(id) ?? 0)) spentEach.set(id, round6(v));
  }
  const chosenIds = new Set(chosen.map((c) => c.id));
  // --new-money: the caps count only what this run spends from here on, not what the run already cost.
  const spentBefore = newMoney ? spent : 0;
  const eachBefore = newMoney ? new Map(spentEach) : new Map();
  if (newMoney) notes.push(`O limite de ${usd(maxUSD)} vale só o gasto desta rodada (--new-money): a medição já tinha custado ${usd(spent)} antes.`);
  const notCounted = only?.length && !newMoney ? round6([...spentEach].filter(([id]) => !chosenIds.has(id)).reduce((s, [, v]) => s + v, 0)) : 0;

  // Each code item's reference is run once, before any answer is tested: it proves the tests are right and gives the
  // number of tests a true run reports. null: not known (no reference, or the sandbox broke); 'broken': the set is wrong.
  const expected = new Map();
  const expectedFor = (item) => {
    if (!expected.has(item.id)) {
      expected.set(item.id, (async () => {
        if (typeof item.reference !== 'string') return null;
        try {
          const run = await runCode({ code: item.reference, tests: item.tests });
          return run.ok ? run.total : SANDBOX_ERRORS.has(run.error) ? null : 'broken';
        } catch {
          return null;
        }
      })());
    }
    return expected.get(item.id);
  };
  const carried = new WeakSet(); // results whose cost the earlier run already counted
  for (const r of reusable.values()) carried.add(r);

  const results = [];
  const planned = new Set();
  const save = () => {
    const rest = earlier.filter((r) => !planned.has(keyOf(r.contestant, r.kind, r.itemId)));
    writeAtomic(join(runDir, 'results.json'), `${JSON.stringify({ runId, updatedAt: new Date().toISOString(), spentUSD: spent, spentEachUSD: Object.fromEntries(spentEach), results: [...results, ...rest] }, null, 1)}\n`);
  };
  let stopped = false;
  const stoppedEach = new Set();
  const counts = { privacy: 0, budget: 0, budgetEach: 0 };
  const brokenItems = [];

  for (const { kind, items } of sets) {
    for (const [n, item] of items.entries()) {
      onProgress({ kind, index: n + 1, total: items.length, itemId: item.id, spentUSD: spent });
      const { prompt } = promptFor(kind, item);
      const slots = [];
      let reserved = 0;
      const keyFor = (c) => keyOf(c.id, kind, item.id);
      const needsTests = kind === 'code' && chosen.some((c) => !reusable.has(keyFor(c)) || retestable(reusable.get(keyFor(c))));
      const expectedTests = needsTests ? await expectedFor(item) : null;
      if (expectedTests === 'broken') brokenItems.push(item.id);
      for (const c of chosen) {
        const key = keyFor(c);
        planned.add(key);
        const before = reusable.get(key);
        if (before && retestable(before) && expectedTests !== 'broken') {
          slots.push(retestCode(before, { item, runCode, expectedTests }).then((r) => { carried.add(r); return r; }));
          continue;
        }
        if (before) { slots.push(before); continue; }
        if (expectedTests === 'broken') { slots.push(skippedEntry(c, kind, item.id, 'broken-item')); continue; }
        if (!allowedFor(c, kind, { allowDeepseekPersonal })) { counts.privacy++; slots.push(skippedEntry(c, kind, item.id, 'privacy')); continue; }
        if (stopped) { counts.budget++; slots.push(skippedEntry(c, kind, item.id, 'budget')); continue; }
        const est = estimateUSD(c, prompt, seen.get(`${c.id}\u0000${kind}`) ?? []);
        const overEach = stoppedEach.has(c.id) || (spentEach.get(c.id) ?? 0) - (eachBefore.get(c.id) ?? 0) + est > maxUSDEach + 1e-9;
        const overTotal = Math.max(0, spent - spentBefore - notCounted) + reserved + est > maxUSD + 1e-9;
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
        slots.push(answerOne({ contestant: c, kind, item, call, runCode, est, expectedTests: typeof expectedTests === 'number' ? expectedTests : null }));
      }
      // The contestants of one item answer side by side; the results keep the fixed order.
      const done = await Promise.all(slots);
      for (const r of done) {
        results.push(r);
        if (r.skipped || carried.has(r)) continue;
        spent = round6(spent + r.costUSD);
        addSeen(r);
      }
      save();
    }
  }

  if (counts.budget) notes.push(`Parou no limite total de ${usd(maxUSD)}: ${counts.budget} tarefas ficaram de fora. Para continuar, rode de novo com --resume ${runId} e um limite maior.`);
  if (counts.budgetEach) notes.push(`${counts.budgetEach} tarefas ficaram de fora porque um participante chegou ao limite de ${usd(maxUSDEach)} por participante.`);
  const guessedBills = results.filter((r) => r.costEstimated && !carried.has(r)).length;
  if (guessedBills) notes.push(`${guessedBills} perguntas quebraram depois de enviadas, sem conta de volta: o gasto delas foi contado pela estimativa, para o limite não ser furado.`);
  if (brokenItems.length) notes.push(`Tarefas de código com defeito no próprio conjunto (a solução de referência não passou nos testes dela): ${brokenItems.join(', ')}. Ficaram de fora para todos.`);
  if (counts.privacy) notes.push(`DeepSeek não recebeu as suas conversas (${counts.privacy} tarefas de classificar puladas): a empresa guarda os dados na China. Para incluir, use --allow-deepseek-personal.`);

  const finalResults = [...results, ...earlier.filter((r) => !planned.has(keyOf(r.contestant, r.kind, r.itemId)))];
  const ptItems = sets.find((s) => s.kind === 'pt')?.items ?? [];
  const rows = writeReports(runDir, { runId, results: finalResults, ptItems, notes, spentUSD: spent, maxUSD });
  writeRouting(smDir, rows, { runId });
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
      redo: { type: 'string' },
      'new-money': { type: 'boolean', default: false },
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
    redo: list(values.redo),
    newMoney: values['new-money'],
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
