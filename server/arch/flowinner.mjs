// Level 2 of the Flow, inside a part (flow.md fl09): the part's pieces, taken from the paths its "Where in the code"
// (and "How it works") names and from the code itself, the imports between them, and who it talks to outside the
// part, drawn at the edges with the same words as on the general view, each arrow tied to the piece whose file shows
// it. Deterministic, with no AI. Built on request from what the model build already read (the scans, kept in memory);
// nothing is written anywhere and nothing read is executed. The pure functions come first; the I/O at the bottom only
// reads the part file and the first lines of the part's files.
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { posix } from 'node:path';
import { isSecretsFile, safeResolve } from '../files.mjs';
import { maskSecrets } from '../sources/claude-conversation.mjs';
import { kindOfFile } from '../sources/count.mjs';
import { ownersAllOf } from './attach.mjs';
import { programOnly } from './flow.mjs';
import { partSections } from './parse.mjs';

export const INNER_VERSION = 2;
// boxes: pieces drawn before the rest of a folder is grouped; neighbours: boxes outside the part on each side;
// perNeighbour: arrows one outside box sends to (or takes from) the pieces; innerEdges: arrows between pieces.
export const INNER_LIMITS = { boxes: 14, neighbours: 8, perNeighbour: 2, innerEdges: 40, evidence: 5, how: 600, files: 60, head: 160 };
const FRESH_MS = 10 * 60_000;

const normPath = (p) => String(p ?? '').trim().replaceAll('\\', '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (p) => (posix.dirname(p) === '.' ? '' : posix.dirname(p));
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const SKIP_KINDS = new Set(['test', 'dep', 'generated', 'binary', 'doc']);
const keepOther = (p) => !isSecretsFile(p) && !SKIP_KINDS.has(kindOfFile(p));

// The files of a part: the code the Flow read that the part owns, and the other files (styles, screens, settings)
// under its folders or named by it that no deeper part holds. ownersOf(paths) → [[partId]] in the same order.
export function partFilesOf({ part, owners, scanned, paths, ownersOf }) {
  const code = scanned.filter((p) => (owners.get(p) ?? []).includes(part.id)).sort(byPath);
  const read = new Set(scanned);
  const seeds = (part.codePaths ?? []).map(normPath).filter(Boolean);
  const folders = seeds.filter((s) => s.endsWith('/') || paths.some((p) => p.startsWith(`${s}/`))).map((s) => (s.endsWith('/') ? s : `${s}/`));
  const named = new Set(seeds.filter((s) => !s.endsWith('/')));
  const candidates = paths.filter((p) => !read.has(p) && (named.has(p) || folders.some((f) => p.startsWith(f))) && keepOther(p)).sort(byPath);
  const own = candidates.length ? ownersOf(candidates) : [];
  const other = candidates.filter((p, i) => (own[i] ?? []).includes(part.id));
  return [...code.map((path) => ({ path, code: true })), ...other.map((path) => ({ path, code: false }))];
}

// Where the part starts: the paths it names that hold files. A path that holds none of the files the Flow read (a
// document, a test folder, a library) is a note. sections: partSections(text), or null (then the part's codePaths).
export function seedsOf(part, sections, files) {
  const where = sections?.where?.length ? sections.where : (part.codePaths ?? []).map((path) => ({ path, line: null }));
  const paths = files.map((f) => f.path);
  const seeds = [];
  const notCode = [];
  const kindOf = (clean) => {
    const base = clean.replace(/\/+$/, '');
    if (!base) return null;
    if (!clean.endsWith('/') && paths.includes(base)) return { path: base, folder: false };
    if (paths.some((p) => p.startsWith(`${base}/`))) return { path: `${base}/`, folder: true };
    return null;
  };
  const add = (raw, line, quiet = false) => {
    const clean = normPath(raw);
    if (!clean || clean.split('/').includes('..')) return;
    const hit = kindOf(clean);
    if (!hit) {
      if (!quiet && !notCode.includes(clean)) notCode.push(clean);
      return;
    }
    if (!seeds.some((s) => s.path === hit.path)) seeds.push({ ...hit, line });
  };
  for (const w of where) add(w.path, w.line);
  for (const m of String(sections?.how?.text ?? '').matchAll(/`([^`\s]+)`/g)) add(m[1], sections.how.line, true);
  return { seeds, notes: notCode.length ? [{ key: 'notCode', paths: notCode }] : [] };
}

// The pieces drawn: one box per seed; while there is room, the biggest folder opens into its files and its
// first-level folders (a folder of one file is that file). A folder too big to open whole keeps its folders, the file
// the part starts from and the files with the most links inside the part; the rest is one box that says how many.
// → { boxes: [{ id, kind: 'component' | 'group', path, dir, folder, name, files, fileCount, other, seedLine }],
// grouped, loose (files that are not code, straight in an opened folder: counted, not drawn) }.
export function componentsOf({ seeds, files, links = new Map(), entries = [], max = INNER_LIMITS.boxes }) {
  const sorted = [...files].sort((a, b) => byPath(a.path, b.path));
  const isCode = new Map(sorted.map((f) => [f.path, f.code]));
  const entrySet = new Set(entries);
  const weight = new Map();
  for (const [from, list] of links) {
    if (!isCode.get(from)) continue;
    for (const l of list) {
      if (!isCode.get(l.target) || l.target === from) continue;
      weight.set(from, (weight.get(from) ?? 0) + 1);
      weight.set(l.target, (weight.get(l.target) ?? 0) + 1);
    }
  }
  // Each file to the deepest seed holding it; a file no seed names goes to its own folder.
  const seedOf = (p) => {
    let best = null;
    for (const s of seeds) {
      const hit = s.folder ? p.startsWith(s.path) : p === s.path;
      if (hit && (!best || s.path.length > best.path.length)) best = s;
    }
    return best;
  };
  const groups = new Map();
  for (const f of sorted) {
    const s = seedOf(f.path) ?? { path: `${dirOf(f.path)}/`, folder: true, line: null, pseudo: true };
    if (!groups.has(s.path)) groups.set(s.path, { seed: s, files: [] });
    groups.get(s.path).files.push(f.path);
  }
  const makeBox = (path, folder, list, seedLine, seeded) => ({ path, folder, files: list, seedLine, seeded });
  let boxes = [...groups.values()].sort((a, b) => byPath(a.seed.path, b.seed.path)).map((g) => makeBox(g.seed.path, g.seed.folder, g.files, g.seed.line ?? null, !g.seed.pseudo));
  const codeCount = (b) => b.files.filter((p) => isCode.get(p)).length;
  const loose = [];
  // What a folder box opens into: its direct code files, and a box per first-level folder (one file: that file).
  const childrenOf = (box) => {
    const out = [];
    const sub = new Map();
    const looseHere = [];
    for (const p of box.files) {
      const rest = p.slice(box.path.length);
      const slash = rest.indexOf('/');
      if (slash < 0) {
        if (isCode.get(p)) out.push(makeBox(p, false, [p], box.seedLine, box.seeded));
        else looseHere.push(p);
      } else {
        const dir = `${box.path}${rest.slice(0, slash + 1)}`;
        if (!sub.has(dir)) sub.set(dir, []);
        sub.get(dir).push(p);
      }
    }
    for (const [dir, list] of sub) {
      if (list.length === 1 && isCode.get(list[0])) out.push(makeBox(list[0], false, list, box.seedLine, box.seeded));
      else if (list.length === 1) looseHere.push(list[0]);
      else out.push(makeBox(dir, true, list, box.seedLine, box.seeded));
    }
    // A folder that only holds one folder opens straight into it.
    if (out.length === 1 && out[0].folder && !looseHere.length) return childrenOf(out[0]);
    return { kids: out.sort((a, b) => byPath(a.path, b.path)), loose: looseHere };
  };
  const rankOf = (b) => [b.files.some((p) => entrySet.has(p)) ? 0 : 1, b.folder ? 0 : 1, -b.files.reduce((n, p) => n + (weight.get(p) ?? 0), 0)];
  const byRank = (a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return byPath(a.path, b.path);
  };
  let grouped = 0;
  const done = new Set();
  for (let guard = 0; guard < 200; guard++) {
    const open = boxes.filter((b) => b.folder && !b.group && !done.has(b.path) && codeCount(b) > 0)
      .sort((a, b) => codeCount(b) - codeCount(a) || byPath(a.path, b.path));
    let changed = false;
    for (const c of open) {
      const { kids, loose: l } = childrenOf(c);
      if (kids.length <= 1) { done.add(c.path); continue; }
      const room = max - (boxes.length - 1);
      const at = boxes.indexOf(c);
      if (kids.length <= room) {
        boxes.splice(at, 1, ...kids);
        loose.push(...l);
      } else if (room >= 3) {
        const ranked = [...kids].sort(byRank);
        const keep = ranked.slice(0, room - 1);
        const rest = ranked.slice(room - 1);
        const restFiles = rest.flatMap((k) => k.files).sort(byPath);
        const dir = c.path.replace(/\/$/, '');
        const group = { ...makeBox(`${c.path}*`, false, [...restFiles, ...l].sort(byPath), c.seedLine, c.seeded), group: true, dir };
        grouped += restFiles.filter((p) => isCode.get(p)).length;
        boxes.splice(at, 1, ...keep, group);
      } else {
        done.add(c.path);
        continue;
      }
      changed = true;
      break;
    }
    if (!changed) break;
  }
  // Names: the shortest end of the path that tells the boxes apart.
  const plainPath = (b) => b.path.replace(/\/\*$/, '').replace(/\/$/, '');
  const named = boxes.filter((b) => !b.group);
  const nameOf = (b, depth) => {
    const segs = plainPath(b).split('/');
    return segs.slice(-depth).join('/') + (b.folder ? '/' : '');
  };
  const depthOf = new Map(named.map((b) => [b.path, 1]));
  for (let round = 0; round < 8; round++) {
    const seen = new Map();
    for (const b of named) {
      const n = nameOf(b, depthOf.get(b.path));
      seen.set(n, [...(seen.get(n) ?? []), b]);
    }
    let clash = false;
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      clash = true;
      for (const b of list) depthOf.set(b.path, depthOf.get(b.path) + 1);
    }
    if (!clash) break;
  }
  const out = boxes.map((b) => ({
    id: `c:${b.path}`, kind: b.group ? 'group' : 'component', path: b.path, dir: b.group ? b.dir : b.folder ? plainPath(b) : dirOf(b.path), folder: Boolean(b.folder),
    name: b.group ? null : nameOf(b, depthOf.get(b.path)), files: b.files, fileCount: codeCount(b), other: b.files.length - codeCount(b), seedLine: b.seedLine ?? null, seeded: b.seeded !== false,
  })).sort((a, b) => byPath(a.id, b.id));
  return { boxes: out, grouped, loose: loose.sort(byPath) };
}

const newFact = (extra) => ({ declared: [], detected: [], ai: null, ownerConfirmed: null, ...extra });
const badgesOf = (f) => [f.declared.length ? 'declared' : null, f.detected.length ? 'detected' : null].filter(Boolean);
const originOf = (f) => (f.declared.length ? 'declared' : f.detected.length ? 'detected' : 'declared');
const SIDE_ORDER = { actor: 0, part: 1, free: 2, service: 3 };

// The view inside one part. part: the arch part; sections: partSections of its file, or null; files: partFilesOf;
// links: Map(path → [{ target, line, names }]) for every file the Flow read; owners: Map(path → [partId]); trace: the
// level-1 model's side table (edgeId → [{ file, other, line, via }]); model: the level-1 model; entries: the files the
// program itself starts from; heads: { path: first sentence of its opening comment }. declaredOnly: no code was read
// (the demo, a build that failed): one box per path the part file names.
export function innerModel({
  part, sections = null, files = [], links = new Map(), owners = new Map(), trace = new Map(), model, entries = [], heads = {}, fileOwner = new Map(), limits: limitsIn = {}, declaredOnly = false,
}) {
  const L = { ...INNER_LIMITS, ...limitsIn };
  const partNode = `part:${part.id}`;
  const fileList = [...files].sort((a, b) => byPath(a.path, b.path));
  const notes = [];
  let comp;
  if (declaredOnly) {
    const where = sections?.where?.length ? sections.where : (part.codePaths ?? []).map((path) => ({ path, line: null }));
    const seen = new Set();
    const boxes = [];
    for (const w of where) {
      const path = normPath(w.path);
      if (!path || seen.has(path) || path.split('/').includes('..')) continue;
      seen.add(path);
      const folder = path.endsWith('/');
      const segs = path.replace(/\/$/, '').split('/');
      boxes.push({ id: `c:${path}`, kind: 'component', path, dir: folder ? path.replace(/\/$/, '') : dirOf(path), folder, name: segs.at(-1) + (folder ? '/' : ''), files: [], fileCount: 0, other: 0, seedLine: w.line ?? null, seeded: true });
    }
    comp = { boxes: boxes.sort((a, b) => byPath(a.id, b.id)), grouped: 0, loose: [] };
    notes.push({ key: 'declaredOnly' });
  } else {
    const seeds = seedsOf(part, sections, fileList);
    notes.push(...seeds.notes);
    comp = componentsOf({ seeds: seeds.seeds, files: fileList, links, entries, max: L.boxes });
    if (comp.loose.length) notes.push({ key: 'otherFiles', n: comp.loose.length, paths: comp.loose.slice(0, 5) });
  }
  const boxOf = new Map();
  for (const b of comp.boxes) for (const p of b.files) boxOf.set(p, b.id);
  const codeIn = new Set(fileList.filter((f) => f.code).map((f) => f.path));
  const sentences = String(sections?.how?.text ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
  const aboutOf = (b) => {
    if (b.kind === 'group') return null;
    const plain = b.path.replace(/\/$/, '');
    const base = plain.split('/').at(-1);
    return sentences.find((s) => s.includes(plain) || new RegExp(`(^|[\\s\`/(])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s\`),.:;])`).test(s)) ?? null;
  };

  // Arrows between the pieces: an import from one piece's file into another's, from the piece that lends to the one
  // that uses it, as on the general view.
  const innerEdges = new Map();
  const importedInside = new Set();
  const importsInside = new Set();
  const importedOutside = new Set();
  const groupIds = new Set(comp.boxes.filter((b) => b.kind === 'group').map((b) => b.id));
  let groupLinks = 0;
  for (const path of [...links.keys()].sort(byPath)) {
    const mine = codeIn.has(path);
    for (const l of links.get(path)) {
      if (!codeIn.has(l.target)) continue;
      const a = boxOf.get(l.target);
      if (!mine) {
        if (a && !(owners.get(path) ?? []).includes(part.id)) importedOutside.add(a);
        continue;
      }
      const b = boxOf.get(path);
      if (!a || !b || a === b) continue;
      importedInside.add(a);
      importsInside.add(b);
      // The leftover files of a folder are a bag, not a piece: links with them would only tangle the drawing.
      if (groupIds.has(a) || groupIds.has(b)) { groupLinks++; continue; }
      const id = `${b}>${a}#import`;
      if (!innerEdges.has(id)) innerEdges.set(id, newFact({ id, from: b, to: a, kind: 'import', label: { from: 'code', text: null, key: 'flow.l2.lbl.uses', missing: false }, names: new Set(), hidden: false, weight: 0 }));
      const e = innerEdges.get(id);
      for (const n of l.names ?? []) e.names.add(n);
      e.detected.push({ file: path, line: l.line ?? null, via: 'import' });
      e.weight++;
    }
  }
  let innerList = [...innerEdges.values()].map((e) => ({ ...e, names: [...e.names].sort(byPath) }));
  let innerCut = 0;
  if (innerList.length > L.innerEdges) {
    const keep = new Set([...innerList].sort((a, b) => b.weight - a.weight || byPath(a.id, b.id)).slice(0, L.innerEdges).map((e) => e.id));
    innerCut = innerList.length - keep.size;
    innerList = innerList.filter((e) => keep.has(e.id));
  }

  // Who it talks to outside: the boxes of the general view joined to this part by an arrow (the chats' and branches'
  // "related" lines are not code and stay on the general view), on the side the arrow comes in or goes out.
  const l1Nodes = new Map((model?.nodes ?? []).map((n) => [n.id, n]));
  const l1Edges = (model?.edges ?? []).filter((e) => (e.from === partNode || e.to === partNode) && e.from !== e.to && e.kind !== 'related' && l1Nodes.has(e.from) && l1Nodes.has(e.to));
  const edgeRank = (e) => (e.hidden ? 1e6 : 0) - (e.weight ?? 1);
  const near = new Map();
  for (const e of [...l1Edges].sort((a, b) => edgeRank(a) - edgeRank(b) || byPath(a.id, b.id))) {
    const other = e.from === partNode ? e.to : e.from;
    if (!near.has(other)) near.set(other, { id: other, side: e.to === partNode ? 'in' : 'out', visible: false, weight: 0, edges: [] });
    const n = near.get(other);
    n.edges.push(e);
    n.visible ||= !e.hidden;
    n.weight += e.weight ?? 1;
  }
  const nearRank = (n) => [n.visible ? 0 : 1, SIDE_ORDER[l1Nodes.get(n.id).kind] ?? 9, -n.weight];
  const nearSort = (a, b) => {
    const ra = nearRank(a);
    const rb = nearRank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return byPath(a.id, b.id);
  };
  const keptNear = [];
  const cutNear = [];
  // Each side keeps its busiest boxes; those joined only by arrows seen in the code (shown on request) count apart.
  for (const side of ['in', 'out']) {
    for (const visible of [true, false]) {
      const list = [...near.values()].filter((n) => n.side === side && n.visible === visible).sort(nearSort);
      keptNear.push(...list.slice(0, L.neighbours));
      cutNear.push(...list.slice(L.neighbours));
    }
  }
  if (cutNear.length) notes.push({ key: 'moreNeighbours', items: cutNear.map((n) => ({ id: n.id, name: l1Nodes.get(n.id).name ?? null, nameKey: l1Nodes.get(n.id).nameKey ?? null, hidden: !n.visible })).sort((a, b) => byPath(a.id, b.id)) });

  // Each outside arrow goes to the pieces whose files show it (the most evidence first); an arrow only the README draws,
  // or only a dependency in a manifest, goes to the piece the part starts from. An import counts only in the arrow's own
  // direction: an arrow into this part is shown by a file here that uses the other part, an arrow out of it by a file
  // here the other part uses (the README's words say what flows that way, not the other).
  const routed = [];
  const hitsOf = new Map();
  for (const n of keptNear) {
    for (const e of n.edges) {
      const hits = new Map();
      const incoming = e.to === partNode;
      for (const it of trace.get(e.id) ?? []) {
        const ours = !it.other ? it.file : incoming ? it.file : it.other;
        const box = boxOf.get(ours);
        if (!box || (it.other && !codeIn.has(ours))) continue;
        if (!hits.has(box)) hits.set(box, []);
        hits.get(box).push({ file: ours, line: ours === it.file ? it.line : null, via: it.via });
      }
      hitsOf.set(e.id, hits);
      routed.push({ n, e, hits });
    }
  }
  const callers = new Set();
  for (const { n, e, hits } of routed) {
    if (e.to !== partNode) continue;
    const kind = l1Nodes.get(n.id).kind;
    if (kind === 'actor' || kind === 'service') for (const box of hits.keys()) callers.add(box);
  }

  // The bands, top to bottom: where it starts (nobody imports it and it leads somewhere, or the program starts it),
  // what does the work, the pieces only other parts use, and the pieces it leans on.
  const entrySet = new Set(entries);
  const bandOf = (b) => {
    if (b.kind === 'group') return 'base';
    const declaredEntry = b.files.some((p) => entrySet.has(p));
    const free = !importedInside.has(b.id) && !importedOutside.has(b.id);
    if (declaredEntry || (free && (importsInside.has(b.id) || callers.has(b.id)))) return 'entry';
    if (importedInside.has(b.id)) return importsInside.has(b.id) ? 'work' : 'base';
    if (importedOutside.has(b.id)) return 'shared';
    return b.fileCount === 0 && b.files.length ? 'base' : 'work';
  };
  const boxNodes = comp.boxes.map((b) => {
    const declared = b.seeded ? [{ file: part.file, line: b.seedLine ?? null, via: 'part-doc' }] : [];
    const detected = b.files.slice(0, L.evidence).map((file) => ({ file, line: 1, via: codeIn.has(file) ? 'code' : 'file' }));
    const head = !b.folder && b.kind === 'component' && b.fileCount === 1 ? heads[b.files[0]] ?? null : null;
    // The owner of the piece (fl16/fl17): the majority among its files' owners, with the counts for the hover.
    const ownersTally = { ai: 0, bot: 0, script: 0 };
    const ownerReasons = [];
    for (const file of b.files) {
      const o = fileOwner.get(file);
      if (!o) continue;
      ownersTally[o.owner] += 1;
      if (ownerReasons.length < 3) for (const r of o.reasons ?? []) ownerReasons.push(r);
    }
    const [owner, ownerCount] = Object.entries(ownersTally).sort((a, b) => b[1] - a[1])[0];
    const n = newFact({
      id: b.id, kind: b.kind, name: b.name, nameKey: null, path: b.path, dir: b.dir, folder: b.folder, partId: null, level: 2, parent: partNode,
      files: b.files, fileCount: b.fileCount, other: b.other, band: bandOf(b), about: aboutOf(b), head, declared, detected,
      owner: ownerCount > 0 ? owner : null, ownerCounts: ownersTally, ownerReasons: [...new Set(ownerReasons)].slice(0, 3),
    });
    return { ...n, origin: originOf(n), badges: badgesOf(n), declaredCount: declared.length, detectedCount: b.files.length };
  });
  const firstIn = (band) => boxNodes.find((b) => b.band === band)?.id;
  const entryBox = firstIn('entry') ?? firstIn('work') ?? boxNodes[0]?.id ?? null;

  const outEdges = [];
  let arrowsCut = 0;
  for (const { e, hits } of routed) {
    const out = e.from === partNode;
    let targets = [...hits].sort((a, b) => b[1].length - a[1].length || byPath(a[0], b[0]));
    arrowsCut += Math.max(0, targets.length - L.perNeighbour);
    targets = targets.slice(0, L.perNeighbour);
    const viaManifest = !targets.length && (trace.get(e.id) ?? []).some((x) => x.via === 'dependency');
    const readme = !targets.length && !viaManifest;
    if (!targets.length) {
      if (!entryBox) continue;
      targets = [[entryBox, []]];
    }
    for (const [box, ev] of targets) {
      const f = newFact({
        id: `${e.id}@${box}`, from: out ? box : e.from, to: out ? e.to : box, kind: e.kind, label: e.label, names: [...(e.names ?? [])],
        hidden: Boolean(e.hidden), l1: e.id, readme, manifest: viaManifest, weight: Math.max(1, ev.length),
        declared: [...(e.declared ?? [])], detected: ev.slice(0, L.evidence),
      });
      outEdges.push({ ...f, origin: originOf(f), badges: badgesOf(f), declaredCount: f.declared.length, detectedCount: ev.length });
    }
  }
  const nearNodes = keptNear.map((n) => {
    const x = l1Nodes.get(n.id);
    return {
      id: x.id, kind: x.kind, where: x.where ?? null, name: x.name ?? null, nameKey: x.nameKey ?? null, partId: x.partId ?? null, level: 1, parent: null,
      side: n.side, band: n.side, hidden: !n.visible, origin: x.origin, badges: x.badges ?? [], declared: x.declared ?? [], detected: x.detected ?? [],
      declaredCount: x.declaredCount ?? (x.declared ?? []).length, detectedCount: x.detectedCount ?? (x.detected ?? []).length,
    };
  }).sort((a, b) => byPath(a.id, b.id));
  const innerOut = innerList.map((e) => ({ ...e, l1: null, readme: false, manifest: false, origin: originOf(e), badges: badgesOf(e), declaredCount: 0, detectedCount: e.detected.length, detected: e.detected.slice(0, L.evidence) }));
  const how = sections?.how ? { text: clip(sections.how.text, L.how), file: part.file, line: sections.how.line } : null;
  return {
    version: INNER_VERSION, partId: part.id, name: part.name, file: part.file ?? null, how,
    nodes: [...boxNodes, ...nearNodes],
    edges: [...innerOut, ...outEdges.sort((a, b) => byPath(a.id, b.id))],
    notes,
    counts: {
      boxes: boxNodes.length, files: codeIn.size, other: fileList.length - codeIn.size, grouped: comp.grouped, cut: innerCut, arrowsCut, groupLinks,
      neighbours: nearNodes.length, neighboursCut: cutNear.length,
    },
  };
}

// What a page needs of a view: every piece keeps at most `max` of its file names (the count stays).
export const publicView = (view, max = INNER_LIMITS.files) => ({ ...view, nodes: view.nodes.map((n) => (n.files ? { ...n, files: n.files.slice(0, max) } : n)) });

// The colour of each piece now. rows: the Changes rows of the project ({ path, ts, sessionId, state }); chats: the
// project's chats ({ sessionId, status }). live: a conversation working now changed one of its files in the last minutes;
// changed: one of its files changed in the last minutes; quiet: nothing recent, but files not saved yet (a small mark,
// not a colour: in a folder where many conversations work, old unsaved files would colour every piece). Pieces with
// nothing are left out. → { [boxId]: { tone, files, unsaved } }.
export function liveOf(view, rows, chats, nowMs, windowMs = FRESH_MS) {
  const busy = new Set((chats ?? []).filter((c) => c.status === 'busy' && c.sessionId).map((c) => c.sessionId));
  const boxOf = new Map();
  for (const n of view?.nodes ?? []) if (n.kind === 'component' || n.kind === 'group') for (const p of n.files ?? []) boxOf.set(p, n.id);
  const acc = new Map();
  for (const r of rows ?? []) {
    const box = boxOf.get(r.path);
    if (!box) continue;
    const at = Date.parse(r.ts);
    const recent = Number.isFinite(at) && at >= nowMs - windowMs && at <= nowMs + windowMs;
    if (!acc.has(box)) acc.set(box, { live: false, files: new Set(), unsaved: new Set() });
    const a = acc.get(box);
    if (recent) {
      a.files.add(r.path);
      if (r.sessionId && busy.has(r.sessionId)) a.live = true;
    }
    if (r.state === 'pending') a.unsaved.add(r.path);
  }
  const out = {};
  for (const [box, a] of [...acc].sort((x, y) => byPath(x[0], y[0]))) {
    if (!a.files.size && !a.unsaved.size) continue;
    out[box] = { tone: a.live ? 'live' : a.files.size ? 'changed' : 'quiet', files: a.files.size, unsaved: a.unsaved.size };
  }
  return out;
}

// The scripts an html page loads from the project: where a page part starts.
export function htmlEntries(htmlPath, text) {
  const dir = dirOf(htmlPath);
  const out = [];
  for (const m of String(text ?? '').matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"'#?]+)/gi)) {
    const src = m[1].trim();
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src) || src.startsWith('/')) continue;
    const path = posix.normalize(posix.join(dir, src));
    if (path.startsWith('..') || out.includes(path)) continue;
    out.push(path);
  }
  return out;
}

// The first sentence of the comment a file opens with (after a #! line), without the references in brackets, with
// secrets masked and at most `max` characters; null when the file does not open with a comment.
export function firstSentence(text, max = INNER_LIMITS.head) {
  const lines = String(text ?? '').slice(0, 8000).split('\n').map((l) => l.replace(/\r$/, ''));
  let i = 0;
  if (lines[0]?.startsWith('#!')) i++;
  while (i < lines.length && !lines[i].trim()) i++;
  const first = lines[i]?.trim() ?? '';
  const words = [];
  if (first.startsWith('//')) {
    for (; i < lines.length && lines[i].trim().startsWith('//'); i++) words.push(lines[i].trim().replace(/^\/\/+\s?/, ''));
  } else if (first.startsWith('/*')) {
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      const end = l.includes('*/');
      words.push(l.replace(/^\/\*+/, '').replace(/\*+\/.*$/, '').replace(/^\*+\s?/, ''));
      if (end) break;
    }
  } else return null;
  let s = maskSecrets(words.join(' ')).replace(/\s+/g, ' ').trim();
  for (let k = 0; k < 3; k++) s = s.replace(/\s*\([^()]*\)/g, '');
  s = s.replace(/\s+([:;,.])/g, '$1').trim();
  const m = /^(.+?[.!?])(?=\s|$)/.exec(s);
  const sentence = (m ? m[1] : s).trim();
  return sentence ? clip(sentence, max) : null;
}

// ---- I/O: only reads ----------------------------------------------------------------------------------------------

const HEAD_BYTES = 4096;
const HTML_MAX = 256 * 1024;
const headMemo = new Map();

function readHead(abs) {
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ }
  }
}

// The view of one part from what the model build kept (side, see buildFlowModel). root: the project folder; arch: the
// map as read; model: the level-1 model. The part file is read for its sections only when the map is the folder's own
// (a map from the main branch gives its paths without lines); every path is resolved inside the folder. null for a part
// the Flow does not draw.
export function partView({ root, arch, partId, model, side = null, readFile = readFileSync }) {
  const program = side?.program ?? programOnly(arch);
  const part = program.parts.find((p) => p.id === partId);
  if (!part) return null;
  let sections = null;
  if (root && arch.source === 'worktree' && part.file) {
    const abs = safeResolve(root, part.file);
    try { sections = abs ? partSections(readFile(abs, 'utf8')) : null; } catch { sections = null; }
  }
  if (!root || !side?.ready) return innerModel({ part, sections, model, declaredOnly: true });
  const files = partFilesOf({
    part, owners: side.owners, scanned: side.scanned, paths: side.paths,
    ownersOf: (list) => ownersAllOf(list, program, { topLevel: side.topLevel }),
  });
  const entries = new Set(side.entries ?? []);
  for (const f of files.filter((x) => !x.code && /\.html?$/i.test(x.path)).slice(0, 5)) {
    const abs = safeResolve(root, f.path);
    try {
      const text = abs ? readFile(abs, 'utf8') : '';
      if (text.length <= HTML_MAX) for (const p of htmlEntries(f.path, text)) entries.add(p);
    } catch { /* gone */ }
  }
  const heads = {};
  for (const f of files.filter((x) => x.code)) {
    const sha = side.shas?.get(f.path) ?? null;
    const key = `${root}|${f.path}|${sha}`;
    if (!headMemo.has(key)) {
      const abs = safeResolve(root, f.path);
      headMemo.set(key, abs ? firstSentence(readHead(abs) ?? '') : null);
      if (headMemo.size > 5000) headMemo.delete(headMemo.keys().next().value);
    }
    const head = headMemo.get(key);
    if (head) heads[f.path] = head;
  }
  return innerModel({ part, sections, files, links: side.links, owners: side.owners, trace: side.trace, model, entries: [...entries].sort(byPath), heads, fileOwner: side.fileOwner ?? new Map() });
}
