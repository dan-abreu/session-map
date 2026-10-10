import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolOf, runTool, sccTotals, depcruiseLinks, crossCheck, crossCheckImports, markDivergent } from '../server/foundation/optional.mjs';

test('toolOf: tool absent from PATH and node_modules/.bin gives null, no error', async () => {
  const seen = [];
  const which = (name, dirs) => { seen.push([name, dirs]); return null; };
  assert.equal(await toolOf('scc', '/proj', { which }), null);
  assert.ok(seen[0][1].some((d) => d.replace(/[\\]/g, '/').endsWith('/proj/node_modules/.bin')));
});

test('toolOf: found tool is returned with its path; depcruise maps to its binary name', async () => {
  const which = (name) => (name === 'depcruise' ? '/proj/node_modules/.bin/depcruise' : null);
  const t = await toolOf('depcruise', '/proj', { which });
  assert.deepEqual(t, { name: 'depcruise', path: '/proj/node_modules/.bin/depcruise' });
  assert.equal(await toolOf('scc', '/proj', { which }), null);
});

test('toolOf: refuses names other than scc and depcruise (never npx)', async () => {
  let called = false;
  const which = () => { called = true; return '/x/npx'; };
  assert.equal(await toolOf('npx', '/proj', { which }), null);
  assert.equal(called, false);
});

test('runTool: execFile without shell, 30 s timeout, 20 MB cap; parses JSON; failure gives null', async () => {
  const calls = [];
  const exec = async (file, args, opts) => { calls.push([file, args, opts]); return { stdout: '{"a":1}' }; };
  const out = await runTool({ name: 'scc', path: '/bin/scc' }, ['--format', 'json'], '/proj', { exec });
  assert.deepEqual(out, { a: 1 });
  assert.equal(calls[0][0], '/bin/scc');
  assert.equal(calls[0][2].timeout, 30000);
  assert.equal(calls[0][2].maxBuffer, 20 * 1024 * 1024);
  assert.equal(calls[0][2].cwd, '/proj');
  assert.ok(!calls[0][2].shell);
  assert.equal(await runTool({ name: 'scc', path: 'x' }, [], '/p', { exec: async () => { throw new Error('boom'); } }), null);
  assert.equal(await runTool({ name: 'scc', path: 'x' }, [], '/p', { exec: async () => ({ stdout: 'not json' }) }), null);
});

const SCC = [
  { Name: 'JavaScript', Files: [
    { Location: './src/a.js', Lines: 10, Code: 7, Comment: 2, Blank: 1 },
    { Location: 'src\\b.js', Lines: 5, Code: 5, Comment: 0, Blank: 0 } ] },
  { Name: 'Markdown', Files: [{ Location: 'README.md', Lines: 3, Code: 3, Comment: 0, Blank: 0 }] },
];

test('sccTotals: flattens per-file counts with normalized paths', () => {
  const m = sccTotals(SCC);
  assert.deepEqual(m.get('src/a.js'), { total: 10, code: 7, comment: 2, blank: 1 });
  assert.deepEqual(m.get('src/b.js'), { total: 5, code: 5, comment: 0, blank: 0 });
  assert.equal(m.size, 3);
  assert.equal(sccTotals(null).size, 0);
});

test('crossCheck: lists only files whose line counts differ', () => {
  const census = { files: [
    { path: 'src/a.js', included: true, lines: { total: 10, code: 7, comment: 2, blank: 1 } },
    { path: 'src/b.js', included: true, lines: { total: 6, code: 6, comment: 0, blank: 0 } },
    { path: 'README.md', included: true, lines: { total: 3, code: 3, comment: 0, blank: 0 } },
    { path: 'only-ours.js', included: true, lines: { total: 1, code: 1, comment: 0, blank: 0 } },
    { path: 'pnpm-lock.yaml', included: false, lines: null } ] };
  const diff = crossCheck(census, sccTotals(SCC));
  assert.equal(diff.length, 1);
  assert.equal(diff[0].path, 'src/b.js');
  assert.deepEqual(diff[0].own, { total: 6, code: 6, comment: 0, blank: 0 });
  assert.deepEqual(diff[0].scc, { total: 5, code: 5, comment: 0, blank: 0 });
});

const CRUISE = { modules: [
  { source: 'src/a.js', dependencies: [{ resolved: 'src/b.js' }, { resolved: 'src/c.js' }, { resolved: 'node_modules/x/i.js', coreModule: false }] },
  { source: 'src/b.js', dependencies: [] } ] };

test('depcruiseLinks: from/to pairs, node_modules ignored', () => {
  const links = depcruiseLinks(CRUISE);
  assert.deepEqual(links, [{ from: 'src/a.js', to: 'src/b.js' }, { from: 'src/a.js', to: 'src/c.js' }]);
  assert.deepEqual(depcruiseLinks(null), []);
});

const imp = (a, b) => ({ id: `import:${a}->${b}`, kind: 'import', file: a, origin: 'EXTRACTED', attrs: {} });

test('crossCheckImports: links one saw and the other did not', () => {
  const facts = { files: { 'src/a.js': {}, 'src/b.js': {}, 'src/z.js': {} }, facts: [imp('src/a.js', 'src/b.js'), imp('src/a.js', 'src/z.js'), { id: 'route:GET /', kind: 'route' }] };
  // vendor/x.js is not one of our files: its link is out of scope, not a divergence.
  const r = crossCheckImports(facts, [...depcruiseLinks(CRUISE), { from: 'vendor/x.js', to: 'src/a.js' }]);
  assert.deepEqual(r.onlyOurs, [{ from: 'src/a.js', to: 'src/z.js' }]);
  assert.deepEqual(r.onlyTool, [{ from: 'src/a.js', to: 'src/c.js' }]);
});

test('crossCheckImports: files the tool never analysed are not divergences', () => {
  // Both ends are project files, so only the "did the tool analyse lib/q.js?" rule keeps this out of onlyOurs.
  const facts = { files: { 'lib/q.js': {}, 'lib/r.js': {} }, facts: [imp('lib/q.js', 'lib/r.js')] };
  assert.deepEqual(crossCheckImports(facts, depcruiseLinks(CRUISE)).onlyOurs, []);
  assert.deepEqual(crossCheckImports(facts, depcruiseLinks(CRUISE), depcruiseSources(CRUISE)).onlyOurs, []);
});

test('markDivergent: flags our fact AMBIGUOUS, keeps everything else, does not mutate', () => {
  const facts = { facts: [imp('src/a.js', 'src/z.js'), imp('src/a.js', 'src/b.js')] };
  const out = markDivergent(facts, { onlyOurs: [{ from: 'src/a.js', to: 'src/z.js' }], onlyTool: [] });
  assert.equal(out.facts[0].origin, 'AMBIGUOUS');
  assert.equal(out.facts[0].id, facts.facts[0].id);
  assert.equal(out.facts[1].origin, 'EXTRACTED');
  assert.equal(facts.facts[0].origin, 'EXTRACTED');
});

// --- review fixes (B1-T13) ---
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOptional, depcruiseSources } from '../server/foundation/optional.mjs';

function fakeProject() {
  const root = mkdtempSync(join(tmpdir(), 'sm-optional-'));
  const bin = join(root, 'node_modules', '.bin');
  const pkg = join(root, 'node_modules', 'dependency-cruiser');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(bin, 'depcruise.cmd'), '@echo off\r\nnode "%~dp0\..\dependency-cruiser\bin\dependency-cruise.mjs" %*\r\n');
  writeFileSync(join(bin, 'depcruise'), '#!/bin/sh\nexec node "$0/../../dependency-cruiser/bin/dependency-cruise.mjs" "$@"\n');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'dependency-cruiser', bin: { 'dependency-cruise': 'bin/dependency-cruise.mjs', depcruise: 'bin/dependency-cruise.mjs' } }));
  const script = join(pkg, 'bin', 'dependency-cruise.mjs');
  writeFileSync(script, 'process.stdout.write(JSON.stringify({ modules: [], argv: process.argv.slice(2) }));\n');
  return { root, bin, script };
}

test('toolOf (real lookup, win32): depcruise never resolves to a .cmd shim; runs node + the package bin script', async (t) => {
  const { root, script } = fakeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tool = await toolOf('depcruise', root, { env: { PATH: '' }, platform: 'win32' });
  assert.deepEqual(tool, { name: 'depcruise', path: process.execPath, pre: [script] });
  assert.ok(!/\.(cmd|bat)$/i.test(tool.path));
  const calls = [];
  const exec = async (file, args, opts) => { calls.push([file, args, opts]); return { stdout: '{}' }; };
  await runTool(tool, ['--output-type', 'json', 'src'], root, { exec });
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [script, '--output-type', 'json', 'src']);
  assert.ok(!calls[0][2].shell);
  // and it really runs, with the real execFile and no shell
  const out = await runTool(tool, ['--output-type', 'json'], root);
  assert.deepEqual(out, { modules: [], argv: ['--output-type', 'json'] });
});

test('toolOf (real lookup, win32): shim without the package, or a .cmd/.bat scc, gives null', async (t) => {
  const { root } = fakeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  rmSync(join(root, 'node_modules', 'dependency-cruiser'), { recursive: true, force: true });
  assert.equal(await toolOf('depcruise', root, { env: { PATH: '' }, platform: 'win32' }), null);
  const path = join(root, 'tools');
  mkdirSync(path);
  writeFileSync(join(path, 'scc.cmd'), '@echo off\r\n');
  writeFileSync(join(path, 'scc.bat'), '@echo off\r\n');
  writeFileSync(join(path, 'scc'), '');
  assert.equal(await toolOf('scc', root, { env: { PATH: path }, platform: 'win32' }), null);
  writeFileSync(join(path, 'scc.exe'), '');
  assert.deepEqual(await toolOf('scc', root, { env: { PATH: path }, platform: 'win32' }), { name: 'scc', path: join(path, 'scc.exe') });
});

function fakePackage(pkg) {
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'dependency-cruiser', bin: { depcruise: 'bin/dependency-cruise.mjs' } }));
  const script = join(pkg, 'bin', 'dependency-cruise.mjs');
  writeFileSync(script, '');
  return script;
}

test('toolOf (real lookup, win32): the sibling package folder is only looked at for a node_modules/.bin entry', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'sm-optional-path-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'proj');
  mkdirSync(root);
  // An arbitrary PATH folder: a dependency-cruiser folder next to it has nothing to do with npm.
  const tools = join(base, 'tools', 'bin');
  mkdirSync(tools, { recursive: true });
  writeFileSync(join(tools, 'depcruise.cmd'), '@echo off\r\n');
  fakePackage(join(base, 'tools', 'dependency-cruiser'));
  assert.equal(await toolOf('depcruise', root, { env: { PATH: tools }, platform: 'win32' }), null);
  // The npm global folder keeps the package in <dir>/node_modules.
  const npm = join(base, 'npm');
  mkdirSync(npm);
  writeFileSync(join(npm, 'depcruise.cmd'), '@echo off\r\n');
  const globalScript = fakePackage(join(npm, 'node_modules', 'dependency-cruiser'));
  assert.deepEqual(await toolOf('depcruise', root, { env: { PATH: npm }, platform: 'win32' }), { name: 'depcruise', path: process.execPath, pre: [globalScript] });
  // Another project's node_modules/.bin on PATH: the package sits next to .bin.
  const other = join(base, 'other', 'node_modules');
  mkdirSync(join(other, '.bin'), { recursive: true });
  writeFileSync(join(other, '.bin', 'depcruise.cmd'), '@echo off\r\n');
  const localScript = fakePackage(join(other, 'dependency-cruiser'));
  assert.deepEqual(await toolOf('depcruise', root, { env: { PATH: join(other, '.bin') }, platform: 'win32' }), { name: 'depcruise', path: process.execPath, pre: [localScript] });
});

test('toolOf (real lookup, posix): the plain executable in node_modules/.bin is used', async (t) => {
  const { root, bin } = fakeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(await toolOf('depcruise', root, { env: { PATH: '' }, platform: 'linux' }), { name: 'depcruise', path: join(bin, 'depcruise') });
});

test('missing tool: the caller flow never execs anything and has no npx fallback', async () => {
  const calls = [];
  const exec = async (...a) => { calls.push(a); return { stdout: '{}' }; };
  const which = () => null;
  assert.equal(await toolOf('depcruise', '/proj', { exec, which }), null);
  assert.equal(await runOptional('scc', '/proj', ['--by-file', '--format', 'json'], { exec, which }), null);
  assert.equal(await runOptional('depcruise', '/proj', ['--output-type', 'json', '.'], { exec, which }), null);
  assert.equal(await runOptional('npx', '/proj', ['depcruise'], { exec, which: () => '/x/npx' }), null);
  assert.equal(calls.length, 0);
  const found = await runOptional('scc', '/proj', ['--format', 'json'], { exec, which: () => '/bin/scc' });
  assert.deepEqual(found, {});
  assert.equal(calls.length, 1);
  assert.ok(!calls.flat(2).some((a) => typeof a === 'string' && /npx/i.test(a)));
});

test('depcruiseLinks: unresolved, npm and core dependencies are not links', () => {
  const json = { modules: [{ source: 'src/a.js', dependencies: [
    { resolved: 'lodash', module: 'lodash', couldNotResolve: true, dependencyTypes: ['unknown'] },
    { resolved: 'fs', module: 'fs', coreModule: false, dependencyTypes: ['core'] },
    { resolved: 'left-pad/index.js', module: 'left-pad', dependencyTypes: ['npm'] },
    { resolved: 'dev/x.js', module: 'devx', dependencyTypes: ['npm-dev'] },
    { resolved: 'src/b.js', module: './b', dependencyTypes: ['local'] } ] }] };
  assert.deepEqual(depcruiseLinks(json), [{ from: 'src/a.js', to: 'src/b.js' }]);
});

test('crossCheckImports: an import of ours out of a module the tool analysed with no dependencies is onlyOurs', () => {
  const facts = { files: { 'src/a.js': {}, 'src/b.js': {}, 'src/x.js': {} }, facts: [imp('src/b.js', 'src/x.js')] };
  const r = crossCheckImports(facts, depcruiseLinks(CRUISE), depcruiseSources(CRUISE));
  assert.deepEqual(r.onlyOurs, [{ from: 'src/b.js', to: 'src/x.js' }]);
});

// Review round 3: log signature, depcruise exit code with JSON, library imports, comment-dependent `code`.
function captureStderr(fn) {
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return true; };
  return Promise.resolve().then(fn).finally(() => { process.stderr.write = orig; }).then((value) => ({ value, lines }));
}

test('runTool failure logs level warn with only the code, never the command or stderr', async () => {
  const err = Object.assign(new Error('Command failed: /home/ana/bin/scc --x\nsecret stderr'), { code: 'ENOENT' });
  const { value, lines } = await captureStderr(() => runTool({ name: 'scc', path: '/home/ana/bin/scc' }, [], '/p', { exec: async () => { throw err; } }));
  assert.equal(value, null);
  const rec = lines.map((l) => JSON.parse(l)).find((r) => r.event === 'optional-run-failed');
  assert.ok(rec, lines.join(''));
  assert.equal(rec.level, 'warn');
  assert.equal(rec.tool, 'scc');
  assert.equal(rec.code, 'ENOENT');
  assert.ok(!lines.join('').includes('/home/ana') && !lines.join('').includes('secret'));
});

test('toolOf which failure logs level warn with the name and code', async () => {
  const which = () => { throw Object.assign(new Error('EACCES /home/ana'), { code: 'EACCES' }); };
  const { value, lines } = await captureStderr(() => toolOf('scc', '/proj', { which }));
  assert.equal(value, null);
  const rec = lines.map((l) => JSON.parse(l)).find((r) => r.event === 'optional-which-failed');
  assert.deepEqual([rec?.level, rec?.name, rec?.code], ['warn', 'scc', 'EACCES']);
  assert.ok(!lines.join('').includes('/home/ana'));
});

test('runTool: a non-zero exit with JSON on stdout (depcruise rule violations) still gives the JSON', async () => {
  const exec = async () => { throw Object.assign(new Error('Command failed'), { code: 2, stdout: '{"modules":[]}' }); };
  const { value } = await captureStderr(() => runTool({ name: 'depcruise', path: 'x' }, [], '/p', { exec }));
  assert.deepEqual(value, { modules: [] });
  const bad = async () => { throw Object.assign(new Error('x'), { code: 2, stdout: 'not json' }); };
  assert.equal((await captureStderr(() => runTool({ name: 'depcruise', path: 'x' }, [], '/p', { exec: bad }))).value, null);
});

test('crossCheckImports: a library import or one whose target is not a project file is never onlyOurs', () => {
  const lib = { ...imp('src/a.js', 'lodash'), attrs: { library: true } };
  const outside = imp('src/a.js', 'react');
  // A library fact whose target is a project file: only the library flag keeps it out.
  const libInside = { ...imp('src/a.js', 'src/c.js'), attrs: { library: true } };
  // The shape B1-T14 really writes for a project import: library false, still compared.
  const own = { ...imp('src/a.js', 'src/b.js'), attrs: { spec: './b', library: false } };
  const facts = { files: { 'src/a.js': {}, 'src/b.js': {}, 'src/c.js': {} }, facts: [lib, outside, libInside, own] };
  const r = crossCheckImports(facts, [], new Set(['src/a.js']));
  assert.deepEqual(r.onlyOurs, [{ from: 'src/a.js', to: 'src/b.js' }]);
});

test('crossCheck: only total and blank are compared (code depends on how comments are classified)', () => {
  const census = { files: [{ path: 'src/a.js', included: true, lines: { total: 10, code: 5, comment: 4, blank: 1 } }] };
  assert.deepEqual(crossCheck(census, sccTotals(SCC)), []);
});
