// Reads the architecture convention (desenho-3 § 1): a README with layers plus one markdown file per part.
// Pure: it receives file contents and returns data.

export const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const key = (s) => norm(s).replace(/[^a-z0-9]/g, '');
export const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const MISSING_HEADINGS = { oquefalta: 'pt', whatsmissing: 'en', whatismissing: 'en', todo: 'en' };
const CODE_PATHS_HEADINGS = { ondeestanocodigo: 'pt', whereinthecode: 'en' };
const CODE_RE = /^[a-z]{1,4}(?:-[a-z]{1,8})?\d{1,4}$/i;
const ITEM_RE = /^[-*+]\s+\[([ xX])\]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

export const isUserWho = (who) => !!who && key(who) !== 'claude';

// Headings outside code fences, with their line index.
function headingsOf(lines) {
  const out = [];
  let fence = null;
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, '');
    const f = FENCE_RE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = HEADING_RE.exec(line);
    if (h) out.push({ idx, level: h[1].length, text: h[2] });
  });
  return out;
}

function parseBold(rest) {
  const m = /^\*\*([^*]+?)(:?)\*\*(:?)\s*(.*)$/.exec(rest);
  if (!m || !(m[2] || m[3])) return null;
  const tokens = m[1].split(/\s*[·|]\s*/).map((t) => t.trim()).filter(Boolean).map(classifyToken);
  if (!tokens.some((t) => t.kind)) return null;
  return { tokens, rest: m[4] };
}

function classifyToken(raw) {
  const n = norm(raw);
  if (/^(em andamento|in progress|doing)$/.test(n)) return { raw, kind: 'status', value: 'doing' };
  if (/^(bloqueia|blocks?|blocker)\b/.test(n)) return { raw, kind: 'weight', value: 'blocks' };
  if (/^(importante|important)\b/.test(n)) return { raw, kind: 'weight', value: 'important' };
  if (/^(detalhe|detail)\b/.test(n)) return { raw, kind: 'weight', value: 'detail' };
  const step = /^(?:etapas?|steps?)\s+(\d+[a-z]?)\b/.exec(n);
  if (step) return { raw, kind: 'milestone', value: step[1] };
  if (/^(com (o |a |os |as )?\S|with \S|claude$)/.test(n) || /\S (e|and) claude$/.test(n)) return { raw, kind: 'who', value: raw };
  return { raw, kind: null };
}

function parseItem(first, checked, subLines, line) {
  let rest = first;
  let status = checked ? 'done' : 'todo';
  let who = null;
  let weight = null;
  let milestone = null;
  const lead = parseBold(rest);
  if (lead) {
    rest = lead.rest;
    for (const t of lead.tokens) {
      if (t.kind === 'status' && !checked) status = t.value;
      else if (t.kind === 'who') who = t.value;
      else if (t.kind === 'weight') weight = t.value;
      else if (t.kind === 'milestone') milestone = t.value;
    }
  }
  let code = null;
  const tail = /\s+`([^`]+)`\s*$/.exec(rest);
  if (tail && CODE_RE.test(tail[1])) {
    code = tail[1];
    rest = rest.slice(0, tail.index);
  }
  const detail = [];
  for (const raw of subLines) {
    const t = raw.trim();
    if (!t) continue;
    const bullet = /^[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(t);
    if (bullet) detail.push(bullet[1]);
    else if (detail.length) detail[detail.length - 1] += ` ${t}`;
    else detail.push(t);
  }
  return { code, title: rest.trim(), detail, status, who, weight, milestone, line };
}

// Locates the "O que falta" section and its items by line.
function scanPart(text) {
  const lines = text.split('\n');
  const heads = headingsOf(lines);
  const fh = heads.find((h) => MISSING_HEADINGS[key(h.text)]);
  const empty = { lines, heads, section: null, regions: [] };
  if (!fh) return empty;
  const after = heads.filter((h) => h.idx > fh.idx);
  const end = (after.find((h) => h.level <= fh.level)?.idx) ?? lines.length;
  const inner = after.filter((h) => h.idx < end);
  const bounds = [{ name: '', headIdx: null, start: fh.idx + 1 }, ...inner.map((h) => ({ name: h.text, headIdx: h.idx, start: h.idx + 1 }))];
  const regions = bounds.map((b, i) => {
    const regionEnd = bounds[i + 1] ? bounds[i + 1].headIdx : end;
    return { ...b, end: regionEnd, items: itemsIn(lines, b.start, regionEnd) };
  });
  return { lines, heads, section: { headIdx: fh.idx, level: fh.level, end, lang: MISSING_HEADINGS[key(fh.text)] }, regions };
}

function itemsIn(lines, start, end) {
  const items = [];
  let fence = null;
  for (let i = start; i < end; i++) {
    const line = lines[i].replace(/\r$/, '');
    const f = FENCE_RE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = ITEM_RE.exec(line);
    if (!m) continue;
    let last = i;
    const sub = [];
    for (let j = i + 1; j < end; j++) {
      const l = lines[j].replace(/\r$/, '');
      if (!l.trim()) continue;
      if (!/^\s+\S/.test(l)) break;
      last = j;
      sub.push(l);
    }
    items.push({ ...parseItem(m[2], m[1] !== ' ', sub, i + 1), startIdx: i, endIdx: last });
    i = last;
  }
  return items;
}

function aboutOf(lines, h1Idx) {
  const para = [];
  let fence = false;
  for (let i = h1Idx + 1; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (FENCE_RE.test(l)) fence = !fence;
    if (HEADING_RE.test(l) && !fence) break;
    if (fence || !l.trim()) {
      if (para.length) break;
      continue;
    }
    if (l.startsWith('>')) continue;
    if (/^([-*+]|\d+\.|\|)\s?/.test(l.trim())) { if (para.length) break; continue; }
    para.push(l.trim());
  }
  return para.join(' ');
}

function codePathsOf(lines, heads) {
  const h = heads.find((x) => CODE_PATHS_HEADINGS[key(x.text)]);
  if (!h) return [];
  const next = heads.find((x) => x.idx > h.idx && x.level <= h.level);
  const body = lines.slice(h.idx + 1, next ? next.idx : lines.length).join('\n');
  const paths = [];
  for (const m of body.matchAll(/`([^`\s]*\/[^`\s]*)`/g)) if (!paths.includes(m[1])) paths.push(m[1]);
  return paths;
}

function parsePart(dir, name, text) {
  const { lines, heads, regions, section } = scanPart(text);
  const h1 = heads.find((h) => h.level === 1);
  const base = name.replace(/\.md$/i, '');
  const groups = regions.filter((r) => r.items.length).map((r) => ({ name: r.name, items: r.items.map(stripScan) }));
  const items = groups.flatMap((g) => g.items);
  const open = items.filter((i) => i.status !== 'done');
  return {
    part: {
      id: slug(base), name: h1 ? h1.text.replace(/[*`]/g, '') : base, file: `${dir}/${name}`,
      about: h1 ? aboutOf(lines, h1.idx) : '', codePaths: codePathsOf(lines, heads), groups,
      counts: {
        todo: items.filter((i) => i.status === 'todo').length,
        doing: items.filter((i) => i.status === 'doing').length,
        done: items.length - open.length,
        withUser: open.filter((i) => isUserWho(i.who)).length,
        blocks: open.filter((i) => i.weight === 'blocks').length,
      },
      chatIds: [], workCellIds: [],
    },
    lang: section?.lang ?? null,
  };
}

const stripScan = ({ startIdx, endIdx, ...item }) => item;

// The first mermaid block of the README: the diagram the Flow tab draws and an import rewrites. Both fences sit on
// their own lines, as in markdown, so a run of backticks inside a line never ends the block.
export const MERMAID_FENCE_RE = /^[ \t]*```mermaid[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*(?=\r?$)/m;
export const readmeMermaid = (text) => MERMAID_FENCE_RE.exec(text)?.[1].replace(/\s+$/, '') ?? null;

function layersFromMermaid(text, resolve) {
  const block = readmeMermaid(text);
  if (block === null) return [];
  const layers = [];
  const stack = [];
  const seen = new Set();
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    const sg = /^subgraph\s+([\w-]+)(?:\s*\[\s*"?([^\]"]+)"?\s*\])?\s*$/.exec(line) ?? /^subgraph\s+"?([^"]+)"?\s*$/.exec(line);
    if (sg) {
      const layer = { id: slug(sg[1]), name: (sg[2] ?? sg[1]).trim(), partIds: [] };
      layers.push(layer);
      stack.push(layer);
      continue;
    }
    if (line === 'end') { stack.pop(); continue; }
    const layer = stack[stack.length - 1];
    if (!layer) continue;
    for (const n of line.matchAll(/\b([A-Za-z_]\w*)(?:\[\[?"?([^\]"]+)"?\]?\]|\("?([^)"]+)"?\)|\{"?([^}"]+)"?\})/g)) {
      const id = resolve(n[2] ?? n[3] ?? n[4]) ?? resolve(n[1]);
      if (id && !seen.has(id)) { seen.add(id); layer.partIds.push(id); }
    }
  }
  return layers;
}

function layersFromHeadings(text, resolve, resolveFile) {
  const lines = text.split('\n');
  const all = headingsOf(lines);
  const layers = [];
  for (const h of all.filter((x) => x.level === 2 || x.level === 3)) {
    const next = all.find((x) => x.idx > h.idx);
    const body = lines.slice(h.idx + 1, next ? next.idx : lines.length);
    const partIds = [];
    const add = (id) => { if (id && !partIds.includes(id)) partIds.push(id); };
    for (const l of body) {
      const links = [...l.matchAll(/\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g)];
      if (links.length) { links.forEach((k) => add(resolveFile(k[1]))); continue; }
      const item = /^\s*[-*+]\s+(?:\*\*)?([^*\n—–:]+?)(?:\*\*)?\s*(?:[—–:]|\s-\s|$)/.exec(l);
      if (item) add(resolve(item[1]));
    }
    if (partIds.length) layers.push({ id: slug(h.text), name: h.text.replace(/[*`]/g, ''), partIds });
  }
  return layers;
}

export function parseArch(dir, files, source = 'worktree') {
  const names = Object.keys(files).sort();
  const partNames = names.filter((n) => /\.md$/i.test(n) && n.toLowerCase() !== 'readme.md');
  if (!partNames.length && !('README.md' in files)) return { source: 'none', dir: null, lang: 'en', mermaid: null, layers: [], parts: [] };
  const parsed = partNames.map((n) => parsePart(dir, n, files[n]));
  const parts = parsed.map((p) => p.part);
  const langs = parsed.map((p) => p.lang).filter(Boolean);
  const lang = langs.length ? (langs.filter((l) => l === 'pt').length >= langs.length / 2 ? 'pt' : 'en') : /arquitetura/i.test(dir) ? 'pt' : 'en';

  const byKey = new Map();
  for (const p of parts) {
    byKey.set(key(p.id), p.id);
    if (!byKey.has(key(p.name))) byKey.set(key(p.name), p.id);
  }
  const byFile = new Map(partNames.map((n, i) => [n.toLowerCase(), parts[i].id]));
  const resolve = (label) => byKey.get(key(label)) ?? null;
  const resolveFile = (href) => {
    let name = href.replace(/^.*[\\/]/, '');
    try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    return byFile.get(name.toLowerCase()) ?? null;
  };

  const readme = files['README.md'] ?? '';
  let layers = layersFromMermaid(readme, resolve);
  if (!layers.some((l) => l.partIds.length)) layers = layersFromHeadings(readme, resolve, resolveFile);
  layers = layers.filter((l) => l.partIds.length);
  const placed = new Set(layers.flatMap((l) => l.partIds));
  const loose = parts.filter((p) => !placed.has(p.id)).map((p) => p.id);
  if (loose.length) layers.push({ id: 'other', name: lang === 'pt' ? 'Outros' : 'Other', partIds: loose });
  // A link from one part's file to another's ([Payments](payments.md)) is one of the reasons two parts are related.
  const withRefs = parts.map((p, i) => {
    const refs = new Set();
    for (const m of files[partNames[i]].matchAll(/\]\(([^)\s]+?\.md)(?:#[^)\s]*)?\)/gi)) {
      if (m[1].includes('://') || m[1].includes('..')) continue;
      const id = resolveFile(m[1]);
      if (id && id !== p.id) refs.add(id);
    }
    return { ...p, refs: [...refs].sort() };
  });
  return { source, dir, lang, mermaid: readmeMermaid(readme), layers, parts: withRefs };
}
