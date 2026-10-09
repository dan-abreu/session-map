// The only code that writes into a project's architecture folder (desenho-3 § 1). It edits lines in place and
// leaves every byte it does not need to touch exactly as it was, including line endings.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { classifyToken, detectEol, key, parseBold, scanPart } from './parse.mjs';

const STATUS_WORD = { pt: 'em andamento', en: 'in progress' };
const MILESTONE_WORD = { pt: 'etapa', en: 'step' };
const WEIGHT_WORD = { pt: { blocks: 'bloqueia', important: 'importante', detail: 'detalhe' }, en: { blocks: 'blocks', important: 'important', detail: 'detail' } };
const SECTION_HEADING = { pt: 'O que falta', en: "What's missing" };
const STATUSES = ['todo', 'doing', 'done'];
const ITEM_RE = /^[-*+]\s+\[([ xX])\]\s+(.*)$/;

class ArchWriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => new ArchWriteError(code, message);

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Returns the real path of a part file that sits directly inside the architecture folder, or throws.
function guard(file, dir) {
  const rel = relative(resolve(dir), resolve(file));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw fail('OUTSIDE_ARCH_DIR', 'file is outside the architecture folder');
  if (rel.includes(sep) || !/\.md$/i.test(rel) || key(rel) === 'readmemd' || !existsSync(file) || !statSync(file).isFile()) {
    throw fail('NOT_A_PART', 'not a part file of the architecture folder');
  }
  const real = relative(realpathSync(dir), realpathSync(file));
  if (!real || real.startsWith('..') || isAbsolute(real)) throw fail('OUTSIDE_ARCH_DIR', 'file resolves outside the architecture folder');
  return file;
}

function normalizeItem(input, lang) {
  const title = clean(input.title);
  if (!title) throw fail('INVALID_ITEM', 'title is required');
  const weight = input.weight ?? null;
  if (weight !== null && !WEIGHT_WORD[lang][weight]) throw fail('INVALID_ITEM', 'unknown weight');
  const milestone = input.milestone == null ? null : clean(input.milestone);
  if (milestone !== null && !/^[\w.-]{1,12}$/.test(milestone)) throw fail('INVALID_ITEM', 'bad milestone');
  const who = input.who == null ? null : clean(String(input.who).replace(/[*`·|]/g, '')).replace(/:$/, '');
  if (who && classifyToken(who).kind !== 'who') throw fail('INVALID_ITEM', 'unrecognised "who"');
  const detail = (input.detail ?? []).map(clean).filter(Boolean);
  const group = clean(String(input.group ?? '').replace(/^#+/, '').replace(/[*`]/g, ''));
  return { title, weight, milestone, who: who || null, detail, group };
}

function prefixOf(tokens) {
  return tokens.length ? `**${tokens.join(' · ')}:** ` : '';
}

function nextCode(file, dir, lang, ownCodes) {
  const counts = new Map();
  for (const c of ownCodes) {
    const p = /^(.*?)\d+$/.exec(c)?.[1];
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const prefix = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? (key(basename(file, '.md')).replace(/\d/g, '').slice(0, 2) || 'it');
  const re = new RegExp(`\`${prefix.replace(/[^\w-]/g, '')}(\\d+)\``, 'gi');
  let max = 0;
  let width = 2;
  for (const name of readdirSync(dir).filter((n) => /\.md$/i.test(n))) {
    for (const m of readFileSync(resolve(dir, name), 'utf8').matchAll(re)) {
      max = Math.max(max, Number(m[1]));
      width = Math.max(width, m[1].length);
    }
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

// "N itens em aberto: A bloqueiam o lançamento, B importantes, C detalhes, D sem peso": the numbers are recomputed,
// every other word stays as the author wrote it (only singular/plural follows the number).
function patchCountLine(line, counts) {
  let out = line;
  const total = counts.todo + counts.doing;
  const pt = /(\d+) (itens?)( em aberto)/;
  const en1 = /(\d+) (items?)( open| in progress)/;
  const en2 = /(\d+) (open items?)/;
  if (pt.test(out)) out = out.replace(pt, (_, __, ___, tail) => `${total} ${total === 1 ? 'item' : 'itens'}${tail}`);
  else if (en1.test(out)) out = out.replace(en1, (_, __, ___, tail) => `${total} ${total === 1 ? 'item' : 'items'}${tail}`);
  else if (en2.test(out)) out = out.replace(en2, () => `${total} ${total === 1 ? 'open item' : 'open items'}`);
  else return null;
  const word = (re, n, forms) => {
    out = out.replace(re, (_, __, w) => {
      const pair = forms.find(([one, many]) => w === one || w === many);
      return `${n} ${pair ? (n === 1 ? pair[0] : pair[1]) : w}`;
    });
  };
  word(/(\d+) (bloqueiam?|blocks?|block)\b/, counts.blocks, [['bloqueia', 'bloqueiam'], ['blocks', 'block']]);
  word(/(\d+) (importantes?|important)\b/, counts.important, [['importante', 'importantes']]);
  word(/(\d+) (detalhes?|details?|minor)\b/, counts.detail, [['detalhe', 'detalhes'], ['detail', 'details']]);
  out = out.replace(/(\d+)( sem peso| unweighted| no weight)/, (_, __, w) => `${counts.none}${w}`);
  return out;
}

function refreshCounts(text) {
  const scan = scanPart(text);
  if (!scan.section) return text;
  const items = scan.regions.flatMap((r) => r.items).filter((i) => i.status !== 'done');
  const counts = {
    todo: items.filter((i) => i.status === 'todo').length,
    doing: items.filter((i) => i.status === 'doing').length,
    blocks: items.filter((i) => i.weight === 'blocks').length,
    important: items.filter((i) => i.weight === 'important').length,
    detail: items.filter((i) => i.weight === 'detail').length,
    none: items.filter((i) => !i.weight).length,
  };
  const lines = scan.lines;
  for (let i = scan.section.headIdx + 1; i < scan.section.end; i++) {
    const patched = patchCountLine(lines[i].replace(/\r$/, ''), counts);
    if (patched !== null) {
      lines[i] = patched + (lines[i].endsWith('\r') ? '\r' : '');
      break;
    }
  }
  return lines.join('\n');
}

export function addItem(file, input, { dir, lang: langHint } = {}) {
  guard(file, dir);
  const text = readFileSync(file, 'utf8');
  const scan = scanPart(text);
  const lang = scan.section?.lang ?? langHint ?? 'en';
  const item = normalizeItem(input, lang);
  const nl = detectEol(text) === '\r\n' ? '\r' : '';
  const ownCodes = scan.regions.flatMap((r) => r.items.map((i) => i.code).filter(Boolean));
  const code = nextCode(file, dir, lang, ownCodes);

  const tokens = [];
  if (item.who) tokens.push(item.who);
  if (item.milestone) tokens.push(`${MILESTONE_WORD[lang]} ${item.milestone}`);
  if (item.weight) tokens.push(WEIGHT_WORD[lang][item.weight]);
  const block = [`- [ ] ${prefixOf(tokens)}${item.title} \`${code}\``, ...item.detail.map((d) => `  - ${d}`)];

  const lines = scan.lines;
  const blank = (i) => i >= 0 && i < lines.length && !lines[i].trim();
  let at;
  let insert = block;
  if (!scan.section) {
    at = lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    insert = ['', `## ${SECTION_HEADING[lang]}`, '', ...(item.group ? [`### ${item.group}`, ''] : []), ...block];
  } else {
    const region = scan.regions.find((r) => key(r.name) === key(item.group));
    if (!region) {
      let last = scan.section.end - 1;
      while (last > scan.section.headIdx && blank(last)) last--;
      at = last + 1;
      insert = ['', `### ${item.group}`, '', ...block];
    } else if (region.items.length) {
      at = region.items[region.items.length - 1].endIdx + 1;
    } else if (region.headIdx !== null) {
      at = blank(region.headIdx + 1) ? region.headIdx + 2 : region.headIdx + 1;
      if (!blank(at - 1)) insert = ['', ...block];
      if (at < lines.length && lines[at].trim() && /^#/.test(lines[at])) insert = [...insert, ''];
    } else {
      let last = region.end - 1;
      while (last > scan.section.headIdx && blank(last)) last--;
      at = last + 1;
      insert = ['', ...block];
    }
  }
  lines.splice(at, 0, ...insert.map((l) => l + nl));
  writeFileSync(file, refreshCounts(lines.join('\n')));
  return { code };
}

export function setStatus(file, code, status, { dir, lang: langHint } = {}) {
  guard(file, dir);
  if (!STATUSES.includes(status)) throw fail('INVALID_ITEM', 'unknown status');
  const text = readFileSync(file, 'utf8');
  const scan = scanPart(text);
  const found = scan.regions.flatMap((r) => r.items).find((i) => i.code === code);
  if (!found) throw fail('ITEM_NOT_FOUND', `no item with code ${code}`);
  const lang = scan.section.lang ?? langHint ?? 'en';
  const cr = scan.lines[found.startIdx].endsWith('\r') ? '\r' : '';
  const m = ITEM_RE.exec(scan.lines[found.startIdx].replace(/\r$/, ''));
  const lead = parseBold(m[2]);
  const tokens = (lead ? lead.tokens : []).filter((t) => t.kind !== 'status').map((t) => t.raw);
  if (status === 'doing') tokens.unshift(STATUS_WORD[lang]);
  scan.lines[found.startIdx] = `- [${status === 'done' ? 'x' : ' '}] ${prefixOf(tokens)}${lead ? lead.rest : m[2]}${cr}`;
  const next = refreshCounts(scan.lines.join('\n'));
  if (next !== text) writeFileSync(file, next);
  return { changed: next !== text };
}
