// The cheap AI's part of the book (pc28): a title and a one-line summary for each closed chapter that has none, and the
// conversation's title. Run detached by book-hook.mjs; the engine's facts stay the source, the AI only words them.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeJSON } from '../ai/runner.mjs';
import { isClaudeModel } from '../ai/claude-models.mjs';
import { callServer, readTokenFile, serverBase } from '../ai/serverclient.mjs';
import { writeAtomic } from '../store.mjs';
import { acceptTidy, chaptersOf, parseLines, tidyDigest } from './book.mjs';

const BATCH = 6;
// After a failed call the AI is not asked again for this long: a turn that keeps failing must not bill a call each time.
const BACKOFF_MS = 30 * 60_000;
const PROMPT_MAX = 30_000;
const SCHEMA = '{"title":"...","subjectChanged":false,"chapters":[{"n":1,"title":"...","summary":"..."}]}';

// The Cérebro's "book" row (id146, id156): the owner's model and level for the titles and summaries ride on the call, Haiku at
// no named level when none. When the row names another company's AI, the server is asked first (it holds that AI's key, the
// daily cap and the credit pause); when it cannot take it, the Claude call below does the work as it always did.
const EFFORT_WORDS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const smDirOf = () => process.env.SESSION_MAP_DIR || join(homedir(), '.claude', 'session-map');
const bookRow = () => {
  try {
    const f = JSON.parse(readFileSync(join(smDirOf(), 'config.json'), 'utf8'))?.ai?.others?.functions?.book;
    return f && typeof f === 'object' ? f : {};
  } catch {
    return {};
  }
};
// What rides on the Claude call: only a Claude row's model and level. A row on another AI keeps its words for that AI:
// when the Claude call is only the fallback, it runs on the cheap default.
const bookChoice = () => {
  const f = bookRow();
  if (typeof f.provider === 'string' && f.provider !== 'auto' && f.provider !== 'claude') return {};
  return {
    ...(isClaudeModel(f.model) ? { model: f.model } : {}),
    ...(EFFORT_WORDS.has(f.effort) ? { effort: f.effort } : {}),
  };
};
// The other AI the row names, or null when it is Claude, automatic or nothing.
const bookOutsideProvider = () => {
  const p = bookRow().provider;
  return typeof p === 'string' && p !== 'auto' && p !== 'claude' ? p : null;
};

// The same ask through the server: {ok, value, costUSD} or null when the server is down, refuses or no other AI can take it.
export async function askBookOutside(prompt, { call = callServer } = {}) {
  const dir = smDirOf();
  const token = readTokenFile(dir);
  if (!token) return null;
  const r = await call({ base: serverBase(dir), method: 'POST', path: '/api/ai/book', body: { prompt, schemaHint: SCHEMA }, timeoutMs: 120_000, token });
  return r?.status === 200 && r.json?.ok === true ? { ok: true, value: r.json.value, costUSD: Number(r.json.costUSD) || 0 } : null;
}

const readText = (path) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
const readJson = (path) => { try { return JSON.parse(readText(path)); } catch { return null; } };

// outside: the ask to the server for a row on another AI. None by default, so a test or a caller that passes only `run` never
// reaches the owner's server or config; the program a hook starts passes askBookOutside (below).
export async function tidyBook({ transcriptPath, bookDir, run = runClaudeJSON, outside = null, now = Date.now }) {
  const lock = join(bookDir, 'tidy.lock');
  const failFile = join(bookDir, 'tidy.fail');
  if (now() - (Number(readText(failFile)) || 0) < BACKOFF_MS) return;
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
    const named = bookOutsideProvider();
    let res = named && outside ? await outside(prompt).catch(() => null) : null;
    if (!res?.ok) res = await run(prompt, { model: 'haiku', ...bookChoice(), cwd: join(tmpdir(), 'session-map-book'), schemaHint: SCHEMA });
    if (!res?.ok) { writeAtomic(failFile, String(now())); return; }
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
  try { if (transcriptPath && bookDir && existsSync(transcriptPath)) await tidyBook({ transcriptPath, bookDir, outside: askBookOutside }); } catch { /* the next turn tries again */ }
  process.exit(0);
}
