// Foundation routes of block B5 (fd15, profile, practices, compass, library): the project's profile and the owner's
// answers, the best practices and the Compass with their texts, the ideas checked against the professional standard,
// and /api/library. Contract: http/index.mjs (token, header, 64 KB, --demo and unknown project are gated there).
// Texts are joined here from the library (knowledge/ in this repository and the user's local layer) by `id`, never from
// a file on disk that a project could have written; a package or item id is only ever a key, never a path.
import { log } from '../../log.mjs';
import { recomputeGuide } from '../guide.mjs';
import { canMarkDone, evaluateIdea, levelOf, markDone, newIdea, reopenIdea, resizeIdea, attestCheck, acceptUnverified } from '../ideas.mjs';
import { gapsOf, loadLibrary, localKnowledgeDir, selectFor, sharedKnowledgeDir, staleOf, statusOf } from '../library.mjs';
import { attestPractice, attestsOf } from '../practices.mjs';
import { applyOwner, effectiveProfile, emptyProfile, questionsFor, writeProfile } from '../profile.mjs';
import { defaultStandard, stagesFor } from '../standard.mjs';
import { fail } from './common.mjs';

// What the engine modules throw (err.code), as HTTP.
const ERRORS = { 'bad-owner': 400, 'bad-idea': 400, 'unknown-check': 400, 'unknown-idea': 404, 'essential-failed': 409 };
const IDEA_ID_RE = /^idea:[0-9a-f]{8}$/;
const PRACTICE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const TEXT_KEYS = ['title', 'what', 'why', 'how', 'doneWhen'];
const PLACEHOLDER_RE = /\{(route|table|integration|app)\}/g;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

// Runs an engine call; a known refusal becomes its HTTP error, anything else stays a 500.
function guarded(fn) {
  try {
    return fn();
  } catch (err) {
    if (ERRORS[err?.code]) fail(ERRORS[err.code], err.code);
    throw err;
  }
}

// ---- library ------------------------------------------------------------------------------------------------------

// The user's local layer is private learning: the demo (shown to others) reads only the shared packages.
const libraryOf = (ctx) => loadLibrary({ sharedDir: sharedKnowledgeDir(), localDir: ctx.demo ? null : localKnowledgeDir(ctx.smDir) });

function definitions(packages) {
  const items = new Map();
  for (const pkg of packages) for (const item of list(pkg.items)) if (item && typeof item.id === 'string' && !items.has(item.id)) items.set(item.id, item);
  return { items, packages: new Map(packages.map((p) => [p.id, p])) };
}

const textOf = (def) => (def ? Object.fromEntries(TEXT_KEYS.map((k) => [k, isObj(def[k]) ? def[k] : null])) : null);

function fillExample(text, params) {
  if (!isObj(text)) return null;
  const fill = (s) => String(s).replace(PLACEHOLDER_RE, (m, key) => (typeof params?.[key] === 'string' ? params[key] : m));
  return Object.fromEntries(Object.entries(text).filter(([, v]) => typeof v === 'string').map(([lang, v]) => [lang, fill(v)]));
}

// ---- profile ------------------------------------------------------------------------------------------------------

const storedProfile = (ctx) => {
  const raw = ctx.read('profile.json', null);
  return isObj(raw) ? raw : null;
};

const profileView = (p) => (p ? { ...p, effective: effectiveProfile(p.detected, p.owner), questions: questionsFor(p) } : null);

const target = (ctx) => ({ id: ctx.project.id, root: ctx.project.root });

// The guide follows the owner's answer; when it cannot be recomputed now, the answer is kept and the next round redoes it.
async function recompute(ctx, what) {
  try {
    await recomputeGuide(ctx.smDir, target(ctx));
  } catch (err) {
    log('warn', 'foundation-guide-recompute-failed', { project: ctx.project.id, what, error: err.message });
  }
  ctx.fresh();
}

async function putProfile(ctx) {
  const body = ctx.body;
  if (!isObj(body) || Object.keys(body).some((k) => k !== 'owner') || !isObj(body.owner)) fail(400, 'bad-owner');
  const prev = storedProfile(ctx) ?? { version: 1, generatedAt: null, ...emptyProfile() };
  const now = new Date().toISOString();
  const next = guarded(() => applyOwner(prev, body.owner, now));
  writeProfile(ctx.smDir, ctx.project.id, next, now);
  await recompute(ctx, 'profile');
  return profileView(storedProfile(ctx));
}

// ---- practices and compass ----------------------------------------------------------------------------------------

function practicesView(doc, defs) {
  if (!isObj(doc)) return null;
  const items = list(doc.items).filter(isObj).map((it) => {
    const def = defs.items.get(it.id) ?? null;
    return {
      id: it.id, pkg: it.pkg, front: it.front, ladder: it.ladder, severity: it.severity, state: it.state, reason: it.reason ?? null,
      evidence: list(it.evidence), attested: it.attested ?? null,
      text: textOf(def), source: def?.source ?? null, effort: def?.effort ?? null, standard: list(def?.standard),
    };
  });
  return { version: doc.version, generatedAt: doc.generatedAt, profileHash: doc.profileHash, items, ladder: doc.ladder ?? null };
}

function compassView(doc, defs) {
  if (!isObj(doc)) return null;
  const next3 = list(doc.next3).filter(isObj).map((n) => {
    const def = defs.items.get(n.itemId) ?? null;
    const text = textOf(def);
    if (text) text.example = n.example ? fillExample(def.example, n.example.params) : null;
    return { ...n, text, source: def?.source ?? null };
  });
  const notices = list(doc.disclaimers).map((id) => defs.packages.get(id)).filter((p) => p?.disclaimer).map((p) => ({ pkg: p.id, text: p.disclaimer }));
  return { ...doc, next3, notices };
}

async function attestOnePractice(ctx) {
  const id = ctx.params.pid;
  if (!PRACTICE_ID_RE.test(id)) fail(400, 'bad-idea');
  const body = isObj(ctx.body) ? ctx.body : fail(400, 'bad-idea');
  if (body.action !== 'attest') fail(400, 'bad-idea');
  const doc = ctx.read('practices.json', null);
  const item = list(doc?.items).find((i) => i?.id === id) ?? fail(400, 'unknown-check');
  if (body.note !== undefined && typeof body.note !== 'string') fail(400, 'bad-idea');
  const days = body.days === undefined ? undefined : body.days;
  const attests = guarded(() => attestPractice(attestsOf(doc), id, { note: body.note, days }, new Date().toISOString()));
  item.attested = attests[id];
  ctx.write('practices.json', doc);
  log('info', 'foundation-guide-write', { project: ctx.project.id, what: 'practice-attest', id });
  await recompute(ctx, 'practice');
  return practicesView(ctx.read('practices.json', null), definitions(libraryOf(ctx).packages));
}

// ---- ideas --------------------------------------------------------------------------------------------------------

// The practices with the `standard` ids their library item covers: that link is how a practice answers an idea's check.
function linkedPractices(ctx, defs) {
  return list(ctx.read('practices.json', null)?.items).filter(isObj)
    .map((it) => ({ ...it, standard: list(defs.items.get(it.id)?.standard) }));
}

function ideaInputs(ctx) {
  const stored = storedProfile(ctx);
  const defs = definitions(libraryOf(ctx).packages);
  return {
    profile: stored ? effectiveProfile(stored.detected, stored.owner) : null,
    practices: linkedPractices(ctx, defs),
    standard: defaultStandard(),
    now: new Date().toISOString(),
  };
}

const evaluate = (idea, inputs) => evaluateIdea(idea, inputs);

function ideaView(idea, inputs, texts) {
  return {
    ...idea,
    checks: list(idea.checks).map((c) => ({ ...c, text: texts.get(c.id) ?? null })),
    stages: stagesFor({ size: idea.size, sensitive: idea.sensitive, profile: inputs.profile }),
    level: levelOf(idea),
    canDone: canMarkDone(idea),
  };
}

const standardTexts = (inputs) => new Map(inputs.standard.map((c) => [c.id, c.text]));

function readIdeas(ctx) {
  const doc = ctx.read('ideas.json', null);
  return isObj(doc) && Array.isArray(doc.ideas) ? doc : null;
}

function saveIdeas(ctx, ideas, what, id) {
  ctx.write('ideas.json', { version: 1, generatedAt: new Date().toISOString(), ideas });
  log('info', 'foundation-guide-write', { project: ctx.project.id, what, id });
  ctx.fresh();
}

function getIdeas(ctx) {
  const doc = readIdeas(ctx);
  if (!doc) return null;
  const inputs = ideaInputs(ctx);
  const texts = standardTexts(inputs);
  // Checks are re-read against today's practices: what the project shows now, not what it showed when the idea was saved.
  // A damaged entry is left out of the answer (and logged) instead of hiding every other idea.
  const ideas = [];
  for (const idea of doc.ideas.filter(isObj)) {
    try {
      ideas.push(ideaView(evaluate(idea, inputs), inputs, texts));
    } catch (err) {
      log('warn', 'foundation-guide-bad-idea', { project: ctx.project.id, id: String(idea.id).slice(0, 40), error: err.message });
    }
  }
  return { ...doc, ideas };
}

function postIdea(ctx) {
  const body = isObj(ctx.body) ? ctx.body : fail(400, 'bad-idea');
  if (typeof body.text !== 'string') fail(400, 'bad-idea');
  const inputs = ideaInputs(ctx);
  const idea = guarded(() => evaluate(newIdea(body.text, { now: inputs.now, size: body.size, sensitive: body.sensitive }), inputs));
  const ideas = list(readIdeas(ctx)?.ideas);
  const same = ideas.find((i) => i?.id === idea.id);
  if (same) return ideaView(same, inputs, standardTexts(inputs));
  saveIdeas(ctx, [...ideas, idea], 'idea-new', idea.id);
  return ideaView(idea, inputs, standardTexts(inputs));
}

const ACTIONS = {
  attest(idea, body, inputs) {
    if (typeof body.checkId !== 'string' || (body.note !== undefined && typeof body.note !== 'string')) fail(400, 'bad-idea');
    return evaluate(attestCheck(idea, body.checkId, { note: body.note, days: body.days ?? 90, now: inputs.now }), inputs);
  },
  // An essential that failed always blocks; an essential nobody verified passes only with the owner's explicit yes.
  done(idea, body, inputs) {
    let next = idea;
    if (body.acceptUnverified === true) for (const id of canMarkDone(idea).unverified) next = acceptUnverified(next, id);
    return markDone(next, inputs.now);
  },
  reopen: (idea, body, inputs) => evaluate(reopenIdea(idea), inputs),
  resize: (idea, body, inputs) => evaluate(resizeIdea(idea, { size: body.size, sensitive: body.sensitive }), inputs),
};

function changeIdea(ctx) {
  const iid = ctx.params.iid;
  if (!IDEA_ID_RE.test(iid)) fail(404, 'unknown-idea');
  const body = isObj(ctx.body) ? ctx.body : fail(400, 'bad-idea');
  const action = Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : fail(400, 'bad-idea');
  const ideas = list(readIdeas(ctx)?.ideas);
  const at = ideas.findIndex((i) => i?.id === iid);
  if (at < 0) fail(404, 'unknown-idea');
  const inputs = ideaInputs(ctx);
  const current = guarded(() => evaluate(ideas[at], inputs));
  const next = guarded(() => action(current, body, inputs));
  saveIdeas(ctx, ideas.map((i, n) => (n === at ? next : i)), `idea-${body.action}`, iid);
  return ideaView(next, inputs, standardTexts(inputs));
}

// ---- library ------------------------------------------------------------------------------------------------------

async function library(ctx) {
  const project = await ctx.projectOf(ctx.query.get('project'));
  const raw = ctx.readFor(project.id, 'profile.json', null);
  const profile = isObj(raw) ? effectiveProfile(raw.detected, raw.owner) : effectiveProfile(null, null);
  const { packages, invalid } = libraryOf(ctx);
  const today = new Date();
  const chosen = selectFor(profile, packages);
  return {
    packages: chosen.map((p) => ({
      id: p.id, kind: p.kind, title: p.title, status: statusOf(p, today), checkedAt: p.checkedAt,
      disclaimer: p.disclaimer ?? null, itemCount: list(p.items).length, source: p.layer === 'local' ? 'local' : 'shared',
    })),
    gaps: gapsOf(profile, packages),
    stale: staleOf(chosen, today),
    invalid: invalid.map((i) => ({ file: i.file, error: i.error })),
  };
}

export const routes = [
  { method: 'GET', path: 'profile', run: (ctx) => profileView(storedProfile(ctx)) },
  { method: 'PUT', path: 'profile', run: putProfile },
  { method: 'GET', path: 'practices', run: (ctx) => practicesView(ctx.read('practices.json', null), definitions(libraryOf(ctx).packages)) },
  { method: 'POST', path: 'practice/:pid', run: attestOnePractice },
  { method: 'GET', path: 'compass', run: (ctx) => compassView(ctx.read('compass.json', null), definitions(libraryOf(ctx).packages)) },
  { method: 'GET', path: 'ideas', run: getIdeas },
  { method: 'POST', path: 'idea', run: postIdea },
  { method: 'POST', path: 'idea/:iid', run: changeIdea },
  { method: 'GET', path: 'library', global: true, run: library },
];
