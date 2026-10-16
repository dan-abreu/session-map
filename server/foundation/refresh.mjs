import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { parse, resolve } from 'node:path';
import { log } from '../log.mjs';
import { ownersOf } from '../arch/attach.mjs';
import { readArch } from '../arch/detect.mjs';
import { withLocalParts } from '../arch/local.mjs';
import { topLevelOf } from '../collect.mjs';
import { loadConfig } from '../config.mjs';
import { FILE_MAX, isSecretsFile, safeResolve } from '../files.mjs';
import { mainBranch } from '../sources/git.mjs';
import { writeAtomic } from '../store.mjs';
import { blockSteps } from './blocks.mjs';
import { censusOf, diffCensus, trimLog } from './census.mjs';
import { readDocs } from './docwatch.mjs';
import { extractAll } from './extract/index.mjs';
import { ledgerDocument, lineCharsOf } from './ledger.mjs';
import { crossCheck, crossCheckImports, depcruiseLinks, depcruiseSources, markDivergent, runOptional, sccTotals } from './optional.mjs';
import { sectionsOf } from './sections.mjs';
import { fdPath, readFd, writeFd } from './store.mjs';

// The foundation's reading round for one project (index § 1): census -> facts -> model -> health, versions, profile ->
// up to date. Each block appends its step here, in that order: { name, run(ctx) }. What a step returns lands in
// ctx.results[name] for the steps after it. The shell itself writes nothing.
// The reading step of block 1 (readStep, below) always runs first, then the blocks of blocks.mjs (model, versions, guide,
// health, "Tudo em dia?"); STEPS holds what anything else adds after them.
export const STEPS = [];
export const MIN_GAP_MS = 30_000;

// smDir|projectId -> { running: Promise | null, startedAt }
const rounds = new Map();

function refusal(key, nowMs) {
  const round = rounds.get(key);
  if (round?.running) return 'running';
  if (round && nowMs - round.startedAt < MIN_GAP_MS) return 'too-soon';
  return null;
}

async function runSteps(project, smDir, steps, careMode) {
  const ctx = { project, smDir, careMode, results: {} };
  const report = [];
  for (const step of steps) {
    const started = Date.now();
    try {
      ctx.results[step.name] = await step.run(ctx);
      report.push({ name: step.name, ok: true, ms: Date.now() - started });
    } catch (err) {
      // One broken step must not leave the others unread.
      log('warn', 'foundation-step-failed', { projectId: project.id, step: step.name, error: err.message });
      report.push({ name: step.name, ok: false, ms: Date.now() - started, error: err.message });
    }
  }
  return { ran: true, steps: report };
}

// careMode: the care mode to use in memory for this round, without writing care.json (the B7 proof runs this way).
export function refreshFoundation(project, smDir, { steps = [readStep(), ...blockSteps(), ...STEPS], careMode, now = Date.now } = {}) {
  const key = `${smDir}|${project.id}`;
  const reason = refusal(key, now());
  if (reason) return Promise.resolve({ ran: false, reason });
  const round = { startedAt: now(), running: null };
  rounds.set(key, round);
  round.running = runSteps(project, smDir, steps, careMode).finally(() => { round.running = null; });
  return round.running;
}

// For POST refresh: answers at once whether a round started; the round goes on in the background.
export function startRefresh(project, smDir, opts = {}) {
  const reason = refusal(`${smDir}|${project.id}`, (opts.now ?? Date.now)());
  if (reason) return { started: false, reason };
  refreshFoundation(project, smDir, opts).catch((err) => log('warn', 'foundation-refresh-failed', { projectId: project.id, error: err.message }));
  return { started: true };
}

// ---------- block 1: read the code (fd01, fd02, fd12) ----------
// census -> facts -> sections -> read ledger, all under brain/<id>/foundation/. Nothing is written in the project.

const sameJson = (a, b) => JSON.stringify({ ...a, generatedAt: null }) === JSON.stringify({ ...b, generatedAt: null });
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };
// A chat opened in the home folder or at a disk root makes it a project, but its code is the whole computer:
// counting it walks every cache and library on the disk and never ends.
const sameDir = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
function tooWide(root) {
  const full = resolve(root);
  return sameDir(full, resolve(homedir())) || sameDir(full, parse(full).root);
}

// owner of every counted file: one part each (the same ownersOf the boxes' sizes use), null for none
function ownersFor(census, arch, topLevel) {
  const paths = census.files.filter((f) => f.included).map((f) => f.path);
  const owners = ownersOf(paths, arch, { topLevel });
  return new Map(paths.map((p, i) => [p, owners[i] ?? null]));
}

// The owners come from the list of files and the list comes from the census, so the census is taken once with the owners
// of the last round and, only if some file's owner moved, once more (every row reused, nothing reread) with the new ones.
async function censusWithOwners(root, prev, arch, topLevel, at, vendored = []) {
  const known = new Map((prev?.files ?? []).map((f) => [f.path, f.owner ?? null]));
  const first = await censusOf(root, prev, { owners: known, now: at, vendored });
  const fresh = ownersFor(first, arch, topLevel);
  if (first.files.every((f) => !f.included || (f.owner ?? null) === fresh.get(f.path))) return first;
  const second = await censusOf(root, first, { owners: fresh, now: at, vendored });
  // against the last round the rev moves once, however many passes it took
  if (!Number.isInteger(prev?.rev) || first.rev > prev.rev) second.rev = first.rev;
  return second;
}

// The statement: one JSON line per rev. A line left by a round that died before census.json is replaced, not repeated.
function appendLog(smDir, projectId, line) {
  const path = fdPath(smDir, projectId, 'census-log.jsonl');
  let kept = [];
  try {
    kept = readFileSync(path, 'utf8').split('\n').filter((l) => {
      try { return l.trim() && JSON.parse(l).rev < line.rev; } catch { return false; }
    });
  } catch { /* no statement yet */ }
  writeAtomic(path, `${trimLog([...kept, JSON.stringify(line)]).join('\n')}\n`);
}

const sameFacts = (a, b) => {
  const x = Object.entries(a?.files ?? {});
  return !!a && a.censusRev === b.censusRev && x.length === Object.keys(b.files).length
    && x.every(([path, e]) => b.files[path]?.sha === e.sha && b.files[path]?.extractor === e.extractor && b.files[path]?.ws === e.ws);
};

// The text of a partly read file, to count its read lines: never a secret, never outside the root, never too big.
const lineCharsFrom = (root) => (path) => {
  if (isSecretsFile(path)) return null;
  const abs = safeResolve(root, path);
  if (!abs || isSecretsFile(abs)) return null;
  try {
    if (statSync(abs).size > FILE_MAX) return null;
    return lineCharsOf(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
};

// scc and dependency-cruiser, only if already installed: they can mark an import of ours AMBIGUOUS, never replace it.
async function crossChecked(root, census, facts, optional) {
  const out = { facts, lineDiffs: 0, importDiffs: 0 };
  try {
    const scc = await runOptional('scc', root, ['--by-file', '--format', 'json'], optional);
    if (scc) out.lineDiffs = crossCheck(census, sccTotals(scc)).length;
    const dep = await runOptional('depcruise', root, ['--output-type', 'json', '.'], optional);
    if (dep) {
      const diff = crossCheckImports(facts, depcruiseLinks(dep), depcruiseSources(dep));
      out.importDiffs = diff.onlyOurs.length;
      out.facts = markDivergent(facts, diff);
    }
  } catch (err) {
    log('warn', 'foundation-optional-failed', { error: err.message });
  }
  return out;
}

// readText: injected by a test to prove which files the readers open. optional: { which, exec } for the tools.
export function readStep({ now = () => new Date(), optional = {}, readText } = {}) {
  return {
    name: 'read',
    async run({ project, smDir }) {
      const root = project?.root;
      if (typeof root !== 'string' || !isDir(root)) throw new Error('no-root');
      if (tooWide(root)) throw new Error('too-wide');
      const id = project.id;
      const at = now();
      const config = loadConfig(root, smDir);
      const arch = withLocalParts(await readArch(root, config, { mainBranch: await mainBranch(root) }), smDir, id);
      const prev = readFd(smDir, id, 'census.json', null);
      const census = await censusWithOwners(root, prev, arch, topLevelOf(root), at, config.vendored);
      const moved = !Number.isInteger(prev?.rev) || census.rev !== prev.rev;
      if (moved) {
        appendLog(smDir, id, diffCensus(prev, census));
        writeFd(smDir, id, 'census.json', census);
      }

      const prevFacts = readFd(smDir, id, 'facts.json', null);
      let facts = extractAll(root, census, prevFacts, { now: at, ...(readText ? { readText } : {}) });
      let cross = { lineDiffs: 0, importDiffs: 0 };
      if (sameFacts(prevFacts, facts)) {
        facts = prevFacts;
      } else {
        cross = await crossChecked(root, census, facts, optional);
        facts = cross.facts;
        writeFd(smDir, id, 'facts.json', facts);
      }

      const sections = sectionsOf(facts, census, arch, { docs: readDocs(root, census).docs, now: at });
      const prevSections = readFd(smDir, id, 'sections.json', null);
      if (!prevSections || !sameJson(prevSections, sections)) writeFd(smDir, id, 'sections.json', sections);

      // The ledger is the AI rounds' to write; the census only keeps it honest: an entry whose file changed is dropped.
      const ledger = readFd(smDir, id, 'read-ledger.json', null);
      let percent = null;
      if (ledger && typeof ledger === 'object') {
        const doc = ledgerDocument(ledger, census, { lineChars: lineCharsFrom(root), now: at });
        if (!sameJson(ledger, doc)) writeFd(smDir, id, 'read-ledger.json', doc);
        percent = doc.summary.percent;
      }
      return { rev: census.rev, moved, files: census.sums.total.files, facts: facts.facts.length, readPercent: percent, lineDiffs: cross.lineDiffs, importDiffs: cross.importDiffs };
    },
  };
}
