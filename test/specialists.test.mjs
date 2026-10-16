import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArch, partRules } from '../server/arch/parse.mjs';
import { CONFIG, agentSpecs, deriveSpecialists, isTestFile, shortAbout, specialistCard, specialistForFiles } from '../server/ai/specialists.mjs';

// The domain specialists (id158, or68): derived from the architecture map, never written by hand.

const PART = (name, about, paths, rules) => [
  `# ${name}`, '', about, '',
  '## Where in the code', '', ...paths.map((p) => `- \`${p}\``), '',
  ...(rules ? ['## Rules that must not break', '', ...rules, ''] : []),
  "## What's missing", '', '- [ ] **Claude:** Something `xx01`', '',
].join('\n');

const FILES = {
  'README.md': '# Parts\n\n## Engine\n\n- [Alpha](alpha.md)\n- [Beta](beta.md)\n',
  'alpha.md': PART('Alpha', 'Alpha does the first thing. It also does more.', ['server/alpha/', 'server/alpha.mjs'], ['- Never write to the person\'s folder.', '- A rule that wraps', '  onto a second line.']),
  'beta.md': PART('Beta', 'Beta reads files.', ['server/beta/'], null),
  'ideas.md': ['# Ideas and requests', '', '## Where in the code', '', '- `server/ideas/`', '', "## What's missing", '',
    '- [ ] An idea `id01`', '  - Asked: 2026-10-15 — "one"', '- [ ] Another `id02`', '  - Asked: 2026-10-15 — "two"', ''].join('\n'),
};
const arch = () => parseArch('docs/architecture', FILES, 'worktree');
const readPart = (p) => FILES[p.file.split('/').pop()];

test('partRules reads the bullets, joins a wrapped one, knows the Portuguese heading, and is empty without the section', () => {
  assert.deepEqual(partRules(FILES['alpha.md']), ["Never write to the person's folder.", 'A rule that wraps onto a second line.']);
  assert.deepEqual(partRules('# X\n\n## Regras que não podem quebrar\n\n- Uma regra.\n\n## O que falta\n'), ['Uma regra.']);
  assert.deepEqual(partRules(FILES['beta.md']), []);
});

test('a code part becomes a specialist; the registry of requests does not', () => {
  const files = ['server/alpha/a.mjs', 'server/alpha.mjs', 'server/beta/b.mjs', 'test/alpha-a.test.mjs', 'test/beta-b.test.mjs', 'test/fixtures/x.json'];
  const list = deriveSpecialists({ arch: arch(), readPart, files, testCommand: 'node --test' });
  assert.deepEqual(list.map((s) => s.id), ['sm-alpha', 'sm-beta']);
  const [alpha, beta] = list;
  assert.deepEqual([...alpha.owns], ['server/alpha/', 'server/alpha.mjs']);
  assert.equal(alpha.rules.length, 2);
  assert.deepEqual([...alpha.tests], ['test/alpha-a.test.mjs']);
  assert.deepEqual([...beta.tests], ['test/beta-b.test.mjs']);
  assert.equal(alpha.about, 'Alpha does the first thing.');
});

test('isTestFile and shortAbout', () => {
  assert.ok(isTestFile('test/a-b.test.mjs') && isTestFile('src/x_test.go') && isTestFile('a.spec.ts'));
  assert.ok(!isTestFile('test/fixtures/data.json') && !isTestFile('server/a.mjs'));
  assert.equal(shortAbout('One.  Two\nthree.'), 'One.');
  assert.ok(shortAbout('x'.repeat(500)).length <= 220);
});

test('the card carries ownership, the rules, the proof and the method, and stays under its ceiling however large the part', () => {
  const [alpha] = deriveSpecialists({ arch: arch(), readPart, files: ['server/alpha/a.mjs', 'test/alpha-a.test.mjs'], testCommand: 'node --test' });
  const card = specialistCard(alpha);
  assert.match(card, /You own the "Alpha" part/);
  assert.match(card, /- server\/alpha\//);
  assert.match(card, /Rules that must not break/);
  assert.match(card, /Proof: 1 test file cover/);
  assert.match(card, /`node --test <files>`/);
  assert.match(card, /code\/test: 1\) define done/);
  const big = { ...alpha, owns: Array.from({ length: 40 }, (_, i) => `server/area${i}/`), rules: Array.from({ length: 30 }, (_, i) => `Rule number ${i}: ${'long '.repeat(80)}`), tests: Array.from({ length: 200 }, (_, i) => `test/some-long-test-name-${i}.test.mjs`) };
  assert.ok(Buffer.byteLength(specialistCard(big)) <= CONFIG.cardMaxBytes);
  assert.match(specialistCard({ ...alpha, tests: [] }), /the map maps no test file to your part/);
});

test('files route to the specialist of the part that owns most of them', () => {
  const a = arch();
  const list = deriveSpecialists({ arch: a, readPart, files: [] });
  assert.equal(specialistForFiles(['server/beta/b.mjs'], a, list)?.id, 'sm-beta');
  assert.equal(specialistForFiles(['server/alpha/a.mjs', 'server/alpha.mjs', 'server/beta/b.mjs'], a, list)?.id, 'sm-alpha');
  assert.equal(specialistForFiles(['somewhere/else.mjs'], a, list), null);
});

test('the agent specs: builders on the code row of the policy, the native roles with the tools of their role', () => {
  const list = deriveSpecialists({ arch: arch(), readPart, files: [] });
  const level = (kind) => ({ code: { model: 'sonnet', effort: 'medium' }, search: { model: 'haiku', effort: 'low' }, review: { model: 'sonnet', effort: 'medium' }, plan: { model: 'sonnet', effort: 'medium' }, architecture: { model: 'opus', effort: 'high' }, security: { model: 'opus', effort: 'high' } })[kind];
  const specs = agentSpecs({ specialists: list, level });
  const by = Object.fromEntries(specs.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(by), ['sm-alpha', 'sm-beta', 'sm-finder', 'sm-planner', 'sm-architect', 'sm-reviewer', 'sm-guardian']);
  assert.deepEqual([by['sm-alpha'].model, by['sm-alpha'].effort, by['sm-alpha'].classes], ['sonnet', 'medium', ['read', 'edit', 'shell']]);
  assert.deepEqual(by['sm-finder'].classes, ['read']);
  assert.deepEqual(by['sm-reviewer'].classes, ['read', 'shell']);
  assert.deepEqual(by['sm-guardian'].classes, ['read']);
  assert.equal(by['sm-architect'].model, 'opus');
  assert.match(by['sm-alpha'].description, /^Owner of the Alpha part\./);
  assert.ok(by['sm-alpha'].description.length <= 480);
});

test('partRules: numbered rules count, a nested bullet joins its rule, a fence is not a rule, a blank line ends a rule', () => {
  const text = [
    '# X', '', '## Rules that must not break', '',
    '1. First rule', '2) Second rule', '   with a wrapped line',
    '- Third', '  - nested a', '  - nested b', '',
    'Not a rule after a blank line.', '',
    '```', '- in a fence', '```', '',
    '- Fourth', '', "## What's missing", '', '- [ ] **Claude:** x `xx01`', '',
  ].join('\n');
  assert.deepEqual(partRules(text), ['First rule', 'Second rule with a wrapped line', 'Third nested a nested b', 'Fourth']);
});

test('the card never prints an empty list of tests, and a description is cut by characters, not in the middle of an emoji', () => {
  const [alpha] = deriveSpecialists({ arch: arch(), readPart, files: ['test/alpha-a.test.mjs'] });
  const tight = specialistCard({ ...alpha, tests: ['test/a.test.mjs'], rules: Array.from({ length: 8 }, () => 'x'.repeat(260)) }, { ...CONFIG, cardMaxBytes: 1500 });
  assert.doesNotMatch(tight, /\(, /);
  const withEmoji = { ...alpha, about: `${'a'.repeat(219)}😀 tail.` };
  const spec = agentSpecs({ specialists: [withEmoji], level: () => ({ model: 'sonnet', effort: 'medium' }) })[0];
  assert.doesNotMatch(spec.description, /[\ud800-\udbff](?![\udc00-\udfff])/, 'no lone surrogate');
});
