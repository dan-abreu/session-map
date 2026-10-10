import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertText, groupAlerts, summaryOf, tabTitle, wantsAlert } from '../server/web/alerts.js';
import { translator } from '../server/web/i18n.js';

const en = translator('en');
const pt = translator('pt-BR');
const done = (sessionId, extra = {}) => ({
  id: 1, kind: 'finished', reason: 'answer', projectId: 'shop-1', projectName: 'shop', sessionId, title: `Fix ${sessionId}`, origin: 'vscode',
  summary: 'The form shows the error now.', ...extra,
});

test('summaryOf: the reply on one line, without the folded blocks, cut at a whole word', () => {
  assert.equal(summaryOf('Done.\n\n```session-map\n{"doing":"x"}\n```'), 'Done.');
  const long = summaryOf(`${'word '.repeat(80)}end`);
  assert.ok(long.length <= 200 && long.endsWith('word…'));
  assert.equal(summaryOf(''), '');
});

test('summaryOf: plain words, without the marks of the reply\'s formatting', () => {
  assert.equal(summaryOf('**Short answer:** 3 items are open.\n\n**Open items:**\n- **`CFG1`: permission.** Decide.\n* [the guide](docs/a.md) _soon_\n## Next\n1. Write it'),
    'Short answer: 3 items are open. Open items: CFG1: permission. Decide. the guide soon Next Write it');
  assert.equal(summaryOf('snake_case_name and 2 * 3 stay'), 'snake_case_name and 2 * 3 stay');
});

test('groupAlerts: same kind in the same project collapse, in the order they came', () => {
  const groups = groupAlerts([done('a'), { ...done('b'), projectId: 'blog-2', projectName: 'blog' }, done('c'), { ...done('d'), kind: 'waiting', reason: 'question' }]);
  assert.deepEqual(groups.map((g) => [g.kind, g.projectName, g.alerts.map((a) => a.sessionId)]), [
    ['finished', 'shop', ['a', 'c']], ['finished', 'blog', ['b']], ['waiting', 'shop', ['d']],
  ]);
});

test('one alert says what it is, why, what to do, where it runs and the summary; every reason has all three', () => {
  const words = alertText(pt, groupAlerts([done('a')])[0]);
  assert.equal(words.title, 'Terminou · shop · VS Code');
  assert.equal(words.body, 'Fix a — The form shows the error now.');
  assert.equal(words.action, 'Abrir conversa');
  for (const reason of ['answer', 'question', 'asks', 'permission', 'stopped', 'failed', 'exited', 'restart', 'clash']) {
    const kind = { answer: 'finished', question: 'waiting', asks: 'waiting', permission: 'waiting', clash: 'clash' }[reason] ?? 'error';
    for (const t of [en, pt]) {
      const w = alertText(t, groupAlerts([done('a', { kind, reason, tool: 'Write', branches: ['x', 'y'], files: ['f.js'] })])[0]);
      for (const field of ['what', 'why', 'todo']) assert.ok(w[field] && !/[{}]|^alert\./.test(w[field]), `${reason} ${field}: ${w[field]}`);
    }
  }
});

test('a group counts and lists the titles; a clash names the branches and offers the map', () => {
  const words = alertText(en, groupAlerts([done('a'), done('b'), done('c')])[0]);
  assert.equal(words.title, '3 jobs finished · shop');
  assert.equal(words.body, 'Fix a · Fix b · Fix c');
  const clash = alertText(en, groupAlerts([{ id: 2, kind: 'clash', reason: 'clash', projectId: 'shop-1', projectName: 'shop', sessionId: null, branches: ['feat/a', 'feat/b'], files: ['src/x.js'] }])[0]);
  assert.match(clash.why, /feat\/a.*feat\/b.*src\/x\.js/);
  assert.equal(clash.action, 'See on the map');
});

test('without content (the phone): only the project and the situation, never a title or a summary', () => {
  const one = alertText(pt, groupAlerts([done('a')])[0], { content: false });
  assert.deepEqual([one.title, one.body], ['session-map · shop', 'Terminou']);
  const many = alertText(pt, groupAlerts([done('a'), done('b')])[0], { content: false });
  assert.equal(many.body, '2 trabalhos terminaram');
  for (const w of [one, many]) assert.ok(!JSON.stringify(w).includes('Fix') && !JSON.stringify(w).includes('form'));
});

test('wantsAlert follows the project choices, everything on until turned off', () => {
  assert.equal(wantsAlert({}, done('a')), true);
  assert.equal(wantsAlert({ perProject: { 'shop-1': { finished: false } } }, done('a')), false);
  assert.equal(wantsAlert({ perProject: { 'shop-1': { finished: false } } }, done('a', { kind: 'waiting' })), true);
});

test('tabTitle puts the unseen count in front', () => {
  assert.equal(tabTitle('session-map', 2), '(2) session-map');
  assert.equal(tabTitle('session-map', 0), 'session-map');
});
