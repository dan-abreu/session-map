// Safe split of a long Markdown document by topic (fd13). Pure: it gets texts and returns a plan; whoever applies it
// goes through care.applyOp. Cuts only at second-level headings outside code, tables and comments; every line of
// every piece is the original line byte for byte (CRLF included); only the index gains lines (the list of pieces).
// Links and anchors of the whole file set follow the headings, and the result is checked before it is offered.

import { posix } from 'node:path';
import { headingsOf, ghSlug, linksOf, maskCode, resolveLink, anchorsOf, brokenLinks } from './mdlinks.mjs';
import { docTypeOf, docAction } from './docsize.mjs';

const keepLines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const slashed = (p) => String(p ?? '').replaceAll('\\', '/');
const fail = (why) => ({ ok: false, why });
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const NAME_MAX = 80;

// ---------- naming ----------

function pieceName(title, n, used) {
  let base = ghSlug(title).normalize('NFC').replace(/[^\p{L}\p{M}\p{N}_-]/gu, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  base = Array.from(base).slice(0, NAME_MAX).join('');
  if (base === '') base = `section-${n}`;
  if (RESERVED.test(base)) base += '-section';
  let name = base;
  for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base}-${k}`;
  used.add(name.toLowerCase());
  return name;
}

const encodePath = (p) => p.split('/').map((s) => s.replaceAll(' ', '%20')).join('/');
// Path of `to` as written in a file living at `from`.
const relTarget = (from, to) => encodePath(posix.relative(`/${posix.dirname(from)}`, `/${to}`));

// Link text for the index: the heading as plain text, with brackets escaped so it cannot open a link.
const plainTitle = (t) => t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[[\]]/g, '\\$&').trim();

// ---------- editing link targets in place ----------

// Offset of the destination of `link` in a masked line (code, comments and front matter already blanked), or -1.
// One cursor per link kind keeps repeated targets in order.
function locate(masked, link, cursors) {
  const t = link.target;
  if (link.kind === 'inline' || link.kind === 'image') {
    for (let at = masked.indexOf('](', cursors.inline); at >= 0; at = masked.indexOf('](', at + 1)) {
      let i = at + 2;
      while (/\s/.test(masked[i] ?? '')) i++;
      if (masked[i] === '<') i++;
      if (masked.startsWith(t, i)) { cursors.inline = i + t.length; return i; }
    }
    return -1;
  }
  if (link.kind === 'reference') {
    const m = /^ {0,3}\[[^\]\n]+\]:[ \t]*<?/.exec(masked);
    return m && masked.startsWith(t, m[0].length) ? m[0].length : -1;
  }
  const re = /(?:href|src)\s*=\s*["']/gi;
  re.lastIndex = cursors.html;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    if (masked.startsWith(t, re.lastIndex)) { cursors.html = re.lastIndex + t.length; return re.lastIndex; }
  }
  return -1;
}

// Applies [{link, to}] to the text; null when a target cannot be found where it was read (then nothing is touched).
function editTargets(text, edits) {
  if (!edits.length) return text;
  const raw = keepLines(text);
  const masked = keepLines(maskCode(text));
  const byLine = new Map();
  for (const e of edits) {
    if (!byLine.has(e.link.line)) byLine.set(e.link.line, []);
    byLine.get(e.link.line).push(e);
  }
  for (const [line, list] of byLine) {
    const cursors = { inline: 0, html: 0 };
    const spots = [];
    for (const e of list) {
      const at = locate(masked[line - 1] ?? '', e.link, cursors);
      if (at < 0) return null;
      spots.push({ at, len: e.link.target.length, to: e.to });
    }
    let out = raw[line - 1];
    for (const s of spots.sort((a, b) => b.at - a.at)) out = out.slice(0, s.at) + s.to + out.slice(s.at + s.len);
    raw[line - 1] = out;
  }
  return raw.join('');
}

// Everything after the path in a link as written: "?query#anchor".
const tailOf = (target) => {
  const hash = target.indexOf('#');
  const head = hash < 0 ? target : target.slice(0, hash);
  return { query: /\?.*$/.exec(head)?.[0] ?? '', frag: hash < 0 ? '' : target.slice(hash) };
};

// ---------- verification ----------

const neutralLine = (line) => line
  .replace(/\r$/, '')
  .replace(/\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '](_)')
  .replace(/\b(href|src)(\s*=\s*)("[^"]*"|'[^']*')/gi, '$1$2_')
  .replace(/^(\s{0,3}\[[^\]]+\]:)\s*(<[^>]*>|\S+)/, '$1 _');

const contentLines = (files) => {
  const out = [];
  for (const text of Object.values(files)) for (const l of String(text).split('\n')) if (l.trim() !== '') out.push(l.replace(/\r$/, ''));
  return out;
};

const brokenKey = (b) => {
  if (b.why === 'anchor-missing') return `anchor-missing|${String(resolveLink(b.file, b.target)?.anchor ?? '').toLowerCase()}`;
  return `file-missing|${resolveLink(b.file, b.target)?.path ?? b.target}`;
};

// before / after: { path -> text } of the same file set. ok = every non-empty line before is still there after (link
// targets aside) and no link is newly broken. Links to paths the "before" already pointed at count as existing, so
// a link that was already broken does not block; `existsOnDisk` adds what the caller can see on disk.
export function verifySplit(before, after, { existsOnDisk } = {}) {
  const b = Object.fromEntries(Object.entries(before ?? {}).map(([p, t]) => [slashed(p), String(t ?? '')]));
  const a = Object.fromEntries(Object.entries(after ?? {}).map(([p, t]) => [slashed(p), String(t ?? '')]));
  const have = new Set(contentLines(a).map(neutralLine));
  const lostLines = [...new Set(contentLines(b).filter((l) => !have.has(neutralLine(l))))];

  const known = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const [file, text] of Object.entries(b)) {
    for (const l of linksOf(text)) {
      if (l.external) continue;
      const r = resolveLink(file, l.target);
      if (r?.path) known.add(r.path);
    }
  }
  const exists = (p) => known.has(p) || Boolean(existsOnDisk?.(p));
  const counts = new Map();
  for (const x of brokenLinks(b, exists)) counts.set(brokenKey(x), (counts.get(brokenKey(x)) ?? 0) + 1);
  const newBroken = [];
  for (const x of brokenLinks(a, exists)) {
    const k = brokenKey(x);
    if (counts.get(k) > 0) counts.set(k, counts.get(k) - 1);
    else newBroken.push(x);
  }
  return { ok: lostLines.length === 0 && newBroken.length === 0, lostLines, newBroken };
}

// A reference definition or a footnote whose uses are in another piece would stop working: the lines survive,
// the meaning does not. Refuse instead of guessing.
function labelsCrossPieces(text, segOfLine) {
  const masked = maskCode(text);
  const lines = masked.split('\n');
  const starts = [];
  let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  const lineAt = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo;
  };
  for (let i = 0; i < lines.length; i++) {
    const def = /^ {0,3}\[([^\]\n]+)\]:/.exec(lines[i]);
    if (!def) continue;
    const label = def[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const use = new RegExp(`\\[${label}\\]`, 'gi');
    for (let m = use.exec(masked); m; m = use.exec(masked)) {
      const at = lineAt(m.index);
      if (at !== i && segOfLine(at) !== segOfLine(i)) return true;
    }
  }
  return false;
}

// ---------- the plan ----------

// planSplit({ path, text, files, existsOnDisk }) -> { ok: true, op, index, pieces: [{ path, title, lines }], updated }
// or { ok: false, why: append-only | too-few-sections | link-would-break | name-clash }.
// files: { path -> text } of the Markdown files of the repository that may link to this document.
export function planSplit({ path, text, files = {}, existsOnDisk } = {}) {
  const p = slashed(path);
  const src = String(text ?? '');
  if (docAction(docTypeOf(p), 'warning') === 'archive') return fail('append-only');

  const lines = keepLines(src);
  const maskedLines = keepLines(maskCode(src));
  const cuts = headingsOf(src).filter((h) => {
    if (h.level !== 2) return false;
    if ((maskedLines[h.line - 1] ?? '').trim() === '') return false;
    return !(lines[h.line - 1].includes('|') && /^\s*\|/.test(lines[h.line - 2] ?? ''));
  });
  if (cuts.length < 2) return fail('too-few-sections');

  // Segment 0 is the preamble (stays in the index); segment j is the section of cuts[j - 1].
  const starts = [0, ...cuts.map((h) => h.line - 1)];
  const segOfLine = (i) => { let j = 0; while (j + 1 < starts.length && starts[j + 1] <= i) j++; return j; };
  const segText = starts.map((s, j) => lines.slice(s, starts[j + 1] ?? lines.length).join(''));

  const dir = posix.dirname(p) === '.' ? '' : posix.dirname(p);
  const stem = posix.basename(p).replace(/\.(md|markdown)$/i, '');
  const used = new Set();
  const pieces = cuts.map((h, i) => {
    const name = pieceName(h.text, i + 1, used);
    return { path: posix.join(dir, stem, `${name}.md`), title: h.text, lines: segText[i + 1].split('\n').length - (segText[i + 1].endsWith('\n') ? 1 : 0) };
  });
  const segPath = (j) => (j === 0 ? p : pieces[j - 1].path);

  const taken = new Set(Object.keys(files).map((k) => slashed(k).toLowerCase()));
  taken.add(p.toLowerCase());
  for (const pc of pieces) {
    if (taken.has(pc.path.toLowerCase()) || existsOnDisk?.(pc.path)) return fail('name-clash');
  }

  // Where each heading and each HTML id of the original ends up, and under which anchor.
  const headings = headingsOf(src);
  const localSlugs = segText.map((t) => headingsOf(t).map((h) => h.slug));
  const perSeg = starts.map(() => 0);
  const anchorMap = new Map();
  for (const h of headings) {
    const j = segOfLine(h.line - 1);
    const slug = localSlugs[j][perSeg[j]++];
    if (slug === undefined) return fail('link-would-break');
    anchorMap.set(h.slug, { seg: j, slug });
  }
  if (perSeg.some((n, j) => n !== localSlugs[j].length)) return fail('link-would-break');
  const htmlIds = new Map();
  segText.forEach((t, j) => {
    for (const a of anchorsOf(t)) if (!anchorMap.has(a) && !htmlIds.has(a)) htmlIds.set(a, j);
  });
  const placeOf = (anchor) => {
    const key = anchor.replace(/^user-content-/i, '').toLowerCase();
    if (anchorMap.has(key)) return anchorMap.get(key);
    return htmlIds.has(key) ? { seg: htmlIds.get(key), slug: key } : null;
  };

  if (labelsCrossPieces(src, segOfLine)) return fail('link-would-break');

  // Links written in the document itself: relative paths get one level deeper inside pieces; links to its own
  // headings point to the piece that now holds them.
  const own = [];
  for (const link of linksOf(src)) {
    if (link.external) continue;
    const r = resolveLink(p, link.target);
    if (!r || r.path === null) continue;
    const from = segOfLine(link.line - 1);
    let to = null;
    if (r.path === p) {
      if (link.path === '' && link.anchor === null) continue;
      const place = r.anchor ? placeOf(r.anchor) : null;
      if (r.anchor && !place) { if (link.path !== '') to = `${relTarget(segPath(from), p)}${tailOf(link.target).query}#${r.anchor}`; }
      else {
        const dest = place ? place.seg : 0;
        const anchor = place ? `#${place.slug}` : '';
        to = dest === from && r.anchor ? anchor : `${relTarget(segPath(from), segPath(dest))}${anchor}`;
        if (dest === from && !r.anchor) to = null;
      }
    } else if (from !== 0) {
      const { query, frag } = tailOf(link.target);
      to = `${link.target.startsWith('/') ? `/${r.path}` : relTarget(segPath(from), r.path)}${query}${frag}`;
    }
    if (to !== null && to !== link.target) own.push({ link, to });
  }
  const edited = editTargets(src, own);
  if (edited === null) return fail('link-would-break');
  const editedLines = keepLines(edited);
  const bodies = starts.map((s, j) => editedLines.slice(s, starts[j + 1] ?? editedLines.length).join(''));

  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const toc = pieces.map((pc) => `- [${plainTitle(pc.title)}](${relTarget(p, pc.path)})${eol}`).join('');
  const lead = bodies[0];
  const gap = lead === '' || lead.trim() === '' || /(\r?\n)[ \t]*\r?\n$/.test(lead) ? '' : eol;
  const index = `${lead}${gap}${toc}`;

  // Links from the rest of the repository into this document.
  const updated = [];
  const opFiles = [{ path: p, after: index }, ...pieces.map((pc, i) => ({ path: pc.path, after: bodies[i + 1] }))];
  for (const [rawPath, other] of Object.entries(files)) {
    const fp = slashed(rawPath);
    if (fp === p) continue;
    const edits = [];
    for (const link of linksOf(String(other ?? ''))) {
      if (link.external || !link.anchor) continue;
      const r = resolveLink(fp, link.target);
      if (!r || r.path !== p) continue;
      const place = placeOf(r.anchor);
      if (!place || (place.seg === 0 && place.slug === r.anchor)) continue;
      const { query } = tailOf(link.target);
      const where = link.target.startsWith('/') ? `/${segPath(place.seg)}` : relTarget(fp, segPath(place.seg));
      edits.push({ link, to: `${where}${query}#${place.slug}` });
    }
    const next = editTargets(String(other ?? ''), edits);
    if (next === null) return fail('link-would-break');
    if (next !== other) { opFiles.push({ path: fp, after: next }); updated.push(fp); }
  }

  const before = { ...Object.fromEntries(Object.entries(files).map(([k, v]) => [slashed(k), v])), [p]: src };
  const after = { ...before };
  for (const f of opFiles) after[f.path] = f.after;
  if (!verifySplit(before, after, { existsOnDisk }).ok) return fail('link-would-break');

  return {
    ok: true,
    op: { kind: 'doc-split', sensitive: false, files: opFiles, why: { msg: 'findings.split.title', params: { n: pieces.length } } },
    index: p,
    pieces,
    updated,
  };
}
