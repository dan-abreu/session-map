// The clerk robot of the architecture map (am04). The AI supplies the words; the clerk decides where each line goes and in
// which order: the next free code, the group, the request's "Where it went" line, the index line, a new part's file plus
// its row in the README table plus its node in the mermaid flow. Each call plans the exact line edits (pure, on the files
// as read), checks the order, and writes them with the safe writer of livemark (atomic swap, EBUSY retry, a file changed
// in the last 5 seconds is not touched). It never deletes a line. Every answer is { ok: true, edits, wrote, ... } or
// { ok: false, reason }, and a refusal writes nothing.
import { existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { matchParts, parseFlow } from '../web/flow.js';
import { detectArch } from './detect.mjs';
import { RECENT_MS, markedLine, progressWord, replaceFile } from './livemark.mjs';
import { key, parseArch, parseBold, readmeMermaid, scanPart, slug } from './parse.mjs';

const refuse = (reason) => ({ ok: false, reason });
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const stampOf = (ms) => { const d = new Date(ms); return `${dayOf(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const LABELS = {
  en: {
    asked: 'Asked', means: 'What it means', confirm: 'How to confirm it is done', went: 'Where it went', status: 'Status',
    notYet: 'not yet an item.', fresh: 'new.', from: (c) => `From \`${c}\`.`, built: 'Built on', newGroup: 'New requests',
    missing: "What's missing", how: 'How it works', where: 'Where in the code', rules: 'Rules that must not break', blank: 'Not written yet.',
  },
  pt: {
    asked: 'Pedido', means: 'O que significa', confirm: 'Como conferir', went: 'Onde foi', status: 'Situação',
    notYet: 'ainda não é um item.', fresh: 'novo.', from: (c) => `Do pedido \`${c}\`.`, built: 'Feito em', newGroup: 'Pedidos novos',
    missing: 'O que falta', how: 'Como funciona', where: 'Onde está no código', rules: 'Regras que não podem quebrar', blank: 'A escrever.',
  },
};
const ASKED_RE = /^(asked|pedido(?: em)?)\s*:/i;
const WHERE_RE = /^([-*+]\s+)(where it went|onde foi)(\s*:\s*)(.*)$/i;
const STATUS_RE = /^[-*+]\s+(status|situacao|situação)\s*:/i;
const CODE_MENTION_RE = /`([a-z]{1,4}(?:-[a-z]{1,8})?)(\d{1,4})`/gi;
const PREFIX_NOTE_RE = /<!--\s*code prefix:\s*([a-z]{1,4})\s*-->/i;
const REGISTRY_FILE_RE = /^(ideas|pedidos|requests|ideias)\.md$/i;
const CLOSED_RE = /closed|fechad|arquiv/i;
const OPEN_ITEM_RE = /^([-*+]\s+)\[ \]\s+(.*)$/;

// ---- reading the map ----

// The map as the clerk plans on it: line endings folded to \n (crlf remembers which files to give back), parsed once.
export async function loadMap(root, { config } = {}) {
  if (typeof root !== 'string' || !root.trim()) return refuse('session-map did not say which project this is, so there is no map to write.');
  const found = await detectArch(root, config ?? {}, { mainBranch: null }); // the work tree only: no git
  if (found.source !== 'worktree') return refuse('this project has no architecture folder in its own files (docs/architecture, docs/arquitetura or docs/arch); a map on the main branch is not written from here.');
  const files = {};
  const crlf = {};
  for (const [name, text] of Object.entries(found.files)) {
    crlf[name] = text.includes('\r\n');
    files[name] = text.replace(/\r\n/g, '\n');
  }
  const arch = parseArch(found.dir, files, 'worktree');
  const scans = {};
  const byCode = new Map(); // lowercase code -> [{ file, item, scan }]
  for (const [name, text] of Object.entries(files)) {
    if (!/\.md$/i.test(name) || name.toLowerCase() === 'readme.md') continue;
    const scan = scanPart(text);
    scans[name] = scan;
    for (const region of scan.regions) {
      for (const item of region.items) {
        if (!item.code) continue;
        const list = byCode.get(item.code.toLowerCase()) ?? [];
        list.push({ file: name, item, scan });
        byCode.set(item.code.toLowerCase(), list);
      }
    }
  }
  return { ok: true, root, dir: found.dir, raw: found.files, files, crlf, arch, scans, byCode };
}

const fileOf = (map, part) => part.file.slice(part.file.lastIndexOf('/') + 1);
const langOf = (map, file) => map.scans[file]?.section?.lang ?? map.arch.lang;

function findPart(map, ref) {
  const k = key(ref);
  if (!k) return null;
  return map.arch.parts.find((p) => key(p.id) === k || key(p.name) === k || key(fileOf(map, p).replace(/\.md$/i, '')) === k) ?? null;
}

const prefixOf = (code) => code.replace(/\d+$/, '').toLowerCase();

// Every code a file names between backticks, by prefix: the biggest number in use, so a code is never given twice.
function highest(map, prefix) {
  let max = 0;
  for (const text of Object.values(map.files)) {
    for (const m of text.matchAll(CODE_MENTION_RE)) if (m[1].toLowerCase() === prefix) max = Math.max(max, Number(m[2]));
  }
  return max;
}
const nextCode = (map, prefix) => `${prefix}${pad(highest(map, prefix) + 1)}`;

// The prefixes the items of the folder already use, with the part that owns each (and the ones a new part reserved).
function prefixOwners(map) {
  const owners = new Map();
  for (const [name, text] of Object.entries(map.files)) {
    const note = PREFIX_NOTE_RE.exec(text);
    if (note) owners.set(note[1].toLowerCase(), name);
  }
  for (const list of map.byCode.values()) for (const { file, item } of list) if (!owners.has(prefixOf(item.code))) owners.set(prefixOf(item.code), file);
  return owners;
}

// The prefix a part's items use: the commonest among its codes, else the one a new part reserved.
function partPrefix(map, file) {
  const counts = new Map();
  for (const list of map.byCode.values()) for (const e of list) if (e.file === file) counts.set(prefixOf(e.item.code), (counts.get(prefixOf(e.item.code)) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  return PREFIX_NOTE_RE.exec(map.files[file] ?? '')?.[1].toLowerCase() ?? null;
}

// The requests file: the registry part that is not the closed one, else a file named like one.
function registryOf(map) {
  const named = map.arch.parts.filter((p) => p.role === 'requests').map((p) => fileOf(map, p));
  const open = named.find((f) => !CLOSED_RE.test(f)) ?? Object.keys(map.files).find((f) => REGISTRY_FILE_RE.test(f));
  return open ?? null;
}

const isRequest = (entry) => entry.item.detail.some((d) => ASKED_RE.test(d));

// The flow in the README: the mermaid model and the node each part has in it (null when the README draws none).
function flowOf(map) {
  const block = readmeMermaid(map.files['README.md'] ?? '');
  if (block === null) return null;
  const model = parseFlow(block);
  if (!model.ok) return null;
  const nodeOfPart = new Map();
  for (const [nodeId, partId] of matchParts(model, map.arch.parts)) if (!nodeOfPart.has(partId)) nodeOfPart.set(partId, nodeId);
  return { model, nodeOfPart };
}

// The flow must hold every part that has code to talk about; the operation part and the registries' own items are exempt.
function missingFromFlow(map, part) {
  const flow = flowOf(map);
  if (!flow || part.role === 'operation') return null;
  return flow.nodeOfPart.has(part.id) ? null : `the part "${part.name}" is not in the flow of README.md: a part must be drawn there before it gets items (map_add_part draws it).`;
}

// ---- line edits ----

// An edit is { file, at, remove, lines, what }: in the file's lines (as read), `remove` lines from index `at` are replaced
// by `lines`. Edits of one file never overlap.
function applyEdits(text, edits) {
  const lines = text === null ? [] : text.split('\n');
  const sorted = [...edits].sort((a, b) => a.at - b.at);
  const landed = [];
  let shift = 0;
  for (const e of sorted) {
    landed.push({ what: e.what, line: e.at + shift + 1 });
    shift += e.lines.length - e.remove;
  }
  for (const e of [...sorted].reverse()) lines.splice(e.at, e.remove, ...e.lines);
  return { text: text === null ? `${lines.join('\n')}\n` : lines.join('\n'), landed };
}

const lastNonBlank = (lines, from, to) => {
  for (let i = to - 1; i >= from; i--) if (lines[i].trim()) return i;
  return from;
};

// Where a new item goes in a part file's "What's missing": at the end of its group, a new group at the end of the
// section, or a whole new section at the end of the file. → one edit.
function placeInGroup(map, file, group, itemLines, lang) {
  const text = map.files[file];
  const lines = text.split('\n');
  const scan = map.scans[file] ?? scanPart(text);
  const L = LABELS[lang];
  if (!scan.section) {
    const at = lastNonBlank(lines, 0, lines.length) + 1;
    return { file, at, remove: 0, lines: ['', `## ${L.missing}`, '', `### ${group}`, '', ...itemLines] };
  }
  const region = scan.regions.find((r) => r.headIdx !== null && key(r.name) === key(group));
  if (!region) {
    const at = lastNonBlank(lines, scan.section.headIdx, scan.section.end) + 1;
    return { file, at, remove: 0, lines: ['', `${'#'.repeat(Math.min(scan.section.level + 1, 6))} ${group}`, '', ...itemLines] };
  }
  if (!region.items.length) return { file, at: region.headIdx + 1, remove: 0, lines: ['', ...itemLines] };
  const last = region.items[region.items.length - 1];
  const at = last.endIdx + 1;
  return { file, at, remove: 0, lines: [...(lines[last.endIdx].trim().startsWith('|') ? [''] : []), ...itemLines] };
}

// The registry's "Index" list: `- Group: id01, id02`. → an edit adding the code to its group's line (or a new line), or null.
function indexEdit(map, file, group, code) {
  const lines = map.files[file].split('\n');
  const heads = map.scans[file].heads;
  const head = heads.find((h) => /^(index|indice|índice)$/i.test(h.text.trim()));
  if (!head) return null;
  const next = heads.find((h) => h.idx > head.idx && h.level <= head.level);
  const end = next ? next.idx : lines.length;
  let lastBullet = -1;
  for (let i = head.idx + 1; i < end; i++) {
    const m = /^([-*+]\s+)(.+?):\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    lastBullet = i;
    if (key(m[2]) === key(group)) return { file, at: i, remove: 1, lines: [`${lines[i].replace(/[.\s]+$/, '')}, ${code}`], what: `index line of "${group}"` };
  }
  if (lastBullet < 0) return null;
  return { file, at: lastBullet + 1, remove: 0, lines: [`- ${group}: ${code}`], what: `index line of "${group}"` };
}

// ---- the planners ----

function titleFrom(words) {
  const first = words.split(/(?<=[.!?])\s/)[0].replace(/^["“]|["”]$/g, '').trim();
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 80)}...`;
}

export function planAddRequest(map, a, { now = Date.now } = {}) {
  const words = oneLine(a.words);
  const meaning = oneLine(a.meaning);
  const confirm = oneLine(a.confirm);
  if (!words) return refuse('give the words: the person\'s own words for the request, as they said them.');
  if (!meaning) return refuse('give the meaning: one or two plain sentences on what the person wants.');
  if (!confirm) return refuse('give how to confirm it is done: how the person sees it working.');
  const date = oneLine(a.date) || stampOf(now());
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(date)) return refuse(`the date must look like 2026-10-13 or 2026-10-13 10:30, not "${date}".`);
  const file = registryOf(map);
  if (!file) return refuse('this map has no requests file (ideas.md or pedidos.md) to write the request in.');
  const lang = langOf(map, file);
  const L = LABELS[lang];
  const group = oneLine(a.group).replace(/^#+\s*/, '') || L.newGroup;
  const prefix = partPrefix(map, file) ?? 'rq';
  const code = nextCode(map, prefix);
  if (map.byCode.has(code)) return refuse(`the code ${code} is already used.`);
  const title = oneLine(a.title) || titleFrom(words);
  const item = [
    `- [ ] ${title} \`${code}\``,
    `  - ${L.asked}: ${date} — "${words}"`,
    `  - ${L.means}: ${meaning}`,
    `  - ${L.confirm}: ${confirm}`,
    `  - ${L.went}: ${L.notYet}`,
    `  - ${L.status}: ${L.fresh}`,
  ];
  const edits = [{ ...placeInGroup(map, file, group, item, lang), what: `request ${code}` }];
  const idx = indexEdit(map, file, group, code);
  if (idx) edits.push(idx);
  return { ok: true, edits, code, expect: { code } };
}

export function planAddItem(map, a) {
  const part = findPart(map, oneLine(a.part));
  if (!part) return refuse(`there is no part called "${oneLine(a.part)}". Parts: ${map.arch.parts.filter((p) => p.role !== 'requests').map((p) => p.name).join(', ')}.`);
  if (part.role === 'requests') return refuse(`"${part.name}" holds the person's requests: write one with map_add_request, not an item.`);
  const from = oneLine(a.from).replace(/`/g, '');
  if (!from) return refuse('every item comes from a request: give from, the code of the request (write it first with map_add_request).');
  const request = (map.byCode.get(from.toLowerCase()) ?? []).find(isRequest);
  if (!request) return refuse(`there is no request ${from} in the map: write the request first (map_add_request), then its items.`);
  const title = oneLine(a.title);
  if (!title) return refuse('give the title of the item.');
  const group = oneLine(a.group).replace(/^#+\s*/, '');
  if (!group) return refuse('give the group of the part where the item goes (it is created when it does not exist).');
  const gone = missingFromFlow(map, part);
  if (gone) return refuse(gone);
  const file = fileOf(map, part);
  const owners = prefixOwners(map);
  let prefix = partPrefix(map, file);
  if (!prefix) {
    const given = oneLine(a.prefix).toLowerCase();
    if (!/^[a-z]{1,4}$/.test(given)) return refuse(`"${part.name}" has no codes yet: give prefix, 1 to 4 letters that no other part uses.`);
    if (owners.has(given) && owners.get(given) !== file) return refuse(`the prefix ${given} already belongs to ${owners.get(given)}: pick another.`);
    prefix = given;
  }
  const lang = langOf(map, file);
  const L = LABELS[lang];
  const code = nextCode(map, prefix);
  if (map.byCode.has(code)) return refuse(`the code ${code} is already used.`);
  const details = (Array.isArray(a.details) ? a.details : String(a.details ?? '').split('\n')).map((d) => oneLine(d).replace(/^[-*+]\s+/, '')).filter(Boolean);
  const itemLines = [`- [ ] ${title} \`${code}\``, `  - ${L.from(from)}`, ...details.map((d) => `  - ${d}`)];
  const edits = [{ ...placeInGroup(map, file, group, itemLines, lang), what: `item ${code}` }];

  // The request learns where it went.
  const reqLines = map.files[request.file].split('\n');
  const { startIdx, endIdx } = request.item;
  let wentAt = -1;
  let statusAt = -1;
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const bare = reqLines[i].replace(/^\s+/, '');
    if (WHERE_RE.test(bare)) wentAt = i;
    if (STATUS_RE.test(bare)) statusAt = i;
  }
  if (wentAt >= 0) {
    const m = WHERE_RE.exec(reqLines[wentAt].replace(/^\s+/, ''));
    const indent = reqLines[wentAt].match(/^\s*/)[0];
    const value = m[4].trim();
    const next = /`[^`]+`/.test(value) ? `${value.replace(/\.\s*$/, '')}, \`${code}\`${/\.\s*$/.test(value) ? '.' : ''}` : `\`${code}\`.`;
    edits.push({ file: request.file, at: wentAt, remove: 1, lines: [`${indent}${m[1]}${m[2]}${m[3]}${next}`], what: `"${m[2]}" line of ${from}` });
  } else {
    const indent = (reqLines[startIdx + 1] ?? '  - ').match(/^\s*/)[0] || '  ';
    const at = statusAt >= 0 ? statusAt : endIdx + 1;
    const reqLang = langOf(map, request.file);
    edits.push({ file: request.file, at, remove: 0, lines: [`${indent}- ${LABELS[reqLang].went}: \`${code}\`.`], what: `"${LABELS[reqLang].went}" line of ${from}` });
  }
  return { ok: true, edits, code, expect: { code } };
}

// One item by its code: refuses an unknown code and a code on two items.
function oneItem(map, codeIn) {
  const code = oneLine(codeIn).replace(/`/g, '');
  if (!code) return refuse('give the code of the item.');
  const list = map.byCode.get(code.toLowerCase()) ?? [];
  if (!list.length) return refuse(`there is no item with the code ${code} in the map.`);
  if (list.length > 1) return refuse(`the code ${code} is on more than one item (${list.map((e) => e.file).join(', ')}): the map has a duplicate code, so the clerk will not guess which one.`);
  return { ok: true, code, ...list[0] };
}

export function planStartItem(map, a) {
  const f = oneItem(map, a.code);
  if (!f.ok) return f;
  if (f.item.status === 'done') return refuse(`${f.code} is already ticked: nothing to start.`);
  if (f.item.status === 'doing') return { ok: true, edits: [], note: `${f.code} is already marked in progress.` };
  if (f.item.status === 'later') return refuse(`${f.code} is parked (later): take its "later" mark off first, then start it.`);
  const lines = map.files[f.file].split('\n');
  const line = lines[f.item.startIdx];
  if (!line.trimEnd().endsWith(`\`${f.item.code}\``)) return refuse(`${f.code} is a table row, not a checklist line; the mark cannot be written there by the clerk.`);
  const next = markedLine(line, progressWord(langOf(map, f.file)));
  if (next === null) return refuse(`the line of ${f.code} is not an open checklist line ("- [ ] ...").`);
  return { ok: true, edits: [{ file: f.file, at: f.item.startIdx, remove: 1, lines: [next], what: `in-progress mark of ${f.code}` }], code: f.code };
}

// The bold prefix without its status token ("**in progress · important:** x" -> "**important:** x"); nothing left, no prefix.
function withoutProgress(rest) {
  const lead = parseBold(rest);
  if (!lead || !lead.tokens.some((t) => t.kind === 'status')) return rest;
  const keep = lead.tokens.filter((t) => t.kind !== 'status').map((t) => t.raw);
  if (!keep.length) return lead.rest;
  const m = /^\*\*([^*]+?)(:?)\*\*(:?)/.exec(rest);
  return `**${keep.join(' · ')}${m[2]}**${m[3]} ${lead.rest}`;
}

export function planFinishItem(map, a, { now = Date.now } = {}) {
  const note = oneLine(a.note);
  if (!note) return refuse('give a note: what was built and where (it becomes the "Built on" line). An item is not ticked without it.');
  const f = oneItem(map, a.code);
  if (!f.ok) return f;
  if (f.item.status === 'done') return refuse(`${f.code} is already ticked.`);
  const lines = map.files[f.file].split('\n');
  const line = lines[f.item.startIdx];
  const m = OPEN_ITEM_RE.exec(line);
  if (!m || !line.trimEnd().endsWith(`\`${f.item.code}\``)) return refuse(`the line of ${f.code} is not an open checklist line ("- [ ] ..."); a table row is ticked by hand.`);
  const date = oneLine(a.date) || dayOf(now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return refuse(`the date must look like 2026-10-13, not "${date}".`);
  const label = LABELS[langOf(map, f.file)].built;
  return {
    ok: true,
    code: f.code,
    edits: [
      { file: f.file, at: f.item.startIdx, remove: 1, lines: [`${m[1]}[x] ${withoutProgress(m[2])}`], what: `tick of ${f.code}` },
      { file: f.file, at: f.item.endIdx + 1, remove: 0, lines: [`  - ${label} ${date}: ${note}`], what: `"${label}" line of ${f.code}` },
    ],
  };
}

// ---- the mermaid flow in the README ----

function mermaidSpan(lines) {
  const open = lines.findIndex((l) => /^[ \t]*```mermaid[ \t]*$/.test(l));
  if (open < 0) return null;
  const close = lines.findIndex((l, i) => i > open && /^[ \t]*```[ \t]*$/.test(l));
  return close < 0 ? null : { open, close };
}

// The subgraphs of the block with the line of their `end`.
function subgraphsIn(lines, span) {
  const out = [];
  const stack = [];
  for (let i = span.open + 1; i < span.close; i++) {
    const t = lines[i].trim();
    const sg = /^subgraph\s+([\w-]+)(?:\s*\[\s*"?([^\]"]+?)"?\s*\])?\s*$/.exec(t);
    if (sg) {
      const g = { id: sg[1], title: sg[2] ?? sg[1], start: i, end: -1, indent: lines[i].match(/^\s*/)[0] };
      out.push(g);
      stack.push(g);
    } else if (t === 'end') {
      const g = stack.pop();
      if (g) g.end = i;
    }
  }
  return out.filter((g) => g.end > g.start);
}

// A node id for a new part: the initials, or two letters, unique in the flow and never the word `end`.
function newNodeId(name, taken) {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : (words[0] ?? 'P').slice(0, 2);
  base = (base.toUpperCase().replace(/^\d+/, '') || 'P');
  let id = base;
  for (let n = 2; taken.has(id) || id.toLowerCase() === 'end'; n++) id = `${base}${n}`;
  return id;
}

const NAME_RE = /^[^[\]"`|{}()<>#\n]{1,60}$/;

export function planAddPart(map, a) {
  const name = oneLine(a.name);
  const about = oneLine(a.about);
  const layerName = oneLine(a.layer);
  const prefix = oneLine(a.prefix).toLowerCase();
  if (!name || !NAME_RE.test(name) || !/[a-z0-9]/i.test(name)) return refuse('the name of a part is plain words (no brackets, quotes, bars or backticks), up to 60 characters.');
  if (!about) return refuse('give about: what the part is, in a sentence or two.');
  if (!/^[a-z]{1,4}$/.test(prefix)) return refuse('give prefix: 1 to 4 letters for the codes of this part\'s items.');
  if (!layerName) return refuse('give the layer of the flow where the part is drawn.');
  const dup = map.arch.parts.find((p) => key(p.name) === key(name) || key(p.id) === key(name));
  if (dup) return refuse(`a part called "${dup.name}" already exists.`);
  const owners = prefixOwners(map);
  if (owners.has(prefix)) return refuse(`the prefix ${prefix} already belongs to ${owners.get(prefix)}: pick another.`);
  const fileName = `${slug(name)}.md`;
  if (fileName === '.md' || fileName.toLowerCase() === 'readme.md' || Object.keys(map.files).some((n) => n.toLowerCase() === fileName)) return refuse(`the file ${fileName} already exists.`);
  const readme = map.files['README.md'];
  if (readme === undefined) return refuse('the map has no README.md to hold the table and the flow.');
  const lines = readme.split('\n');
  const span = mermaidSpan(lines);
  const flow = flowOf(map);
  if (!span || !flow) return refuse('the README has no mermaid flow to draw the part in: a part is added to the flow in the same change.');

  // 1. the part's file
  const lang = map.arch.lang;
  const L = LABELS[lang];
  const content = [`# ${name}`, '', about, '', `## ${L.how}`, '', L.blank, '', `## ${L.where}`, '', L.blank, '', `## ${L.rules}`, '', L.blank, '', `## ${L.missing}`, '', `<!-- code prefix: ${prefix} -->`];
  const edits = [{ file: fileName, create: true, at: 0, remove: 0, lines: content, what: `part file ${fileName}` }];

  // 2. the row of the README's table of parts
  let tableEnd = -1;
  let columns = 2;
  // A table shown inside a code fence is an example, not the table of parts.
  let fence = false;
  const fenced = lines.map((l) => { if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return true; } return fence; });
  for (let i = 0; i + 1 < lines.length; i++) {
    if (fenced[i] || fenced[i + 1] || !/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) continue;
    let last = i + 1;
    let linked = false;
    for (let j = i + 2; j < lines.length && !fenced[j] && /^\s*\|/.test(lines[j]); j++) { last = j; linked ||= /\]\([^)]*\.md[^)]*\)/.test(lines[j]); }
    if (linked) { tableEnd = last; columns = lines[i].trim().replace(/^\||\|$/g, '').split('|').length; break; }
    i = last;
  }
  if (tableEnd >= 0) {
    const one = (about.split(/(?<=[.!?])\s/)[0]).replace(/\|/g, '\\|');
    const cells = [`[${name}](${fileName})`, one, ...Array(Math.max(0, columns - 2)).fill('')].slice(0, columns);
    edits.push({ file: 'README.md', at: tableEnd + 1, remove: 0, lines: [`| ${cells.join(' | ')} |`], what: `table row of ${name}` });
  }

  // 3. the node in the mermaid flow, inside its layer
  const taken = new Set([...flow.model.nodes.map((n) => n.id), ...flow.model.layers.map((l) => l.id)]);
  const nodeId = newNodeId(name, taken);
  const groups = subgraphsIn(lines, span);
  const layer = groups.find((g) => key(g.id) === key(layerName) || key(g.title) === key(layerName));
  if (layer) {
    let prev = layer.end - 1;
    while (prev > layer.start && !lines[prev].trim()) prev--;
    const indent = prev > layer.start ? lines[prev].match(/^\s*/)[0] : `${layer.indent}    `;
    edits.push({ file: 'README.md', at: layer.end, remove: 0, lines: [`${indent}${nodeId}[${name}]`], what: `flow node ${nodeId} of ${name}` });
  } else if (a.newLayer === true) {
    let id = key(layerName) || 'layer';
    for (let n = 2; taken.has(id); n++) id = `${key(layerName) || 'layer'}${n}`;
    const top = groups.filter((g) => !groups.some((o) => o !== g && o.start < g.start && o.end > g.end));
    const at = top.length ? Math.max(...top.map((g) => g.end)) + 1 : span.open + 2;
    const indent = top.length ? top[0].indent : '    ';
    edits.push({ file: 'README.md', at, remove: 0, lines: [`${indent}subgraph ${id}["${layerName.replace(/"/g, "'")}"]`, `${indent}    ${nodeId}[${name}]`, `${indent}end`], what: `flow node ${nodeId} of ${name}, in the new layer ${layerName}` });
  } else {
    return refuse(`there is no layer "${layerName}" in the flow. Layers: ${groups.map((g) => g.title).join(', ') || 'none'}. (newLayer: true makes a new one.)`);
  }
  return { ok: true, edits, expect: { part: name, prefix } };
}

const ARROW_RE = /(-->|==>|-\.->|---)/;

export function planAddLink(map, a) {
  const from = findPart(map, oneLine(a.from));
  const to = findPart(map, oneLine(a.to));
  if (!from) return refuse(`there is no part called "${oneLine(a.from)}".`);
  if (!to) return refuse(`there is no part called "${oneLine(a.to)}".`);
  if (from.id === to.id) return refuse('a part cannot be linked to itself.');
  const readme = map.files['README.md'];
  const flow = flowOf(map);
  const lines = (readme ?? '').split('\n');
  const span = mermaidSpan(lines);
  if (!flow || !span) return refuse('the README has no mermaid flow to draw the arrow in.');
  for (const p of [from, to]) if (!flow.nodeOfPart.has(p.id)) return refuse(`the part "${p.name}" is not in the flow of README.md: draw it first (map_add_part).`);
  const a1 = flow.nodeOfPart.get(from.id);
  const b1 = flow.nodeOfPart.get(to.id);
  if (flow.model.edges.some((e) => e.from === a1 && e.to === b1)) return refuse(`the flow already has an arrow from "${from.name}" to "${to.name}".`);
  const label = oneLine(a.label).replace(/[|"`]/g, '').trim();
  let last = -1;
  for (let i = span.open + 1; i < span.close; i++) if (ARROW_RE.test(lines[i]) && !/^\s*(subgraph|%%)/.test(lines[i])) last = i;
  const indent = last >= 0 ? lines[last].match(/^\s*/)[0] : '    ';
  const at = last >= 0 ? last + 1 : span.close;
  const text = label ? `${indent}${a1} -->|${label}| ${b1}` : `${indent}${a1} --> ${b1}`;
  return { ok: true, edits: [{ file: 'README.md', at, remove: 0, lines: [text], what: `flow arrow ${a1} to ${b1}` }], expect: { edge: [a1, b1] } };
}

// ---- checking the result, then writing ----

// The folder as it would be after the edits must hold what the call promised; otherwise nothing is written.
function postCheck(map, texts, expect) {
  if (!expect) return null;
  const files = { ...map.files, ...texts };
  if (expect.code) {
    const n = Object.entries(files).filter(([name]) => !/^readme\.md$/i.test(name)).reduce((sum, [, t]) => sum + scanPart(t).regions.flatMap((r) => r.items).filter((i) => i.code?.toLowerCase() === expect.code.toLowerCase()).length, 0);
    if (n !== 1) return `the code ${expect.code} would be on ${n} items`;
  }
  if (expect.part || expect.edge) {
    const arch = parseArch(map.dir, files, 'worktree');
    const flowMap = { files, arch };
    const flow = flowOf(flowMap);
    if (!flow) return 'the flow of the README would not read back';
    if (expect.part) {
      const p = arch.parts.find((x) => key(x.name) === key(expect.part));
      if (!p || !flow.nodeOfPart.has(p.id)) return `the part ${expect.part} would be missing from the flow`;
    }
    if (expect.edge && !flow.model.edges.some((e) => e.from === expect.edge[0] && e.to === expect.edge[1])) return 'the arrow would not read back from the flow';
  }
  return null;
}

const stamps = new Map(); // path -> the mtime the clerk left, so its own quick second write is not taken for somebody else's

async function commit(map, plan, { now = Date.now, rename, retryMs = 50 } = {}) {
  const byFile = new Map();
  for (const e of plan.edits) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  // Two edits on the same place of a file would land in an order nobody chose: refuse instead of guessing.
  for (const list of byFile.values()) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    if (sorted.some((e, i) => i > 0 && e.at < sorted[i - 1].at + Math.max(1, sorted[i - 1].remove))) return refuse('two edits of one call touch the same place of a file, so the order of the lines would be a guess; nothing was written.');
  }
  const out = [];
  const wrote = [];
  const texts = {};
  for (const [name, list] of byFile) {
    const created = list.some((e) => e.create);
    const { text, landed } = applyEdits(created ? null : map.files[name], list);
    texts[name] = text;
    out.push({ name, created, text: map.crlf[name] ? text.replace(/\n/g, '\r\n') : text });
    for (const l of landed) wrote.push({ file: `${map.dir}/${name}`, line: l.line, what: l.what });
  }
  const broken = postCheck(map, texts, plan.expect);
  if (broken) return refuse(`this would break the map's order (${broken}); nothing was written.`);
  // Everything is checked before the first write: a file that is busy or changed stops the whole call.
  for (const o of out) {
    const path = join(map.root, map.dir, o.name);
    if (o.created) {
      if (existsSync(path)) return refuse(`the file ${o.name} appeared meanwhile; nothing was written.`);
      continue;
    }
    let st;
    try { st = statSync(path); } catch { return refuse(`${o.name} could not be read; nothing was written.`); }
    if (now() - st.mtimeMs < RECENT_MS && stamps.get(path) !== st.mtimeMs) return refuse(`${o.name} was changed a moment ago by someone else (less than 5 seconds): try again in a few seconds. Nothing was written.`);
    if (readFileSync(path, 'utf8') !== map.raw[o.name]) return refuse(`${o.name} changed while the clerk prepared the edit; try again. Nothing was written.`);
  }
  const done = [];
  try {
    for (const o of out) {
      const path = join(map.root, map.dir, o.name);
      await replaceFile(path, o.text, { rename: rename ?? renameSync, retryMs });
      done.push(o);
      stamps.set(path, statSync(path).mtimeMs);
    }
  } catch (err) {
    // Put back what was already swapped in, so a half-written change does not stay.
    for (const o of done) {
      const path = join(map.root, map.dir, o.name);
      try {
        if (o.created) unlinkSync(path);
        else await replaceFile(path, map.raw[o.name], { rename: rename ?? renameSync, retryMs });
      } catch { /* the original stays on disk next to the failure */ }
    }
    return refuse(`could not write the map (${err?.code ?? 'error'}); what was written was put back.`);
  }
  return { ok: true, wrote };
}

async function run(planner, args, opts = {}) {
  const a = args ?? {};
  const map = await loadMap(a.root, opts);
  if (!map.ok) return map;
  const plan = planner(map, a, opts);
  if (!plan.ok) return plan;
  const { edits, note, code, expect } = plan;
  if (!edits.length) return { ok: true, edits: [], wrote: [], note, ...(code ? { code } : {}) };
  const done = await commit(map, plan, opts);
  if (!done.ok) return done;
  return { ok: true, edits: edits.map(({ file, at, remove, lines, what }) => ({ file, at, remove, lines, what })), wrote: done.wrote, ...(code ? { code } : {}), ...(expect?.part ? { part: expect.part } : {}) };
}

export const addRequest = (args, opts) => run(planAddRequest, args, opts);
export const addItem = (args, opts) => run(planAddItem, args, opts);
export const startItem = (args, opts) => run(planStartItem, args, opts);
export const finishItem = (args, opts) => run(planFinishItem, args, opts);
export const addPart = (args, opts) => run(planAddPart, args, opts);
export const addLink = (args, opts) => run(planAddLink, args, opts);
