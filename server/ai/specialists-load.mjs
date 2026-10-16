import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readArch } from '../arch/detect.mjs';
import { deriveSpecialists } from './specialists.mjs';

// The specialists of one project on disk (id158, or68): its architecture map in the working tree, its tracked files and
// its test runner, read once and turned into the specialists. The sync script and the other engines' trigger share it.

const run = promisify(execFile);
const readText = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };

// The files git knows or would know: tracked, or new and not ignored — so the list does not change on `git add`/commit,
// and a test file written today is in its specialist's card. Asynchronous: the server must not stand still for it.
export const trackedFiles = async (root) => {
  const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return [...new Set(String(stdout).split(/\r?\n/).filter(Boolean))].sort();
};

// The runner of the project's tests, when it is plain: `node --test` from package.json. Anything else stays unnamed.
export function testCommandOf(root, read = readText) {
  try {
    const script = JSON.parse(read(join(root, 'package.json')) ?? '{}')?.scripts?.test ?? '';
    return /^node\s+--test\b/.test(script) ? 'node --test' : null;
  } catch { return null; }
}

// -> { ok, arch, specialists, files } or { ok: false, error }. A map read from the main branch is never a source: the
// files it names may not be the ones in the folder the agent will work in.
export async function loadSpecialists({ root, files = null, read = readText, tracked = trackedFiles } = {}) {
  let arch;
  try { arch = await readArch(root, {}); } catch { return { ok: false, error: 'no-map' }; }
  if (arch.source !== 'worktree') return { ok: false, error: 'no-map' };
  let list;
  try { list = files ?? await tracked(root); } catch { return { ok: false, error: 'no-files' }; }
  const specialists = deriveSpecialists({ arch, readPart: (p) => read(join(root, p.file)) ?? '', files: list, testCommand: testCommandOf(root, read) });
  return { ok: true, arch, specialists, files: list };
}
