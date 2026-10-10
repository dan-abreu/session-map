import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../log.mjs';

// The library is data, not code: packages in knowledge/*.json (shared, in the repository) and in a local layer on the
// user's machine. Nothing here holds guidance text; it loads, checks, selects and ages packages.

export const KINDS = ['general', 'stack', 'type', 'legal', 'finance', 'marketing', 'sales'];
export const FRONTS = ['organization', 'quality', 'security', 'operation', 'legal', 'product', 'marketing', 'finance'];
export const MAX_AGE_DAYS = { legal: 90, finance: 90, stack: 180, general: 365, type: 365, marketing: 365, sales: 365 };

const APPLIES_KEYS = ['types', 'stacks', 'signals', 'countries', 'money', 'audience', 'stages'];
const FACET_OF_OWNER = { country: 'countries', money: 'money', stage: 'stages' };
const LADDER = /^N[0-4]$/;
const SEVERITY = ['E', 'R', 'A'];
const TRUST = ['V', 'F', 'C', 'NV'];
const DETECT_KINDS = ['file', 'content', 'health', 'dep', 'supported-version', 'manual'];
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_NAME = /^[a-z0-9][a-z0-9._+-]{0,40}$/i;
const PLACEHOLDERS = new Set(['route', 'table', 'integration', 'app']);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_REGEX_LENGTH = 200;
const DAY_MS = 86400000;
const LOCAL_HINT = '~/.claude/session-map/knowledge';
const NEEDS_DISCLAIMER = new Set(['legal', 'finance']);

export function sharedKnowledgeDir() {
  return fileURLToPath(new URL('../../knowledge', import.meta.url));
}

export function localKnowledgeDir(smDir = join(homedir(), '.claude', 'session-map')) {
  return join(smDir, 'knowledge');
}

// ---- small readers ------------------------------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const strList = (v) => Array.isArray(v) && v.length > 0 && v.every(isStr);
const isText = (v) => isObj(v) && isStr(v.en) && isStr(v['pt-BR']);
const isHttps = (v) => {
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
};

function dayNumber(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : Math.floor(value.getTime() / DAY_MS);
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value / DAY_MS) : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return Math.floor(ms / DAY_MS);
}

export function textIn(text, lang = 'en') {
  if (!isObj(text)) return '';
  return String(text[lang] || text.en || '');
}

// A pattern that reaches a file must stay inside the project and never aim at a secrets file.
function safeGlob(glob) {
  if (!isStr(glob) || glob.length > 200) return false;
  const g = glob.replaceAll('\\', '/');
  if (g.startsWith('/') || /^[a-z]:/i.test(g) || g.split('/').includes('..')) return false;
  const name = g.split('/').pop();
  return !(/^\.env/i.test(name) && !/\.(example|sample|template|dist)$/i.test(name));
}

// ---- validation ---------------------------------------------------------------------------------------------------

function checkApplies(value, where, errors) {
  if (value === undefined) return;
  if (!isObj(value)) { errors.push(`${where}: must be an object`); return; }
  for (const [key, list] of Object.entries(value)) {
    if (!APPLIES_KEYS.includes(key)) errors.push(`${where}: unknown field "${key}"`);
    else if (!Array.isArray(list) || !list.every(isStr)) errors.push(`${where}.${key}: must be a list of texts`);
  }
}

function checkDetect(detect, where, errors) {
  const bad = (why) => errors.push(`${where}.detect: ${why}`);
  if (!isObj(detect) || !DETECT_KINDS.includes(detect.kind)) return bad('unknown kind');
  if (detect.kind === 'file') {
    if (!strList(detect.anyOf) || !detect.anyOf.every(safeGlob)) bad('file needs anyOf: a list of safe project paths');
  } else if (detect.kind === 'content') {
    if (!strList(detect.files) || !detect.files.every(safeGlob)) bad('content needs files: a list of safe project paths');
    const hasContains = strList(detect.contains);
    const hasMatches = strList(detect.matches);
    if (!hasContains && !hasMatches) bad('content needs contains or matches');
    if (hasMatches) {
      for (const source of detect.matches) {
        try {
          if (source.length > MAX_REGEX_LENGTH) throw new Error('long');
          new RegExp(source);
        } catch { bad('matches holds a pattern that does not compile or is too long'); break; }
      }
    }
    if (detect.minLines !== undefined && !(Number.isInteger(detect.minLines) && detect.minLines > 0)) bad('minLines must be a positive number');
  } else if (detect.kind === 'health') {
    if (!isStr(detect.id)) bad('health needs the id of a health item');
  } else if (detect.kind === 'dep') {
    if (!isStr(detect.name)) bad('dep needs a name');
  } else if (detect.kind === 'supported-version') {
    if (!isStr(detect.stack)) bad('supported-version needs a stack');
  }
}

function checkExample(example, where, errors) {
  if (example === undefined || example === null) return;
  if (!isText(example)) { errors.push(`${where}.example: needs en and pt-BR`); return; }
  for (const lang of ['en', 'pt-BR']) {
    for (const m of example[lang].matchAll(/\{([^}]*)\}/g)) {
      if (!PLACEHOLDERS.has(m[1])) errors.push(`${where}.example: "{${m[1]}}" is not a project fact (use route, table, integration, app)`);
    }
  }
}

function checkSource(source, where, errors) {
  if (!isObj(source) || !isStr(source.name)) { errors.push(`${where}.source: needs a name`); return; }
  if (!TRUST.includes(source.trust)) { errors.push(`${where}.source: trust must be one of ${TRUST.join(' ')}`); return; }
  const url = source.url;
  if (url === null || url === undefined) {
    if (source.trust === 'V' || source.trust === 'F') errors.push(`${where}.source: a ${source.trust} source needs an https url`);
  } else if (!isHttps(url)) errors.push(`${where}.source: url must be https`);
}

function checkItem(item, index, seen, errors) {
  const where = `items[${index}]`;
  if (!isObj(item)) { errors.push(`${where}: must be an object`); return; }
  if (!isStr(item.id)) errors.push(`${where}: id is missing`);
  else if (seen.has(item.id)) errors.push(`${where}: duplicate id "${item.id}"`);
  else seen.add(item.id);
  if (!FRONTS.includes(item.front)) errors.push(`${where}: front must be one of ${FRONTS.join(' ')}`);
  if (!LADDER.test(item.ladder)) errors.push(`${where}: ladder must be N0 to N4`);
  if (!SEVERITY.includes(item.severity)) errors.push(`${where}: severity must be E, R or A`);
  if (!(Number.isInteger(item.effort) && item.effort >= 1 && item.effort <= 3)) errors.push(`${where}: effort must be 1 to 3`);
  for (const field of ['title', 'what', 'why', 'how', 'doneWhen']) {
    if (!isText(item[field])) errors.push(`${where}: ${field} needs en and pt-BR`);
  }
  checkExample(item.example, where, errors);
  checkApplies(item.appliesIf, `${where}.appliesIf`, errors);
  checkDetect(item.detect, where, errors);
  if (item.standard !== undefined && !(Array.isArray(item.standard) && item.standard.every(isStr))) errors.push(`${where}: standard must be a list of ids`);
  checkSource(item.source, where, errors);
}

function checkLifecycle(life, errors) {
  if (life === undefined || life === null) return;
  if (!isObj(life) || !isStr(life.product) || !Array.isArray(life.cycles)) { errors.push('lifecycle: needs product and cycles'); return; }
  life.cycles.forEach((c, i) => {
    const ok = isObj(c) && isStr(c.cycle) && isHttps(c.source)
      && [c.supportUntil, c.securityUntil].every((d) => d === null || dayNumber(d) !== null);
    if (!ok) errors.push(`lifecycle.cycles[${i}]: needs cycle, dates (or null) and an https source`);
  });
}

export function validatePackage(pkg) {
  const errors = [];
  if (!isObj(pkg)) return { ok: false, errors: ['package must be an object'] };
  if (pkg.version !== 1) errors.push('version must be 1');
  if (!(typeof pkg.id === 'string' && ID_RE.test(pkg.id))) errors.push('id must be a short slug');
  if (!KINDS.includes(pkg.kind)) errors.push(`kind must be one of ${KINDS.join(' ')}`);
  if (!isText(pkg.title)) errors.push('title needs en and pt-BR');
  checkApplies(pkg.applies, 'applies', errors);
  if (dayNumber(pkg.checkedAt) === null) errors.push('checkedAt must be a real date YYYY-MM-DD');
  if (!['confirmed', 'recheck'].includes(pkg.status)) errors.push('status must be confirmed or recheck');
  checkLifecycle(pkg.lifecycle, errors);
  if (!Array.isArray(pkg.items)) {
    errors.push('items must be a list');
    return { ok: false, errors };
  }
  const seen = new Set();
  pkg.items.forEach((item, i) => checkItem(item, i, seen, errors));
  const touchesLaw = NEEDS_DISCLAIMER.has(pkg.kind) || pkg.items.some((it) => NEEDS_DISCLAIMER.has(it?.front));
  if (touchesLaw && !isText(pkg.disclaimer)) errors.push('disclaimer (en and pt-BR) is required for legal and finance content');
  else if (pkg.disclaimer !== null && pkg.disclaimer !== undefined && !isText(pkg.disclaimer)) errors.push('disclaimer needs en and pt-BR');
  if (pkg.status === 'confirmed' && pkg.items.some((it) => it?.source?.trust === 'NV')) {
    errors.push('an unchecked (NV) item makes the package status recheck');
  }
  return { ok: errors.length === 0, errors };
}

// ---- loading ------------------------------------------------------------------------------------------------------

function readLayer(dir, layer, packages, invalid) {
  if (!dir || !existsSync(dir)) return;
  let names;
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch (e) {
    log('warn', 'library.readdir', { layer, error: e.message });
    return;
  }
  for (const name of names) {
    const fail = (error) => invalid.push({ file: name, layer, error });
    try {
      const path = join(dir, name);
      if (statSync(path).size > MAX_FILE_BYTES) { fail('file is too large'); continue; }
      let data;
      try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('not valid JSON'); continue; }
      const { ok, errors } = validatePackage(data);
      if (!ok) { fail(errors.slice(0, 3).join('; ')); continue; }
      if (`${data.id}.json` !== name) { fail('id does not match the file name'); continue; }
      packages.set(data.id, { ...data, layer });
    } catch (e) {
      log('warn', 'library.read', { layer, file: name, error: e.message });
      fail('could not be read');
    }
  }
}

// The local layer is read last, so it wins by id; a broken local file leaves the shared package standing.
export function loadLibrary({ sharedDir, localDir } = {}) {
  const packages = new Map();
  const invalid = [];
  readLayer(sharedDir, 'shared', packages, invalid);
  readLayer(localDir, 'local', packages, invalid);
  return { packages: [...packages.values()].sort((a, b) => a.id.localeCompare(b.id)), invalid };
}

// ---- applicability ------------------------------------------------------------------------------------------------

const lower = (v) => String(v).trim().toLowerCase();
const listOf = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);
const names = (v, key) => listOf(v).map((x) => (isObj(x) ? x[key] : x)).filter(isStr).map(lower);

// Accepts the flat shape ({ types, stacks, country… }) and the stored profile.json ({ detected, owner }).
export function profileFacets(profile) {
  const p = isObj(profile) ? profile : {};
  const detected = isObj(p.detected) ? p.detected : p;
  const owner = isObj(p.owner) ? p.owner : p;
  const facets = {
    types: names(detected.types, 'name'),
    stacks: names(detected.stacks, 'name'),
    signals: names(detected.signals, 'kind'),
    countries: names(owner.countries, 'name'),
    money: names(owner.money, 'name'),
    audience: names(owner.audience, 'name'),
    stages: names(owner.stages, 'name'),
  };
  for (const [ownerKey, facet] of Object.entries(FACET_OF_OWNER)) {
    facets[facet] = [...new Set([...facets[facet], ...names(owner[ownerKey], 'name')])];
  }
  return facets;
}

// Fields are ANDed, values inside a field are ORed; an empty or absent field matches everything.
export function appliesTo(applies, facets) {
  if (!isObj(applies)) return true;
  return APPLIES_KEYS.every((key) => {
    const wanted = names(applies[key], 'name');
    if (!wanted.length) return true;
    const have = facets[key] ?? [];
    return wanted.some((w) => have.includes(w));
  });
}

export function selectFor(profile, packages) {
  const facets = profileFacets(profile);
  return packages.filter((pkg) => appliesTo(pkg.applies, facets));
}

// ---- ageing and gaps ----------------------------------------------------------------------------------------------

export function daysOld(pkg, today) {
  const checked = dayNumber(pkg?.checkedAt);
  const now = dayNumber(today);
  if (checked === null || now === null) return null;
  return Math.max(0, now - checked);
}

export function statusOf(pkg, today) {
  if (pkg?.status === 'recheck') return 'recheck';
  const age = daysOld(pkg, today);
  // An unreadable date is never trusted.
  if (age === null || age > (MAX_AGE_DAYS[pkg.kind] ?? MAX_AGE_DAYS.general)) return 'stale-source';
  return 'confirmed';
}

const RESEARCH_RULES = [
  'Use only official sources (laws, agencies, the maker\'s documentation) and open each page before citing it.',
  'Give every item a source with name, https url and trust mark V (verified), F (vendor), C (convention) or NV (unchecked).',
  'If a page cannot be opened, mark the item NV and set the package status to "recheck"; never write a url from memory.',
  'Write texts in English and Brazilian Portuguese, simple words, and follow knowledge/README.md in the session-map repository.',
].join(' ');

const requestFor = (kind, name) => ({
  text: `Research best-practice guidance for the ${kind} "${name}" for the Session Map library. ${RESEARCH_RULES} `
    + `Save the package as ${LOCAL_HINT}/${kind}-${name.toLowerCase()}.json (local layer, never inside the project) with id "${kind}-${name.toLowerCase()}".`,
});

export function staleOf(packages, today) {
  return packages
    .filter((pkg) => statusOf(pkg, today) === 'stale-source')
    .map((pkg) => ({
      id: pkg.id,
      daysOld: daysOld(pkg, today),
      request: {
        text: `Recheck the Session Map library package "${pkg.id}" (last checked ${pkg.checkedAt}). ${RESEARCH_RULES} `
          + `Update checkedAt to today and save the result as ${LOCAL_HINT}/${pkg.id}.json.`,
      },
    }));
}

// A type or stack of the project with no package of its kind is a gap. Names come from project files, so only
// plain names go into the request text that is sent to a chat.
export function gapsOf(profile, packages) {
  const facets = profileFacets(profile);
  const covered = (kind, key) => new Set(packages.filter((p) => p.kind === kind).flatMap((p) => names(p.applies?.[key], 'name')));
  const gaps = [];
  for (const [kind, key] of [['type', 'types'], ['stack', 'stacks']]) {
    const have = covered(kind, key);
    for (const name of facets[key]) {
      if (SAFE_NAME.test(name) && !have.has(name)) gaps.push({ kind, name, request: requestFor(kind, name) });
    }
  }
  return gaps;
}
