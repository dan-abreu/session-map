// Every file's parts for the files side of the map (mind-map-page mm40, mm42), read exactly as the boxes' counts read them
// (mm25, sizes.mjs): the parts holding its deepest path, and for a test no part names, the part of the file it tests (fd16).
// So a file with no part here is one of the root's "files with no box on the map", and the two can never disagree.
import * as attach from './attach.mjs';

// paths: relative to the project root. → one list of part ids per path, in map order; [] for a file with no box.
// Every part tied at a file's deepest path comes with ownersAllOf (flow fl08); until it lands, the one owner the counts use.
export function fileOwners(paths, arch, { topLevel } = {}) {
  const all = attach.ownersAllOf?.(paths, arch, { topLevel });
  const one = attach.ownersOf(paths, arch, { topLevel });
  return paths.map((_, i) => (all?.[i].length ? all[i] : one[i] ? [one[i]] : []));
}
