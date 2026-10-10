import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linksOf, resolveSpec, specifiersIn } from '../server/imports.mjs';

test('the files a source file uses, with the line where it asks for each', () => {
  const text = [
    "import { a } from './a.js';",
    "import type { T } from '../types';",
    "import './side.css';",
    "export * from './all.mjs';",
    "export { b as c } from \"./b\";",
    'const lazy = await import("./lazy.js");',
    "const fs = require('node:fs');",
    "import React from 'react';",
    "// import nope from './commented.js'",
    " * import alsoNope from './doc-comment.js'",
  ].join('\n');
  assert.deepEqual(specifiersIn(text, 'src/x.ts').map((s) => `${s.line}:${s.spec}`), [
    '1:./a.js', '2:../types', '3:./side.css', '4:./all.mjs', '5:./b', '6:./lazy.js', '7:node:fs', '8:react',
  ]);
  assert.deepEqual(specifiersIn('@import "base.css";\n@import url(\'theme.css\');', 'web/style.css').map((s) => s.spec), ['base.css', 'theme.css']);
  assert.deepEqual(specifiersIn('<script type="module" src="./app.js"></script>\n<link rel="stylesheet" href="style.css">', 'web/index.html').map((s) => s.spec), ['./app.js', 'style.css']);
  assert.deepEqual(specifiersIn('import x from "./y"', 'notes.md'), [], 'only languages the reader knows');
});

test('a relative name finds the file it means, with the extensions and index files bundlers try', () => {
  const files = new Set(['src/a.ts', 'src/b/index.tsx', 'src/c.js', 'web/style.css', 'web/base.css', 'src/d.mjs']);
  assert.equal(resolveSpec('src/x.ts', './a', files), 'src/a.ts');
  assert.equal(resolveSpec('src/x.ts', './a.js', files), 'src/a.ts', 'TypeScript written with .js names');
  assert.equal(resolveSpec('src/x.ts', './b', files), 'src/b/index.tsx');
  assert.equal(resolveSpec('src/deep/x.js', '../c.js', files), 'src/c.js');
  assert.equal(resolveSpec('web/style.css', 'base.css', files), 'web/base.css', 'CSS names are relative without ./');
  assert.equal(resolveSpec('src/x.ts', 'react', files), null);
  assert.equal(resolveSpec('src/x.ts', './missing', files), null);
  assert.equal(resolveSpec('src/x.ts', '../../outside', files), null);
});

test('links of a file in a project: what it uses, what uses it and the libraries it asks for', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sm-imp-')));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'main.js'), "import { cart } from './cart.js';\nimport express from 'express';\n");
    writeFileSync(join(root, 'src', 'cart.js'), "import { tax } from './tax.js';\nexport const cart = 1;\n");
    writeFileSync(join(root, 'src', 'tax.js'), 'export const tax = 2;\n');
    writeFileSync(join(root, 'src', 'admin.js'), "\n\nimport { cart } from './cart.js';\n");
    writeFileSync(join(root, 'README.md'), '# hi\n');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    const cart = await linksOf(root, 'src/cart.js');
    assert.equal(cart.graph, true);
    assert.deepEqual(cart.uses, [{ path: 'src/tax.js', line: 1 }]);
    assert.deepEqual(cart.usedBy, [{ path: 'src/admin.js', line: 3 }, { path: 'src/main.js', line: 1 }]);
    assert.deepEqual((await linksOf(root, 'src/main.js')).libraries, ['express']);
    assert.deepEqual(await linksOf(root, 'README.md'), { graph: false, uses: [], usedBy: [], libraries: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
