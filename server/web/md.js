// Markdown as Claude writes it (mind-map-page mm22): headings, lists, tables, code, quotes and inline marks. Parsed into
// plain nodes (node:test loads this) and drawn with h(): no HTML from a reply ever reaches the page as markup.

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const AUTOLINK = /^https?:\/\/[^\s<>()[\]`]+/;
const TRAILING = /[.,;:!?'"]+$/;
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\]\s+/;
const isWordChar = (c) => Boolean(c) && /[\p{L}\p{N}]/u.test(c);

function pushText(out, text) {
  if (!text) return;
  if (typeof out.at(-1) === 'string') out[out.length - 1] += text;
  else out.push(text);
}

// The closing mark of an emphasis that opened at i: not after a space, and not inside a word.
function closing(text, from, mark) {
  for (let j = text.indexOf(mark, from); j !== -1; j = text.indexOf(mark, j + 1)) {
    if (/\s/.test(text[j - 1]) || j === from) continue;
    if (!isWordChar(text[j + mark.length])) return j;
  }
  return -1;
}

// [label](url) with balanced parentheses in the url → {label, url, end}.
function linkAt(text, i) {
  let depth = 0;
  let close = -1;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '[') depth++;
    else if (text[j] === ']' && --depth === 0) { close = j; break; }
  }
  if (close === -1 || text[close + 1] !== '(') return null;
  depth = 0;
  for (let j = close + 1; j < text.length; j++) {
    if (text[j] === '(') depth++;
    else if (text[j] === ')' && --depth === 0) return { label: text.slice(i + 1, close), url: text.slice(close + 2, j).trim(), end: j + 1 };
  }
  return null;
}

export function parseInline(text) {
  const out = [];
  // Once a mark has no closing after some point it has none after any later point either: long odd text stays linear.
  const none = new Map();
  const close = (from, mark) => {
    if (from >= (none.get(mark) ?? Infinity)) return -1;
    const end = closing(text, from, mark);
    if (end === -1) none.set(mark, Math.min(from, none.get(mark) ?? Infinity));
    return end;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const prev = text[i - 1];
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i))[0];
      const end = text.indexOf(run, i + run.length);
      if (end !== -1) {
        out.push({ t: 'code', v: text.slice(i + run.length, end).replace(/^ (.+) $/, '$1') });
        i = end + run.length;
        continue;
      }
    }
    const two = text.slice(i, i + 2);
    if ((two === '**' || two === '__' || two === '~~') && !isWordChar(prev) && text[i + 2] && !/\s/.test(text[i + 2])) {
      const end = close(i + 2, two);
      if (end !== -1) {
        out.push({ t: two === '~~' ? 's' : 'b', c: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((c === '*' || c === '_') && text[i + 1] !== c && !isWordChar(prev) && text[i + 1] && !/\s/.test(text[i + 1])) {
      const end = close(i + 1, c);
      if (end !== -1) {
        out.push({ t: 'i', c: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const link = linkAt(text, i);
      if (link) {
        const inner = parseInline(link.label);
        if (SAFE_HREF.test(link.url)) out.push({ t: 'a', href: link.url, c: inner });
        else for (const n of inner) (typeof n === 'string' ? pushText(out, n) : out.push(n));
        i = link.end;
        continue;
      }
    }
    if (c === 'h' && !isWordChar(prev)) {
      const m = AUTOLINK.exec(text.slice(i));
      if (m) {
        const url = m[0].replace(TRAILING, '');
        out.push({ t: 'a', href: url, c: [url] });
        i += url.length;
        continue;
      }
    }
    pushText(out, c === '\\' && /[\\`*_[\]()#+\-.!~|>]/.test(text[i + 1] ?? '') ? text[++i] : c);
    i++;
  }
  return out;
}

const indentOf = (line) => /^\s*/.exec(line)[0].replace(/\t/g, '    ').length;
const dedent = (line, n) => line.replace(new RegExp(`^ {0,${n}}`), '');

function cells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => parseInline(c.trim().replace(/\\\|/g, '|')));
}

const alignOf = (cell) => {
  const s = cell.trim();
  if (s.startsWith(':') && s.endsWith(':')) return 'center';
  if (s.endsWith(':')) return 'right';
  return 'left';
};

const startsBlock = (line, next) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
  || (line.includes('|') && next !== undefined && TABLE_RULE.test(next) && next.includes('-'));

function parseList(lines, start) {
  const first = ITEM.exec(lines[start]);
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
    const content = base + m[2].length + Math.min(m[3].length, 4);
    const body = [m[4]];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const next = lines.slice(i + 1).find((l) => l.trim());
        if (next === undefined || indentOf(next) < content) break;
        body.push('');
        i++;
        continue;
      }
      if (indentOf(line) < content && (ITEM.test(line) || indentOf(line) <= base)) break;
      body.push(dedent(line, content));
      i++;
    }
    const task = TASK.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    items.push({ ...(task ? { check: task[1] !== ' ' } : {}), c: parseMarkdown(body.join('\n')) });
    // A blank line between two items of the same list keeps the list going.
    if (!lines[i]?.trim()) {
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      const again = ITEM.exec(lines[j] ?? '');
      if (again && indentOf(again[1]) === base && /\d/.test(again[2]) === ordered) i = j;
    }
  }
  const list = ordered ? { t: 'ol', start: Number.parseInt(first[2], 10), items } : { t: 'ul', items };
  return { node: list, next: i };
}

export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const [, pad, mark, lang] = fence;
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && !lines[i].trim().replace(new RegExp(`^\\${mark[0]}+`), '').trim())) {
        body.push(dedent(lines[i], pad.length));
        i++;
      }
      i++;
      blocks.push({ t: 'pre', lang, v: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: 'h', level: heading[1].length, c: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
      blocks.push({ t: 'quote', c: parseMarkdown(body.join('\n')) });
      continue;
    }
    if (ITEM.test(line)) {
      const { node, next } = parseList(lines, i);
      blocks.push(node);
      i = next;
      continue;
    }
    if (line.includes('|') && TABLE_RULE.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').includes('-')) {
      const head = cells(line);
      const align = lines[i + 1].trim().replace(/^\||\|$/g, '').split('|').map(alignOf);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      blocks.push({ t: 'table', align, head, rows });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (!para.length || !startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++].trim());
    const c = [];
    para.forEach((l, n) => {
      if (n) c.push({ t: 'br' });
      for (const node of parseInline(l)) (typeof node === 'string' ? (typeof c.at(-1) === 'string' ? c[c.length - 1] += node : c.push(node)) : c.push(node));
    });
    blocks.push({ t: 'p', c });
  }
  return blocks;
}

// ---- drawing --------------------------------------------------------------------------------

function inlineNodes(h, nodes) {
  return nodes.map((n) => {
    if (typeof n === 'string') return n;
    if (n.t === 'br') return h('br', {});
    if (n.t === 'code') return h('code', {}, n.v);
    if (n.t === 'a') return h('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer' }, inlineNodes(h, n.c));
    return h({ b: 'strong', i: 'em', s: 'del' }[n.t], {}, inlineNodes(h, n.c));
  });
}

// opts.code(lang, text): the head of a code block (its language and a copy button), drawn by the caller.
export function renderMarkdown(h, text, opts = {}) {
  const draw = (blocks) => blocks.map((b) => {
    switch (b.t) {
      case 'h': return h('p', { class: `md-h md-h${b.level}`, role: 'heading', 'aria-level': String(Math.min(b.level + 2, 6)) }, inlineNodes(h, b.c));
      case 'pre': return h('div', { class: 'md-code' }, opts.code ? opts.code(b.lang, b.v) : null, h('pre', {}, h('code', {}, b.v)));
      case 'hr': return h('hr', {});
      case 'quote': return h('blockquote', {}, draw(b.c));
      case 'ul':
      case 'ol':
        return h(b.t, { ...(b.t === 'ol' && b.start !== 1 ? { start: String(b.start) } : {}), class: b.items.some((it) => 'check' in it) ? 'md-tasks' : null },
          b.items.map((it) => h('li', { class: 'check' in it ? `md-task${it.check ? ' is-done' : ''}` : null },
            'check' in it ? h('span', { class: 'md-box', role: 'img', 'aria-label': it.check ? opts.done ?? 'done' : opts.open ?? 'to do' }) : null,
            draw(it.c))));
      case 'table':
        return h('div', { class: 'md-table' }, h('table', {},
          h('thead', {}, h('tr', {}, b.head.map((c, n) => h('th', { class: `is-${b.align[n] ?? 'left'}` }, inlineNodes(h, c))))),
          h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c, n) => h('td', { class: `is-${b.align[n] ?? 'left'}` }, inlineNodes(h, c))))))));
      default: return h('p', {}, inlineNodes(h, b.c));
    }
  });
  return draw(parseMarkdown(text));
}
