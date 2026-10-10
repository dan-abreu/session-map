// "Everything up to date?" lines of groups 5 to 8: quality, dependencies, git and conversations. Each line is a pure
// function (ctx) -> { state, evidence, reason, findingIds, detail }; ctx is the UptodateCtx of uptodate.mjs. A source that
// was not consulted gives `unverified`, never `warning`: nothing here guesses.
import { requestsOf } from '../web/requests.js';

const DAY_MS = 86_400_000;
const STALE_BRANCH_DAYS = 14;

const confirmed = (evidence, detail = null) => ({ state: 'confirmed', evidence, reason: null, findingIds: [], detail });
const warning = (evidence, detail, findingIds = []) => ({ state: 'warning', evidence, reason: null, findingIds, detail });
const unverified = (reason, detail = null) => ({ state: 'unverified', evidence: [], reason, findingIds: [], detail });
const noData = () => unverified('no-data');
const ev = (file, line, sha, factId) => ({ file, line, sha: sha ?? null, ...(factId ? { factId } : {}) });

const nowMs = (ctx) => (ctx.now ? Date.parse(ctx.now) : Date.now());
const partsOf = (ctx) => ctx.project?.arch?.parts ?? [];
const itemsOf = (ctx) => partsOf(ctx).flatMap((p) => (p.groups ?? []).flatMap((g) => (g.items ?? []).map((it) => ({ ...it, part: p }))));
// The git state has no file of the project to point at, so its evidence names the thing that was read.
const gitEvidence = (what) => [ev('.git', 0, null, `git:${what}`)];
const healthItem = (ctx, re) => ctx.health?.items?.find((i) => re.test(i.id)) ?? null;

function flatKeys(value, prefix = '', out = new Set()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatKeys(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.add(prefix);
  return out;
}

function testsExist(ctx) {
  if (!ctx.census?.files) return noData();
  const files = ctx.census.files.filter((f) => f.included !== false);
  const withCode = partsOf(ctx).map((p) => ({ part: p, code: files.filter((f) => f.kind === 'code' && f.owner === p.id) })).filter((x) => x.code.length);
  if (!withCode.length) return unverified('not-applicable');
  const bare = withCode.filter((x) => !files.some((f) => f.kind === 'test' && f.owner === x.part.id));
  if (bare.length) return warning(bare.map((x) => ev(x.code[0].path, 1, x.code[0].sha)), bare.map((x) => x.part.id).join(', '));
  return confirmed(withCode.map((x) => {
    const t = files.find((f) => f.kind === 'test' && f.owner === x.part.id);
    return ev(t.path, 1, t.sha);
  }));
}

function testsPassing(ctx) {
  if (!ctx.health) return noData();
  const item = healthItem(ctx, /(^|[.-])ci[.-]?tests?$|tests?[.-]passing/);
  if (!item) return noData();
  if (item.state === 'unverified') return unverified(item.reason ?? 'no-data');
  if (item.state === 'na') return unverified('not-applicable');
  if (!item.evidence?.length) return noData();
  return item.state === 'fail' ? warning(item.evidence, null) : confirmed(item.evidence);
}

function i18n(ctx) {
  const inCensus = (ctx.census?.files ?? []).filter((f) => f.included !== false && /(^|\/)(locales|messages)\/[^/]+\.json$/.test(f.path));
  if (!inCensus.length) return ctx.census ? unverified('not-applicable') : noData();
  const text = new Map((ctx.localeFiles ?? []).map((f) => [f.path, f.text]));
  const byDir = new Map();
  for (const f of inCensus) {
    const dir = f.path.slice(0, f.path.lastIndexOf('/'));
    const raw = text.get(f.path);
    if (raw === undefined) return noData();
    let keys;
    try { keys = flatKeys(JSON.parse(raw)); } catch { return noData(); }
    byDir.set(dir, [...(byDir.get(dir) ?? []), { file: f, keys }]);
  }
  const evidence = [];
  const details = [];
  for (const [dir, langs] of byDir) {
    if (langs.length < 2) continue;
    const all = new Set(langs.flatMap((l) => [...l.keys]));
    for (const l of langs) {
      const missing = [...all].filter((k) => !l.keys.has(k)).sort();
      if (!missing.length) continue;
      evidence.push(ev(l.file.path, 1, l.file.sha));
      details.push(`${dir}: ${l.file.path.split('/').pop()} lacks ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
    }
  }
  if (details.length) return warning(evidence, details.join('; '));
  const checked = inCensus.map((f) => ev(f.path, 1, f.sha));
  return byDir.size && [...byDir.values()].some((l) => l.length > 1) ? confirmed(checked) : unverified('not-applicable');
}

// Warnings count only when the piece was checked against a source (`verified`), never from a guess.
function depLine(ctx, { warns, healthRe }) {
  const pieces = ctx.versions?.pieces;
  if (!pieces && !ctx.health) return noData();
  const bad = (pieces ?? []).filter((p) => p.verified && warns.includes(p.warning));
  if (bad.length) return warning(bad.map((p) => ev(p.file, p.line ?? 1, p.sha, `dep:${p.name}`)), bad.map((p) => `${p.name} ${p.version}`).join(', '));
  const item = healthRe ? healthItem(ctx, healthRe) : null;
  if (item && item.state !== 'na') {
    if (item.state === 'unverified') return unverified(item.reason ?? 'no-data');
    if (item.evidence?.length) return item.state === 'fail' ? warning(item.evidence, null) : confirmed(item.evidence);
  }
  return null;
}

function depVersions(ctx) {
  const r = depLine(ctx, { warns: ['outdated', 'old'], healthRe: null });
  if (r) return r;
  const pieces = ctx.versions?.pieces ?? [];
  const ok = pieces.filter((p) => p.verified);
  if (ok.length) return confirmed(ok.map((p) => ev(p.file, p.line ?? 1, p.sha, `dep:${p.name}`)));
  return pieces.length ? unverified(pieces[0].reason ?? 'no-data') : noData();
}
const depVulns = (ctx) => depLine(ctx, { warns: ['vulnerable'], healthRe: /(^|[.-])(vulns?|vulnerabilit)/ }) ?? noData();
const depLicenses = (ctx) => depLine(ctx, { warns: ['license'], healthRe: /^deps?[.-]licen/ }) ?? noData();

const uncommitted = (ctx) => {
  if (!ctx.git) return noData();
  const n = Array.isArray(ctx.git.uncommitted) ? ctx.git.uncommitted.length : ctx.git.uncommitted;
  if (typeof n !== 'number') return noData();
  return n > 0 ? warning(gitEvidence('working-tree'), String(n)) : confirmed(gitEvidence('working-tree'));
};

const unpushed = (ctx) => {
  if (!ctx.git || typeof ctx.git.ahead !== 'number') return noData();
  return ctx.git.ahead > 0 ? warning(gitEvidence('ahead'), String(ctx.git.ahead)) : confirmed(gitEvidence('ahead'));
};

function branches(ctx) {
  const cells = ctx.project?.workCells;
  if (!cells) return noData();
  const limit = nowMs(ctx) - STALE_BRANCH_DAYS * DAY_MS;
  const bad = cells.filter((c) => c.status === 'merged' || c.mergedAt || (c.lastCommit?.ts && Date.parse(c.lastCommit.ts) < limit));
  return bad.length ? warning(gitEvidence('branches'), bad.map((c) => c.branch).join(', ')) : confirmed(gitEvidence('branches'));
}

function clashes(ctx) {
  const cells = ctx.project?.workCells;
  if (!cells) return noData();
  const bad = cells.filter((c) => c.clashWith?.length);
  return bad.length ? warning(gitEvidence('clashes'), bad.map((c) => c.branch).join(', ')) : confirmed(gitEvidence('clashes'));
}

function boardItems(ctx) {
  const chats = ctx.project?.chats;
  if (!chats || !partsOf(ctx).length) return noData();
  const codes = new Set(itemsOf(ctx).map((i) => i.code).filter(Boolean));
  const bad = [...new Set(chats.filter((c) => c.itemCode && !codes.has(c.itemCode)).map((c) => c.itemCode))];
  const archFile = ctx.project.arch.parts[0].file ?? ctx.project.arch.dir ?? '.';
  return bad.length ? warning([ev(archFile, 1, null, 'board:items')], bad.join(', ')) : confirmed([ev(archFile, 1, null, 'board:items')]);
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// Written = the decision's words appear in an item of the architecture or in a document of the architecture folder.
function decisionsUnwritten(ctx) {
  const decisions = ctx.project?.decisions;
  if (!decisions) return noData();
  const dir = ctx.project?.arch?.dir ?? null;
  const proof = [ev(dir ?? '.', 0, null, 'decisions:pending')];
  if (!decisions.length) return confirmed(proof);
  const haystack = [
    ...itemsOf(ctx).map((i) => norm(`${i.title} ${(i.detail ?? []).join(' ')}`)),
    ...(ctx.docs ?? []).filter((d) => !dir || d.path.startsWith(`${dir}/`)).map((d) => norm(d.text)),
  ];
  const open = decisions.filter((d) => d.text && !haystack.some((h) => h.includes(norm(d.text))));
  return open.length ? warning(proof, open.map((d) => d.text).join('; ')) : confirmed(proof);
}

function requestsNoItem(ctx) {
  if (!partsOf(ctx).length) return noData();
  const { list } = requestsOf(ctx.project);
  if (!list.length) return unverified('not-applicable');
  const point = (r) => ev(partsOf(ctx).find((p) => p.id === r.partId)?.file ?? ctx.project.arch.dir ?? '.', 1, null, `request:${r.code}`);
  const bare = list.filter((r) => r.noActivity);
  return bare.length ? warning(bare.map(point), bare.map((r) => r.code).join(', ')) : confirmed(list.map(point));
}

export const LINES = [
  { id: 'g5.tests-exist', group: 5, run: testsExist },
  { id: 'g5.tests-passing', group: 5, run: testsPassing },
  { id: 'g5.inspection', group: 5, run: () => noData() },
  { id: 'g5.i18n', group: 5, run: i18n },
  { id: 'g6.dep-versions', group: 6, run: depVersions },
  { id: 'g6.dep-vulns', group: 6, run: depVulns },
  { id: 'g6.dep-licenses', group: 6, run: depLicenses },
  { id: 'g7.uncommitted', group: 7, run: uncommitted },
  { id: 'g7.unpushed', group: 7, run: unpushed },
  { id: 'g7.branches', group: 7, run: branches },
  { id: 'g7.clashes', group: 7, run: clashes },
  { id: 'g7.board-items', group: 7, run: boardItems },
  { id: 'g7.issues', group: 7, run: () => unverified('no-token') },
  { id: 'g8.decisions-unwritten', group: 8, run: decisionsUnwritten },
  { id: 'g8.requests-no-item', group: 8, run: requestsNoItem },
];
