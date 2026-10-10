// Copies one of the invented repositories in test/fixtures/repos/ into a fresh temporary folder and makes it a real git
// repository, so a test can run the census and the readers on something that behaves like a project.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FIXTURE_REPOS = join(import.meta.dirname, 'repos');
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const AUTHOR = { name: 'Ana', email: 'ana@example.com' };

// The .env is made only here, after the commit, so it shows as a file git sees but nobody committed (the case the census
// must treat as a secret and never open). Its content is a marker the tests search for to prove it was never read.
export const ENV_FILE = 'SECRET_TOKEN=do-not-read-42\n';

function git(root, args) {
  return execFileSync('git', [
    '-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`,
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=none', '-c', 'init.defaultBranch=main',
    ...args,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 30_000 });
}

// Returns the root of the copy. The caller removes it with removeFixtureRepo().
export function copyFixtureRepo(name, { env = true } = {}) {
  if (!NAME_RE.test(name)) throw new Error(`unknown fixture: ${name}`);
  const from = join(FIXTURE_REPOS, name);
  const root = mkdtempSync(join(tmpdir(), `sm-fixture-${name}-`));
  try {
    cpSync(from, root, { recursive: true });
  } catch {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`unknown fixture: ${name}`);
  }
  git(root, ['init', '-q']);
  // A global gitignore (core.excludesFile) often lists .env and would turn it into an ignored file, hiding the secret case.
  // Set in the copy's own config, the override reaches every git run inside it (the tests' and the census'), not just ours.
  const noGlobal = join(root, '.git', 'no-global-excludes');
  writeFileSync(noGlobal, '');
  git(root, ['config', 'core.excludesFile', noGlobal.replaceAll('\\', '/')]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', `chore: ${name} fixture`, `--author=${AUTHOR.name} <${AUTHOR.email}>`]);
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'x', 'index.js'), 'module.exports = {};\n');
  if (env) writeFileSync(join(root, '.env'), ENV_FILE);
  return root;
}

export function removeFixtureRepo(root) {
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
