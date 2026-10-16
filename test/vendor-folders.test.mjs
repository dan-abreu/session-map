import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { censusOf } from '../server/foundation/census.mjs';
import { countRepo, dependencyDirsOf, kindOfFile } from '../server/sources/count.mjs';

// A folder named "vendor" is not always a library. In a delivery app (the owner's project B) it is where the vendors' screens live:
// 459 files of a whole app, and the views and translations a framework lets the project override. The name alone dropped them
// from the Foundation, the sizes and the Flow as "other people's code". Now the project's own files say which vendor folder
// holds installed libraries (the marks of Composer and Go), and the rest is the project's.

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'sm-vendor-'));
  const files = {
    'apps/vendor/lib/main.dart': 'void main() {}\n',
    'apps/vendor/pubspec.yaml': 'name: vendor_app\n',
    'backend/resources/views/vendor/pagination/default.blade.php': '<nav></nav>\n',
    'backend/app/Http/Orders.php': '<?php\nclass Orders {}\n',
    'backend/vendor/autoload.php': '<?php\n',
    'backend/vendor/acme/pkg/Pkg.php': '<?php\nclass Pkg {}\n',
    'node_modules/left-pad/index.js': 'module.exports = 1;\n',
    'README.md': '# shop\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'init', '-q');
  git(root, 'add', '-A', '-f');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

test('dependencyDirsOf names a vendor folder only where the files show a package manager, and kindOfFile follows it', () => {
  const paths = ['apps/vendor/lib/main.dart', 'backend/vendor/autoload.php', 'backend/vendor/acme/pkg/Pkg.php', 'go/vendor/modules.txt', 'rb/vendor/composer/installed.json', 'node_modules/x/a.js'];
  assert.deepEqual([...dependencyDirsOf(paths)].sort(), ['backend/vendor', 'go/vendor', 'rb/vendor']);
  const deps = dependencyDirsOf(paths);
  assert.equal(kindOfFile('apps/vendor/lib/main.dart', { deps }), 'code', 'the vendors\' own app is the project\'s');
  assert.equal(kindOfFile('backend/resources/views/vendor/pagination/default.blade.php', { deps }), 'screen');
  assert.equal(kindOfFile('backend/vendor/acme/pkg/Pkg.php', { deps }), 'dep', 'Composer\'s folder is a library');
  assert.equal(kindOfFile('go/vendor/github.com/a/b/c.go', { deps }), 'dep');
  assert.equal(kindOfFile('node_modules/x/a.js', { deps }), 'dep', 'a name that is never anything else still decides');
  assert.equal(kindOfFile('apps/vendor/lib/main.dart'), 'dep', 'with no list of files the name decides, as it always did');
});

test('the census and the sizes count a vendor folder of the project and leave out the installed one', async () => {
  const root = repo();
  try {
    const census = await censusOf(root, null);
    const included = census.files.filter((f) => f.included).map((f) => f.path);
    assert.ok(included.includes('apps/vendor/lib/main.dart'), 'the vendor app is read');
    assert.ok(included.includes('backend/resources/views/vendor/pagination/default.blade.php'));
    assert.ok(!included.some((p) => p.startsWith('backend/vendor/')), 'Composer\'s folder is not');
    assert.ok(!included.some((p) => p.startsWith('node_modules/')));
    assert.equal(census.files.filter((f) => !f.included && f.kind === 'dep').length >= 3, true);
    const sizes = await countRepo(root, { ttlMs: 0 });
    assert.ok(sizes.files.some((f) => f.path === 'apps/vendor/lib/main.dart'), 'the sizes count the vendor app');
    assert.ok(sizes.left.dep.includes('backend/vendor/acme/pkg/Pkg.php'), 'and list Composer\'s as a library');
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
