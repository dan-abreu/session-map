import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { writeAtomic } from '../store.mjs';
import { contestantsFor, estimateUSD, selectContestants } from '../bench/contestants.mjs';
import { isTestFile, specialistCard, specialistForFiles } from './specialists.mjs';

// The proof that a specialist's card helps, on every AI that has a key (id158, or68). The cases are the project's own
// fix commits (a real task, with the files and tests the real fix touched); each case is asked twice, once with the card
// and once without it, and the answer is scored against what the real fix did. What it measures is the first thing a card
// is for: knowing where things live. It is single-shot (no tools), so it is cheap and the same for every AI; it is not a
// whole agentic run — that one costs a session per case and comes after this one shows a gain worth confirming.

export const ARMS = Object.freeze(['plain', 'card']);
export const DEFAULT_MAX_USD = 4;
const MAX_NAMED = 6;
const SRC_EXT = 'mjs|js|cjs|ts|tsx|jsx|css|html|json';
const SRC_RE = new RegExp(`\\.(${SRC_EXT})$`);
const NAME_RE = new RegExp(`\\b[\\w-]+\\.(${SRC_EXT}|md)\\b`, 'g');
const SKIP_RE = /^(docs|research_notes|node_modules)\/|package-lock\.json$/;
const FIX_RE = /^fix(\([^)]*\))?!?:/i;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ---- mining -------------------------------------------------------------------------------------------------------

// The task a person would have written: the commit's words, with the paths that would hand over the answer taken out.
export function scrubTask(subject, body = '') {
  const text = `${subject}\n${String(body).trim().slice(0, 500)}`;
  return text.replace(/[\w@.-]*\/[\w@./-]+/g, '<path>').replace(NAME_RE, '<file>').trim();
}

// git(args) → stdout text (injected). specialistsAt(inventory) → the specialists as they would have been listed with
// that file list, so a test added by the fix itself is not in the card. -> cases, at most `max`, at most `perSpecialist` each.
export async function mineCases({ git, arch, specialistsAt, max = 30, perSpecialist = 6, scan = 600 }) {
  const log = await git(['log', '--no-merges', '-n', String(scan), '--format=%x1e%H%x1f%P%x1f%s', '--name-only']);
  const cases = [];
  const perPart = new Map();
  const lsCache = new Map();
  const inventoryAt = async (base) => {
    if (!lsCache.has(base)) lsCache.set(base, String(await git(['ls-tree', '-r', '--name-only', base])).split(/\r?\n/).filter((p) => p && !/^(test\/fixtures|docs|research_notes|node_modules)\//.test(p) && !/\.(png|jpe?g|gif|svg|webp|woff2?|ico)$/i.test(p)));
    return lsCache.get(base);
  };
  for (const rec of String(log).split('\x1e').filter(Boolean)) {
    if (cases.length >= max) break;
    const [head, ...names] = rec.split(/\r?\n/);
    const [sha, parents, subject] = head.split('\x1f');
    const base = String(parents ?? '').split(' ')[0];
    if (!sha || !base || !FIX_RE.test(subject ?? '')) continue;
    const changed = names.map((n) => n.trim()).filter(Boolean);
    if (changed.length > 10) continue;
    const inventory = await inventoryAt(base);
    const have = new Set(inventory);
    const files = changed.filter((f) => !isTestFile(f) && SRC_RE.test(f) && !SKIP_RE.test(f) && have.has(f));
    const tests = changed.filter((f) => isTestFile(f) && have.has(f));
    if (!files.length || !tests.length || files.length > 5) continue;
    const specialists = specialistsAt(inventory);
    const specialist = specialistForFiles(files, arch, specialists);
    if (!specialist || (perPart.get(specialist.partId) ?? 0) >= perSpecialist) continue;
    const body = await git(['show', '-s', '--format=%b', sha]);
    perPart.set(specialist.partId, (perPart.get(specialist.partId) ?? 0) + 1);
    cases.push({ id: sha.slice(0, 8), sha, base, partId: specialist.partId, specialistId: specialist.id, task: scrubTask(subject.replace(FIX_RE, '').trim(), body), truth: { files, tests }, inventory, card: specialistCard(specialist) });
  }
  return cases;
}

// ---- asking and scoring -------------------------------------------------------------------------------------------

export const SCHEMA_HINT = '{"files": ["path"], "tests": ["path"]}';

export function promptFor(item, arm) {
  return [
    'You are a coding agent about to start work in a repository. You cannot run commands now: answer from the list of the repository\'s files alone.',
    ...(arm === 'card' ? ['', 'Your standing instructions for this work:', item.card] : []),
    '', 'TASK:', item.task,
    '', "THE REPOSITORY'S FILES:", item.inventory.join('\n'),
    '', `Name the source files you would change (at most ${MAX_NAMED}) and the existing test files you would run (at most ${MAX_NAMED}). Use exact paths from the list above.`,
  ].join('\n');
}

const named = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map((x) => x.trim().replaceAll('\\', '/')).filter(Boolean))].slice(0, MAX_NAMED);

function f1(said, truth) {
  if (!truth.length) return null;
  const hit = said.filter((p) => truth.includes(p)).length;
  if (!hit) return 0;
  const precision = hit / said.length;
  const recall = hit / truth.length;
  return (2 * precision * recall) / (precision + recall);
}

// The score of one answer against the real fix: the files (60 %) and the tests (40 %), each as F1 — naming many wrong files
// costs as much as missing the right ones. `invalid`: paths that are not in the repository, the cost of guessing.
export function scoreLocate(item, value) {
  if (!value || typeof value !== 'object' || (!Array.isArray(value.files) && !Array.isArray(value.tests))) return { score: 0, badShape: true };
  const files = named(value.files);
  const tests = named(value.tests);
  const have = new Set(item.inventory);
  const filesF1 = f1(files, item.truth.files) ?? 0;
  const testsF1 = f1(tests, item.truth.tests);
  const score = testsF1 === null ? filesF1 : 0.6 * filesF1 + 0.4 * testsF1;
  return { score: round6(score), filesF1: round6(filesF1), testsF1: testsF1 === null ? null : round6(testsF1), invalid: [...files, ...tests].filter((p) => !have.has(p)).length };
}

// ---- running ------------------------------------------------------------------------------------------------------

export const evalDir = (smDir) => join(smDir, 'spec-eval');
export const casesFile = (smDir) => join(evalDir(smDir), 'cases.json');
export const runDirOf = (smDir, runId) => join(evalDir(smDir), 'runs', String(runId).replace(/[^a-z0-9._-]/gi, '_'));
const keyOf = (contestant, arm, caseId) => `${contestant}|${arm}|${caseId}`;
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };

// options: smDir, cases, only, limit, maxUSD, maxUSDEach, dryRun, resume. deps: call (bench makeCaller), keyedProviders.
// The caps are the bench's: nothing is asked when its worst-case price would pass the total or the contestant's share.
export async function runSpecEval(options = {}, deps = {}) {
  const { smDir, only = null, limit = null, maxUSD = DEFAULT_MAX_USD, dryRun = false, resume = null } = options;
  if (!smDir) throw new Error('runSpecEval needs smDir');
  const { call, keyedProviders = [], onProgress = () => {} } = deps;
  const all = Array.isArray(options.cases) ? options.cases : readJson(casesFile(smDir), []);
  const cases = limit ? all.slice(0, limit) : all;
  const { chosen, missing } = selectContestants(contestantsFor(keyedProviders), only);
  const maxUSDEach = options.maxUSDEach ?? (chosen.length > 1 ? maxUSD / 2 : maxUSD);
  const notes = missing.map((id) => `${id} is not available: the company's key is missing or the name is wrong.`);
  const runId = resume ?? options.runId ?? new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const runDir = runDirOf(smDir, runId);
  const earlierFile = resume ? readJson(join(runDir, 'results.json'), {}) : {};
  const earlier = Array.isArray(earlierFile.results) ? earlierFile.results : [];
  const done = new Map(earlier.filter((r) => r.ok).map((r) => [keyOf(r.contestant, r.arm, r.caseId), r]));

  if (dryRun) {
    const plan = { calls: 0, worstUSD: 0, cases: cases.length, contestants: chosen.map((c) => c.id) };
    for (const item of cases) for (const arm of ARMS) for (const c of chosen) {
      if (done.has(keyOf(c.id, arm, item.id))) continue;
      plan.calls++;
      plan.worstUSD += estimateUSD(c, promptFor(item, arm));
    }
    plan.worstUSD = round6(plan.worstUSD);
    return { runId, runDir, dryRun: true, plan, notes, results: [] };
  }
  if (!call) throw new Error('runSpecEval needs a call function');

  let spent = round6(Number(earlierFile.spentUSD) || earlier.reduce((s, r) => s + (Number(r.costUSD) || 0), 0));
  const spentEach = new Map();
  for (const r of earlier) spentEach.set(r.contestant, round6((spentEach.get(r.contestant) ?? 0) + (Number(r.costUSD) || 0)));
  const seen = new Map();
  for (const r of earlier) if (r.ok) { const k = r.contestant; if (!seen.has(k)) seen.set(k, []); seen.get(k).push({ costUSD: r.costUSD, chars: r.promptChars }); }
  const results = [];
  let stopped = false;
  const stoppedEach = new Set();
  const save = () => writeAtomic(join(runDir, 'results.json'), `${JSON.stringify({ runId, updatedAt: new Date().toISOString(), spentUSD: spent, results: [...results, ...earlier.filter((r) => !results.some((x) => keyOf(x.contestant, x.arm, x.caseId) === keyOf(r.contestant, r.arm, r.caseId)))] }, null, 1)}\n`);

  for (const [n, item] of cases.entries()) {
    onProgress({ index: n + 1, total: cases.length, caseId: item.id, spentUSD: spent });
    for (const arm of ARMS) {
      const prompt = promptFor(item, arm);
      let reserved = 0;
      const slots = [];
      for (const c of chosen) {
        if (done.has(keyOf(c.id, arm, item.id))) continue;
        if (stopped) continue;
        const est = estimateUSD(c, prompt, seen.get(c.id) ?? []);
        const overEach = stoppedEach.has(c.id) || (spentEach.get(c.id) ?? 0) + est > maxUSDEach + 1e-9;
        const overTotal = spent + reserved + est > maxUSD + 1e-9;
        if (overEach && (maxUSDEach < maxUSD || !overTotal)) { stoppedEach.add(c.id); continue; }
        if (overTotal) { stopped = true; continue; }
        reserved += est;
        slots.push((async () => {
          const started = Date.now();
          const res = await call(c, prompt, SCHEMA_HINT);
          const base = { contestant: c.id, arm, caseId: item.id, partId: item.partId, promptChars: prompt.length, ok: Boolean(res.ok), costUSD: round6(Number(res.costUSD) || 0), ms: Date.now() - started, error: res.ok ? null : (res.error ?? 'failed') };
          if (!res.ok) return { ...base, score: 0 };
          const scored = scoreLocate(item, res.value);
          return { ...base, ...scored, ...(scored.badShape ? { ok: false, error: 'bad-shape' } : {}) };
        })());
      }
      for (const r of await Promise.all(slots)) {
        results.push(r);
        spent = round6(spent + r.costUSD);
        spentEach.set(r.contestant, round6((spentEach.get(r.contestant) ?? 0) + r.costUSD));
        if (r.ok) { if (!seen.has(r.contestant)) seen.set(r.contestant, []); seen.get(r.contestant).push({ costUSD: r.costUSD, chars: r.promptChars }); }
      }
    }
    save();
  }
  if (stopped) notes.push(`Stopped at the total cap of $${maxUSD}: run again with --resume ${runId} and a bigger cap to finish.`);
  if (stoppedEach.size) notes.push(`${[...stoppedEach].join(', ')} reached the per-contestant cap of $${round6(maxUSDEach)}.`);
  save();
  const final = [...results, ...earlier.filter((r) => !results.some((x) => keyOf(x.contestant, x.arm, x.caseId) === keyOf(r.contestant, r.arm, r.caseId)))];
  return { runId, runDir, results: final, notes, spentUSD: spent };
}

// ---- the verdict --------------------------------------------------------------------------------------------------

export const MIN_PAIRS = 8;
export const MIN_GAIN = 0.05;

// Per contestant, over the cases both arms answered: the mean of each arm, the gain, and the verdict. 'on': the card gains
// at least MIN_GAIN and wins more cases than it loses; 'off': it does not gain or it loses more than it wins;
// 'unproven': too few pairs to say. Pooled over all specialists — the per-part rows are information, not a verdict.
export function summarizeSpecEval(results) {
  const rows = [];
  for (const contestant of [...new Set(results.map((r) => r.contestant))].sort()) {
    const mine = results.filter((r) => r.contestant === contestant && r.ok);
    const by = new Map();
    for (const r of mine) { if (!by.has(r.caseId)) by.set(r.caseId, {}); by.get(r.caseId)[r.arm] = r; }
    const pairs = [...by.values()].filter((p) => p.plain && p.card);
    const mean = (arm) => (pairs.length ? round6(pairs.reduce((s, p) => s + p[arm].score, 0) / pairs.length) : null);
    const wins = pairs.filter((p) => p.card.score > p.plain.score + 1e-9).length;
    const losses = pairs.filter((p) => p.card.score < p.plain.score - 1e-9).length;
    const gain = pairs.length ? round6(mean('card') - mean('plain')) : null;
    const verdict = pairs.length < MIN_PAIRS ? 'unproven' : gain >= MIN_GAIN && wins > losses ? 'on' : 'off';
    const parts = [...new Set(pairs.map((p) => p.card.partId))].sort().map((partId) => {
      const sub = pairs.filter((p) => p.card.partId === partId);
      return { partId, pairs: sub.length, gain: round6(sub.reduce((s, p) => s + p.card.score - p.plain.score, 0) / sub.length) };
    });
    rows.push({
      contestant, pairs: pairs.length, plain: mean('plain'), card: mean('card'), gain, wins, losses, ties: pairs.length - wins - losses, verdict,
      invalidPlain: pairs.reduce((s, p) => s + (p.plain.invalid ?? 0), 0), invalidCard: pairs.reduce((s, p) => s + (p.card.invalid ?? 0), 0),
      costUSD: round6(results.filter((r) => r.contestant === contestant).reduce((s, r) => s + (Number(r.costUSD) || 0), 0)), parts,
    });
  }
  return rows;
}

export function reportMarkdown({ runId, rows, notes = [], spentUSD = 0 }) {
  const pct = (n) => (n === null ? '—' : n.toFixed(2));
  const out = [`# Specialist card A/B — run ${runId}`, '', `Spent: $${round6(spentUSD)}. A card is switched on for an AI when it gains at least ${MIN_GAIN} and wins more cases than it loses, over at least ${MIN_PAIRS} cases.`, '',
    '| AI | cases | without card | with card | gain | wins/losses/ties | wrong paths (without → with) | verdict |', '|---|---|---|---|---|---|---|---|'];
  for (const r of rows) out.push(`| ${r.contestant} | ${r.pairs} | ${pct(r.plain)} | ${pct(r.card)} | ${r.gain === null ? '—' : (r.gain >= 0 ? '+' : '') + r.gain.toFixed(2)} | ${r.wins}/${r.losses}/${r.ties} | ${r.invalidPlain} → ${r.invalidCard} | ${r.verdict} |`);
  if (rows.length) {
    out.push('', 'Gain by part (informational, few cases each):', '');
    for (const r of rows) out.push(`- ${r.contestant}: ${r.parts.map((p) => `${p.partId} ${p.gain >= 0 ? '+' : ''}${p.gain.toFixed(2)} (${p.pairs})`).join(', ') || 'no pairs'}`);
  }
  if (notes.length) out.push('', ...notes.map((n) => `- ${n}`));
  return `${out.join('\n')}\n`;
}
