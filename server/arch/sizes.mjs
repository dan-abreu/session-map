// Files and lines in every box of the map (mm25): each counted file has one owner, a part; a layer is the sum of its parts;
// the program is every counted file, the ones with no box included. Pure: it receives the count (sources/count.mjs).
import { ownersOf } from './attach.mjs';

const LIST_MAX = 200;
const KINDS = ['code', 'screen', 'test', 'doc'];

const emptyPart = () => ({ files: 0, lines: 0, kinds: Object.fromEntries(KINDS.map((k) => [k, 0])) });

// counted: {files: [{path, kind, lines}], left: {dep, generated, binary: [path]}}. listMax caps the paths sent to the page:
// the files with no box (biggest first) and the ones left out.
export function sizesOf(counted, arch, { topLevel, listMax = LIST_MAX } = {}) {
  const parts = Object.fromEntries(arch.parts.map((p) => [p.id, emptyPart()]));
  const loose = [];
  const total = { files: 0, lines: 0 };
  const owners = ownersOf(counted.files.map((f) => f.path), arch, { topLevel });
  counted.files.forEach((f, i) => {
    total.files += 1;
    total.lines += f.lines;
    const part = parts[owners[i]];
    if (!part) return loose.push(f);
    part.files += 1;
    part.lines += f.lines;
    if (f.kind in part.kinds) part.kinds[f.kind] += 1;
  });
  const layers = Object.fromEntries(arch.layers.map((l) => [l.id, l.partIds.reduce((sum, id) => ({
    files: sum.files + (parts[id]?.files ?? 0),
    lines: sum.lines + (parts[id]?.lines ?? 0),
  }), { files: 0, lines: 0 })]));
  const biggest = [...loose].sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
  return {
    total,
    parts,
    layers,
    unowned: { files: loose.length, lines: loose.reduce((n, f) => n + f.lines, 0), paths: biggest.slice(0, listMax).map((f) => f.path) },
    left: Object.fromEntries(Object.entries(counted.left).map(([k, paths]) => [k, { files: paths.length, paths: paths.slice(0, listMax) }])),
  };
}
