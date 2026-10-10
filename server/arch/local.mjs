import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArch } from './parse.mjs';

// Parts kept in session-map's own folder for a project (projects/<id>/*.md): the owner's requests and the operation of a
// project whose repository has no such files of its own, so nothing is written into that repository. They are read like
// the repository's parts, marked local (their file is the absolute path, which a chat edits directly), in a layer of
// their own; a part the repository already has wins.
export function withLocalParts(arch, smDir, projectId) {
  if (!smDir || arch.source === 'none') return arch;
  const dir = join(smDir, 'projects', projectId);
  let names;
  try {
    names = readdirSync(dir).filter((n) => /\.md$/i.test(n) && n.toLowerCase() !== 'readme.md');
  } catch {
    return arch;
  }
  if (!names.length) return arch;
  const files = Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
  const local = parseArch(dir.replaceAll('\\', '/'), files, 'local');
  const taken = new Set(arch.parts.map((p) => p.id));
  const parts = local.parts.filter((p) => !taken.has(p.id)).map((p) => ({ ...p, local: true }));
  if (!parts.length) return arch;
  const name = arch.lang === 'pt' ? 'Pedidos e operação' : 'Requests and operation';
  return { ...arch, parts: [...arch.parts, ...parts], layers: [...arch.layers, { id: 'local', name, partIds: parts.map((p) => p.id) }] };
}
