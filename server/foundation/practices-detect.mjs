import { statusOf } from './library.mjs';

// B5-T9: the closed set of detectors behind a best practice. One pure function per `detect.kind`; the only input is what
// the caller hands in (census, a text reader, health.json, dependencies, facts, stacks), so nothing here touches the disk.
// The rule that decides every branch: what could not be verified is `unverified` with a reason, never `fail`.

export const REASONS = ['no-data', 'needs-human', 'stale-source', 'attest-expired', 'no-token', 'no-network', 'tool-missing', 'not-applicable'];

// ponytail: convention. Reading caps so a huge repository cannot stall a refresh: past them the answer is "unverified".
const MAX_FILES = 300;
const MAX_CHARS_TOTAL = 3_000_000;
const MAX_CHARS_FILE = 256_000;
const MAX_EVIDENCE = 5;

const list = (v) => (Array.isArray(v) ? v : []);
const ok = (evidence) => ({ state: 'pass', reason: null, evidence });
const no = (evidence = []) => ({ state: 'fail', reason: null, evidence });
const unverified = (reason = 'no-data') => ({ state: 'unverified', reason, evidence: [] });
const place = (e) => ({ file: e.file, line: Number.isInteger(e.line) && e.line > 0 ? e.line : 1 });

// ---- globs ----------------------------------------------------------------------------------------------------------

const cache = new Map();

// `**/` crosses folders (and may be empty), `*` and `?` stay inside one name. A pattern with no slash looks at the root,
// `.github/` and `docs/` (where GitHub and people keep such files); a folder name matches the files under it.
export function globRe(glob) {
  const g = String(glob).replaceAll('\\', '/');
  const hit = cache.get(g);
  if (hit) return hit;
  let body = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { body += '(?:.*/)?'; i += 2; } else { body += '.*'; i += 1; }
    } else if (c === '*') body += '[^/]*';
    else if (c === '?') body += '[^/]';
    else body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const prefix = g.includes('/') ? '' : '(?:\\.github/|docs/)?';
  const re = new RegExp(`^${prefix}${body}(?:/.*)?$`, 'i');
  cache.set(g, re);
  return re;
}

export function matchPaths(globs, files) {
  const res = list(globs).map(globRe);
  return [...new Set(list(files).map((f) => f.path).filter((p) => res.some((re) => re.test(p))))].sort();
}

// ---- file -----------------------------------------------------------------------------------------------------------

function byFile(item, { census, gitDir }) {
  if (!census || !Array.isArray(census.files)) return unverified();
  const globs = list(item.detect.anyOf);
  // `.git` is not a census row: the census itself comes from git, and its `head` says there is a commit.
  const wantsGit = globs.includes('.git');
  if (wantsGit && census.head) return ok([{ file: '.git', line: 1 }]);
  const found = matchPaths(globs.filter((g) => g !== '.git'), census.files);
  if (found.length) return ok(found.slice(0, 3).map((file) => ({ file, line: 1 })));
  // No head is also what a missing or slow git leaves behind; only the caller's look at the folder proves there is no .git.
  if (wantsGit && gitDir !== false) return unverified('tool-missing');
  return no();
}

// ---- content --------------------------------------------------------------------------------------------------------

const lineOf = (text, index) => {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

function compile(sources) {
  const out = [];
  for (const s of list(sources)) {
    try { out.push(new RegExp(s, 'm')); } catch { return null; }
  }
  return out;
}

// First line where the text satisfies the rule, or 0. `contains` and `matches` are any-of.
function hitLine(text, detect, patterns) {
  let best = 0;
  const mark = (index) => { const n = lineOf(text, index); if (!best || n < best) best = n; };
  for (const s of list(detect.contains)) { const i = text.indexOf(s); if (i >= 0) mark(i); }
  for (const re of patterns) { const m = re.exec(text); if (m) mark(m.index); }
  return best;
}

function byContent(item, { census, readText }) {
  const { detect } = item;
  if (!census || !Array.isArray(census.files) || typeof readText !== 'function') return unverified();
  const patterns = compile(detect.matches);
  if (patterns === null) return unverified();
  // The census is exact, so no matching row proves absence. A generated file, a library or a secret is not the project's
  // own text and is never read; a row left out as binary (a README saved as UTF-16) exists but could not be read.
  const all = matchPaths(detect.files, census.files);
  if (!all.length) return no();
  const rows = new Map(census.files.map((f) => [f.path, f]));
  const paths = all.filter((p) => rows.get(p).included !== false);
  const minLines = Number.isInteger(detect.minLines) ? detect.minLines : 0;
  let unread = all.some((p) => rows.get(p).included === false && rows.get(p).reason === 'binary') ? 1 : 0;
  let blank = null;
  let budget = MAX_CHARS_TOTAL;
  for (let i = 0; i < paths.length; i++) {
    if (i >= MAX_FILES || budget <= 0) { unread++; break; }
    let text = readText(paths[i]);
    if (typeof text !== 'string') { unread++; continue; }
    text = text.slice(0, MAX_CHARS_FILE);
    budget -= text.length;
    if (!text.trim()) { blank ??= paths[i]; continue; }
    if (minLines && text.split('\n').filter((l) => l.trim()).length < minLines) continue;
    const line = hitLine(text, detect, patterns);
    if (line) return ok([{ file: paths[i], line }]);
  }
  if (unread) return unverified();
  return no(blank ? [{ file: blank, line: 1 }] : []);
}

// ---- health ---------------------------------------------------------------------------------------------------------

function byHealth(item, { health }) {
  const rows = Array.isArray(health) ? health : list(health && health.items);
  const row = rows.find((r) => r && r.id === item.detect.id);
  if (!row) return unverified();
  const evidence = list(row.evidence).filter((e) => e && e.file).slice(0, MAX_EVIDENCE).map(place);
  if (row.state === 'pass') return ok(evidence);
  if (row.state === 'fail') return no(evidence);
  if (row.state === 'na') return { state: 'na', reason: 'not-applicable', evidence: [] };
  return unverified(REASONS.includes(row.reason) ? row.reason : 'no-data');
}

// ---- dep ------------------------------------------------------------------------------------------------------------

function byDep(item, { deps, facts }) {
  const want = String(item.detect.name).toLowerCase();
  const dep = list(deps).find((d) => String(d.name).toLowerCase() === want);
  if (dep) return ok([place(dep)]);
  const fact = list(facts).find((f) => f && f.kind === 'integration' && String(f.attrs?.package ?? '').toLowerCase() === want);
  if (fact) return ok([place(fact)]);
  // No manifest was read (or none lists anything): the absence proves nothing.
  return list(deps).length ? no() : unverified();
}

// ---- supported-version ----------------------------------------------------------------------------------------------

function cycleOf(version, cycles) {
  const v = String(version);
  return list(cycles)
    .filter((c) => v === c.cycle || v.startsWith(`${c.cycle}.`))
    .sort((a, b) => b.cycle.length - a.cycle.length)[0] ?? null;
}

const dayOf = (now) => {
  const d = new Date(now ?? Date.now());
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function bySupportedVersion(item, { stacks, pkg, now }) {
  const stack = list(stacks).find((s) => String(s.name).toLowerCase() === String(item.detect.stack).toLowerCase());
  if (!stack) return { state: 'na', reason: 'not-applicable', evidence: [] };
  const today = dayOf(now);
  if (!pkg || today === null) return unverified();
  if (statusOf(pkg, today) !== 'confirmed') return unverified('stale-source');
  if (!stack.version) return unverified();
  const cycle = cycleOf(stack.version, pkg.lifecycle && pkg.lifecycle.cycles);
  if (!cycle) return unverified();
  // No end date at all = still supported; otherwise security support decides, and the last day counts.
  const until = cycle.securityUntil ?? cycle.supportUntil ?? null;
  const evidence = [place(stack)];
  return until === null || until >= today ? ok(evidence) : no(evidence);
}

// ---- entry ----------------------------------------------------------------------------------------------------------

const DETECTORS = {
  file: byFile,
  content: byContent,
  health: byHealth,
  dep: byDep,
  'supported-version': bySupportedVersion,
  manual: () => unverified('needs-human'),
};

// ctx: { census, readText, health, deps, facts, stacks, pkg, now }. -> { state, reason, evidence: [{ file, line }] }
export function detectItem(item, ctx = {}) {
  const run = item && item.detect && DETECTORS[item.detect.kind];
  if (!run) return unverified();
  try {
    return run(item, ctx);
  } catch {
    // A reader that throws is a thing we could not verify, not a failed practice.
    return unverified();
  }
}
