import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { estimateFix, opFromFinding } from '../server/foundation/docfix.mjs';
import { RULES, buildRuleInput } from '../server/foundation/docwatch.mjs';
import { applyOp, undoOp } from '../server/foundation/care.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { ownersOf } from '../server/arch/attach.mjs';

const ID = 'acme-shop-8324f1';
const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');

const tmp = [];
const dir = (name) => { const d = mkdtempSync(join(tmpdir(), `sm-fix-${name}-`)); tmp.push(d); return d; };
test.after(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

function put(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}
function walk(root, base = root) {
  const out = [];
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const abs = join(base, e.name);
    if (e.isDirectory()) out.push(...walk(root, abs));
    else out.push(relative(root, abs).replaceAll('\\', '/'));
  }
  return out;
}
const OWNERS = {};
function censusOf(root, owners = OWNERS) {
  return {
    version: 1,
    files: walk(root).sort().map((path) => ({
      path, type: path.split('.').pop(), kind: path.endsWith('.md') ? 'doc' : 'code', included: true, reason: null,
      bytes: 1, sha: `sha-${path}`, owner: owners[path] ?? null, lines: { total: 1, code: 1, comment: 0, blank: 0 },
    })),
  };
}
function repo(files) {
  const root = dir('repo');
  execFileSync('git', ['init', '-q'], { cwd: root, windowsHide: true });
  put(root, files);
  return root;
}
const route = (method, path, file = 'apps/api/src/orders.ts', line = 3) => ({
  id: `route:${method} ${path}`, kind: 'route', name: `${method} ${path}`, file, line, sha: 'a1', origin: 'EXTRACTED',
  attrs: { method, path, framework: 'fastify' }, refs: [],
});
const factsOf = (...list) => ({ version: 1, facts: list });

async function inputFor(root, extra = {}) {
  const smDir = extra.smDir ?? dir('sm');
  const built = await buildRuleInput({ root, census: censusOf(root, extra.owners), facts: factsOf(), ...extra });
  return { ...built, smDir, ...extra, docs: built.docs };
}
const findings = (input, rule) => RULES.flatMap((r) => r.run(input)).filter((f) => f.rule === rule);

const hashTree = (root) => {
  const h = createHash('sha256');
  for (const p of walk(root).sort()) h.update(p).update('\0').update(readFileSync(join(root, p)));
  return h.digest('hex');
};
const lines = (n, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

// ---------- doc-size: split ----------

test('a long README is split by the program: the op applies, keeps every line, and Undo gives back the original bytes', async () => {
  const sections = ['Install', 'Usage', 'Rules', 'Release'].flatMap((name) => [`## ${name}`, '', ...lines(105, name), '']);
  const root = repo({ 'README.md': ['# Shop', '', 'Intro.', '', ...sections].join('\n') });
  const smDir = dir('sm');
  const input = await inputFor(root, { smDir });
  const [f] = findings(input, 'doc-size');
  assert.equal(f.fix.kind, 'split');
  const before = hashTree(root);
  const res = await opFromFinding(f, input, { ai: () => { throw new Error('the AI must not be asked'); } });
  assert.equal(res.ok, true);
  assert.equal(res.costUSD, 0);
  assert.equal(res.op.kind, 'doc-split');
  assert.equal(res.op.findingId, f.id);
  assert.equal(hashTree(root), before, 'building the op writes nothing');
  const applied = applyOp({ id: ID, root }, res.op, { smDir, mode: 'auto' });
  assert.equal(applied.status, 'applied');
  assert.equal(existsSync(join(root, 'README', 'install.md')), true);
  assert.ok(readFileSync(join(root, 'README.md'), 'utf8').length < 1000);
  const undone = undoOp({ id: ID, root }, applied.opId, { smDir, confirm: true });
  assert.equal(undone.ok, true);
  assert.equal(hashTree(root), before);
});

test('a split that the planner refuses comes back as a failure with its reason and no op', async () => {
  const root = repo({ 'README.md': ['# Shop', '', ...lines(450)].join('\n') });
  const input = await inputFor(root);
  const [f] = findings(input, 'doc-size');
  const res = await opFromFinding(f, input);
  assert.deepEqual([res.ok, res.error, res.reason], [false, 'split-failed', 'too-few-sections']);
  assert.equal(res.op, undefined);
});

// ---------- doc-size: archive ----------

const changelog = (versions, existing = []) => ['# Changelog', '', 'All notable changes.', '',
  ...Array.from({ length: versions }, (_, i) => versions - i).flatMap((n) => [`## 0.${n}.0`, '', ...lines(13, `change ${n}`), ''])].concat(existing).join('\n');

test('a long changelog moves its old versions to an archive file, keeps the newest on top, and Undo restores it', async () => {
  const root = repo({ 'CHANGELOG.md': changelog(60) });
  const smDir = dir('sm');
  const input = await inputFor(root, { smDir });
  const [f] = findings(input, 'doc-size');
  assert.equal(f.fix.kind, 'archive');
  const before = hashTree(root);
  const original = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const res = await opFromFinding(f, input);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.op.kind, 'doc-archive');
  assert.deepEqual(res.op.files.map((x) => x.path), ['CHANGELOG.md', 'CHANGELOG-archive-v0.md']);
  const [keep, archive] = res.op.files.map((x) => x.after);
  const keptLines = keep.split('\n').length;
  assert.ok(keptLines < 250, `kept ${keptLines} lines`);
  assert.match(keep, /^# Changelog\n\nAll notable changes\.\n\n## 0\.60\.0\n/);
  assert.match(keep, /\[v0\]\(CHANGELOG-archive-v0\.md\)/);
  assert.match(archive, /## 0\.1\.0\n/);
  assert.equal(archive.includes('## 0.60.0'), false);
  const union = new Set(`${keep}\n${archive}`.split('\n'));
  for (const l of original.split('\n').filter((x) => x.trim())) assert.ok(union.has(l), `lost: ${l}`);
  const applied = applyOp({ id: ID, root }, res.op, { smDir, mode: 'auto' });
  assert.equal(applied.status, 'applied');
  assert.equal(undoOp({ id: ID, root }, applied.opId, { smDir, confirm: true }).ok, true);
  assert.equal(hashTree(root), before);
});

test('archiving into an archive that already exists puts the newer entries first and keeps the old ones', async () => {
  const old = ['# CHANGELOG - v0', '', 'Entries moved out of [CHANGELOG.md](CHANGELOG.md).', '', '## 0.0.1', '', 'first', ''].join('\n');
  const root = repo({ 'CHANGELOG.md': changelog(60), 'CHANGELOG-archive-v0.md': old });
  const input = await inputFor(root);
  const [f] = findings(input, 'doc-size').filter((x) => x.target.file === 'CHANGELOG.md');
  const res = await opFromFinding(f, input);
  assert.equal(res.ok, true, JSON.stringify(res));
  const archive = res.op.files.find((x) => x.path === 'CHANGELOG-archive-v0.md').after;
  assert.ok(archive.indexOf('## 0.1.0') < archive.indexOf('## 0.0.1'), 'newer entries come before the ones archived earlier');
  assert.ok(archive.startsWith('# CHANGELOG - v0\n'));
});

test('a registry grows at the end, so archiving keeps the last entries and moves the first ones, grouped by year', async () => {
  const entries = ['2023', '2024'].flatMap((y) => Array.from({ length: 30 }, (_, i) => [`## ${y}-01-${String(i + 1).padStart(2, '0')} decision`, '', ...lines(13, `d${y}${i}`), '']).flat());
  const root = repo({ 'docs/decisions/log.md': ['# Decisions', '', ...entries].join('\n') });
  const input = await inputFor(root);
  const [f] = findings(input, 'doc-size');
  assert.equal(f.fix.kind, 'archive');
  const res = await opFromFinding(f, input);
  assert.equal(res.ok, true, JSON.stringify(res));
  const paths = res.op.files.map((x) => x.path);
  assert.deepEqual(paths, ['docs/decisions/log.md', 'docs/decisions/log-archive-2023.md', 'docs/decisions/log-archive-2024.md']);
  const [keep, archive] = res.op.files.map((x) => x.after);
  assert.ok(keep.includes('2024-01-30 decision'));
  assert.equal(keep.includes('2023-01-01 decision'), false);
  assert.ok(archive.includes('2023-01-01 decision'));
  assert.match(keep, /\[2023\]\(log-archive-2023\.md\) · \[2024\]\(log-archive-2024\.md\)/);
});

test('archiving is refused when another document links to an entry that would move', async () => {
  const root = repo({ 'CHANGELOG.md': changelog(60), 'docs/notes.md': 'See [the first release](../CHANGELOG.md#010).\n' });
  const input = await inputFor(root);
  const [f] = findings(input, 'doc-size');
  const res = await opFromFinding(f, input);
  assert.deepEqual([res.ok, res.error], [false, 'archive-failed']);
  assert.equal(res.reason, 'new-broken-link');
});

test('the summary and the manual kinds have nothing the program can fix', async () => {
  const root = repo({ 'README.md': '# Shop\n' });
  const input = await inputFor(root);
  for (const kind of ['summary', 'manual']) {
    const f = { id: 'f:aaaaaaaaaaaa', rule: 'doc-size', target: { file: 'README.md', line: 1 }, evidence: [], what: { msg: 'm', params: {} }, fix: { kind, opId: null } };
    const res = await opFromFinding(f, input);
    assert.deepEqual([res.ok, res.error], [false, 'no-fix'], kind);
  }
});

// ---------- owner-missing ----------

const archDocs = {
  'docs/architecture/README.md': '# Architecture\n',
  'docs/architecture/api.md': '# API\n\nThe API.\n\n## Where in the code\n\n- `apps/api/src/`\n\n## What is missing\n\n- [ ] **Important:** tests `a1`\n',
  'docs/architecture/web.md': '# Web\n\nThe site.\n\n## Where in the code\n\n- `apps/web/src/`\n',
};
const archOf = (root) => {
  const files = {};
  for (const n of ['README.md', 'api.md', 'web.md']) files[n] = readFileSync(join(root, 'docs/architecture', n), 'utf8');
  return parseArch('docs/architecture', files);
};
const ownerRepo = (extra = {}) => repo({
  ...archDocs,
  'apps/api/package.json': '{}', 'apps/api/src/a.ts': 'a', 'apps/api/newdir/x.ts': 'x',
  'apps/web/package.json': '{}', 'apps/web/src/w.ts': 'w',
  ...extra,
});
const OWNED = { 'apps/api/src/a.ts': 'api', 'apps/web/src/w.ts': 'web', 'apps/api/package.json': 'api', 'apps/web/package.json': 'web' };

test('an unowned folder next to files of ONE part is added to that part under "Where in the code"', async () => {
  const root = ownerRepo();
  const input = await inputFor(root, { owners: OWNED, arch: archOf(root) });
  const [f] = findings(input, 'owner-missing');
  assert.equal(f.target.file, 'apps/api/newdir');
  const res = await opFromFinding(f, input, { ai: () => { throw new Error('no AI for this'); } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.costUSD, 0);
  assert.deepEqual(res.op.files.map((x) => x.path), ['docs/architecture/api.md']);
  const after = res.op.files[0].after;
  const before = readFileSync(join(root, 'docs/architecture/api.md'), 'utf8');
  assert.equal(after.split('\n').length, before.split('\n').length + 1);
  assert.match(after, /- `apps\/api\/src\/`\n- `apps\/api\/newdir\/`\n/);
  const files = Object.fromEntries(['README.md', 'api.md', 'web.md'].map((n) => [n, n === 'api.md' ? after : readFileSync(join(root, 'docs/architecture', n), 'utf8')]));
  assert.deepEqual(ownersOf(['apps/api/newdir/x.ts'], parseArch('docs/architecture', files)), ['api']);
});

test('a folder whose neighbours belong to two parts, or to none, is not fixed by guessing', async () => {
  const root = ownerRepo({ 'apps/api/lib/b.ts': 'b' });
  const two = await inputFor(root, { owners: { ...OWNED, 'apps/api/lib/b.ts': 'web' }, arch: archOf(root) });
  const res = await opFromFinding(findings(two, 'owner-missing').find((x) => x.target.file === 'apps/api/newdir'), two);
  assert.deepEqual([res.ok, res.error, res.reason], [false, 'no-fix', 'several-owners']);
  const none = await inputFor(root, { owners: {}, arch: archOf(root) });
  const res2 = await opFromFinding(findings(none, 'owner-missing')[0], none);
  assert.deepEqual([res2.ok, res2.error, res2.reason], [false, 'no-fix', 'no-owner']);
});

test('a part with no "Where in the code" section cannot take the folder', async () => {
  const root = ownerRepo({ 'docs/architecture/api.md': '# API\n\nThe API.\n' });
  const input = await inputFor(root, { owners: OWNED, arch: archOf(root) });
  const res = await opFromFinding(findings(input, 'owner-missing')[0], input);
  assert.deepEqual([res.ok, res.error, res.reason], [false, 'no-fix', 'no-code-section']);
});

// ---------- the AI route ----------

const API_DOC = ['# API', '', 'Routes of the shop.', '', '- `GET /orders` lists them', '- `GET /purchases` lists the new ones', '', ...lines(10, 'note')].join('\n');
const shopRepo = (extra = {}) => repo({
  'README.md': '# Shop\n\nUNIQUE-README-MARKER\n',
  'docs/api.md': API_DOC,
  'apps/api/src/orders.ts': 'export const a = 1;\nexport const b = 2;\nexport const route = "/purchases";\n',
  ...extra,
});
const shopInput = async (root, extra = {}) => inputFor(root, { facts: factsOf(route('GET', '/purchases')), ...extra });
const citeFinding = (input) => findings(input, 'doc-cites-missing').find((f) => f.target.file === 'docs/api.md');
const goodAfter = API_DOC.replace('- `GET /orders` lists them\n', '').replace('- `GET /orders` lists them', '');
const fakeAi = (value, extra = {}) => {
  const calls = [];
  const ai = async (prompt, opts) => { calls.push({ prompt, opts }); return typeof value === 'function' ? value(prompt, opts) : { ok: true, value, costUSD: 0.02, ...extra }; };
  return { ai, calls };
};

test('a good AI answer becomes a doc-update op, after the program checked it', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const f = citeFinding(input);
  assert.ok(f, 'the old route is a finding');
  const { ai, calls } = fakeAi({ after: goodAfter });
  const res = await opFromFinding(f, input, { ai });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.costUSD, 0.02);
  assert.equal(res.op.kind, 'doc-update');
  assert.equal(res.op.sensitive, false);
  assert.equal(res.op.findingId, f.id);
  assert.deepEqual(res.op.files, [{ path: 'docs/api.md', after: goodAfter }]);
  assert.deepEqual(res.op.why, { msg: f.what.msg, params: f.what.params });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.model, 'sonnet');
  assert.match(calls[0].opts.schemaHint, /after/);
});

test('the prompt holds the finding document and its evidence, and no other document', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const { ai, calls } = fakeAi({ after: goodAfter });
  await opFromFinding(citeFinding(input), input, { ai });
  const prompt = calls[0].prompt;
  assert.ok(prompt.includes('- `GET /orders` lists them'));
  assert.ok(prompt.includes('GET /orders'));
  assert.ok(prompt.includes('GET /purchases'), 'the facts that exist now are listed');
  assert.equal(prompt.includes('UNIQUE-README-MARKER'), false);
});

test('config.ai.fixModel chooses the model', async () => {
  const root = shopRepo();
  const input = await shopInput(root, { config: { ai: { fixModel: 'haiku' } } });
  const { ai, calls } = fakeAi({ after: goodAfter });
  await opFromFinding(citeFinding(input), input, { ai });
  assert.equal(calls[0].opts.model, 'haiku');
});

test('an answer that still cites the old route is refused, and nothing is offered', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: API_DOC.replace('lists the new ones', 'lists the new ones (GET /orders was kept)') }).ai });
  assert.deepEqual([res.ok, res.error], [false, 'still-present']);
  assert.equal(res.op, undefined);
});

test('an answer that swaps the old route for another route that does not exist is refused as a new finding', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: API_DOC.replace('GET /orders', 'GET /bought') }).ai });
  assert.deepEqual([res.ok, res.error], [false, 'new-finding']);
});

test('an answer that points at another file is refused', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  for (const extra of [{ files: [{ path: 'README.md', after: 'x' }] }, { path: 'README.md' }]) {
    const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: goodAfter, ...extra }).ai });
    assert.deepEqual([res.ok, res.error], [false, 'other-file']);
  }
});

test('an answer that adds a secret is refused', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
  const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: `${goodAfter}\nDeploy with ${token}\n` }).ai });
  assert.deepEqual([res.ok, res.error], [false, 'new-secret']);
});

test('an answer that adds a link to nothing is refused', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: `${goodAfter}\nSee [more](docs/missing.md).\n` }).ai });
  assert.deepEqual([res.ok, res.error], [false, 'new-broken-link']);
  const fine = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: `${goodAfter}\nSee [home](../README.md).\n` }).ai });
  assert.equal(fine.ok, true, JSON.stringify(fine));
});

test('an answer that rewrites more than 40% of the lines is refused', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const rewritten = API_DOC.split('\n').map((l, i) => (i < 12 ? `rewritten ${i}` : l)).join('\n').replace('rewritten 4', '- `GET /purchases` lists them');
  const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: rewritten }).ai });
  assert.deepEqual([res.ok, res.error], [false, 'too-many-changes']);
});

test('an answer that changes more than 200 lines is refused even when that is under 40%', async () => {
  const big = ['# API', '', '- `GET /orders` lists them', ...lines(997, 'row')].join('\n');
  const root = shopRepo({ 'docs/api.md': big });
  const input = await shopInput(root);
  const f = citeFinding(input);
  const after = big.split('\n').map((l, i) => (i >= 3 && i < 260 ? `changed ${i}` : l)).join('\n').replace('- `GET /orders` lists them\n', '');
  const res = await opFromFinding(f, input, { ai: fakeAi({ after }).ai });
  assert.deepEqual([res.ok, res.error], [false, 'too-many-changes']);
});

test('a document over 60 KB is refused before the AI is asked', async () => {
  const root = shopRepo({ 'docs/api.md': `- \`GET /orders\` lists them\n${'x'.repeat(100).concat('\n').repeat(700)}` });
  const input = await shopInput(root);
  const { ai, calls } = fakeAi({ after: 'y' });
  const res = await opFromFinding(citeFinding(input), input, { ai });
  assert.deepEqual([res.ok, res.error], [false, 'doc-too-big']);
  assert.equal(calls.length, 0);
});

test('a failure of the AI is reported as such, with its reason', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi(() => ({ ok: false, error: 'timeout' })).ai });
  assert.deepEqual([res.ok, res.error, res.reason], [false, 'ai-failed', 'timeout']);
});

test('an answer without the document, or equal to it, is refused', async () => {
  const root = shopRepo();
  const input = await shopInput(root);
  for (const [value, error] of [[{}, 'bad-output'], [{ after: '' }, 'bad-output'], [{ after: 42 }, 'bad-output'], [{ after: API_DOC }, 'no-change']]) {
    const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi(value).ai });
    assert.deepEqual([res.ok, res.error], [false, error], JSON.stringify(value));
  }
});

test('secrets in the document never reach the AI, and come back untouched in the result', async () => {
  const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
  const doc = `${API_DOC}\nDeploy token (example): ${token}\n`;
  const root = shopRepo({ 'docs/api.md': doc });
  const input = await shopInput(root);
  const { ai, calls } = fakeAi((prompt) => {
    assert.equal(prompt.includes(token), false, 'the token must be masked in the prompt');
    const masked = prompt.split('\n').filter((l) => l.startsWith('Deploy token'));
    assert.equal(masked.length, 1);
    return { ok: true, value: { after: `${goodAfter}\n${masked[0]}\n` }, costUSD: 0 };
  });
  const res = await opFromFinding(citeFinding(input), input, { ai });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.op.files[0].after.includes(`Deploy token (example): ${token}`));
});

test('the line ending and the final newline of the document are kept', async () => {
  const crlf = `${API_DOC.replaceAll('\n', '\r\n')}\r\n`;
  const root = shopRepo({ 'docs/api.md': crlf });
  const input = await shopInput(root);
  const res = await opFromFinding(citeFinding(input), input, { ai: fakeAi({ after: `${goodAfter}` }).ai });
  assert.equal(res.ok, true, JSON.stringify(res));
  const after = res.op.files[0].after;
  assert.equal(after.includes('\r\n'), true);
  assert.equal(/[^\r]\n/.test(after), false);
  assert.equal(after.endsWith('\r\n'), true);
});

test('without an injected AI the default runner asks the claude command and reads its JSON', async () => {
  const root = shopRepo();
  const smDir = dir('sm');
  const input = await shopInput(root, { smDir });
  const reply = JSON.stringify({ result: JSON.stringify({ after: goodAfter }), total_cost_usd: 0.03 });
  const res = await opFromFinding(citeFinding(input), input, { bin: FAKE_CLAUDE, env: { ...process.env, FAKE_REPLY: reply } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.costUSD, 0.03);
  assert.equal(res.op.files[0].after, goodAfter);
});

test('a finding of a file that is not a document, or one the watcher does not know, has no fix', async () => {
  const root = shopRepo({ 'package.json': '{"version":"1.0.0"}' });
  const input = await shopInput(root);
  const base = { id: 'f:bbbbbbbbbbbb', evidence: [], what: { msg: 'm', params: {} }, fix: { kind: 'ai-update', opId: null } };
  const a = await opFromFinding({ ...base, rule: 'version-mismatch', target: { file: 'package.json', line: 2 } }, input, { ai: fakeAi({ after: 'x' }).ai });
  assert.deepEqual([a.ok, a.error, a.reason], [false, 'no-fix', 'not-a-document']);
  const b = await opFromFinding({ ...base, rule: 'doc-cites-missing', target: { file: 'docs/ghost.md', line: 2 } }, input, { ai: fakeAi({ after: 'x' }).ai });
  assert.deepEqual([b.ok, b.error], [false, 'doc-missing']);
  const c = await opFromFinding({ ...base, rule: 'made-up', target: { file: 'docs/api.md', line: 2 } }, input, { ai: fakeAi({ after: 'x' }).ai });
  assert.deepEqual([c.ok, c.error], [false, 'no-fix']);
  const d = await opFromFinding(null, input);
  assert.deepEqual([d.ok, d.error], [false, 'bad-finding']);
});

test('code without a document asks the AI to update the document of the part that owns the file', async () => {
  const orders = ['# Orders', '', 'The orders part.', '', '## Where in the code', '', '- `apps/api/src/`', ''].join('\n');
  const root = shopRepo({
    'docs/architecture/README.md': '# Architecture\n',
    'docs/architecture/orders.md': orders,
  });
  const arch = parseArch('docs/architecture', { 'README.md': '# Architecture\n', 'orders.md': orders });
  const input = await shopInput(root, { facts: factsOf(route('GET', '/refunds')), owners: { 'apps/api/src/orders.ts': 'orders' }, arch });
  const f = findings(input, 'code-without-doc').find((x) => x.target.file === 'apps/api/src/orders.ts');
  assert.ok(f);
  const after = orders.replace('- `apps/api/src/`', '- `apps/api/src/`\n\nRoutes: `GET /refunds` lists the refunds.');
  const { ai, calls } = fakeAi({ after });
  const res = await opFromFinding(f, input, { ai });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.op.files.map((x) => x.path), ['docs/architecture/orders.md']);
  assert.ok(calls[0].prompt.includes('GET /refunds'), 'the facts of the code file are in the prompt');
  assert.ok(calls[0].prompt.includes('export const route'), 'so is the evidence line of the code');
  const lone = await shopInput(root, { facts: factsOf(route('GET', '/refunds')), arch });
  const f2 = findings(lone, 'code-without-doc').find((x) => x.target.file === 'apps/api/src/orders.ts');
  const none = await opFromFinding(f2, lone, { ai });
  assert.deepEqual([none.ok, none.error, none.reason], [false, 'no-fix', 'no-doc-target']);
});

// ---------- estimateFix ----------

test('estimateFix is zero for the program, and grows with the document and the model for the AI', () => {
  const ai = { rule: 'doc-cites-missing', fix: { kind: 'ai-update' } };
  assert.equal(estimateFix({ rule: 'doc-size', fix: { kind: 'split' } }), 0);
  assert.equal(estimateFix({ rule: 'owner-missing', fix: { kind: 'owner' } }), 0);
  const small = estimateFix(ai, { bytes: 2000 });
  const large = estimateFix(ai, { bytes: 40_000 });
  assert.ok(small > 0 && large > small);
  assert.ok(estimateFix(ai, { bytes: 20_000, model: 'haiku' }) < estimateFix(ai, { bytes: 20_000 }));
  assert.ok(estimateFix(ai, { bytes: 20_000, model: 'opus' }) > estimateFix(ai, { bytes: 20_000 }));
  assert.ok(estimateFix(ai) > 0, 'a guess is made when the size is not known');
  assert.ok(estimateFix(ai, { bytes: 40_000 }) < 1, 'a 40 KB document costs well under a dollar');
});

// ---------- the motor route (fd23): version and count swaps, no AI ----------

const noAi = () => { throw new Error('the motor must not ask the AI'); };

test('a version mismatch in the README is swapped by the motor: no AI, no cost, the judge checks it', async () => {
  const root = repo({ 'README.md': '# Shop\n\nVersion: 1.2.0\n', 'package.json': '{"name":"shop","version":"1.3.0"}' });
  const input = await inputFor(root);
  const [f] = findings(input, 'version-mismatch');
  assert.ok(f, 'the README names an old version');
  assert.deepEqual([f.what.params.found, f.what.params.expected], ['1.2.0', '1.3.0']);
  const res = await opFromFinding(f, input, { ai: noAi });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.costUSD, 0);
  assert.equal(res.op.kind, 'doc-update');
  assert.deepEqual(res.op.files, [{ path: 'README.md', after: '# Shop\n\nVersion: 1.3.0\n' }]);
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# Shop\n\nVersion: 1.2.0\n', 'building the op writes nothing');
});

test('a "12 routes" count is swapped to the code count by the motor: no AI, no cost', async () => {
  const root = repo({ 'README.md': '# Shop\n\nThe API has 12 routes.\n', 'apps/api/src/orders.ts': 'export const a = 1;\n' });
  const input = await inputFor(root, { facts: factsOf(route('GET', '/a'), route('POST', '/b')) });
  const [f] = findings(input, 'docs-disagree');
  assert.ok(f, 'the README counts 12 routes, the code has 2');
  assert.deepEqual([f.what.params.claimed, f.what.params.count], [12, 2]);
  const res = await opFromFinding(f, input, { ai: noAi });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.costUSD, 0);
  assert.deepEqual(res.op.files, [{ path: 'README.md', after: '# Shop\n\nThe API has 2 routes.\n' }]);
});

test('when the finding line does not hold the found version, the AI route is tried', async () => {
  const root = repo({ 'README.md': '# Shop\n\nVersion: 1.2.0\n', 'package.json': '{"name":"shop","version":"1.3.0"}' });
  const input = await inputFor(root);
  const [f] = findings(input, 'version-mismatch');
  const { ai, calls } = fakeAi({ after: '# Shop\n\nVersion: 1.3.0\n' });
  const wrong = { ...f, target: { file: f.target.file, line: 1 } };
  const res = await opFromFinding(wrong, input, { ai });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.length, 1, 'the motor could not, the AI tried');
});

test('a diagram-node disagreement has no motor: the AI route is tried', async () => {
  const root = repo({ 'README.md': '# Shop\n\nText.\n\nMore text.\n' });
  const input = await inputFor(root);
  const f = { id: 'f:cccccccccccc', rule: 'docs-disagree', target: { file: 'README.md', line: 1 }, evidence: [], what: { msg: 'm', params: { node: 'X', a: 'README.md', b: 'parts', what: 'X' } }, fix: { kind: 'ai-update', opId: null } };
  const { ai, calls } = fakeAi({ after: '# Shop\n\nText.\n\nMore text.\n\n' });
  const res = await opFromFinding(f, input, { ai });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.length, 1);
});

test('estimateFix is zero for the motor rules; a diagram node still goes to the AI', () => {
  assert.equal(estimateFix({ rule: 'version-mismatch', fix: { kind: 'ai-update' } }), 0);
  assert.equal(estimateFix({ rule: 'docs-disagree', fix: { kind: 'ai-update' }, what: { params: { claimed: 12, count: 10, kind: 'route' } } }), 0);
  assert.ok(estimateFix({ rule: 'docs-disagree', fix: { kind: 'ai-update' }, what: { params: { node: 'X' } } }) > 0, 'a diagram node still goes to the AI');
});
