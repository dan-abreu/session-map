// The plan set of the measuring bench (or30): the owner's real requests, scored without a judge model. These checks keep
// the set's shape honest and prove the scorer on hand-written plans, one good and one bad.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runClaudeJSON } from '../server/ai/runner.mjs';
import { makeCaller, parseContestant } from '../server/bench/contestants.mjs';
import { PLAN_EFFORT, promptFor, runBench } from '../server/bench/run.mjs';
import { PLAN_RIGHT_AT, scoreAnswer, scorePlan } from '../server/bench/score.mjs';

const set = JSON.parse(readFileSync(new URL('../server/bench/sets/plan.json', import.meta.url), 'utf8'));
const itemOf = (id) => set.items.find((i) => i.id === id);
const task = (text, model, effort, why = '') => ({ task: text, model, effort, why });

test('plan set: header, size and shape', () => {
  assert.equal(set.kind, 'plan');
  assert.equal(set.items.length, 8);
  const ids = new Set();
  for (const item of set.items) {
    assert.match(item.id, /^pl-[a-z0-9-]+$/);
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    assert.match(item.source, /^id1(0[5-9]|1[01])$/, item.id);
    assert.ok(item.request.length > 80, item.id);
    assert.equal(typeof item.sensitive, 'boolean', item.id);
    if (item.sensitive) assert.doesNotThrow(() => new RegExp(item.sensitiveRx, 'i'), item.id);
    assert.ok(item.points.length >= 2 && item.points.length <= 3, item.id);
    for (const p of item.points) {
      assert.match(p.id, /^[a-z-]+$/);
      assert.ok(p.why.length > 10);
      assert.ok(p.all.length >= 1);
      // Portuguese and English variants: a point is never one bare word.
      assert.ok(p.all.flat().length >= 4, `${item.id}/${p.id}: too few words`);
      for (const group of p.all) {
        assert.ok(group.length >= 1);
        // The plan's text is matched without accents and in lower case, so the patterns are written that way.
        for (const rx of group) {
          assert.doesNotThrow(() => new RegExp(rx, 'i'), `${item.id}/${p.id}: ${rx}`);
          assert.equal(rx, rx.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), `${item.id}/${p.id}: ${rx}`);
        }
      }
    }
  }
  assert.ok(set.items.some((i) => i.sensitive));
  assert.ok(set.items.some((i) => !i.sensitive));
});

test('plan set: the prompt shows the request and the rules, never the points', () => {
  const { prompt, schemaHint } = promptFor('plan', itemOf('pl-conversation-book'));
  assert.match(prompt, /capitulos mais curtos/);
  assert.match(prompt, /10 agents/);
  assert.match(prompt, /approv/i);
  assert.match(prompt, /haiku/);
  assert.doesNotMatch(prompt, /chapters-from-transcript|sensitiveRx|points/);
  assert.match(schemaHint, /"tasks"/);
});

const goodBook = {
  summary: 'We show what is installed and what is in use, and cut each long conversation into short chapters from its transcript; a chapter is summarised once the conversation passes a size limit.',
  tasks: [
    task('List installed skills and plugins and mark which are in use now', 'haiku', 'low', 'mechanical listing'),
    task('Cut the conversation transcript into chapters with an index', 'sonnet', 'medium', 'plain code'),
    task('Summarise a chapter when the conversation grows past the size limit in tokens', 'sonnet', 'medium', 'logic with a threshold'),
    task('Review the book index against real conversations', 'sonnet', 'high', 'one reviewer'),
  ],
  agents: 4,
  waitsForApproval: true,
  questions: ['Which size limit do you want for a chapter?'],
};

test('scorePlan: a good plan meets every criterion', () => {
  const r = scorePlan(itemOf('pl-conversation-book'), goodBook);
  assert.deepEqual(r.missed, []);
  assert.equal(r.share, 1);
  assert.equal(r.score, 1);
  assert.equal(r.met.length, 7);
});

test('scorePlan: a good plan in Portuguese is understood too', () => {
  const r = scorePlan(itemOf('pl-conversation-book'), {
    summary: 'Mostrar o que está instalado e em uso, cortar a conversa em capítulos a partir do histórico e resumir quando passar do limite de tamanho.',
    tasks: [
      { tarefa: 'x', task: 'Listar skills e plugins instalados e os que estão em uso', model: 'Haiku', effort: 'low' },
      { task: 'Cortar a conversa em capítulos com índice', model: 'sonnet', effort: 'medium' },
      { task: 'Resumir o capítulo quando a conversa passar do limite de tamanho', model: 'sonnet', effort: 'medium' },
    ],
    agents: 3,
    waitsForApproval: true,
  });
  assert.deepEqual(r.missed, []);
  assert.equal(r.score, 1);
});

test('scorePlan: a bad plan scores low', () => {
  const r = scorePlan(itemOf('pl-conversation-book'), {
    summary: 'Done, I built it already.',
    tasks: [task('Do everything', 'gpt-5', 'max')],
    agents: 12,
    waitsForApproval: false,
  });
  assert.equal(r.score, 0);
  assert.ok(r.share < 0.3);
  for (const id of ['split', 'model-effort', 'max-agents', 'approval']) assert.ok(r.missed.includes(id), id);
});

test('scorePlan: a sensitive request needs a strong task and no guarding work on a weak one', () => {
  const item = itemOf('pl-plan-first-cheap');
  const plan = (tasks) => ({
    summary: 'Plan first with the cheapest model, then build per task with the right model; the engine enforces it as a rule.',
    tasks,
    agents: tasks.length,
    waitsForApproval: true,
  });
  const strong = scorePlan(item, plan([
    task('Write the plan with the cheapest model', 'haiku', 'low'),
    task('Enforce the spend cap in the engine', 'opus', 'high'),
    task('Wire the model per task', 'sonnet', 'medium'),
  ]));
  assert.ok(strong.met.includes('strong-on-sensitive'));
  assert.equal(strong.score, 1);
  const weakGuard = scorePlan(item, plan([
    task('Write the plan with the cheapest model', 'sonnet', 'medium'),
    task('Enforce the spend cap in the engine', 'haiku', 'low'),
    task('Wire the model per task', 'sonnet', 'medium'),
  ]));
  assert.ok(weakGuard.missed.includes('strong-on-sensitive'));
  const noStrong = scorePlan(item, plan([task('Wire the model per task', 'sonnet', 'medium'), task('Write tests', 'haiku', 'low')]));
  assert.ok(noStrong.missed.includes('strong-on-sensitive'));
  // Measuring the spend is mechanical: on a cheap model it is no weak guard.
  const measure = scorePlan(item, plan([
    task('Medir o gasto de hoje nos registros das conversas', 'haiku', 'low'),
    task('Travar o limite de gasto no motor', 'opus', 'high'),
  ]));
  assert.ok(measure.met.includes('strong-on-sensitive'));
  // A non-sensitive request does not count that criterion at all.
  assert.ok(!scorePlan(itemOf('pl-conversation-book'), goodBook).met.includes('strong-on-sensitive'));
});

test('scorePlan: more than 10 tasks or agents, or no approval, each fail their own criterion', () => {
  const item = itemOf('pl-conversation-book');
  const many = Array.from({ length: 11 }, (_, i) => task(`step ${i}`, 'sonnet', 'medium'));
  assert.ok(scorePlan(item, { ...goodBook, tasks: many }).missed.includes('max-agents'));
  assert.ok(scorePlan(item, { ...goodBook, agents: 11 }).missed.includes('max-agents'));
  assert.ok(scorePlan(item, { ...goodBook, waitsForApproval: false }).missed.includes('approval'));
  // The field missing: the text may still say it waits.
  const { waitsForApproval, ...noField } = goodBook;
  assert.ok(scorePlan(item, noField).missed.includes('approval'));
  assert.ok(scorePlan(item, { ...noField, summary: `${goodBook.summary} Nothing is built until you approve.` }).met.includes('approval'));
  // Naming the approval is not waiting for it.
  for (const said of ['Do not wait for approval; start implementing now.', 'Não precisa esperar a aprovação, já começo.']) {
    assert.ok(scorePlan(item, { ...noField, summary: said }).missed.includes('approval'), said);
  }
  // An infinite agent count is over the limit; a count that is no number is left to the task list.
  assert.ok(scorePlan(item, { ...goodBook, agents: 1e309 }).missed.includes('max-agents'));
  assert.ok(scorePlan(item, { ...goodBook, agents: 'three' }).met.includes('max-agents'));
});

test('scorePlan: the threshold is 80% and an answer without tasks is a bad shape', () => {
  assert.equal(PLAN_RIGHT_AT, 0.8);
  const item = itemOf('pl-conversation-book');
  // 6 of 7 is 86%: still right.
  const missesOnePoint = scorePlan(item, { ...goodBook, summary: 'Show it.', tasks: goodBook.tasks.filter((t) => !/Summarise/.test(t.task)) });
  assert.equal(missesOnePoint.missed.length, 1);
  assert.equal(missesOnePoint.score, 1);
  // 5 of 7 is 71%: wrong.
  const missesTwo = scorePlan(item, { ...goodBook, summary: 'Show it.', tasks: goodBook.tasks.slice(0, 2), agents: 13 });
  assert.equal(missesTwo.missed.length, 2);
  assert.ok(missesTwo.share < 0.8);
  assert.equal(missesTwo.score, 0);
  for (const bad of [null, 'text', {}, { tasks: 'x' }]) {
    const r = scoreAnswer('plan', item, bad);
    assert.equal(r.score, 0);
    assert.equal(r.badShape, true);
  }
});

test('a plan call asks each Claude level at its own effort, and the runner passes it to the CLI', async () => {
  assert.deepEqual({ ...PLAN_EFFORT }, { haiku: 'low', sonnet: 'medium', opus: 'high' });
  const seen = [];
  const caller = makeCaller({ smDir: '/sm', runClaude: async (p, opts) => { seen.push(opts); return { ok: true, value: {}, costUSD: 0 }; } });
  await caller(parseContestant('claude:opus'), 'p', '{}', { effort: 'high' });
  await caller(parseContestant('claude:opus'), 'p', '{}');
  assert.equal(seen[0].effort, 'high');
  assert.ok(!('effort' in seen[1]));
  // runBench passes the effort for plan items only, and never to an outside AI.
  const root = mkdtempSync(join(tmpdir(), 'sm-bench-plan-'));
  try {
    const asked = [];
    const call = async (c, prompt, schema, opts) => { asked.push([c.id, opts?.effort]); return { ok: true, value: goodBook, costUSD: 0 }; };
    const only = ['claude:haiku', 'claude:sonnet', 'claude:opus', 'openai:gpt-6-luna'];
    const out = await runBench({ smDir: join(root, 'sm'), kinds: ['plan'], limit: 1, only, runId: 'effort-test' }, { call, keyedProviders: ['openai'] });
    assert.deepEqual(asked.sort(), [['claude:haiku', 'low'], ['claude:opus', 'high'], ['claude:sonnet', 'medium'], ['openai:gpt-6-luna', undefined]]);
    assert.equal(out.rows.length, 4);
    assert.ok(out.rows.every((r) => r.kind === 'plan' && r.tried === 1));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // The CLI gets --effort only when asked.
  const argv = [];
  const exec = async (bin, args) => { argv.push(args); return { stdout: '{"result":"{}","total_cost_usd":0}', code: 0 }; };
  const cwd = join(tmpdir(), 'sm-bench-plan-cwd');
  await runClaudeJSON('x', { cwd, bin: 'claude', effort: 'low', exec });
  await runClaudeJSON('x', { cwd, bin: 'claude', exec });
  assert.deepEqual(argv[0].slice(argv[0].indexOf('--effort'), argv[0].indexOf('--effort') + 2), ['--effort', 'low']);
  assert.ok(!argv[1].includes('--effort'));
});
