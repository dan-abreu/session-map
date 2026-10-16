import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The one routing policy (or33): which model and effort each kind of task gets, the ladder a failure climbs, the one
// level of the chat (or35: it never moves on its own) and the conversation's phases, which only shape the turn.
// The AI only says what kind of task it is; the brain, recommend() and the guard read this file.
// It is loaded and checked once: a typo in a model or effort stops the server at start, not in the middle of a task.
export const POLICY_FILE = fileURLToPath(new URL('./policy.json', import.meta.url));
export const MODELS = Object.freeze(['haiku', 'sonnet', 'opus', 'fable']);
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const PHASE_KEYS = Object.freeze(['trivial', 'talk', 'plan', 'build']);

const rankOf = ({ model, effort }) => MODELS.indexOf(model) * 10 + EFFORTS.indexOf(effort);

function level(where, v) {
  if (!v || typeof v !== 'object') throw new Error(`policy: ${where} is not a level`);
  if (!MODELS.includes(v.model)) throw new Error(`policy: ${where} has an unknown model "${v.model}"`);
  if (!EFFORTS.includes(v.effort)) throw new Error(`policy: ${where} has an unknown effort "${v.effort}"`);
  return { model: v.model, effort: v.effort };
}

// raw: the parsed policy.json -> a frozen policy, or throws.
export function validatePolicy(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('policy: not an object');
  const tasks = {};
  for (const [kind, row] of Object.entries(raw.tasks ?? {})) {
    const lv = level(`task ${kind}`, row);
    for (const field of ['why', 'whyPt', 'evidence']) {
      if (typeof row[field] !== 'string' || !row[field].trim()) throw new Error(`policy: task ${kind} has no ${field}`);
    }
    tasks[kind] = Object.freeze({ ...lv, why: row.why, whyPt: row.whyPt, evidence: row.evidence });
  }
  if (!Object.keys(tasks).length) throw new Error('policy: no tasks');
  if (!Array.isArray(raw.ladder) || raw.ladder.length < 2) throw new Error('policy: the ladder needs at least two rungs');
  const ladder = raw.ladder.map((r, i) => {
    const lv = level(`ladder rung ${i}`, r);
    if (lv.effort === 'max') throw new Error('policy: max is never automatic, so it is not on the ladder');
    return Object.freeze(lv);
  });
  ladder.forEach((r, i) => {
    if (i && rankOf(r) <= rankOf(ladder[i - 1])) throw new Error(`policy: ladder rung ${i} does not climb`);
    // Fable only after an Opus rung failed.
    if (r.model === 'fable' && !ladder.slice(0, i).some((p) => p.model === 'opus')) throw new Error('policy: fable needs an opus rung before it');
  });
  // The chat's level (or35): one, fixed, never moved by the brain. Only the person (changeRun) or a line here changes it.
  const chatLv = level('chat', raw.chat);
  if (typeof raw.chat.whyPt !== 'string' || !raw.chat.whyPt.trim()) throw new Error('policy: chat has no whyPt');
  if (chatLv.effort === 'max') throw new Error('policy: max is never automatic, so the chat does not run on it');
  const chat = Object.freeze({ ...chatLv, why: String(raw.chat.why ?? ''), whyPt: raw.chat.whyPt });
  const phases = {};
  for (const key of PHASE_KEYS) {
    const row = raw.phases?.[key];
    if (!row || typeof row !== 'object') throw new Error(`policy: phase ${key} is missing`);
    if (row.model !== undefined || row.effort !== undefined) throw new Error(`policy: phase ${key} names a level; the chat has one level (chat), phases only shape the turn`);
    if (typeof row.whyPt !== 'string' || !row.whyPt.trim()) throw new Error(`policy: phase ${key} has no whyPt`);
    phases[key] = Object.freeze({ why: String(row.why ?? ''), whyPt: row.whyPt });
  }
  const agents = raw.limits?.agentsPerWorkflow;
  if (!Number.isInteger(agents) || agents < 1) throw new Error('policy: limits.agentsPerWorkflow must be a whole number');
  return Object.freeze({ tasks: Object.freeze(tasks), ladder: Object.freeze(ladder), chat, phases: Object.freeze(phases), limits: Object.freeze({ agentsPerWorkflow: agents }) });
}

export const POLICY = validatePolicy(JSON.parse(readFileSync(POLICY_FILE, 'utf8')));

export const KINDS = Object.freeze(Object.keys(POLICY.tasks));
export const hasKind = (kind, policy = POLICY) => Object.hasOwn(policy.tasks, kind);

// The highest rung that is not above the level (docs, sonnet at low, sits between two rungs).
const rungOf = (lv, policy) => policy.ladder.reduce((at, r, i) => (rankOf(r) <= rankOf(lv) ? i : at), 0);

// -> {model, effort} for a kind of task; rungsUp climbs the ladder once per real failure (clamped at the top). null for an unknown kind.
export function levelFor(kind, rungsUp = 0, policy = POLICY) {
  if (!hasKind(kind, policy)) return null;
  const row = policy.tasks[kind];
  const up = Math.max(0, Math.floor(Number(rungsUp) || 0));
  if (!up) return { model: row.model, effort: row.effort };
  const r = policy.ladder[Math.min(rungOf(row, policy) + up, policy.ladder.length - 1)];
  return { model: r.model, effort: r.effort };
}

// The chat's level (or35): the same for every phase, size and subject. Neither the brain nor the size moves it; a higher
// level comes only from the person (changeRun) or from a task the plan names.
export function chatLevel(policy = POLICY) {
  return { model: policy.chat.model, effort: policy.chat.effort };
}

// The next rung above a level, or null at the top.
export function nextRung(model, effort, policy = POLICY) {
  const at = rungOf({ model, effort }, policy);
  const r = policy.ladder[at + 1];
  return r ? { model: r.model, effort: r.effort } : null;
}

// The rungs a model has on the ladder, lowest first (empty when it has none).
export const rungsOfModel = (model, policy = POLICY) => policy.ladder.filter((r) => r.model === model).map((r) => ({ model: r.model, effort: r.effort }));

// ---- the human page (docs/standard/politica-de-modelos.md), generated from the policy; a test fails when the file differs ----

export const PAGE_FILE = fileURLToPath(new URL('../../docs/standard/politica-de-modelos.md', import.meta.url));
const KIND_PT = { search: 'busca', read: 'leitura', bulk: 'trabalho em lote', text: 'texto curto', commit: 'commit', docs: 'documentação', code: 'código', test: 'teste', screen: 'tela', debug: 'depuração', plan: 'plano', review: 'revisão', architecture: 'arquitetura', security: 'segurança', money: 'dinheiro', 'personal-data': 'dado pessoal' };
const PHASE_PT = { trivial: 'trivial', talk: 'conversa', plan: 'plano', build: 'construção' };
const MODEL_PT = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' };
const EFFORT_PT = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'altíssimo', max: 'máximo' };
const RULE_PT = { 'no judgment needed': 'não pede julgamento', 'high risk': 'risco alto', 'known facts only': 'só registra fatos já conhecidos' };

// "bench 2026-10-10 code 22/22" -> "medido em 2026-10-10: code 22/22"; "rule: high risk" -> "regra: risco alto".
function evidencePt(e) {
  const bench = /^bench (\d{4}-\d{2}-\d{2}) (.+)$/.exec(e);
  if (bench) return `medido em ${bench[1]}: ${bench[2]}`;
  const rule = /^rule: (.+)$/.exec(e);
  return rule ? `regra: ${RULE_PT[rule[1]] ?? rule[1]}` : e;
}

export function policyPage(policy = POLICY) {
  const lv = (r) => `${MODEL_PT[r.model]}, nível ${EFFORT_PT[r.effort]}`;
  return `${[
    '# Política de modelos',
    '',
    '> Este arquivo é gerado a partir de `server/ai/policy.json`. Não edite à mão: mude o arquivo de política e rode `node server/ai/policy.mjs --write`; um teste falha se este texto ficar diferente.',
    '',
    'Esta é a tabela única que decide qual modelo de IA e qual nível de raciocínio cada tipo de tarefa recebe. A IA só diz de que tipo é a tarefa (a etiqueta no começo da descrição, como `[code]`); o robô do session-map escolhe o modelo e o nível a partir daqui.',
    '',
    '## Tipos de tarefa',
    '',
    '| Tipo | Modelo | Nível | Por quê | De onde vem |',
    '|---|---|---|---|---|',
    ...Object.entries(policy.tasks).map(([k, t]) => `| ${KIND_PT[k] ?? k} (\`${k}\`) | ${MODEL_PT[t.model]} | ${EFFORT_PT[t.effort]} | ${t.whyPt} | ${evidencePt(t.evidence)} |`),
    '',
    '## Escada de falhas',
    '',
    'Cada falha de verdade sobe um degrau, nunca mais de um por vez. O nível máximo nunca é usado sozinho. O Fable só entra depois que um degrau do Opus falhou.',
    '',
    ...policy.ladder.map((r, i) => `${i + 1}. ${lv(r)}`),
    '',
    '## A conversa',
    '',
    `A conversa com a pessoa roda em **${lv(policy.chat)}** e nunca troca de modelo sozinha: ${policy.chat.whyPt}. Só a pessoa muda esse nível, na aba Cérebro (a linha Conversa) ou numa linha desta tabela. O trabalho pesado vai para tarefas com o modelo do tipo delas, acima.`,
    '',
    '## Fases da conversa',
    '',
    'O cérebro de entrada pesa cada mensagem só para saber de que fase ela é; a fase dá o tom do turno (planejar antes de construir), não o modelo.',
    '',
    '| Fase | O que é |',
    '|---|---|',
    ...Object.entries(policy.phases).map(([k, p]) => `| ${PHASE_PT[k] ?? k} | ${p.whyPt} |`),
    '',
    '## Limites',
    '',
    `- No máximo ${policy.limits.agentsPerWorkflow} agentes por fluxo de trabalho.`,
  ].join('\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) writeFileSync(PAGE_FILE, policyPage());
