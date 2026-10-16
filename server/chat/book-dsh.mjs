import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../store.mjs';
import { chapterText, chaptersOf } from './book.mjs';

// The book for DeepSeek sessions (id123, item 1): the same <smDir>/book/<sessionId>/cap-N.md + index.json layout the
// Claude hook writes (book-hook.mjs), generated from the DSH log items with no AI and no hook, so the book keeps
// updating while no Claude is around. The DSH items (sources/deepseek.mjs readConversation) are adapted to the Claude
// entry shape book.mjs reads; tool names map to Claude's (the book's EDIT_TOOLS). A truncated path (detail ends with
// '…') is never claimed as a file: a wrong path is worse than none.

const EDIT_NAME = Object.freeze({ edit: 'Edit', write: 'Write', multi_edit: 'MultiEdit' });
const RUN_NAME = Object.freeze({ pwsh: 'Bash', bash: 'Bash' });

export function bookEntriesOf(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    if ((item.type === 'user' || item.type === 'assistant') && typeof item.text === 'string' && item.text) {
      out.push({ type: item.type, message: { content: [{ type: 'text', text: item.text }] } });
    } else if (item.type === 'tool' && typeof item.name === 'string') {
      const detail = typeof item.detail === 'string' ? item.detail : '';
      const editName = EDIT_NAME[item.name];
      if (editName && detail && !detail.endsWith('…')) {
        out.push({ type: 'assistant', message: { content: [{ type: 'tool_use', name: editName, input: { file_path: detail } }] } });
      } else if (RUN_NAME[item.name]) {
        out.push({ type: 'assistant', message: { content: [{ type: 'tool_use', name: RUN_NAME[item.name], input: { command: detail } }] } });
      }
      if (item.result != null && String(item.result).trim()) {
        out.push({ type: 'user', message: { content: [{ type: 'tool_result', content: String(item.result) }] } });
      }
    }
  }
  return out;
}

// Idempotent: closed chapters are written once; the index is written only when the chapters actually changed (the
// read runs on every page open and the live mirror polls it). The id is the DSH session id ('session-<uuid>'), which
// fits the same folder the Claude hook uses (book-hook.mjs SAFE_RE).
export function writeDshBook({ smDir, sessionId, items, now = new Date() }) {
  const entries = bookEntriesOf(items);
  const chapters = chaptersOf(entries);
  const bookDir = join(smDir, 'book', sessionId);
  const sig = chapters.map((c) => `${c.n}:${c.closed ? 1 : 0}:${c.words.length}`).join('|');
  let same = false;
  try { same = JSON.parse(readFileSync(join(bookDir, 'index.json'), 'utf8'))?.sig === sig; } catch { /* first run, or never written */ }
  if (same) return { chapters, bookDir, same: true };
  for (const c of chapters) {
    const file = join(bookDir, `cap-${c.n}.md`);
    if (c.closed && !existsSync(file)) writeAtomic(file, chapterText(entries, c));
  }
  writeAtomic(join(bookDir, 'index.json'), JSON.stringify({
    updatedAt: now.toISOString(),
    engine: 'deepseek',
    sig,
    chapters: chapters.map(({ n, words, closed, files, commits, codes, decisions }) => ({ n, words, closed, files, commits, codes, decisions })),
  }));
  return { chapters, bookDir, same: false };
}
