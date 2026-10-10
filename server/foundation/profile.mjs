import { createHash } from 'node:crypto';
import { readFd, writeFd } from './store.mjs';
import { readTextOf, scanManifests, typesOf } from './profile-stacks.mjs';
import { signalsOf, teamOf, gitAuthors, deployOf } from './profile-signals.mjs';

// fd: project profile (contract § 11). What the program detected (`detected`, with evidence) and what the owner answered or
// corrected (`owner`, wins on screen). Everything here is exact: no AI. The only I/O is the profile.json file and, through
// detectProfile, the manifests and the git author count that profile-stacks / profile-signals already do.

const err = (code, message) => Object.assign(new Error(message || code), { code });

export const TYPES = ['web', 'api', 'mobile', 'library', 'cli', 'game', 'data'];
export const STAGES = ['idea', 'prototype', 'first-client', 'growth', 'company'];
// Closed lists for what the owner may answer. `laws` is the list of regimes the owner may name when the country has none.
export const OWNER_LISTS = {
  money: ['subscription', 'sale', 'ads', 'marketplace', 'free', 'personal'],
  audience: ['kids', 'health', 'business', 'general'],
  stage: STAGES,
  team: ['solo', 'team'],
  types: TYPES,
  laws: ['LGPD', 'GDPR', 'UK-GDPR', 'CCPA', 'PIPEDA'],
};
const OWNER_KEYS = ['country', 'money', 'audience', 'stage', 'types', 'team', 'laws'];

// ponytail: convention. ISO-2 codes of the EU member states (GDPR applies); BR is LGPD. Anything else: ask the owner.
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

export function lawsFor(country) {
  const c = typeof country === 'string' ? country.toUpperCase() : '';
  if (c === 'BR') return ['LGPD'];
  if (EU.has(c)) return ['GDPR'];
  return [];
}

export function emptyProfile() {
  return { detected: null, owner: { country: null, laws: [], money: null, audience: [], stage: null, types: [], team: null }, askedAt: null };
}

// Joins the T7 detectors. input: { root, census, facts, readText?, authors? }. `authors` (from gitAuthors) is read with git
// when missing and a root is given. Manifests are read once.
export async function detectProfile({ root, census, facts = [], readText, authors } = {}) {
  const read = readText ?? (root ? readTextOf(root) : () => { throw new Error('no root'); });
  const scan = scanManifests({ census, readText: read });
  const list = authors ?? (root ? await gitAuthors(root) : []);
  return {
    types: typesOf({ census, facts, stacks: scan.stacks, packages: scan.packages }),
    stacks: scan.stacks,
    signals: signalsOf({ facts, deps: scan.deps }),
    team: teamOf(list),
    deploy: deployOf({ census }),
  };
}

const asList = (v) => (Array.isArray(v) ? v : []);

// The profile as the rest of the foundation reads it: the owner's answers win over what was detected.
export function effectiveProfile(detected, owner) {
  const d = detected || {};
  const o = owner || {};
  const types = asList(o.types).length ? [...o.types] : asList(d.types);
  const team = o.team ? { kind: o.team, authors: d.team?.authors ?? null } : (d.team ?? { kind: null, authors: 0 });
  const laws = asList(o.laws).length ? [...o.laws] : lawsFor(o.country);
  return {
    types,
    stacks: asList(d.stacks),
    signals: asList(d.signals),
    team,
    deploy: asList(d.deploy),
    country: o.country ?? null,
    laws,
    money: o.money ?? null,
    audience: asList(o.audience),
    stage: o.stage ?? null,
  };
}

// What still has no answer. No sentence: the screen turns `key` into text. `laws` is asked when the country is known but
// has no law of its own, and the owner has not named one.
export function questionsFor(profile) {
  const p = profile || emptyProfile();
  const o = p.owner || {};
  const out = [];
  if (!o.country) out.push({ key: 'country', options: null });
  if (!o.money) out.push({ key: 'money', options: OWNER_LISTS.money });
  if (!asList(o.audience).length) out.push({ key: 'audience', options: OWNER_LISTS.audience });
  if (!o.stage) out.push({ key: 'stage', options: OWNER_LISTS.stage });
  if (!o.team && !p.detected?.team?.kind) out.push({ key: 'team', options: OWNER_LISTS.team });
  if (o.country && !lawsFor(o.country).length && !asList(o.laws).length) out.push({ key: 'laws', options: OWNER_LISTS.laws });
  return out;
}

function checkOne(key, value) {
  if (value === null) return key === 'audience' || key === 'types' || key === 'laws' ? [] : null;
  if (key === 'country') {
    const c = typeof value === 'string' ? value.toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(c)) throw err('bad-owner', `bad country: ${value}`);
    return c;
  }
  if (key === 'audience' || key === 'types' || key === 'laws') {
    if (!Array.isArray(value) || value.some((v) => !OWNER_LISTS[key].includes(v))) throw err('bad-owner', `bad ${key}`);
    return [...new Set(value)];
  }
  if (!OWNER_LISTS[key].includes(value)) throw err('bad-owner', `bad ${key}: ${value}`);
  return value;
}

// Returns a new profile with the owner's patch applied (null clears a key). Any bad value refuses the whole patch.
export function applyOwner(prev, patch, now = new Date().toISOString()) {
  const base = prev || emptyProfile();
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw err('bad-owner', 'patch must be an object');
  const owner = { ...emptyProfile().owner, ...(base.owner || {}) };
  for (const key of Object.keys(patch)) {
    if (!OWNER_KEYS.includes(key)) throw err('bad-owner', `unknown key: ${key}`);
    owner[key] = checkOne(key, patch[key]);
  }
  return { ...base, owner, askedAt: now };
}

// A new detection replaces `detected`; what the owner said is kept.
export function mergeDetected(prev, detected) {
  const base = prev || emptyProfile();
  return { ...base, detected, owner: { ...emptyProfile().owner, ...(base.owner || {}) } };
}

// Same effective profile = same hash. Evidence, lines and author counts are left out: moving a line does not change it.
export function profileHash(profile) {
  const e = effectiveProfile(profile?.detected, profile?.owner);
  const core = {
    types: [...e.types].sort(),
    stacks: e.stacks.map((s) => `${s.name}@${s.version ?? ''}`).sort(),
    signals: e.signals.map((s) => s.kind).sort(),
    team: e.team.kind ?? null,
    deploy: e.deploy.map((d) => d.name).sort(),
    country: e.country,
    laws: [...e.laws].sort(),
    money: e.money,
    audience: [...e.audience].sort(),
    stage: e.stage,
  };
  return createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

export function readProfile(smDir, projectId) {
  const raw = readFd(smDir, projectId, 'profile.json', null);
  if (!raw || typeof raw !== 'object') return { version: 1, generatedAt: null, ...emptyProfile() };
  return {
    version: 1,
    generatedAt: raw.generatedAt ?? null,
    detected: raw.detected ?? null,
    owner: { ...emptyProfile().owner, ...(raw.owner || {}) },
    askedAt: raw.askedAt ?? null,
  };
}

export function writeProfile(smDir, projectId, profile, now = new Date().toISOString()) {
  const p = profile || emptyProfile();
  writeFd(smDir, projectId, 'profile.json', {
    version: 1,
    generatedAt: now,
    detected: p.detected ?? null,
    owner: { ...emptyProfile().owner, ...(p.owner || {}) },
    askedAt: p.askedAt ?? null,
  });
}
