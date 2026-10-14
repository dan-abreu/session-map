// The conversation as a book (pc28): one chapter per request of the person, its facts read from the transcript with no
// AI (files written, commits, item codes, the decisions listed at the end), an index that stands in for the whole history
// after Claude Code's own summary runs, and the raw text of one chapter for when a detail is needed again.
// Pure: the reading of files and the cheap AI's call live in book-hook.mjs.

const CODE_RE = /^(?:[a-z]{2,4}\d{1,3}|id\d{1,4})$/;
const COMMIT_RE = /^\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/gm;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const DECISIONS_RE = /^\s*\**\s*(Decisões que tomei|Decisions I took)\s*\**\s*:?\s*$/i;
const HEX_RE = /^[0-9a-f]{7,40}$/;
const PATH_END_RE = /\.(mjs|js|ts|md|json)$/;
const TITLE_MAX = 90;
const SUMMARY_MAX = 200;

export function parseLines(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* a line cut while being written */ }
  }
  return out;
}

export function promptText(entry) {
  if (entry?.type !== 'user') return '';
  const c = entry.message?.content;
  const raw = typeof c === 'string' ? c
    : Array.isArray(c) ? c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n') : '';
  return raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

export function isHumanPrompt(entry) {
  if (entry?.type !== 'user' || entry.isMeta || entry.isCompactSummary || entry.isSidechain) return false;
  const c = entry.message?.content;
  if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) return false;
  const p = promptText(entry);
  return Boolean(p) && !p.startsWith('<command-') && !p.startsWith('<local-command') && !p.startsWith('[Request interrupted');
}

const resultText = (b) => (typeof b.content === 'string' ? b.content
  : Array.isArray(b.content) ? b.content.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '');

const lastAssistantText = (list, from, to) => {
  let last = '';
  for (let i = from; i <= to; i++) {
    const e = list[i];
    if (e?.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) if (b?.type === 'text' && typeof b.text === 'string') last = b.text;
  }
  return last;
};

function decisionsOf(text) {
  const out = [];
  let found = false;
  for (const line of String(text).split('\n')) {
    if (!found) { found = DECISIONS_RE.test(line); continue; }
    const t = line.trim();
    if (!t) continue;
    if (!/^[-*]\s+/.test(t)) break;
    out.push(t.replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim());
    if (out.length === 8) break;
  }
  return out;
}

// A page chat's first message carries session-map's context before the person's words; their words are its last paragraph.
const personWords = (text) => (text.startsWith('Context from session-map') ? text.slice(text.lastIndexOf('\n\n') + 2).trim() : text);

// cwd: the folder paths are shown from; by default the transcript's own.
export function chaptersOf(entries, { cwd } = {}) {
  const list = entries ?? [];
  cwd ??= list.find((e) => typeof e?.cwd === 'string')?.cwd ?? '';
  const starts = [];
  for (let i = 0; i < list.length; i++) if (isHumanPrompt(list[i])) starts.push(i);
  const base = cwd ? cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';
  return starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] - 1 : list.length - 1;
    const words = personWords(promptText(list[start]));
    const files = new Set();
    const commits = new Set();
    const codes = new Set();
    const addCodes = (text) => { for (const m of text.matchAll(/`([^`\s]+)`/g)) if (CODE_RE.test(m[1])) codes.add(m[1]); };
    addCodes(words);
    for (let i = start; i <= end; i++) {
      const e = list[i];
      const content = e?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (e.type === 'assistant' && b?.type === 'text' && typeof b.text === 'string') addCodes(b.text);
        else if (e.type === 'assistant' && b?.type === 'tool_use' && EDIT_TOOLS.has(b.name)) {
          const raw = b.input?.file_path || b.input?.notebook_path;
          if (typeof raw !== 'string' || !raw) continue;
          let p = raw.replace(/\\/g, '/');
          if (base && p.toLowerCase().startsWith(`${base}/`)) p = p.slice(base.length + 1);
          files.add(p);
        } else if (e.type === 'user' && b?.type === 'tool_result') {
          for (const m of resultText(b).matchAll(COMMIT_RE)) commits.add(`${m[1]} ${m[2]}`);
        }
      }
    }
    return {
      n: idx + 1, words, start, end, closed: idx + 1 < starts.length,
      files: [...files], commits: [...commits], codes: [...codes], decisions: decisionsOf(lastAssistantText(list, start, end)),
    };
  });
}

export function cut(s, n) {
  const str = String(s ?? '');
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`;
}

export function indexText(chapters, { title = '', tidy = null, chapterPath = () => '', maxChars = 8000 } = {}) {
  const chs = chapters ?? [];
  const head = ['# Índice desta conversa'];
  const bookTitle = tidy?.title || title;
  if (bookTitle) head.push(`**${bookTitle}**`);
  head.push('Cada capítulo é um pedido. O texto inteiro de um capítulo antigo está no arquivo indicado: leia só se precisar.');
  const titleOf = (c) => tidy?.chapters?.[c.n]?.title || cut(c.words, 120);
  const fullBlock = (c) => {
    const lines = [`## Cap. ${c.n} — ${titleOf(c)}${c.closed ? '' : ' (em andamento)'}`];
    const summary = tidy?.chapters?.[c.n]?.summary;
    if (summary) lines.push(summary);
    lines.push(`- pedido: ${cut(c.words, 200)}`);
    if (c.files.length) lines.push(`- arquivos: ${c.files.slice(0, 12).join(', ')}${c.files.length > 12 ? ` +${c.files.length - 12}` : ''}`);
    if (c.commits.length) lines.push(`- commits: ${c.commits.slice(0, 6).join('; ')}`);
    if (c.codes.length) lines.push(`- itens: ${c.codes.join(', ')}`);
    if (c.decisions.length) lines.push(`- decisões: ${c.decisions.join('; ')}`);
    const p = chapterPath(c.n);
    if (p) lines.push(`- texto inteiro: ${p}`);
    return lines.join('\n');
  };
  const shortBlock = (c) => {
    const p = chapterPath(c.n);
    return `## Cap. ${c.n} — ${titleOf(c)}${p ? ` · texto inteiro: ${p}` : ''}`;
  };
  const blocks = chs.map(fullBlock);
  const assemble = () => [head.join('\n'), ...blocks].join('\n\n');
  // The open chapter and the newest closed one stay whole; the oldest fold first.
  const closed = chs.map((c, i) => (c.closed ? i : -1)).filter((i) => i >= 0 && i < chs.length - 1);
  const foldable = closed.slice(0, -1);
  for (let k = 0; k < foldable.length && assemble().length > maxChars; k++) blocks[foldable[k]] = shortBlock(chs[foldable[k]]);
  return assemble();
}

export function chapterText(entries, chapter, { maxChars = 12000 } = {}) {
  const parts = [`# Cap. ${chapter.n}`, '## Pedido', chapter.words];
  const list = entries ?? [];
  for (let i = chapter.start + 1; i <= chapter.end; i++) {
    const e = list[i];
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (e.type === 'assistant' && b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text.trim());
      else if (e.type === 'assistant' && b?.type === 'tool_use') {
        const inp = b.input ?? {};
        parts.push(`→ ${b.name}: ${cut(inp.file_path || inp.command || inp.pattern || inp.description || '', 160)}`);
      } else if (e.type === 'user' && b?.type === 'tool_result') parts.push(`  ← ${cut(resultText(b).replace(/\r?\n/g, ' '), 300)}`);
    }
  }
  const full = parts.join('\n\n');
  if (full.length <= maxChars) return full;
  return `${full.slice(0, Math.floor(maxChars * 0.6))}\n[… meio do capítulo cortado …]\n${full.slice(full.length - Math.floor(maxChars * 0.4))}`;
}

export function tidyDigest(chapters, entries) {
  return (chapters ?? []).filter((c) => c.closed).map((c) => [
    `### ${c.n}`,
    `pedido: ${cut(c.words, 400)}`,
    `resposta final: ${cut(lastAssistantText(entries ?? [], c.start, c.end), 600)}`,
    `fatos: arquivos=${c.files.join(', ')}; commits=${c.commits.join('; ')}; itens=${c.codes.join(', ')}`,
  ].join('\n')).join('\n\n');
}

// A word the cheap AI wrote that names a file, an item or a commit the facts do not have: the text is dropped whole.
function invents(text, facts) {
  const lastSeg = (p) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
  const files = new Set(facts.files.map(lastSeg));
  const shas = facts.commits.map((c) => c.split(' ')[0]);
  for (const raw of text.split(/\s+/)) {
    const w = raw.replace(/^[()[\]{},.;:!?"'`]+|[()[\]{},.;:!?"'`]+$/g, '');
    if (!w) continue;
    if ((/[\\/]/.test(w) || PATH_END_RE.test(w)) && !files.has(lastSeg(w))) return true;
    if (CODE_RE.test(w) && !facts.codes.includes(w)) return true;
    if (HEX_RE.test(w) && /\d/.test(w) && /[a-f]/.test(w) && !shas.some((s) => s.startsWith(w))) return true;
  }
  return false;
}

const keep = (v, max, facts) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max && !invents(t, facts) ? t : null;
};

export function acceptTidy(answer, chapters) {
  const out = { title: null, chapters: {} };
  const closed = (chapters ?? []).filter((c) => c.closed);
  const all = { files: closed.flatMap((c) => c.files), commits: closed.flatMap((c) => c.commits), codes: closed.flatMap((c) => c.codes) };
  try {
    out.title = keep(answer?.title, TITLE_MAX, all);
    for (const item of Array.isArray(answer?.chapters) ? answer.chapters : []) {
      const c = closed.find((x) => x.n === Number(item?.n));
      if (!c) continue;
      out.chapters[c.n] = { title: keep(item.title, TITLE_MAX, c), summary: keep(item.summary, SUMMARY_MAX, c) };
    }
  } catch { /* a malformed answer keeps what was already accepted */ }
  return out;
}
