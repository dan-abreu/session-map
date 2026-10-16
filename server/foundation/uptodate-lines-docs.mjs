// "Everything up to date?" lines of groups 2 (documents) and 3 (numbers). Each line is a pure function of the context
// built by uptodate.mjs and answers { state, evidence, reason, findingIds, detail }. Missing input is never a warning:
// it is unverified/no-data. A confirmed line always says what was checked.
import { requestsOf } from '../web/requests.js';

const LIVE = new Set(['open', 'later', 'accepted']); // never = the owner closed it; applied/undone = not pending

const ok = (evidence, detail = null) => ({ state: 'confirmed', evidence, reason: null, findingIds: [], detail });
const warn = (evidence, findingIds = [], detail = null) => ({ state: 'warning', evidence, reason: null, findingIds, detail });
const unverified = (reason) => ({ state: 'unverified', evidence: [], reason, findingIds: [], detail: null });
const noData = () => unverified('no-data');
const notApplicable = () => unverified('not-applicable');

const listOf = (v) => (Array.isArray(v) ? v : Array.isArray(v?.findings) ? v.findings : null);
const pendingBy = (ctx, rules, keep = () => true) => {
  const all = listOf(ctx.findings);
  return all ? all.filter((f) => rules.includes(f.rule) && LIVE.has(f.state ?? 'open') && keep(f)) : null;
};
const findingEvidence = (f) => (f.evidence?.length ? f.evidence : f.target ? [{ file: f.target.file, line: f.target.line ?? null }] : []);
const fromFindings = (found) => warn(found.flatMap(findingEvidence), found.map((f) => f.id));
const docEvidence = (docs) => docs.slice(0, 20).map((d) => ({ file: d.path, line: null }));

// Routes compare the same whichever way the framework writes the parameter: :id, {id}, [id].
const routeKey = (method, path) => `${String(method).toUpperCase()} ${String(path).replace(/\{[^}/]+\}|\[[^\]/]+\]|:[^/]+/g, ':p')}`;

// Which docs-disagree findings are about a number ("12 routes") and not about a diagram node.
const isCount = (f) => /count|number/i.test(f.what?.msg ?? '') || f.what?.params?.claimed !== undefined || f.what?.params?.count !== undefined;
const kindOfFinding = (f) => f.kind ?? f.what?.params?.kind ?? (f.evidence ?? []).map((e) => /^([a-z]+):/.exec(e.factId ?? '')?.[1]).find(Boolean) ?? null;

function docsLine(rules, { needsDocs = false } = {}) {
  return (ctx) => {
    const found = pendingBy(ctx, rules);
    if (!found) return noData();
    if (found.length) return fromFindings(found);
    const docs = Array.isArray(ctx.docs) ? ctx.docs : [];
    if (needsDocs && !docs.length) return noData();
    return ok(docs.length ? docEvidence(docs) : [{ note: 'findings', count: 0 }]);
  };
}

const LINE_FNS = {
  'g2.cites': docsLine(['doc-cites-missing', 'pointer-broken']),

  'g2.links': (ctx) => {
    if (!Array.isArray(ctx.brokenLinks)) return noData();
    if (ctx.brokenLinks.length) {
      return warn(ctx.brokenLinks.map((b) => ({ file: b.file, line: b.line ?? null, target: b.target, why: b.why })), [], { count: ctx.brokenLinks.length });
    }
    return ok(docEvidence(ctx.docs ?? []).length ? docEvidence(ctx.docs) : [{ note: 'links', count: 0 }]);
  },

  'g2.images': (ctx) => {
    const found = pendingBy(ctx, ['stale-image']);
    if (!found) return noData();
    if (found.length) return fromFindings(found);
    const withImages = (ctx.docs ?? []).filter((d) => /!\[[^\]]*\]\([^)]+\)|<img\b/i.test(d.text ?? ''));
    return withImages.length ? ok(docEvidence(withImages)) : notApplicable();
  },

  'g2.api-docs': (ctx) => {
    if (!ctx.census) return noData();
    const specFiles = (ctx.census.files ?? []).filter((f) => f.included && /^(openapi|swagger)[^/]*$/i.test(f.path.split('/').pop()));
    if (!specFiles.length) return notApplicable();
    // The spec is parsed by uptodate.mjs (I/O); without it we cannot compare.
    if (!ctx.facts || !Array.isArray(ctx.apiSpecs) || !ctx.apiSpecs.length) return noData();
    const inCode = new Map();
    for (const f of ctx.facts.facts ?? []) {
      if (f.kind === 'route' && f.origin !== 'AMBIGUOUS' && f.attrs?.path) inCode.set(routeKey(f.attrs.method, f.attrs.path), f);
    }
    const inSpec = new Map();
    for (const s of ctx.apiSpecs) for (const r of s.routes ?? []) inSpec.set(routeKey(r.method, r.path), { file: s.path, ...r });
    const missingInSpec = [...inCode].filter(([k]) => !inSpec.has(k));
    const missingInCode = [...inSpec].filter(([k]) => !inCode.has(k));
    if (missingInSpec.length || missingInCode.length) {
      return warn([
        ...missingInSpec.map(([, f]) => ({ file: f.file, line: f.line ?? null, note: 'route-not-in-spec', name: f.id })),
        ...missingInCode.map(([, r]) => ({ file: r.file, line: null, note: 'spec-route-not-in-code', name: `${String(r.method).toUpperCase()} ${r.path}` })),
      ], [], { notInSpec: missingInSpec.length, notInCode: missingInCode.length });
    }
    return ok(ctx.apiSpecs.map((s) => ({ file: s.path, line: null })));
  },

  'g2.db-docs': (ctx) => {
    const found = pendingBy(ctx, ['code-without-doc'], (f) => kindOfFinding(f) === 'table');
    if (!found) return noData();
    const tables = (ctx.facts?.facts ?? []).filter((f) => f.kind === 'table');
    if (found.length) return fromFindings(found);
    if (!ctx.facts) return noData();
    if (!tables.length) return notApplicable();
    return ok(tables.slice(0, 20).map((t) => ({ file: t.file, line: t.line ?? null, factId: t.id })));
  },

  'g3.versions': (ctx) => {
    const found = pendingBy(ctx, ['version-mismatch']);
    if (!found && !ctx.versions) return noData();
    const code = ctx.versions?.code;
    const codeEv = code?.file ? [{ file: code.file, line: code.line ?? null, version: code.version }] : [];
    if (found?.length || ctx.versions?.mismatch === true) {
      const ev = [...(found ?? []).flatMap(findingEvidence), ...(ctx.versions?.mismatch === true ? [...codeEv, ...(ctx.versions.tag ? [{ note: 'tag', tag: ctx.versions.tag }] : [])] : [])];
      return warn(ev, (found ?? []).map((f) => f.id));
    }
    return codeEv.length ? ok(codeEv) : noData();
  },

  'g3.numbers': (ctx) => {
    const found = pendingBy(ctx, ['docs-disagree'], isCount);
    if (!found) return noData();
    if (found.length) return fromFindings(found);
    const docs = Array.isArray(ctx.docs) ? ctx.docs : [];
    return ok(docs.length ? docEvidence(docs) : [{ note: 'findings', count: 0 }]);
  },

  'g3.done-ticked': (ctx) => {
    const parts = ctx.project?.arch?.parts;
    if (!Array.isArray(parts)) return noData();
    const doneWords = /^\s*(?:status|situação)\s*:\s*(?:done|conclu[ií]d[oa]|released in|publicad[oa] na)\b|\b(?:released in|publicad[oa] na)\s+v?\d/i;
    // An item whose own status line says it is not done ("Status: in progress (the first part was released in v0.2.3…)") is
    // saying what was released so far, not that it is finished.
    const notDone = /^\s*(?:status|situação)\s*:\s*(?:in progress|em andamento|accepted|aceito|new|novo|later|depois|discarded|descartado)\b/i;
    const bad = [];
    let seen = 0;
    for (const part of parts) {
      for (const g of part.groups ?? []) {
        for (const it of g.items ?? []) {
          seen++;
          if (it.status !== 'done' && !(it.detail ?? []).some((d) => notDone.test(d)) && (it.detail ?? []).some((d) => doneWords.test(d))) {
            bad.push({ file: part.file ?? null, line: it.line ?? null, code: it.code ?? null, note: 'ticked-missing' });
          }
        }
      }
    }
    const unconfirmed = requestsOf(ctx.project).list.filter((r) => r.unconfirmed);
    const badRequests = unconfirmed.filter((r) => !bad.some((b) => b.code === r.code));
    for (const r of badRequests) {
      const part = parts.find((p) => p.id === r.partId);
      bad.push({ file: part?.file ?? null, line: null, code: r.code, note: 'request-unconfirmed' });
    }
    if (bad.length) return warn(bad, [], { count: bad.length });
    return seen ? ok(parts.filter((p) => p.file).map((p) => ({ file: p.file, line: null })).slice(0, 20).concat([{ note: 'items', count: seen }])) : notApplicable();
  },
};

export const LINES = Object.entries(LINE_FNS).map(([id, run]) => ({ id, group: Number(id[1]), run }));
