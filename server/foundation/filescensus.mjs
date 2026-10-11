// What the files side of the map (id77) adds to each row of the Files list: the census counts (code / comment / blank),
// why a file is left out, and "new" for what git sees and no census has counted yet. Names and counts only, never content.
import { repoTree } from './repotree.mjs';

const NO_FIELDS = { census: null, excluded: null, new: false };

function* fileNodes(node) {
  for (const c of node?.children ?? []) {
    if (c.type === 'folder') yield* fileNodes(c);
    else yield c;
  }
}

// files: rows of the Files list. census: census.json or null. tree: the answer of repoTree or null.
// → the same rows, each with census {code, comment, blank} | null, excluded (the reason) | null, new.
export function censusFields(files, census, tree) {
  const rows = new Map((census?.files ?? []).map((f) => [f.path, f]));
  const fresh = new Set([...fileNodes(tree?.tree)].filter((n) => n.new).map((n) => n.path));
  return files.map((f) => {
    const r = rows.get(f.path);
    const counted = r?.included && r.lines;
    return {
      ...f,
      census: counted ? { code: r.lines.code, comment: r.lines.comment, blank: r.lines.blank } : NO_FIELDS.census,
      excluded: r && !r.included ? (r.reason ?? 'left-out') : NO_FIELDS.excluded,
      new: fresh.has(f.path),
    };
  });
}

// The rows of the Files list with the census fields, plus the files made after the last count (git lists them, the count
// does not yet, they are not left out): the side shows them within seconds, marked new, with no counts and no owners.
// Options are repoTree's (list, nowMs, fresh, ...). Without a census nothing is known, so git is not even asked.
export async function withCensus(files, { root, census, ...options }) {
  if (!census) return censusFields(files, null, null);
  const tree = await repoTree(root, census, options);
  const out = censusFields(files, census, tree);
  const known = new Set(files.map((f) => f.path));
  for (const n of fileNodes(tree.tree)) {
    if (!n.new || n.grey || known.has(n.path)) continue;
    out.push({ path: n.path, status: null, lines: null, kind: n.kind, census: null, excluded: null, new: true });
  }
  return out;
}
