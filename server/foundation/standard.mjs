import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fd15: reads the professional standard (docs/standard/NN-*.md) into checks and decides which of the 14 stages an
// idea walks through. Pure except for loadStandard, which reads the folder it is given.

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'standard');
export const STAGES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14'];
export const SIZES = ['trivial', 'small', 'medium', 'large'];

const SEVERITY = { essencial: 'E', recomendado: 'R', avancado: 'A' };
const RANK = { A: 0, R: 1, E: 2 };
const HEADER = /^\|\s*Verificação\s*\|\s*Como é detectada\s*\|\s*Sev\.\s*\|\s*$/;

const SCREEN = ['web', 'mobile', 'game'];
const SELLS = ['subscription', 'sale', 'marketplace'];
const DATA = ['personal-data', 'payments', 'login', 'uploads'];

// ponytail: convention. The qualifier written after "Essencial/Recomendado/Avançado" in the standard tables, in a closed
// table. Text that is not here applies always (never hidden) and the program keeps it as `whenText` for the screen.
const WHEN = [
  [/^web$/, { types: ['web'] }],
  [/^em site publico$/, { types: ['web'] }],
  [/^em tela( nova)?$/, { types: SCREEN }],
  [/^em tela ou rota$/, { types: [...SCREEN, 'api'] }],
  [/^(com usuarios|em produto com usuarios)$/, { types: SCREEN }],
  [/^com dados( reais)?$/, { signals: DATA }],
  [/^com dado pessoal$/, { signals: ['personal-data'] }],
  [/^(em )?dinheiro$/, { signals: ['payments'] }],
  [/^em marketplace$/, { money: ['marketplace'] }],
  [/^(com clientes( pagantes)?|com venda (online|a distancia)|antes de vender|pessoa juridica com fins economicos)$/, { money: SELLS }],
  [/^em produto novo$/, { stage: ['idea', 'prototype'] }],
  [/^em time$/, { team: 'notSolo' }],
  [/^em sensivel$/, { sensitive: true }],
  [/^(em )?media e grande$/, { sizes: ['medium', 'large'] }],
];

// ponytail: convention. Which stages each idea size walks through (README §1: trivial = 03, 04, 06; large = all 14).
const BY_SIZE = {
  trivial: ['03', '04', '06'],
  small: ['02', '03', '04', '06', '08'],
  medium: ['01', '02', '03', '04', '05', '06', '07', '08', '14'],
  large: STAGES,
};
// ponytail: convention. A sensitive kind pulls these stages in, whatever the size.
const BY_SENSITIVE = {
  security: ['05'], auth: ['05'], 'personal-data': ['05', '12'], money: ['05', '12', '13'],
  production: ['06', '07'], publish: ['06', '10'], delete: ['05'],
};

const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const asList = (v) => (Array.isArray(v) ? v : []);
const err = (code, message) => Object.assign(new Error(message || code), { code });

function slugOf(text) {
  const s = plain(text).replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 50).replace(/-+$/, '') || 'item';
}

function whenOf(text) {
  const key = plain(text);
  const hit = WHEN.find(([re]) => re.test(key));
  return hit ? { ...hit[1] } : null;
}

// "Essencial (web)" | "Essencial em tela" | "Recomendado (essencial em produto novo)" | "Avançado (recomendado em dinheiro)".
function parseSeverity(cell) {
  const m = /^(\S+)\s*(?:\((.*)\)|\s(.+))?$/.exec(cell.trim());
  const severity = m && SEVERITY[plain(m[1])];
  if (!severity) return null;
  let rest = (m[2] ?? m[3] ?? '').trim();
  let raise = null;
  const up = /^(essencial|recomendado)\s+(.*)$/i.exec(rest);
  if (up && SEVERITY[plain(up[1])] && RANK[SEVERITY[plain(up[1])]] > RANK[severity]) {
    const when = whenOf(up[2]);
    raise = { to: SEVERITY[plain(up[1])], when, whenText: up[2].trim() };
    rest = '';
  }
  const when = rest ? whenOf(rest) : null;
  return { severity, when, whenText: rest || null, raise };
}

function cells(line) {
  const parts = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  return parts;
}

export function loadStandard(dir = DEFAULT_DIR) {
  let files;
  try { files = readdirSync(dir).filter((n) => /^\d\d-.*\.md$/.test(n)).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    const stage = f.slice(0, 2);
    let lines;
    try { lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/); } catch { continue; }
    const at = lines.findIndex((l) => HEADER.test(l));
    if (at < 0) continue;
    const seen = new Set();
    for (let i = at + 2; i < lines.length && lines[i].startsWith('|'); i++) {
      const [text, detect, sev] = cells(lines[i]);
      const parsed = sev && parseSeverity(sev);
      if (!text || !detect || !parsed) continue;
      let slug = slugOf(text);
      for (let n = 2; seen.has(slug); n++) slug = `${slugOf(text)}-${n}`;
      seen.add(slug);
      out.push({ id: `${stage}.${slug}`, stage, text, detect, ...parsed });
    }
  }
  return out;
}

// Accepts the stored shape { detected, owner } or a flat one. The owner's answers win over what was detected.
export function flatProfile(p) {
  const d = (p && p.detected) || p || {};
  const o = (p && p.owner) || {};
  const kinds = asList(d.signals).map((s) => (typeof s === 'string' ? s : s && s.kind)).filter(Boolean);
  return {
    types: asList(d.types),
    signals: kinds,
    teamKind: (d.team && d.team.kind) || null,
    money: o.money ?? d.money ?? null,
    audience: asList(o.audience ?? d.audience),
    stage: o.stage ?? d.stage ?? null,
  };
}

// Unknown data never hides a check: no types detected, no answer for money/stage, no team = the condition holds.
export function conditionMatches(cond, ctx) {
  if (!cond) return true;
  const profile = ctx.profile || flatProfile({});
  const idea = ctx.idea || { size: 'medium', sensitive: [] };
  if (cond.types && profile.types.length && !cond.types.some((t) => profile.types.includes(t))) return false;
  if (cond.signals && !cond.signals.some((s) => profile.signals.includes(s))) return false;
  if (cond.money && profile.money && !cond.money.includes(profile.money)) return false;
  if (cond.stage && profile.stage && !cond.stage.includes(profile.stage)) return false;
  if (cond.team === 'notSolo' && profile.teamKind && profile.teamKind === 'solo') return false;
  if (cond.sizes && !cond.sizes.includes(idea.size)) return false;
  if (cond.sensitive && !asList(idea.sensitive).length) return false;
  return true;
}

export function checkApplies(check, ctx) {
  return conditionMatches(check.when, ctx) ? { applies: true, reason: null } : { applies: false, reason: 'not-applicable' };
}

// A condition that could not be mapped never raises on its own: the severity stays as written.
export function severityFor(check, ctx) {
  const r = check.raise;
  if (r && r.when && RANK[r.to] > RANK[check.severity] && conditionMatches(r.when, ctx)) return r.to;
  return check.severity;
}

function why(profile, stage, signalsHas) {
  const known = profile.types.length > 0;
  if (stage === '09' && known && !profile.types.some((t) => SCREEN.includes(t))) return 'no-screen';
  if (stage === '07' && known && profile.types.every((t) => t === 'library' || t === 'cli')) return 'no-running-service';
  if (['10', '11', '13'].includes(stage) && profile.money === 'personal') return 'personal-project';
  if (stage === '12' && profile.money === 'personal' && !signalsHas('personal-data')) return 'personal-project';
  return null;
}

// -> the 14 stages, each { stage, applies, by: 'size'|'sensitive'|'profile', reason: { msg, params } }.
export function stagesFor({ size, sensitive, profile } = {}) {
  if (!SIZES.includes(size)) throw err('bad-idea', `unknown size: ${size}`);
  const kinds = asList(sensitive);
  const p = flatProfile(profile);
  return STAGES.map((stage) => {
    const kind = kinds.find((k) => asList(BY_SENSITIVE[k]).includes(stage));
    const inScope = BY_SIZE[size].includes(stage);
    if (!inScope && !kind) return { stage, applies: false, by: 'size', reason: { msg: 'std.reason.outOfSize', params: { size } } };
    const cause = why(p, stage, (s) => p.signals.includes(s));
    if (cause) return { stage, applies: false, by: 'profile', reason: { msg: 'std.reason.profile', params: { why: cause } } };
    return kind
      ? { stage, applies: true, by: 'sensitive', reason: { msg: 'std.reason.sensitive', params: { kind } } }
      : { stage, applies: true, by: 'size', reason: { msg: 'std.reason.size', params: { size } } };
  });
}

// A package item that points at a standard id that does not exist is a broken link (test/knowledge-links.test.mjs).
export function unknownStandardRefs(packages, standard) {
  const known = new Set(standard.map((c) => c.id));
  const bad = [];
  for (const pkg of packages) {
    for (const item of asList(pkg && pkg.items)) {
      for (const ref of asList(item && item.standard)) if (!known.has(ref)) bad.push({ pkg: pkg.id, item: item.id, ref });
    }
  }
  return bad;
}

let cached = null;
// The shipped standard, read once (docs/standard changes with a release, not while the server runs).
export function defaultStandard() {
  if (!cached) cached = loadStandard(DEFAULT_DIR);
  return cached;
}
