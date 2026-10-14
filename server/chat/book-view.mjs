// What the chat's "Livro" panel reads (pc28): the chapter list from index.json + tidy.json, and one chapter's text on
// demand. Nothing here reaches the AI; the page opens a chapter only when the person does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SAFE_RE = /^[A-Za-z0-9-]+$/;
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

// → { title, chapters: [{ n, title, summary, words, closed, files, commits }] }, empty when the chat has no book yet.
export function readBook(smDir, id) {
  if (!smDir || !SAFE_RE.test(String(id))) return { title: null, chapters: [] };
  const dir = join(smDir, 'book', id);
  const index = readJson(join(dir, 'index.json'));
  const tidy = readJson(join(dir, 'tidy.json'));
  const chapters = (Array.isArray(index?.chapters) ? index.chapters : []).map((c) => ({
    n: c.n,
    title: tidy?.chapters?.[c.n]?.title ?? null,
    summary: tidy?.chapters?.[c.n]?.summary ?? null,
    words: Number(c.words) || 0,
    closed: c.closed === true,
    files: Array.isArray(c.files) ? c.files.length : 0,
    commits: Array.isArray(c.commits) ? c.commits.length : 0,
  }));
  return { title: tidy?.title ?? null, chapters };
}

// → the chapter's text, or null when it has no file (the open chapter, or an unknown number).
export function readChapter(smDir, id, n) {
  if (!smDir || !SAFE_RE.test(String(id)) || !/^\d{1,5}$/.test(String(n))) return null;
  try { return readFileSync(join(smDir, 'book', id, `cap-${Number(n)}.md`), 'utf8'); } catch { return null; }
}
