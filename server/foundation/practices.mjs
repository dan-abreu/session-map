import { FRONTS, appliesTo, profileFacets, selectFor } from './library.mjs';
import { effectiveProfile, profileHash } from './profile.mjs';
import { detectItem } from './practices-detect.mjs';

// B5-T9: the best-practices engine. Packages (data) + profile + what the project shows -> practices.json (four states per
// item, the N0-N4 ladder, the score per front). Exact work is program: no AI, no wording here. Texts stay in the packages
// and the route joins them by `id`. The rule of the whole engine: what could not be verified is `unverified` (with a
// reason), never `fail`; what the profile excludes is `na`; and a level that depends on unverified items is `provisional`.

export const RUNGS = ['N0', 'N1', 'N2', 'N3', 'N4'];
export const ATTEST_DAYS = 90;
const MAX_NOTE = 300;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const MAX_EVIDENCE = 5;
const DAY_MS = 86400000;

const err = (code, message) => Object.assign(new Error(message || code), { code });
const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function isoOf(now, code) {
  const d = new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw err(code, 'invalid date');
  return d.toISOString();
}

// ---- profile ------------------------------------------------------------------------------------------------------

// Accepts the stored profile ({ detected, owner }, the profile.json shape) or a flat one ({ types, stacks, money… }).
function storedOf(profile) {
  const p = isObj(profile) ? profile : {};
  if ('detected' in p || 'owner' in p) return { detected: p.detected ?? null, owner: p.owner ?? {} };
  return {
    detected: { types: list(p.types), stacks: list(p.stacks), signals: list(p.signals), team: p.team ?? { kind: null, authors: 0 }, deploy: list(p.deploy) },
    owner: { country: p.country ?? null, laws: list(p.laws), money: p.money ?? null, audience: list(p.audience), stage: p.stage ?? null, types: [], team: null },
  };
}

// ---- attest -------------------------------------------------------------------------------------------------------

// prev: { "<itemId>": { at, expiresAt, note } }. Returns a new map; the date and limits are the ones of idea checks.
export function attestPractice(prev, id, { note, days = ATTEST_DAYS } = {}, now) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw err('bad-idea', 'bad practice id');
  const text = String(note ?? '').trim();
  if (!Number.isInteger(days) || days < 1 || days > 365 || text.length > MAX_NOTE) throw err('bad-idea', 'bad attest');
  const at = isoOf(now, 'bad-idea');
  return { ...(isObj(prev) ? prev : {}), [id]: { at, expiresAt: new Date(Date.parse(at) + days * DAY_MS).toISOString(), note: text } };
}

// The attests a previous practices.json carries, so the next evaluation keeps them.
export function attestsOf(practices) {
  const out = {};
  for (const item of list(practices && practices.items)) if (item && item.id && isObj(item.attested)) out[item.id] = item.attested;
  return out;
}

function cleanAttest(a) {
  if (!isObj(a) || Number.isNaN(Date.parse(a.at)) || Number.isNaN(Date.parse(a.expiresAt))) return null;
  return { at: a.at, expiresAt: a.expiresAt, note: typeof a.note === 'string' ? a.note : '' };
}

// ---- ladder -------------------------------------------------------------------------------------------------------

// items: [{ ladder, state, front }]. Decision 5, read as "fail locks; unverified leaves it provisional" (the same reading as
// ideas.levelOf and foundation.md: an unverified check keeps the level provisional instead of failing it). The level is
// the rung just below the lowest `fail` (N4 when nothing fails, null when N0 fails); `na` is outside the count. An
// `unverified` item never holds the level back: it makes it `provisional` when it sits inside the level reached (checking
// it could lower the level). nextPercent = pass / (pass + fail + unverified) of the locked rung, rounded down (99.9 % is
// 99); null when nothing fails.
export function ladderOf(items) {
  const rung = RUNGS.map(() => ({ pass: 0, fail: 0, unverified: 0 }));
  const byFront = Object.fromEntries(FRONTS.map((f) => [f, { pass: 0, fail: 0, unverified: 0, na: 0 }]));
  for (const it of list(items)) {
    const r = RUNGS.indexOf(it && it.ladder);
    if (r >= 0 && rung[r][it.state] !== undefined) rung[r][it.state]++;
    if (it && byFront[it.front] && byFront[it.front][it.state] !== undefined) byFront[it.front][it.state]++;
  }
  const firstFail = rung.findIndex((r) => r.fail > 0);
  const lock = firstFail < 0 ? RUNGS.length : firstFail;
  const provisional = rung.some((r, i) => r.unverified > 0 && i < lock);
  let nextPercent = null;
  if (firstFail >= 0) {
    const { pass, fail, unverified } = rung[firstFail];
    nextPercent = Math.floor((pass * 100) / (pass + fail + unverified));
  }
  return { level: lock === 0 ? null : RUNGS[lock - 1], provisional, nextPercent, byFront };
}

// ---- evaluation ---------------------------------------------------------------------------------------------------

const evidenceOf = (list_) => list(list_).filter((e) => e && e.file).slice(0, MAX_EVIDENCE).map((e) => ({ file: e.file, line: Number.isInteger(e.line) && e.line > 0 ? e.line : 1 }));

function settle(result, item, attested, nowMs) {
  if (result.state !== 'unverified' || !attested) return result;
  if (Date.parse(attested.expiresAt) > nowMs) return { state: 'pass', reason: null, evidence: [] };
  // An old attest never hides the real reason; only a manual item, which has no other, says the attest ran out.
  return item.detect && item.detect.kind === 'manual' ? { ...result, reason: 'attest-expired' } : result;
}

// input: { packages, profile, census, facts, deps, readText, health, attest, now }
//   packages: loadLibrary().packages · profile: profile.json or flat · census: census.json · deps: depsOf() ·
//   readText: readTextOf(root) · health: health.json (or null) · attest: { "<itemId>": { at, expiresAt, note } }
export function evaluatePractices({ packages, profile, census, facts, deps, readText, health, attest, now } = {}) {
  const generatedAt = isoOf(now, 'bad-now');
  const nowMs = Date.parse(generatedAt);
  const stored = storedOf(profile);
  const effective = effectiveProfile(stored.detected, stored.owner);
  const facets = profileFacets(effective);
  const attests = isObj(attest) ? attest : {};
  const chosen = [...selectFor(effective, list(packages))].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set();
  const items = [];
  for (const pkg of chosen) {
    for (const item of list(pkg.items)) {
      if (!item || typeof item.id !== 'string' || seen.has(item.id)) continue;
      seen.add(item.id);
      const attested = cleanAttest(attests[item.id]);
      let result;
      if (!appliesTo(item.appliesIf, facets)) result = { state: 'na', reason: 'not-applicable', evidence: [] };
      else result = settle(detectItem(item, { census, readText, health, deps, facts, stacks: effective.stacks, pkg, now: generatedAt }), item, attested, nowMs);
      items.push({
        id: item.id, pkg: pkg.id, front: item.front, ladder: item.ladder, severity: item.severity,
        state: result.state, reason: result.reason, evidence: evidenceOf(result.evidence), attested,
      });
    }
  }
  return { version: 1, generatedAt, profileHash: profileHash(stored), items, ladder: ladderOf(items) };
}
