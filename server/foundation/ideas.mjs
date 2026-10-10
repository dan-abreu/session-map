import { createHash } from 'node:crypto';
import {
  SIZES, flatProfile, stagesFor, checkApplies, severityFor, defaultStandard,
} from './standard.mjs';

// fd15: an idea is captured, classified (size + sensitive kinds, by words), walked through the stages that apply and
// checked. Exact work is program, never AI: every rule below is a word list or a state table with a test.

export const SENSITIVE_KINDS = ['security', 'auth', 'personal-data', 'money', 'production', 'publish', 'delete'];
const MAX_TEXT = 2000;
const MAX_NOTE = 300;
const STATES = ['pass', 'fail', 'unverified', 'na'];

const err = (code, message) => Object.assign(new Error(message || code), { code });
const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const list = (v) => (Array.isArray(v) ? v : []);
const iso = (now) => {
  const d = new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw err('bad-idea', 'invalid date');
  return d.toISOString();
};

// ponytail: convention. Words (pt-BR and en, accents removed) that mark a sensitive kind. A false positive only adds
// stages and the owner can change it; a miss is the costly one, so the lists lean wide.
const SENSITIVE_WORDS = {
  security: /\b(seguranca|security|vulnerab\w*|criptograf\w*|encrypt\w*|permiss\w*|permission\w*|firewall|csrf|xss)\b/,
  auth: /\b(login|logar|logout|autentica\w*|authenticat\w*|auth|oauth|sso|senha\w*|password\w*|signin|signup|cadastro|2fa|dois fatores)\b|\bsign (in|up)\b|\bentrar com\b/,
  'personal-data': /\b(cpf|rg|telefone|phone|endereco|address|lgpd|gdpr|dados? pessoa\w*|personal data|data de nascimento|birth\w*|nome completo)\b|\be-?mail d[oa] (usuario|cliente)\b/,
  money: /\b(cobra\w*|cobranc\w*|pagamento\w*|pagar|pague|assinatura\w*|subscription\w*|billing|checkout|fatura\w*|invoice\w*|pix|cartao|stripe|reembolso\w*|refund\w*|payment\w*|charge\w*|imposto\w*|preco\w*|price\w*|pricing|boleto)\b|\bcredit card\b/,
  production: /\b(producao|production|deploy\w*|migrac\w*|migration\w*|rollback)\b/,
  publish: /\b(publica\w*|publish\w*|lancamento|lancar|launch\w*|release|loja)\b|\b(app|play) store\b/,
  delete: /\b(apag\w*|excluir|exclusao|delet\w*)\b|\b(remover|remove) (a )?(conta|usuario|dados|account|user|data|tudo)\b|\bdrop (table|database)\b/,
};

// ponytail: convention. Scope rule for the size: a new system, a charge or a rewrite is large; a copy or label fix is
// trivial; anything sensitive is at least medium; the rest is small (short) or medium (a feature or a long ask).
const LARGE = /\b(do zero|from scratch|reescrev\w*|rewrite|multi.?tenant|marketplace|assinatura\w*|subscription\w*|billing|checkout|cobrar|cobranc\w*)\b|\b(construir|criar|build|create|desenvolver|develop|montar)\b[^.]{0,20}\b(sistema|plataforma|platform|system|aplicativo)\b/;
const TRIVIAL = /\b(texto|text|typo|ortografia|spelling|copy|rotulo|label|titulo|title|cor|color|colour|virgula|mensagem|message|legenda|caption|placeholder)\b|erro de digitacao|nome do botao|link quebrado|broken link/;
const FEATURE = /\b(criar|adicionar|implementar|integrar|create|add|build|implement|integrate|novo|nova|new|endpoint|rota|route|api|tabela|table|relatorio|report|tela|screen|page)\b/;

function checkText(text) {
  const s = String(text ?? '').trim();
  if (!s) throw err('bad-idea', 'empty idea');
  if (s.length > MAX_TEXT) throw err('bad-idea', 'idea too long');
  return s;
}

function checkSensitive(kinds) {
  if (!Array.isArray(kinds) || kinds.some((k) => !SENSITIVE_KINDS.includes(k))) throw err('bad-idea', 'unknown sensitive kind');
  return SENSITIVE_KINDS.filter((k) => kinds.includes(k));
}

function checkSize(size) {
  if (!SIZES.includes(size)) throw err('bad-idea', 'unknown size');
  return size;
}

export function classifyIdea(text) {
  const t = plain(checkText(text));
  const sensitive = SENSITIVE_KINDS.filter((k) => SENSITIVE_WORDS[k].test(t));
  const words = t.split(/\s+/).filter(Boolean).length;
  let size;
  if (LARGE.test(t)) size = 'large';
  else if (TRIVIAL.test(t) && !sensitive.length && !FEATURE.test(t) && words <= 15) size = 'trivial';
  else if (sensitive.length) size = 'medium';
  else size = FEATURE.test(t) || words > 12 ? 'medium' : 'small';
  return { size, sensitive, origin: { size: 'guessed', sensitive: 'guessed' } };
}

export function newIdea(text, { now, size, sensitive } = {}) {
  const clean = checkText(text);
  const guess = classifyIdea(clean);
  const createdAt = iso(now);
  const id = `idea:${createHash('sha256').update(`${createdAt}\n${clean}`).digest('hex').slice(0, 8)}`;
  return {
    id, text: clean, createdAt,
    size: size === undefined ? guess.size : checkSize(size),
    sensitive: sensitive === undefined ? guess.sensitive : checkSensitive(sensitive),
    origin: { size: size === undefined ? 'guessed' : 'owner', sensitive: sensitive === undefined ? 'guessed' : 'owner' },
    status: 'open', doneAt: null, acceptedUnverified: [], checks: [],
  };
}

const evidenceOf = (items) => {
  const out = [];
  for (const p of items) {
    for (const e of list(p.evidence)) {
      if (e && e.file && !out.some((o) => o.file === e.file && o.line === e.line)) out.push({ file: e.file, line: e.line ?? null });
    }
  }
  return out.slice(0, 10);
};

// fail beats unverified beats pass; "unverified" is never turned into "fail" (the rule of the whole standard).
function fromPractices(linked) {
  const of = (s) => linked.filter((p) => p.state === s);
  if (of('fail').length) return { state: 'fail', reason: null, evidence: evidenceOf(of('fail')) };
  if (of('unverified').length) return { state: 'unverified', reason: of('unverified')[0].reason || 'no-data', evidence: [] };
  if (of('pass').length) return { state: 'pass', reason: null, evidence: evidenceOf(of('pass')) };
  return { state: 'na', reason: 'not-applicable', evidence: [] };
}

function fromAttest(attest, nowMs) {
  if (!attest) return { state: 'unverified', reason: 'needs-human', evidence: [] };
  if (Date.parse(attest.expiresAt) > nowMs) return { state: 'pass', reason: null, evidence: [] };
  return { state: 'unverified', reason: 'attest-expired', evidence: [] };
}

// Rebuilds `checks` from the standard for the stages that apply. `practices` is practices.json (items carry the
// `standard` ids they cover); a check with no linked practice waits for a person (or a valid attest).
export function evaluateIdea(idea, { standard, profile, practices, now } = {}) {
  const std = standard || defaultStandard();
  const ctx = { profile: flatProfile(profile), idea };
  const shown = new Set(stagesFor({ size: idea.size, sensitive: idea.sensitive, profile }).filter((s) => s.applies).map((s) => s.stage));
  const items = list(Array.isArray(practices) ? practices : practices && practices.items);
  const nowMs = Date.parse(iso(now));
  const before = new Map(list(idea.checks).map((c) => [c.id, c]));
  const checks = std.filter((c) => shown.has(c.stage)).map((c) => {
    const attest = (before.get(c.id) || {}).attest || null;
    const severity = severityFor(c, ctx);
    const base = { id: c.id, stage: c.stage, severity };
    if (!checkApplies(c, ctx).applies) return { ...base, state: 'na', reason: 'not-applicable', evidence: [], attest };
    const linked = items.filter((p) => list(p.standard).includes(c.id));
    const r = linked.length ? fromPractices(linked) : fromAttest(attest, nowMs);
    return { ...base, ...r, attest };
  });
  return { ...idea, checks };
}

// No "failed" label for the unverified: they make the level provisional (README §3).
export function levelOf(idea) {
  const checks = list(idea && idea.checks);
  const n = Object.fromEntries(STATES.map((s) => [s, checks.filter((c) => c.state === s).length]));
  const counted = n.pass + n.fail + n.unverified;
  const essentialFail = checks.some((c) => c.state === 'fail' && c.severity === 'E');
  let level = 'complete';
  if (essentialFail) level = 'blocked';
  else if (n.fail) level = 'open';
  else if (n.unverified) level = 'provisional';
  return { level, provisional: n.unverified > 0, ...n, percent: counted ? Math.floor((n.pass * 100) / counted) : 100 };
}

export function canMarkDone(idea) {
  const checks = list(idea && idea.checks);
  const accepted = new Set(list(idea && idea.acceptedUnverified));
  const failed = checks.filter((c) => c.state === 'fail' && c.severity === 'E').map((c) => c.id);
  const unverified = checks.filter((c) => c.state === 'unverified' && c.severity === 'E' && !accepted.has(c.id)).map((c) => c.id);
  return { ok: !failed.length && !unverified.length, failed, unverified };
}

const replaceCheck = (idea, id, patch) => ({ ...idea, checks: idea.checks.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
const hasCheck = (idea, id) => list(idea.checks).some((c) => c.id === id);

export function attestCheck(idea, checkId, { note, days, now } = {}) {
  if (!hasCheck(idea, checkId)) throw err('unknown-check');
  const text = String(note ?? '').trim();
  if (!Number.isInteger(days) || days < 1 || days > 365 || text.length > MAX_NOTE) throw err('bad-idea', 'bad attest');
  const at = iso(now);
  return replaceCheck(idea, checkId, { attest: { at, expiresAt: new Date(Date.parse(at) + days * 86400000).toISOString(), note: text } });
}

export function acceptUnverified(idea, checkId) {
  const c = list(idea.checks).find((x) => x.id === checkId);
  if (!c || c.state !== 'unverified') throw err('unknown-check');
  const accepted = list(idea.acceptedUnverified);
  return { ...idea, acceptedUnverified: accepted.includes(checkId) ? accepted : [...accepted, checkId] };
}

export function markDone(idea, now) {
  const r = canMarkDone(idea);
  if (!r.ok) throw Object.assign(err('essential-failed'), { failed: r.failed, unverified: r.unverified });
  return { ...idea, status: 'done', doneAt: iso(now) };
}

export const reopenIdea = (idea) => ({ ...idea, status: 'open', doneAt: null });

export function resizeIdea(idea, { size, sensitive } = {}) {
  if (size === undefined && sensitive === undefined) throw err('bad-idea', 'nothing to change');
  const origin = { ...idea.origin };
  const out = { ...idea };
  if (size !== undefined) { out.size = checkSize(size); origin.size = 'owner'; }
  if (sensitive !== undefined) { out.sensitive = checkSensitive(sensitive); origin.sensitive = 'owner'; }
  return { ...out, origin };
}
