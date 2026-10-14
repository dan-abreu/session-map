// The book's general summary (resumo.md) for the chat's "Livro" panel: plain text, shown on top of the chapters.
// Only <smDir>/book/<id>/resumo.md is read; the id is checked, and a file too big is cut.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SAFE_RE = /^[A-Za-z0-9-]+$/;
export const SUMMARY_MAX = 20 * 1024;

// → the summary's text (at most SUMMARY_MAX bytes), or null when the chat has no resumo.md or the id is not safe.
export function readBookSummary(smDir, id) {
  if (!smDir || !SAFE_RE.test(String(id))) return null;
  let buf;
  try { buf = readFileSync(join(smDir, 'book', String(id), 'resumo.md')); } catch { return null; }
  const text = buf.subarray(0, SUMMARY_MAX).toString('utf8').replace(/�$/, '');
  return text.trim() ? text : null;
}
