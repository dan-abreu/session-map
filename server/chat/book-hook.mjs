// The hooks claude runs for the book (pc28), both from the chat's --settings: --stop at each turn's end writes the closed
// chapters to <state>/book/<session>/ and calls the cheap tidy when one has no title yet; --compact, right after Claude
// Code's own summary, prints the chapter index back into the conversation. Always exits 0: it never stops the chat.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeDir } from '../sources/claude.mjs';
import { writeAtomic } from '../store.mjs';
import { chapterText, chaptersOf, indexText, parseLines } from './book.mjs';

// --user: the plugin or user-settings copy; a page chat (SESSION_MAP_PAGE_CHAT=1) already has the book through --settings.
if (process.argv.includes('--user') && process.env.SESSION_MAP_PAGE_CHAT === '1') process.exit(0);

const TIDY = fileURLToPath(new URL('./book-tidy.mjs', import.meta.url));
const LOCK_FRESH_MS = 5 * 60_000;
const SAFE_RE = /^[A-Za-z0-9-]+$/;

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

// → { chapters, bookDir, tidy } with the closed chapters' files written, or null when the input is no usable chat.
function writeBook(input) {
  const id = String(input?.session_id ?? '');
  if (!SAFE_RE.test(id) || typeof input?.transcript_path !== 'string') return null;
  const smDir = process.env.SESSION_MAP_DIR || join(claudeDir(), 'session-map');
  const bookDir = join(smDir, 'book', id);
  const entries = parseLines(readFileSync(input.transcript_path, 'utf8'));
  const chapters = chaptersOf(entries);
  for (const c of chapters) {
    const file = join(bookDir, `cap-${c.n}.md`);
    if (c.closed && !existsSync(file)) writeAtomic(file, chapterText(entries, c));
  }
  writeAtomic(join(bookDir, 'index.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    chapters: chapters.map(({ n, words, closed, files, commits, codes, decisions }) => ({ n, words, closed, files, commits, codes, decisions })),
  }));
  return { chapters, bookDir, tidy: readJson(join(bookDir, 'tidy.json')), entries };
}

function lockFresh(bookDir) {
  try { return Date.now() - statSync(join(bookDir, 'tidy.lock')).mtimeMs < LOCK_FRESH_MS; } catch { return false; }
}

function stop(input) {
  const book = writeBook(input);
  if (!book) return;
  const pending = book.chapters.some((c) => c.closed && !book.tidy?.chapters?.[c.n]);
  if (!pending || lockFresh(book.bookDir)) return;
  const child = spawn(process.execPath, [TIDY, input.transcript_path, book.bookDir], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

function compact(input) {
  const book = writeBook(input);
  if (!book) return;
  const chapterPath = (n) => join(book.bookDir, `cap-${n}.md`).replaceAll('\\', '/');
  const additionalContext = indexText(book.chapters, { tidy: book.tidy, title: book.tidy?.title, chapterPath });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (process.argv.includes('--compact')) compact(input);
    else if (process.argv.includes('--stop')) stop(input);
  } catch { /* nothing to say: the chat goes on */ }
  process.exit(0);
});
