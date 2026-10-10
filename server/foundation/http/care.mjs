// Foundation routes of block B3 (fd06, fd07, fd13, fd14): care mode, proposals, operations and their undo, the
// watcher's findings, the up-to-date panel, document sizes and code pointers. Contract: http/index.mjs.
// The client never sends file text: a write names a finding or an operation (plus action and confirm) and the server
// builds the operation itself (docfix), so a forged body cannot choose what lands in the repository.
import { readFileSync, statSync } from 'node:fs';
import { loadConfig } from '../../config.mjs';
import { FILE_MAX, isSecretsFile, safeResolve } from '../../files.mjs';
import { log } from '../../log.mjs';
import { MODES, applyOp, listProposals, readCare, resolveProposal, undoOp, writeCare } from '../care.mjs';
import { estimateFix, opFromFinding } from '../docfix.mjs';
import { DEFAULT_LIMITS, docAction, docTypeOf, measureDoc, needsSummary, sizeState } from '../docsize.mjs';
import { readDocs } from '../docwatch.mjs';
import { readFindings, setFindingState } from '../findings.mjs';
import { pointersIn, resolvePointer } from '../pointers.mjs';
import { readFd } from '../store.mjs';
import { fail, pathParam } from './common.mjs';

const OP_ID_RE = /^(op:)?[a-z0-9][a-z0-9._-]{0,99}$/i;
const FINDING_ID_RE = /^f:[0-9a-f]{12}$/;
const FINDING_ACTIONS = new Set(['accept', 'later', 'never']);
const PROPOSAL_STATES = new Set(['open', 'accepted', 'dismissed', 'never']);
// What care.mjs and docfix.mjs may answer, as HTTP. Anything docfix refuses that is not listed is a 422.
const ERRORS = {
  'bad-path': 400, 'bad-op': 400, 'bad-action': 400, 'outside-root': 400, 'secret-file': 403, 'not-found': 404,
  'not-open': 409, 'look-only': 409, 'needs-confirm': 409, 'already-applied': 409, 'already-undone': 409,
  'changed-since': 409, 'bad-transition': 409, 'too-big': 413, 'not-text': 415, 'write-failed': 500,
};

const validOpId = (raw) => OP_ID_RE.test(raw) && !raw.includes('..');
const slugOf = (opId) => (opId.startsWith('op:') ? opId.slice(3) : opId);
// Only what care.applyOp needs: the id names the brain folder, the root is the only place it may write.
const target = (ctx) => ({ id: ctx.project.id, root: ctx.project.root });
const confirmed = (body) => body?.confirm === true;

// Every write leaves a line in the log, refused or not: who asked what, and what came of it.
function audit(ctx, what, fields) {
  log('info', 'foundation-care-write', { project: ctx.project.id, what, ...fields });
}

// A write refused before it reaches care.mjs: a forged id is exactly what the log must keep.
function refuse(ctx, what, raw, status, error) {
  audit(ctx, what, { id: String(raw).slice(0, 120), error });
  fail(status, error);
}

const opIdOf = (ctx, what) => (validOpId(ctx.params.opId) ? ctx.params.opId : refuse(ctx, what, ctx.params.opId, 400, 'bad-id'));
const findingIdOf = (ctx, what) => (FINDING_ID_RE.test(ctx.params.fid) ? ctx.params.fid : refuse(ctx, what, ctx.params.fid, 400, 'bad-id'));

// A care.mjs answer: the object when it went through, else the HTTP error its code maps to.
function settle(ctx, what, fields, res) {
  const code = res.ok ? null : res.error ?? res.status;
  audit(ctx, what, { ...fields, status: res.status ?? null, error: code });
  if (code) fail(ERRORS[code] ?? 409, code);
  ctx.fresh();
  return res;
}

function careOf(ctx) {
  if (!ctx.demo) return readCare(ctx.smDir, ctx.project.id);
  const data = ctx.read('care.json', null);
  return { mode: MODES.includes(data?.mode) ? data.mode : null, askedAt: typeof data?.askedAt === 'string' ? data.askedAt : null };
}

function findingsOf(ctx) {
  const data = ctx.read('findings.json', null);
  return Array.isArray(data?.findings) ? data.findings : [];
}

function findingOf(ctx) {
  const fid = FINDING_ID_RE.test(ctx.params.fid) ? ctx.params.fid : fail(400, 'bad-id');
  return findingsOf(ctx).find((f) => f.id === fid) ?? fail(404, 'not-found');
}

// Desfazer leaves a finding undone; the owner's next answer reopens it first, the only move the state machine allows.
function reopen(ctx, finding) {
  if (finding.state !== 'undone') return;
  const res = setFindingState(ctx.smDir, ctx.project.id, finding.id, 'open');
  if (!res.ok) settle(ctx, 'finding', { finding: finding.id, action: 'reopen' }, res);
}

// A proposal turned down gives its finding back: accepting it parked the finding in accepted, and only undone leads out.
function freeFinding(ctx, fid, opId) {
  if (typeof fid !== 'string') return;
  const finding = readFindings(ctx.smDir, ctx.project.id).find((f) => f.id === fid);
  if (finding?.state !== 'accepted' || slugOf(String(finding.fix?.opId ?? '')) !== slugOf(opId)) return;
  setFindingState(ctx.smDir, ctx.project.id, fid, 'undone');
}

const configOf = (ctx) => (ctx.demo ? {} : loadConfig(ctx.project.root, ctx.smDir));

// The text of a repository file, or null: never a secret, never outside the root, never bigger than the viewer allows.
function readText(root, rel) {
  if (isSecretsFile(rel)) return null;
  const abs = safeResolve(root, rel);
  if (!abs || isSecretsFile(abs)) return null;
  try {
    const st = statSync(abs);
    return st.isFile() && st.size <= FILE_MAX ? readFileSync(abs, 'utf8') : null;
  } catch {
    return null;
  }
}

async function acceptFinding(ctx, finding, { ai }) {
  const project = target(ctx);
  const confirm = confirmed(ctx.body);
  const fields = { finding: finding.id, action: 'accept', confirm };
  if (!['open', 'later', 'undone'].includes(finding.state)) return settle(ctx, 'finding', fields, { ok: false, error: 'bad-transition' });
  // Nothing can be written in look mode: asking the AI for a text first would only cost money.
  const { mode } = readCare(ctx.smDir, project.id);
  if (mode !== 'auto' && mode !== 'suggest') return settle(ctx, 'finding', fields, { ok: false, status: 'look-only' });
  const census = ctx.read('census.json', null);
  if (!Array.isArray(census?.files)) return settle(ctx, 'finding', fields, { ok: false, error: 'no-census' });
  const config = configOf(ctx);
  const made = await opFromFinding(finding, {
    root: project.root, smDir: ctx.smDir, census, config, arch: ctx.project.arch ?? null,
    facts: ctx.read('facts.json', null), model: ctx.read('model.json', null), versions: ctx.read('versions.json', null),
  }, { ai });
  if (!made.ok) {
    audit(ctx, 'finding', { ...fields, error: made.error, reason: made.reason ?? null });
    fail(ERRORS[made.error] ?? 422, made.error);
  }
  const res = applyOp(project, { ...made.op, id: undefined, findingId: finding.id }, { smDir: ctx.smDir, confirm });
  settle(ctx, 'finding', { ...fields, opId: res.opId }, res);
  reopen(ctx, finding);
  const marked = setFindingState(ctx.smDir, project.id, finding.id, 'accepted', res.opId);
  const proposal = res.status === 'proposed' ? readFd(ctx.smDir, project.id, `proposals/${slugOf(res.opId)}.json`, null) : undefined;
  return { ...res, costUSD: made.costUSD ?? 0, finding: marked.finding ?? null, ...(proposal ? { proposal } : {}) };
}

// careRoutes({ ai }): ai(prompt, opts) stands in for the user's claude in tests; production leaves it to docfix.
export function careRoutes({ ai } = {}) {
  // Findings with an answer still running, per project: a double click must not pay the AI or apply twice.
  const busy = new Set();
  return [
    { method: 'GET', path: 'care', run: (ctx) => careOf(ctx) },
    {
      method: 'PUT', path: 'care',
      run: (ctx) => {
        const mode = ctx.body?.mode;
        if (!MODES.includes(mode)) {
          audit(ctx, 'care', { mode: typeof mode === 'string' ? mode.slice(0, 20) : null, error: 'bad-mode' });
          fail(400, 'bad-mode');
        }
        const care = writeCare(ctx.smDir, ctx.project.id, mode);
        audit(ctx, 'care', { mode });
        ctx.fresh();
        return care;
      },
    },
    {
      method: 'GET', path: 'proposals',
      run: (ctx) => {
        const state = ctx.query.get('state');
        if (state !== null && !PROPOSAL_STATES.has(state)) fail(400, 'bad-state');
        if (!ctx.demo) return listProposals(ctx.smDir, ctx.project.id, { state: state ?? undefined });
        const list = ctx.read('proposals.json', []);
        return (Array.isArray(list) ? list : []).filter((p) => !state || p?.state === state);
      },
    },
    {
      method: 'POST', path: 'op/:opId/accept',
      run: (ctx) => {
        const opId = opIdOf(ctx, 'op-accept');
        const confirm = confirmed(ctx.body);
        const res = resolveProposal(target(ctx), opId, 'accept', { smDir: ctx.smDir, confirm });
        return settle(ctx, 'op-accept', { opId, confirm }, res);
      },
    },
    {
      // The way out of a proposal the owner does not want, or that went stale (accept answered changed-since).
      method: 'POST', path: 'op/:opId/dismiss',
      run: (ctx) => {
        const opId = opIdOf(ctx, 'op-dismiss');
        const proposal = readFd(ctx.smDir, ctx.project.id, `proposals/${slugOf(opId)}.json`, null);
        // resolveProposal writes any state over any other: an applied proposal must not turn into a dismissed one.
        if (proposal?.op && proposal.state !== 'open') return settle(ctx, 'op-dismiss', { opId }, { ok: false, error: 'not-open' });
        const res = settle(ctx, 'op-dismiss', { opId }, resolveProposal(target(ctx), opId, 'dismiss', { smDir: ctx.smDir }));
        freeFinding(ctx, proposal.op.findingId, opId);
        return res;
      },
    },
    {
      method: 'POST', path: 'op/:opId/undo',
      run: (ctx) => {
        const opId = opIdOf(ctx, 'op-undo');
        const confirm = confirmed(ctx.body);
        const res = undoOp(target(ctx), opId, { smDir: ctx.smDir, confirm });
        settle(ctx, 'op-undo', { opId, confirm }, res);
        const record = readFd(ctx.smDir, ctx.project.id, `undo/${slugOf(opId)}.json`, null);
        // The finding the operation fixed goes to undone; its next accept, later or never reopens it (reopen above).
        if (record?.findingId) setFindingState(ctx.smDir, ctx.project.id, record.findingId, 'undone');
        return res;
      },
    },
    { method: 'GET', path: 'findings', run: (ctx) => ctx.read('findings.json', null) },
    {
      method: 'POST', path: 'findings/:fid',
      run: async (ctx) => {
        const fid = findingIdOf(ctx, 'finding');
        const action = ctx.body?.action;
        if (!FINDING_ACTIONS.has(action)) {
          audit(ctx, 'finding', { finding: fid, action: typeof action === 'string' ? action.slice(0, 20) : null, error: 'bad-action' });
          fail(400, 'bad-action');
        }
        const finding = readFindings(ctx.smDir, ctx.project.id).find((f) => f.id === fid) ?? refuse(ctx, 'finding', fid, 404, 'not-found');
        const key = `${ctx.project.id} ${fid}`;
        if (busy.has(key)) refuse(ctx, 'finding', fid, 409, 'busy');
        busy.add(key);
        try {
          if (action === 'accept') return await acceptFinding(ctx, finding, { ai });
          reopen(ctx, finding);
          return settle(ctx, 'finding', { finding: fid, action }, setFindingState(ctx.smDir, ctx.project.id, fid, action));
        } finally {
          busy.delete(key);
        }
      },
    },
    {
      method: 'GET', path: 'findings/:fid/estimate',
      run: (ctx) => {
        const finding = findingOf(ctx);
        const model = configOf(ctx).ai?.fixModel ?? 'sonnet';
        const row = (ctx.read('census.json', null)?.files ?? []).find((f) => f?.path === finding.target?.file);
        const bytes = finding.rule === 'code-without-doc' ? undefined : row?.bytes;
        return { findingId: finding.id, model, costUSD: estimateFix(finding, { bytes, model }) };
      },
    },
    { method: 'GET', path: 'uptodate', run: (ctx) => ctx.read('uptodate.json', null) },
    {
      method: 'GET', path: 'docsize',
      run: (ctx) => {
        if (ctx.demo) return ctx.read('docsize.json', null);
        const census = ctx.read('census.json', null);
        if (!Array.isArray(census?.files)) return null;
        const limits = configOf(ctx).docLimits ?? {};
        const { docs, truncated } = readDocs(ctx.project.root, census);
        const rows = [];
        for (const doc of docs) {
          const type = docTypeOf(doc.path);
          if (!type) continue;
          const m = measureDoc(doc.text);
          const state = sizeState(type, m, limits);
          rows.push({
            path: doc.path, type, lines: m.lines, kb: m.kb, ignored: m.ignored, state, action: docAction(type, state),
            needsSummary: needsSummary(type, doc.text), limit: { ...DEFAULT_LIMITS[type], ...(limits[type] ?? {}) },
          });
        }
        return { version: 1, generatedAt: new Date().toISOString(), censusRev: census.rev ?? null, truncated, docs: rows };
      },
    },
    {
      method: 'GET', path: 'pointers',
      run: (ctx) => {
        const doc = pathParam(ctx.query.get('doc'));
        if (!doc || !/\.md$/i.test(doc) || isSecretsFile(doc)) fail(400, 'bad-path');
        if (ctx.demo) {
          const byDoc = ctx.read('pointers.json', null);
          const rows = byDoc && typeof byDoc === 'object' && Object.hasOwn(byDoc, doc) ? byDoc[doc] : null;
          return { doc, pointers: Array.isArray(rows) ? rows : [] };
        }
        // Only what the census takes in: a .md under node_modules or an ignored folder is not the project's document.
        const census = ctx.read('census.json', null);
        if (!Array.isArray(census?.files)) return null;
        if (!census.files.some((f) => f?.path === doc && f.included === true)) fail(404, 'not-found');
        const root = ctx.project.root;
        const text = readText(root, doc);
        if (text === null) fail(404, 'not-found');
        const facts = ctx.read('facts.json', null);
        const readCode = (path) => readText(root, path);
        // The line is worked out on each call, never kept: a document cannot go stale by the code moving (fd13).
        const pointers = pointersIn(text).map((p) => {
          const r = resolvePointer(p, { facts, readCode });
          return { ...p, ok: r.ok, ...(r.ok ? { target: r.line } : { why: r.why }) };
        });
        return { doc, pointers };
      },
    },
  ];
}

export const routes = careRoutes();
