// Interpreter (AI agent): authored this file; pending human review

// Measure a piece of work before anything expensive runs: the economic gate (or14/id16).
// Pure and deterministic: no AI, no cost. It maps the person's request to the work's kind,
// size and sensitivity, so the conductor routes to the cheapest worker that can do it
// (conductor.mjs recommend) instead of trusting the model to self-size. When it cannot tell,
// confidence is 'low' and the caller may refine with one cheap Haiku call.

import { CONDUCTOR_KINDS, SIZES, recommend } from './conductor.mjs';
import { SENSITIVITIES } from './router.mjs';

// Lowercase and accent-fold, so "Segurança", "seguranca" and "SEGURANÇA" match the same rule.
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Order matters: the first kind whose words match wins. Risky / deciding kinds come first,
// and action verbs (search, read) come before code nouns, so "procura onde está a função"
// reads as a search, not as code.
const KIND_SIGNALS = [
  { kind: 'security', re: /\b(seguranca|security|senha|password|secret|api key|chave de api|access token|bearer|jwt|credencial|credential|autenticacao|auth|permissao|permission|sso|vazamento|leak|lgpd|dado pessoal|personal data)\b/ },
  // Cost and price words stay out: talk about tokens and spending is this project's daily subject, not payment code.
  { kind: 'money', re: /\b(dinheiro|money|pagamento|payment|fatura|invoice|billing|financeiro|finance|cobranca|charge|reais)\b|\$\s?\d|\bus\$/ },
  { kind: 'architecture', re: /\b(arquitetura|architecture|camada|layer|parte do mapa|mind ?map|fluxograma|flowchart|mermaid|diagrama|diagram)\b/ },
  { kind: 'business', re: /\b(regra de negocio|business rule|negocio|business|fluxo de negocio)\b/ },
  { kind: 'review', re: /\b(revisar|revisao|review|revise|code review|auditoria|audit)\b/ },
  { kind: 'bulk', re: /\b(rotular|label|classificar|classify|categorizar|categorize|em massa|in bulk|para cada|for each|planilha|spreadsheet)\b/ },
  { kind: 'portuguese', re: /\b(traduzir|traduza|translate|portugues|portuguese|redigir|redija|escrever um texto|escreva um texto|comunicado|anuncio)\b/ },
  { kind: 'search', re: /\b(procurar|procure|encontrar|encontre|find|search|buscar|busque|grep|listar|liste|list|onde esta|where is|localizar|achar)\b/ },
  { kind: 'read', re: /\b(ler|leia|read|resumir|resuma|summarize|explicar|explique|explain|analisar|analise|analyze|entender|entenda|understand|o que (e|sao|faz)|what (is|does|are)|como funciona|how does)\b/ },
  { kind: 'code', re: /\b(implementar|implemente|implement|construir|build|criar|crie|create|codigo|code|funcao|function|classe|class|componente|component|consertar|fix|corrigir|corrija|mudar|mude|alterar|altere|change|feature|funcionalidade|rota|route|endpoint|api|teste|test|debug|refatorar|refactor|commit|push|branch|merge|programa|app)\b/ },
];

const DEFAULT_KIND = 'reasoning';

// Breadth signals, strongest first. Only phrases naming the whole project or a new system are large:
// lone words like "tudo", "every" or "system" show up in small talk ("tudo certo?", "the system prompt").
const LARGE_RE = /\b(do zero|from scratch|projeto inteiro|repo inteiro|repositorio inteiro|todo o projeto|todo o repositorio|em todos os arquivos|em todas as partes|whole (project|repo|repository|codebase|system)|entire (project|repo|repository|codebase)|everything in|(sistema|ferramenta) (novo|nova|inteiro|completo)|new (system|tool))\b/;
const MEDIUM_RE = /\b(alguns|algumas|varios|varias|several|multi|mais de um|more than one|poucos|a few|algumas partes|tres|3 (arquivos|files|coisas|things))\b/;

const FILE_RE = /[\w./-]+\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|php|cs|json|md|markdown|css|scss|html|sql|yml|yaml|toml|sh|ps1)\b/gi;

// A question with no work verb is trivial; otherwise the breadth decides.
const QUESTION_RE = /^[^.!?]{0,140}\?\s*$/;

function sizeOf(text, kind, isQuestion) {
  const t = fold(text);
  if (LARGE_RE.test(t)) return 'large';
  if (MEDIUM_RE.test(t)) return 'medium';
  const files = new Set((text.match(FILE_RE) || []).map((f) => f.toLowerCase())).size;
  if (files > 3) return 'large';
  if (files > 1) return 'medium';
  if (isQuestion) return 'trivial';
  return 'small';
}

// -> {ok, kind, size, sensitivity, confidence} or {ok:false, error}.
// sensitivity: the project's class ('public' | 'internal' | 'client'), from others.mjs; default 'client' (strictest).
export function sizeRequest({ text = '', sensitivity = 'client' } = {}) {
  const raw = String(text ?? '').trim();
  const t = fold(raw);
  if (!t) return { ok: false, error: 'no-text' };
  let kind = DEFAULT_KIND;
  let matched = false;
  for (const s of KIND_SIGNALS) {
    if (s.re.test(t)) { kind = s.kind; matched = true; break; }
  }
  const isQuestion = QUESTION_RE.test(raw);
  const size = sizeOf(raw, kind, isQuestion);
  // Risky work is never "trivial": a money or security change is at least medium.
  const floor = (kind === 'security' || kind === 'money') && (size === 'trivial' || size === 'small') ? 'medium' : size;
  const sens = SENSITIVITIES.includes(sensitivity) ? sensitivity : 'client';
  return {
    ok: true,
    kind: CONDUCTOR_KINDS.includes(kind) ? kind : DEFAULT_KIND,
    size: SIZES.includes(floor) ? floor : 'small',
    sensitivity: sens,
    confidence: matched ? 'high' : 'low',
  };
}


// Measure the work AND pick who does it, in one call: sizeRequest (deterministic) then recommend
// (the cheapest capable worker + reviewer, from conductor.mjs). Returns the routing the conductor
// must follow; nothing here sends anything or spends money. The caller may turn it into a binding
// line of the prompt, and a cost cap can stop it before anything runs.
// others: GET /api/ai/others (null/undefined: Claude only). stats: loadStats() entries (bench + live).
export function measureWork({ text = '', sensitivity = 'client', critical = false, longRun = false, author = 'claude', failedBefore = [], smDir, stats, others } = {}) {
  const size = sizeRequest({ text, sensitivity });
  if (!size.ok) return size;
  let rec;
  try {
    rec = recommend({ kind: size.kind, size: size.size, sensitivity: size.sensitivity, critical, longRun, author, failedBefore, smDir, stats, others });
  } catch (err) {
    return { ...size, ok: false, error: err?.code ?? 'recommend-failed' };
  }
  return { ...size, worker: rec.worker, reviewer: rec.reviewer, finalCheck: rec.finalCheck, why: rec.why, blocked: rec.blocked };
}


// The binding lines the conductor reads at the start of a chat: what session-map measured and who
// should do it. Compact, in plain words, never a prompt on its own. '' when there is nothing to say.
export function directiveOf(measured) {
  if (!measured?.ok || !measured?.worker) return '';
  const label = (w) => (w.provider === 'claude' ? w.model + (w.effort ? ' at ' + w.effort : '') : w.provider + ' ' + w.model);
  const sensitivity = measured.sensitivity && measured.sensitivity !== 'client' ? ' (' + measured.sensitivity + ' data)' : '';
  const lines = [
    'session-map measured this request as ' + measured.kind + '/' + measured.size + sensitivity + '. Work it with ' + label(measured.worker) + '.',
  ];
  if (measured.reviewer) {
    lines.push('When it matters, review with ' + label(measured.reviewer) + (measured.reviewer.provider === 'claude' ? '' : ' (another family)') + '.');
  }
  lines.push('If you must use a different worker, call pick_worker and say why.');
  return lines.join('\n');
}
