import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClassifySet, classifySetPath } from '../server/bench/classify-build.mjs';
import { digestOf } from '../server/ai/digest.mjs';
import { placePrompt } from '../server/ai/place.mjs';
import { setPlacement } from '../server/placements.mjs';
import { addRemoved } from '../server/hidden.mjs';
import { projectIdOf } from '../server/paths.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (code, id2) => ({ id: code, code, title: code, status: 'todo', who: 'claude', ...(id2 ?? {}) });
const part = (pid, name, codePath, items = []) => ({
  id: pid, name, file: `docs/architecture/${pid}.md`, about: `${name} does its job.`, codePaths: [codePath],
  groups: [{ title: 'g', items: items.map((c) => item(c)) }], counts: {}, chatIds: [], workCellIds: [],
});
const ARCH = {
  source: 'worktree', dir: 'docs/architecture', lang: 'en',
  layers: [{ id: 'l', name: 'Layer', partIds: ['server', 'web'] }],
  parts: [part('server', 'Server', 'server/', ['sv01']), part('web', 'Web page', 'web/', ['wb01'])],
};
const summary = (n, extra = {}) => ({
  sessionId: id(n), cwd: ROOT, title: `chat ${n}`, userPrompts: [`work on thing ${n}`], editedFiles: [], commits: [],
  mentionedCodes: [], mentionedPaths: [], gitBranch: null, ...extra,
});

let ROOT;
let SM;
const deps = (convs, arch = ARCH) => ({
  conversations: () => convs.map((summary2) => ({ summary: summary2, helperEdits: [], card: null })),
  rootOf: () => ROOT,
  archOf: async () => arch,
  topLevelOf: () => new Set(['server', 'web', 'docs']),
  workCellsOf: async () => [],
});

test.beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'sm-bench-'));
  ROOT = join(base, 'shop');
  SM = join(base, 'sm');
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(SM, { recursive: true });
});
test.afterEach(() => rmSync(join(ROOT, '..'), { recursive: true, force: true }));

test('gold only from the owner, an item code or file ownership; never from the AI, a page or a guess', async () => {
  const convs = [
    summary(1), // placed by hand on a part
    summary(2), // placed by hand on "no part"
    summary(3, { mentionedCodes: [{ code: 'wb01', n: 2 }], userPrompts: ['finish WB01 please'] }),
    summary(4, { editedFiles: [join(ROOT, 'server', 'a.js')] }),
    summary(5), // nobody knows
    summary(6), // only the AI answered
  ];
  setPlacement(SM, id(1), { partId: 'server', title: 'My own title one' });
  setPlacement(SM, id(2), { partId: null, title: 'Nothing fits' });
  const pid = projectIdOf(ROOT);
  mkdirSync(join(SM, 'brain', pid), { recursive: true });
  writeFileSync(join(SM, 'brain', pid, 'placed.json'), JSON.stringify({ [id(6)]: { hash: 'x', partId: 'web' } }));

  const out = await buildClassifySet({ smDir: SM, deps: deps(convs) });
  const set = JSON.parse(readFileSync(classifySetPath(SM), 'utf8'));
  assert.equal(out.path, classifySetPath(SM));
  assert.equal(set.kind, 'classify');
  assert.equal(set.version, 1);
  const by = Object.fromEntries(set.items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(by).sort(), [id(1), id(2), id(3), id(4)]);
  assert.deepEqual([by[id(1)].source, by[id(1)].gold], ['owner', { partId: 'server' }]);
  assert.deepEqual([by[id(2)].source, by[id(2)].gold], ['owner', { partId: null }]);
  assert.deepEqual([by[id(3)].source, by[id(3)].gold], ['code', { partId: 'web' }]);
  assert.deepEqual([by[id(4)].source, by[id(4)].gold], ['files', { partId: 'server' }]);
  assert.equal(by[id(1)].project, pid);
  assert.match(by[id(1)].schemaHint, /partId/);
  assert.deepEqual(out.byProject[pid], { available: 4, total: 4, owner: 2, code: 1, files: 1, none: 1 });
  assert.equal(out.total, 4);
});

test('the prompt is the product\'s own, and the examples never hold the item\'s own answer', async () => {
  const convs = [summary(1, { title: 'Alpha' }), summary(2, { title: 'Beta' })];
  setPlacement(SM, id(1), { partId: 'server', title: 'Alpha placed' });
  setPlacement(SM, id(2), { partId: 'web', title: 'Beta placed' });
  await buildClassifySet({ smDir: SM, deps: deps(convs) });
  const set = JSON.parse(readFileSync(classifySetPath(SM), 'utf8'));
  const one = set.items.find((i) => i.id === id(1));
  const expected = placePrompt(digestOf(convs[0], null), ARCH, [{ title: 'Beta placed', partId: 'web' }]);
  assert.equal(one.prompt, expected);
  assert.ok(!one.prompt.includes('Alpha placed'));
});

test('a small limit still holds every kind of answer, in a stable order', async () => {
  const convs = [];
  for (let n = 1; n <= 4; n++) convs.push(summary(n, { mentionedCodes: [{ code: 'sv01', n: 1 }], userPrompts: [`sv01 step ${n}`] }));
  convs.push(summary(5, { editedFiles: [join(ROOT, 'web', 'x.js')] }), summary(6));
  setPlacement(SM, id(6), { partId: null });
  const first = await buildClassifySet({ smDir: SM, limit: 3, deps: deps(convs) });
  assert.equal(first.total, 3);
  assert.equal(first.available, 6);
  const ids = JSON.parse(readFileSync(classifySetPath(SM), 'utf8')).items.map((i) => i.id);
  assert.deepEqual(ids.sort(), [id(1), id(5), id(6)]);
  await buildClassifySet({ smDir: SM, limit: 3, deps: deps(convs.reverse()) });
  assert.deepEqual(JSON.parse(readFileSync(classifySetPath(SM), 'utf8')).items.map((i) => i.id).sort(), ids);
});

test('removed conversations, empty digests, one-part projects and other projects are left out', async () => {
  const convs = [summary(1, { mentionedCodes: [{ code: 'sv01', n: 1 }], userPrompts: ['do sv01'] }), summary(2, { mentionedCodes: [{ code: 'sv01', n: 1 }], userPrompts: ['do sv01'] }), summary(3, { userPrompts: [], mentionedCodes: [{ code: 'sv01', n: 1 }] })];
  addRemoved(SM, id(1));
  const out = await buildClassifySet({ smDir: SM, deps: deps(convs) });
  assert.deepEqual(JSON.parse(readFileSync(classifySetPath(SM), 'utf8')).items.map((i) => i.id), [id(2)]);

  const thin = { ...ARCH, parts: ARCH.parts.slice(0, 1) };
  const skipped = await buildClassifySet({ smDir: SM, deps: deps(convs, thin) });
  assert.equal(skipped.total, 0);
  assert.deepEqual(skipped.skippedProjects, [{ projectId: projectIdOf(ROOT), reason: 'fewer than two parts' }]);

  const other = await buildClassifySet({ smDir: SM, projectId: 'someone-else-000000', deps: deps(convs) });
  assert.equal(other.total, 0);
  assert.ok(out.total === 1);
});

test('a code gold is kept only when the prompt lets a reader reach it', async () => {
  const sv = [{ code: 'sv01', n: 2 }];
  const convs = [
    summary(1, { mentionedCodes: sv, userPrompts: ['finish sv01'] }), // kept
    summary(2, { mentionedCodes: sv, userPrompts: ['o que é isso?'] }), // the code is only in the replies
    summary(3, { mentionedCodes: [{ code: 'sv01', n: 1 }, { code: 'wb01', n: 1 }], userPrompts: ['sv01 and wb01'] }), // a tie
    summary(4, { mentionedCodes: sv, userPrompts: ['sv01 again'], editedFiles: [join(ROOT, 'web', 'page.js')] }), // files say web
  ];
  const out = await buildClassifySet({ smDir: SM, deps: deps(convs) });
  const ids = JSON.parse(readFileSync(classifySetPath(SM), 'utf8')).items.map((i) => i.id);
  assert.deepEqual(ids, [id(1)]);
  assert.deepEqual(out.dropped, { 'code-not-in-prompt': 1, 'code-tie': 1, 'files-disagree': 1 });
});

test('a files gold comes from the conversation\'s own edits, never from its helpers\' (the prompt does not show them)', async () => {
  const convs = [summary(1), summary(2, { editedFiles: [join(ROOT, 'server', 'a.js')] })];
  const d = deps(convs);
  d.conversations = () => convs.map((s) => ({ summary: s, helperEdits: [join(ROOT, 'web', 'helper.js')], card: null }));
  await buildClassifySet({ smDir: SM, deps: d });
  const items = JSON.parse(readFileSync(classifySetPath(SM), 'utf8')).items;
  assert.deepEqual(items.map((i) => [i.id, i.gold.partId]), [[id(2), 'server']]);
});

test('two items with the very same digest and different gold are both left out', async () => {
  const same = { title: 'o que seria isso?', userPrompts: ['o que seria isso?'] };
  const convs = [summary(1, same), summary(2, same), summary(3, { title: 'other' })];
  setPlacement(SM, id(1), { partId: 'server' });
  setPlacement(SM, id(2), { partId: 'web' });
  setPlacement(SM, id(3), { partId: 'web' });
  const out = await buildClassifySet({ smDir: SM, deps: deps(convs) });
  assert.deepEqual(JSON.parse(readFileSync(classifySetPath(SM), 'utf8')).items.map((i) => i.id), [id(3)]);
  assert.equal(out.dropped['same-prompt-other-gold'], 2);
});
