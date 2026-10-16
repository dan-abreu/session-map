import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, planNamedIn } from '../server/plans.mjs';

// The plans engine (id133, or44): the superpowers writing-plans refinement, validated mechanically.

const good = `# The blue button

What it is, for an engineer who never saw this codebase.

## File Structure

- \`server/web/blue.js\` — draws the button.

### Task 1: the button appears

Files: \`server/web/blue.js\`, \`server/web/index.html\`.

Test: \`node --test test/web-blue.test.mjs\` green.

### Task 2: the click does it

Files: \`server/web/blue.js\`.

Tests: \`test/web-blue.test.mjs\` covers the click.
`;

test('a complete plan parses: title, tasks, each naming files and its proof', () => {
  const p = parsePlan(good);
  assert.equal(p.ok, true);
  assert.equal(p.tasks, 2);
  assert.equal(p.title, 'The blue button');
});

test('a plan without a title, without tasks, or a task without a file or a proof fails with the reason', () => {
  assert.deepEqual(parsePlan('no title here\n### Task 1\nFiles: `a.js`\nTest: `x.test.mjs`').errors[0], 'sem título: a primeira linha precisa começar com "# " e o nome do plano');
  assert.match(parsePlan('# Only a title').errors.join(' '), /sem tarefas/);
  assert.match(parsePlan('# T\n### Task 1\nFiles: `a.js`\nSem prova.').errors.join(' '), /sem prova/);
  assert.match(parsePlan('# T\n### Task 1\nTest: `x.test.mjs`\nSem arquivo.').errors.join(' '), /sem arquivo/);
});

test('the workflow text names the plan, with or without the docs/superpowers prefix', () => {
  assert.equal(planNamedIn('// plan: docs/superpowers/plans/2026-10-14-blue.md'), '2026-10-14-blue.md');
  assert.equal(planNamedIn('plans/2026-10-14-blue.md'), '2026-10-14-blue.md');
  assert.equal(planNamedIn('no plan here'), null);
});
