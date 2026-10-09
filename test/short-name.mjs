import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Windows only: makes a real folder and returns it under its long and its 8.3 short spelling (null when the volume has no short names).
export function folderWithShortName(t) {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'sm-short-name-test-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const long = join(base, 'a-folder-with-a-long-name');
  mkdirSync(long);
  const short = execSync(`for %I in ("${long}") do @echo %~sI`, { shell: 'cmd.exe', encoding: 'utf8' }).trim();
  return short.includes('~') ? { long, short } : null;
}
