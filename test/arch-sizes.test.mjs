import test from 'node:test';
import assert from 'node:assert/strict';
import { ownersOf } from '../server/arch/attach.mjs';
import { sizesOf } from '../server/arch/sizes.mjs';

const part = (id, codePaths) => ({ id, name: id, file: `docs/architecture/${id}.md`, codePaths, groups: [] });
const ARCH = {
  layers: [{ id: 'front', name: 'Front', partIds: ['web', 'checkout'] }, { id: 'back', name: 'Back', partIds: ['api', 'twin'] }],
  parts: [part('web', ['apps/web']), part('checkout', ['apps/web/src/checkout/']), part('api', ['apps/api', 'shared/']), part('twin', ['shared/'])],
};

test('ownersOf gives each file one owner: the deepest path, the first part on a tie, none when nothing matches', () => {
  assert.deepEqual(ownersOf(['apps/web/src/checkout/pay.ts', 'apps/web/a.ts', 'shared/x.ts', 'README.md', 'docs/architecture/twin.md'], ARCH), ['checkout', 'web', 'api', null, 'twin']);
});

test('ownersOf gives a test with no owner the part of the file it tests, else of the folder its name points to when one part holds most of it (fd16)', () => {
  const arch = { layers: [], parts: [part('arch', ['server/arch/']), part('page', ['server/web/']), part('plugin', ['scripts/']), part('fd', ['server/foundation/'])] };
  const files = [
    'server/arch/parse.mjs', 'server/web/tree.js', 'scripts/readme-shots.mjs', 'server/foundation/lex.mjs',
    'test/arch-parse.test.mjs', 'test/web-tree.test.mjs', 'test/readme-shots.test.mjs', 'test/foundation-uptodate-code.test.mjs',
    'test/server-arch.test.mjs', 'test/nothing-here.test.mjs', 'test/server.test.mjs', 'test/fixtures/arch-en/README.md', 'server/web/tree.test.js',
  ];
  assert.deepEqual(ownersOf(files, arch), ['arch', 'page', 'plugin', 'fd', 'arch', 'page', 'plugin', 'fd', 'arch', null, null, null, 'page']);
});

test('sizesOf: every part counts its own files, a layer is the sum of its parts and the program holds the files with no box too', () => {
  const counted = {
    files: [
      { path: 'apps/web/src/checkout/pay.ts', kind: 'code', lines: 40 },
      { path: 'apps/web/src/checkout/Pay.tsx', kind: 'screen', lines: 60 },
      { path: 'apps/web/a.ts', kind: 'code', lines: 100 },
      { path: 'apps/api/x.test.ts', kind: 'test', lines: 50 },
      { path: 'README.md', kind: 'doc', lines: 30 },
      { path: 'scripts/x.sh', kind: 'code', lines: 20 },
    ],
    left: { dep: ['node_modules/a.js'], generated: ['package-lock.json', 'dist/a.js'], binary: [] },
  };
  const sizes = sizesOf(counted, ARCH);
  assert.deepEqual(sizes.total, { files: 6, lines: 300 });
  assert.deepEqual(sizes.parts.checkout, { files: 2, lines: 100, kinds: { code: 1, screen: 1, test: 0, doc: 0 } });
  assert.deepEqual(sizes.parts.web, { files: 1, lines: 100, kinds: { code: 1, screen: 0, test: 0, doc: 0 } });
  assert.deepEqual(sizes.parts.api, { files: 1, lines: 50, kinds: { code: 0, screen: 0, test: 1, doc: 0 } });
  assert.deepEqual(sizes.parts.twin, { files: 0, lines: 0, kinds: { code: 0, screen: 0, test: 0, doc: 0 } });
  assert.deepEqual(sizes.layers, { front: { files: 3, lines: 200 }, back: { files: 1, lines: 50 } });
  assert.deepEqual(sizes.unowned, { files: 2, lines: 50, paths: ['README.md', 'scripts/x.sh'] });
  assert.deepEqual(sizes.left, { dep: { files: 1, paths: ['node_modules/a.js'] }, generated: { files: 2, paths: ['package-lock.json', 'dist/a.js'] }, binary: { files: 0, paths: [] } });
  const layerSum = Object.values(sizes.layers).reduce((n, l) => n + l.files, 0);
  assert.equal(layerSum + sizes.unowned.files, sizes.total.files, 'the program is the sum of its layers and the files with no box');
});

test('sizesOf keeps the lists short: the biggest files with no box first, at most the cap', () => {
  const files = Array.from({ length: 5 }, (_, i) => ({ path: `loose/${i}.js`, kind: 'code', lines: i + 1 }));
  const sizes = sizesOf({ files, left: { dep: [], generated: [], binary: [] } }, ARCH, { listMax: 2 });
  assert.equal(sizes.unowned.files, 5);
  assert.deepEqual(sizes.unowned.paths, ['loose/4.js', 'loose/3.js']);
});

test('sizesOf with no map counts the whole program as having no box', () => {
  const sizes = sizesOf({ files: [{ path: 'a.js', kind: 'code', lines: 3 }], left: { dep: [], generated: [], binary: [] } }, { layers: [], parts: [] });
  assert.deepEqual(sizes.total, { files: 1, lines: 3 });
  assert.equal(sizes.unowned.files, 1);
  assert.deepEqual(sizes.parts, {});
});

test('ownersOf reads a test name against the code, never against test repositories or documents (fd16)', () => {
  const arch = { layers: [], parts: [part('fx', ['test/fixtures/']), part('docs', ['docs/']), part('fd', ['server/foundation/'])] };
  const files = ['test/fixtures/app/src/lex.ts', 'docs/lex.md', 'server/foundation/lex.mjs', 'test/lex.test.mjs'];
  assert.deepEqual(ownersOf(files, arch), ['fx', 'docs', 'fd', 'fd']);
});
