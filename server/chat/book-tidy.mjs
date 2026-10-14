// The cheap AI's part of the book (pc28): a title and a one-line summary for each closed chapter that has none, and the
// conversation's title. Run detached by book-hook.mjs; the engine's facts stay the source, the AI only words them.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeJSON } from '../ai/runner.mjs';
import { writeAtomic } from '../store.mjs';
import { acceptTidy, chaptersOf, parseLines, tidyDigest } from './book.mjs';

const BATCH = 6;
const PROMPT_MAX = 30_000;
const SCHEMA = '{"title":"...","subjectChanged":false,"chapters":[{"n":1,"title":"...","summary":"..."}]}';

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

export async function tidyBook({ transcriptPath, bookDir, run = runClaudeJSON, now = Date.now }) {
  const lock = join(bookDir, 'tidy.lock');
  writeAtomic(lock, String(now()));
  try {
    const entries = parseLines(readFileSync(transcriptPath, 'utf8'));
    const tidy = readJson(join(bookDir, 'tidy.json'));
    const chapters = chaptersOf(entries);
    const todo = chapters.filter((c) => c.closed && !tidy?.chapters?.[c.n]).slice(0, BATCH);
    if (!todo.length) return;
    const prompt = [
      'Você organiza o índice de uma conversa de trabalho. Cada capítulo abaixo é um pedido da pessoa e o que foi feito.',
      'Para cada capítulo escreva um título (até 90 caracteres) e um resumo de uma linha (até 200 caracteres).',
      'Escreva também um título para a conversa inteira (até 90 caracteres) sobre o assunto principal dela.',
      'Use SOMENTE os fatos dados: nunca invente arquivos, commits nem códigos de item.',
      `Título atual da conversa: ${tidy?.title || '(nenhum)'}`,
      'Responda subjectChanged true somente se o assunto principal da conversa mudou em relação ao título atual.',
      '', tidyDigest(todo, entries),
    ].join('\n').slice(0, PROMPT_MAX);
    const res = await run(prompt, { model: 'haiku', cwd: join(tmpdir(), 'session-map-book'), schemaHint: SCHEMA });
    if (!res?.ok) return;
    const accepted = acceptTidy(res.value, todo);
    const merged = { ...(tidy?.chapters ?? {}) };
    for (const c of todo) {
      const got = accepted.chapters[c.n];
      // A rejected answer is stored as nulls so the chapter is not asked again.
      merged[c.n] = got?.title ? got : { title: null, summary: null };
    }
    let title = tidy?.title ?? null;
    if (accepted.title && (!title || res.value?.subjectChanged === true)) title = accepted.title;
    writeAtomic(join(bookDir, 'tidy.json'), JSON.stringify({
      title, chapters: merged, costUSD: (Number(tidy?.costUSD) || 0) + (Number(res.costUSD) || 0), updatedAt: new Date(now()).toISOString(),
    }));
  } finally {
    rmSync(lock, { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [transcriptPath, bookDir] = process.argv.slice(2);
  try { if (transcriptPath && bookDir && existsSync(transcriptPath)) await tidyBook({ transcriptPath, bookDir }); } catch { /* the next turn tries again */ }
  process.exit(0);
}
