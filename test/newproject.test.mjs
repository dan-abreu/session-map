import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createdRoots, createProject, nameError, suggestParent } from '../server/newproject.mjs';
import { normalizePath } from '../server/paths.mjs';

function dirs() {
  return [mkdtempSync(join(tmpdir(), 'sm-new-p-')), mkdtempSync(join(tmpdir(), 'sm-new-s-'))];
}
const clean = (...ds) => { for (const d of ds) rmSync(d, { recursive: true, force: true }); };
const config = (sm) => JSON.parse(readFileSync(join(sm, 'config.json'), 'utf8'));

test('createProject makes the folder and remembers it in config.json', () => {
  const [parent, sm] = dirs();
  try {
    const out = createProject(sm, { parent, name: '  Meu Projeto  ' }, { now: new Date('2026-10-11T12:00:00Z') });
    assert.equal(out.ok, true);
    assert.equal(out.root, join(parent, 'Meu Projeto'));
    assert.ok(statSync(out.root).isDirectory());
    const entry = config(sm).projects[normalizePath(out.root)];
    assert.deepEqual(entry, { created: { at: '2026-10-11T12:00:00.000Z', root: out.root } });
    assert.deepEqual(createdRoots(config(sm)), [out.root]);
  } finally { clean(parent, sm); }
});

test('createProject keeps what config.json already holds', () => {
  const [parent, sm] = dirs();
  try {
    writeFileSync(join(sm, 'config.json'), JSON.stringify({ budget: { monthlyUSD: 9 }, projects: { 'c:/x': { tidy: true } } }));
    const out = createProject(sm, { parent, name: 'novo' });
    assert.equal(out.ok, true);
    const cfg = config(sm);
    assert.deepEqual(cfg.budget, { monthlyUSD: 9 });
    assert.deepEqual(cfg.projects['c:/x'], { tidy: true });
  } finally { clean(parent, sm); }
});

test('createProject never writes over a folder that exists', () => {
  const [parent, sm] = dirs();
  try {
    mkdirSync(join(parent, 'ja-existe'));
    assert.deepEqual(createProject(sm, { parent, name: 'ja-existe' }), { ok: false, error: 'folder-exists' });
  } finally { clean(parent, sm); }
});

test('createProject refuses a place that is not a folder on this computer', () => {
  const [parent, sm] = dirs();
  try {
    assert.equal(createProject(sm, { parent: join(parent, 'nao-ha'), name: 'a' }).error, 'bad-parent');
    assert.equal(createProject(sm, { parent: 'relativo/pasta', name: 'a' }).error, 'bad-parent');
    assert.equal(createProject(sm, { parent: 42, name: 'a' }).error, 'bad-parent');
    writeFileSync(join(parent, 'arquivo.txt'), 'x');
    assert.equal(createProject(sm, { parent: join(parent, 'arquivo.txt'), name: 'a' }).error, 'bad-parent');
  } finally { clean(parent, sm); }
});

test('nameError accepts a plain folder name and refuses paths and names Windows cannot hold', () => {
  for (const ok of ['site', 'Meu Projeto', 'app-2026', 'loja_da_maria', 'açaí']) assert.equal(nameError(ok), null, ok);
  for (const bad of ['COM¹', 'lpt³', '', '   ', '.', '..', 'a/b', 'a\\b', '../fora', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'fim.', 'CON', 'nul', 'com1', 'LPT9.txt', 'a\u0001b', 'x'.repeat(81), 42, null]) {
    assert.equal(nameError(bad), 'bad-name', String(bad));
  }
});

test('createProject never writes over a config.json whose projects it cannot read', () => {
  const [parent, sm] = dirs();
  try {
    writeFileSync(join(sm, 'config.json'), JSON.stringify({ projects: [{ important: 'data' }] }));
    assert.deepEqual(createProject(sm, { parent, name: 'novo' }), { ok: false, error: 'config-unreadable' });
    assert.deepEqual(config(sm), { projects: [{ important: 'data' }] });
    assert.throws(() => statSync(join(parent, 'novo')));
  } finally { clean(parent, sm); }
});

test('createProject takes the folder back when config.json cannot be written', () => {
  const [parent, sm] = dirs();
  try {
    // A folder where writeAtomic puts its temporary file: the write fails after the project folder was made.
    mkdirSync(join(sm, `config.json.${process.pid}.tmp`));
    assert.deepEqual(createProject(sm, { parent, name: 'novo' }), { ok: false, error: 'config-unreadable' });
    assert.throws(() => statSync(join(parent, 'novo')));
  } finally { clean(parent, sm); }
});

test('createProject refuses a bad name before touching the disk', () => {
  const [parent, sm] = dirs();
  try {
    assert.deepEqual(createProject(sm, { parent, name: '../fora' }), { ok: false, error: 'bad-name' });
    assert.throws(() => statSync(join(sm, 'config.json')));
  } finally { clean(parent, sm); }
});

test('suggestParent picks the folder most projects live in, or the home folder', () => {
  const dev = join(tmpdir(), 'dev');
  assert.equal(suggestParent([join(dev, 'a'), join(dev, 'b'), join(tmpdir(), 'x', 'c')], { home: 'casa' }), dev);
  assert.equal(suggestParent([], { home: 'casa' }), 'casa');
});

test('createdRoots lists only the folders session-map created', () => {
  assert.deepEqual(createdRoots({ projects: { a: { tidy: true }, b: { created: { root: 'C:\\dev\\b', at: 'x' } }, c: { created: 'bad' } } }), ['C:\\dev\\b']);
  assert.deepEqual(createdRoots(null), []);
});
