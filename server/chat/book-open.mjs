// The book command (code, not the AI's judgment): "índice", "cap 3", "3", "2,2" or "2.2" (chapter, sub-chapter).
// A sub-chapter is one step of a chapter: the request, then each stretch that starts at a new passage of the AI's own words.
// CLI: node book-open.mjs <session-id> <ref>   (prints the text; only what was asked reaches the conversation)
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeDir } from '../sources/claude.mjs';
import { cut } from './book.mjs';
import { readBook, readChapter } from './book-view.mjs';

// → { kind: 'index' } | { kind: 'chapter', n } | { kind: 'sub', n, sub } | null
export function parseRef(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/^(?:ver|abrir|acessa|mostra|mostrar)\s+(?:pra mim\s+)?/, '');
  if (/^(?:índice|indice|livro|index|o livro)$/.test(t)) return { kind: 'index' };
  const m = /^(?:(?:todo\s+o\s+)?cap(?:[ií]tulo)?\.?\s*)?(\d{1,5})(?:\s*[.,]\s*(\d{1,3}))?$/.exec(t);
  if (!m) return null;
  return m[2] ? { kind: 'sub', n: Number(m[1]), sub: Number(m[2]) } : { kind: 'chapter', n: Number(m[1]) };
}

// Splits a chapter file (chapterText's format) into its sub-chapters: [{ sub, title, text }]; the header line is dropped.
export function subChapters(chapterMd) {
  const parts = String(chapterMd ?? '').split(/\n\n+/).filter((p) => p.trim() && !/^# Cap\. \d+$/.test(p.trim()));
  const isProse = (p) => !/^(?:## |→ |\s*← |\[… )/.test(p);
  const groups = [];
  let prevProse = false;
  for (const p of parts) {
    if (p.startsWith('## ')) { (groups[0] ?? groups[groups.push({ parts: [], tools: false }) - 1]).parts.push(p); continue; }
    const prose = isProse(p);
    if (!groups.length || (prose && !prevProse && groups.length >= 1 && groups[groups.length - 1].tools)) groups.push({ parts: [], tools: false });
    const g = groups[groups.length - 1];
    g.parts.push(p);
    if (!prose) g.tools = true;
    prevProse = prose;
  }
  return groups.map((g, i) => {
    const first = g.parts.find((p) => !/^## /.test(p)) ?? g.parts[0];
    return { sub: i + 1, title: cut(first.replace(/\s+/g, ' ').trim(), 90), text: g.parts.join('\n\n') };
  });
}

export function indexView(book) {
  if (!book.chapters.length) return 'Este chat ainda não tem livro.';
  const lines = [`# ${book.title || 'Livro desta conversa'}`];
  for (const c of book.chapters) lines.push(`${c.n}. ${c.title || '(sem título)'}${c.closed ? '' : ' (em andamento)'}${c.summary ? `\n   ${c.summary}` : ''}`);
  return lines.join('\n');
}

export function openBook(smDir, id, ref) {
  const cmd = typeof ref === 'string' ? parseRef(ref) : ref;
  if (!cmd) return 'Não entendi. Use: índice · cap 3 · 2,2 (capítulo e subcapítulo).';
  if (cmd.kind === 'index') return indexView(readBook(smDir, id));
  const md = readChapter(smDir, id, cmd.n);
  if (md === null) return `O capítulo ${cmd.n} não existe ou ainda está em andamento.`;
  const subs = subChapters(md);
  if (cmd.kind === 'chapter') {
    const toc = subs.map((s) => `  ${cmd.n}.${s.sub} ${s.title}`).join('\n');
    return `${md}\n\n---\nSubcapítulos:\n${toc}`;
  }
  const s = subs[cmd.sub - 1];
  return s ? `# Cap. ${cmd.n}.${s.sub}\n\n${s.text}` : `O capítulo ${cmd.n} tem ${subs.length} subcapítulo(s); não existe o ${cmd.sub}.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const smDir = process.env.SESSION_MAP_DIR || join(claudeDir(), 'session-map');
  const [id, ...rest] = process.argv.slice(2);
  const ref = rest.join(' ') || 'índice';
  if (!id || !existsSync(join(smDir, 'book', id))) {
    const ids = existsSync(join(smDir, 'book')) ? readdirSync(join(smDir, 'book')).join('\n') : '';
    console.log(`Uso: node book-open.mjs <id-da-conversa> <índice|cap N|N,M>\nConversas com livro:\n${ids}`);
  } else console.log(openBook(smDir, id, ref));
}
