import { FRONTS, textIn } from './library.mjs';
import { effectiveProfile } from './profile.mjs';
import { RUNGS } from './practices.mjs';

// B5-T10: the project's Compass (compass.json). From the evaluated practices, the profile and the census it answers three
// things, all by written rules and never by AI: which stage the project is at, how each front stands, and the next three
// things to do. Texts stay in the packages; the only sentences here are the request a conversation opens with (`ask`).

export const STAGE_KEYS = ['idea', 'prototype', 'first-client', 'growth', 'company'];
export const BUSINESS_FRONTS = ['legal', 'product', 'marketing', 'finance'];

// ponytail: convention. Fewer files than this is still an idea.
const IDEA_FILES = 10;
// ponytail: convention. A library has no end users of its own: a project that also ships one of these is not "only a library".
const END_USER_TYPES = ['web', 'mobile', 'game'];
const NEXT_COUNT = 3;
const MAX_PER_FRONT = 2;
const DEFAULT_EFFORT = 3;
const MAX_PARAM = 80;
const SEVERITY_RANK = { E: 0, R: 1, A: 2 };
const STATE_RANK = { fail: 0, unverified: 1 };

// ponytail: convention. Who answers a front: the technical ones are working chats; the business ones are the board of the
// orchestration chat (`board:` prefix), because money, law and priority belong to the owner.
const ROLE = { organization: 'technology', quality: 'quality', security: 'security', operation: 'operations' };
// Suggestions only ("if they exist"): the plugin is public and the person may not have them.
const SKILLS = {
  organization: ['session-map:architecture'],
  quality: ['superpowers:test-driven-development'],
  security: ['security-review'],
  operation: ['superpowers:verification-before-completion'],
  legal: [],
  product: ['pm-product-discovery:prioritize-features', 'pm-product-strategy:product-strategy'],
  marketing: ['pm-market-research:market-segments', 'pm-product-strategy:value-proposition'],
  finance: ['pm-product-strategy:pricing-strategy'],
};
const NOT_ADVICE = {
  legal: { en: 'This is guidance, not legal advice: a lawyer reviews it.', 'pt-BR': 'Isto é orientação, não parecer jurídico: um advogado revisa.' },
  finance: { en: 'This is guidance, not financial or tax advice: an accountant reviews it.', 'pt-BR': 'Isto é orientação, não parecer contábil: um contador revisa.' },
};
const WORDS = {
  en: { intro: 'Help me with this best practice in my project', what: 'What it is', why: 'Why it matters', how: 'How to do it', done: 'Done when', skills: 'If they exist, use these skills', plan: 'Show me the plan and wait for my OK before changing any file.' },
  'pt-BR': { intro: 'Me ajude com esta boa prática no meu projeto', what: 'O que é', why: 'Por que importa', how: 'Como fazer', done: 'Pronto quando', skills: 'Se existirem, use estas skills', plan: 'Mostre o plano e espere o meu OK antes de mudar qualquer arquivo.' },
};

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function isoOf(now) {
  const d = new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error('invalid date'), { code: 'bad-now' });
  return d.toISOString();
}

// The profile as the engine reads it: the stored one ({ detected, owner }) or one already flat.
function effectiveOf(profile) {
  const p = isObj(profile) ? profile : {};
  if ('detected' in p || 'owner' in p) return effectiveProfile(p.detected, p.owner);
  return { types: list(p.types), money: p.money ?? null, stage: p.stage ?? null };
}

// ---- stage ----------------------------------------------------------------------------------------------------------

function fileCount(census) {
  return Array.isArray(census?.files) ? census.files.filter((f) => f && f.included !== false).length : null;
}

function stageOf(effective, practices, census) {
  if (STAGE_KEYS.includes(effective.stage)) return { key: effective.stage, origin: 'owner', reason: 'owner' };
  const guessed = (key, reason) => ({ key, origin: 'guessed', reason });
  const count = fileCount(census);
  if (count !== null && count < IDEA_FILES) return guessed('idea', 'few-files');
  const evaluated = list(practices?.items).some((i) => i && (i.state === 'pass' || i.state === 'fail' || i.state === 'unverified'));
  if (!evaluated) return guessed('prototype', 'no-data');
  const level = practices.ladder?.level ?? null;
  if (level === 'N4') return guessed('company', 'level-n4');
  if (level === 'N3') return guessed('growth', 'level-n3');
  if (level === 'N2') return guessed('first-client', 'level-n2');
  return guessed('prototype', 'level-below-n2');
}

// ---- fronts ---------------------------------------------------------------------------------------------------------

// Business fronts mean nothing to a personal project, nor to a library with no answer about money.
function businessIsNa(effective) {
  if (effective.money === 'personal') return true;
  const types = list(effective.types);
  return types.includes('library') && !types.some((t) => END_USER_TYPES.includes(t)) && !effective.money;
}

function frontsOf(items, naFronts) {
  const count = Object.fromEntries(FRONTS.map((f) => [f, { pass: 0, fail: 0, unverified: 0 }]));
  for (const it of items) if (count[it.front] && count[it.front][it.state] !== undefined) count[it.front][it.state]++;
  return FRONTS.map((front) => {
    const { pass, fail, unverified } = count[front];
    let state = 'na';
    if (!naFronts.has(front)) state = fail > 0 ? 'warning' : unverified > 0 ? 'unverified' : pass > 0 ? 'ok' : 'na';
    return { front, state, pass, fail, unverified };
  });
}

// ---- example --------------------------------------------------------------------------------------------------------

const PLACEHOLDER = /\{(route|table|integration|app)\}/g;

const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, MAX_PARAM).trim();

// The first fact of each kind the project really has (sorted, so the same project always gives the same example). A route
// with a path the reader could not resolve is not an example.
function sampleFacts(facts) {
  const all = list(facts).filter((f) => isObj(f) && typeof f.id === 'string');
  const first = (pick) => {
    const found = all.map(pick).map(clean).filter(Boolean).sort(byText);
    return found.length ? found[0] : null;
  };
  return {
    route: first((f) => (f.kind === 'route' && f.origin !== 'AMBIGUOUS' && f.attrs?.path ? f.name : null)),
    table: first((f) => (f.kind === 'table' ? f.name : null)),
    integration: first((f) => (f.kind === 'integration' ? f.name : null)),
    app: first((f) => (f.kind === 'screen' ? /^screen:([^:]+):/.exec(f.id)?.[1] : null)),
  };
}

function exampleOf(def, sample) {
  if (!isObj(def?.example)) return null;
  const names = new Set();
  for (const text of Object.values(def.example)) for (const m of String(text).matchAll(PLACEHOLDER)) names.add(m[1]);
  const params = {};
  for (const name of [...names].sort()) {
    if (!sample[name]) return null;
    params[name] = sample[name];
  }
  return { params };
}

// ---- ask ------------------------------------------------------------------------------------------------------------

function askText(lang, item, def, front) {
  const w = WORDS[lang];
  const skills = SKILLS[front] ?? [];
  const title = def ? textIn(def.title, lang) || item.id : item.id;
  const lines = [`${w.intro}: "${title}".`];
  for (const [label, key] of [['what', 'what'], ['why', 'why'], ['how', 'how'], ['done', 'doneWhen']]) {
    const text = def ? textIn(def[key], lang) : '';
    if (text) lines.push(`${w[label]}: ${text}`);
  }
  if (skills.length) lines.push(`${w.skills}: ${skills.join(', ')}.`);
  if (NOT_ADVICE[front]) lines.push(NOT_ADVICE[front][lang]);
  lines.push(w.plan);
  return lines.join('\n');
}

function askOf(item, def) {
  const front = item.front;
  return {
    text: { en: askText('en', item, def, front), 'pt-BR': askText('pt-BR', item, def, front) },
    skills: [...(SKILLS[front] ?? [])],
    role: ROLE[front] ?? `board:${front}`,
  };
}

// ---- next three -----------------------------------------------------------------------------------------------------

// The lowest rung with something to do first; inside a rung, what failed before what could not be verified, then the
// severity (Essential > Recommended > Advanced) and the effort (cheapest first). No front takes more than two of the
// three while another front still has something to do.
function pickNext(items, naFronts, defs) {
  const effortOf = (id) => (Number.isFinite(defs.get(id)?.effort) ? defs.get(id).effort : DEFAULT_EFFORT);
  const pool = items
    .filter((i) => STATE_RANK[i.state] !== undefined && !naFronts.has(i.front) && RUNGS.includes(i.ladder))
    .sort((a, b) => RUNGS.indexOf(a.ladder) - RUNGS.indexOf(b.ladder)
      || STATE_RANK[a.state] - STATE_RANK[b.state]
      || (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
      || effortOf(a.id) - effortOf(b.id)
      || byText(a.id, b.id));
  const chosen = [];
  const used = new Map();
  for (const it of pool) {
    if (chosen.length >= NEXT_COUNT) break;
    if ((used.get(it.front) ?? 0) >= MAX_PER_FRONT) continue;
    chosen.push(it);
    used.set(it.front, (used.get(it.front) ?? 0) + 1);
  }
  for (const it of pool) {
    if (chosen.length >= NEXT_COUNT) break;
    if (!chosen.includes(it)) chosen.push(it);
  }
  return chosen;
}

// input: { practices, profile, census, now, packages?, facts? }. `packages` (the library) gives the text, the effort and
// the example of each item; `facts` (facts.json `.facts`) gives the example its real route, table, integration or app.
export function buildCompass({ practices, profile, census, now, packages, facts } = {}) {
  const generatedAt = isoOf(now);
  const effective = effectiveOf(profile);
  const items = list(practices?.items).filter((i) => isObj(i) && typeof i.id === 'string');
  const naFronts = new Set(businessIsNa(effective) ? BUSINESS_FRONTS : []);
  const defs = new Map();
  for (const pkg of list(packages)) for (const d of list(pkg?.items)) if (d && typeof d.id === 'string' && !defs.has(d.id)) defs.set(d.id, d);
  const sample = sampleFacts(facts);
  const next3 = pickNext(items, naFronts, defs).map((item) => {
    const def = defs.get(item.id) ?? null;
    return { itemId: item.id, front: item.front, example: exampleOf(def, sample), ask: askOf(item, def) };
  });
  const inPlay = new Set(items.map((i) => i.pkg));
  const disclaimers = list(packages).filter((p) => p && inPlay.has(p.id) && p.disclaimer).map((p) => p.id).sort(byText);
  return {
    version: 1,
    generatedAt,
    stage: stageOf(effective, practices, census),
    stages: [...STAGE_KEYS],
    fronts: frontsOf(items, naFronts),
    next3,
    disclaimers,
  };
}
