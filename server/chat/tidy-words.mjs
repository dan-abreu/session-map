// The person's message, read and broken down before the work (id111): a sturdy reader (Sonnet) rewrites it organized and
// coherent (goal, tasks with kind tags, decided, doubts) for the orchestrator, and THAT is the request the working AI and the book get. The person's own words ride at the end of the prompt,
// between two marks, so nothing is lost if the rewrite misread something. Pure but for the one injected call.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaudeJSON } from '../ai/runner.mjs';

export const ORIGINAL_HEAD = "[session-map: the person's own words, kept as written]";
export const ORIGINAL_END = "[end of the person's own words]";
const MIN_WORDS = 15;
const TEXT_MAX = 12_000;
const BACKOFF_MS = 30 * 60_000;
const TIMEOUT_MS = 90_000;
// A sturdier reader than Haiku: breaking a request down well needs judgment (policy kind "plan": Sonnet at medium).
const READER_MODEL = 'sonnet';
const READER_EFFORT = 'medium';
const SCHEMA = '{"text":"..."}';
const DIR = join(tmpdir(), 'session-map-tidy');

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

// Short messages, slash commands and anything too long for the cheap call go as they are.
export const wantsTidy = (text) => {
  const t = String(text ?? '').trim();
  return t.length <= TEXT_MAX && !t.startsWith('/') && words(t) >= MIN_WORDS;
};

export const withOriginal = (tidied, original) => `${tidied}\n\n${ORIGINAL_HEAD}\n${original}\n${ORIGINAL_END}`;

// The person's own words out of a prompt that carries them, or null.
export function originalOf(prompt) {
  const end = String(prompt ?? '').lastIndexOf(`\n${ORIGINAL_END}`);
  const head = end < 0 ? -1 : prompt.indexOf(`\n${ORIGINAL_HEAD}\n`);
  return head < 0 ? null : prompt.slice(head + ORIGINAL_HEAD.length + 2, end);
}

// The reader only reads and breaks the request down; the orchestrator (the working AI, under the model policy) decides
// who does what and at which model and level. So the reader names the kind of each task but never a model or a level.
export const tidyPrompt = (text) => [
  'Você é o leitor do pedido: lê a mensagem de uma pessoa (muitas vezes ditada) e a destrincha para o orquestrador do projeto, uma IA de nível alto que vai escolher quem faz o quê.',
  'Entregue o pedido organizado nestas seções, só as que couberem: "Pedido" (o objetivo em uma ou duas frases), "Tarefas" (lista numerada, uma tarefa por item, com o tipo entre colchetes:',
  '[search] [read] [text] [docs] [code] [test] [screen] [debug] [plan] [review] [architecture] [security] [money] [personal-data]), "Já decidido", "Dúvidas em aberto" e "Restrições".',
  'Regras: mantenha TODO o sentido e todos os pedidos, nada a mais e nada a menos; não responda nem resolva o pedido; não escolha modelo nem nível; mantenha o idioma da pessoa;',
  'corrija pontuação, repetições e frases soltas. Não invente nomes de arquivos, números nem fatos. Mantenha trechos de código, caminhos e comandos exatamente como estão.',
  'Responda só o JSON pedido, com o texto destrinchado em "text".',
  '', '--- mensagem da pessoa ---', text,
].join('\n');

// A breakdown that came back empty, or far shorter or longer than the message, is not trusted.
const sane = (tidied, original) => typeof tidied === 'string' && tidied.trim().length >= original.length * 0.25 && tidied.length <= original.length * 3 + 600;

// → async tidy(text): the tidied text, or null (skipped, failed, in back-off or not trusted). A failed call is not repeated
// for BACKOFF_MS: a call that keeps failing must not bill each message.
export function createTidier({ run = runClaudeJSON, now = Date.now, bin, env } = {}) {
  let failedAt = 0;
  return async function tidy(text) {
    if (!wantsTidy(text) || now() - failedAt < BACKOFF_MS) return null;
    try {
      const res = await run(tidyPrompt(text.trim()), { model: READER_MODEL, effort: READER_EFFORT, cwd: DIR, schemaHint: SCHEMA, bin, env, timeoutMs: TIMEOUT_MS });
      if (!res?.ok) { failedAt = now(); return null; }
      const tidied = res.value?.text;
      return sane(tidied, text.trim()) ? tidied.trim() : null;
    } catch { failedAt = now(); return null; }
  };
}
