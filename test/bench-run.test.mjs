// The bench's engine (or12): runs every chosen contestant on every item in a fixed order, under a hard money cap,
// keeps the owner's conversations away from what is stored, and can pick up a stopped run. Contestants are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCli, promptFor, runBench } from '../server/bench/run.mjs';

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'sm-bench-run-'));
  const smDir = join(root, 'sm');
  const setsDir = join(root, 'sets');
  mkdirSync(setsDir, { recursive: true });
  return { root, smDir, setsDir, done: () => rmSync(root, { recursive: true, force: true }) };
}

const writeSet = (path, kind, items) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ kind, version: 1, about: 'test', items }));
};

const CLASSIFY = [
  { id: 's1', prompt: 'Place this. The owner wrote: SEGREDO-DO-DONO about the map.', schemaHint: '{"partId": "..."}', gold: { partId: 'map' } },
  { id: 's2', prompt: 'Place this other one. SEGREDO-DO-DONO again.', schemaHint: '{"partId": "..."}', gold: { partId: null } },
];
const CODE = [{
  id: 'k1', title: 'add', spec: 'Return the sum of a and b.', signature: 'export function add(a, b)',
  tests: "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from './solution.mjs';\ntest('adds', () => assert.equal(add(2, 3), 5));\n",
  reference: 'export function add(a, b) { return a + b; }',
}];
const REVIEW = [
  { id: 'r1', file: 'a.mjs', code: 'const a = 1;\nconst b = 2;\nexport const sum = a - b;\n', clean: false, bugLines: [3], bug: 'minus instead of plus' },
  { id: 'r2', file: 'b.mjs', code: 'export const one = 1;\n', clean: true, bugLines: [], bug: '' },
];
const GOOD_PT = 'Agora a lista de conversas tem uma caixa de busca. Quando você digita uma palavra, aparecem só as conversas que falam dela. Funciona com as suas conversas em menos de um segundo, e nada foi perdido ou apagado. Para experimentar, abra a lista, clique na caixa no alto e digite uma palavra que você lembra de alguma conversa. Se quiser ver tudo de novo, é só apagar o que digitou. Assim fica mais fácil achar aquela conversa antiga sem precisar rolar a tela inteira.';
const PT = [{ id: 'p1', prompt: 'Explain the search box. Answer {"text": "..."}.' }];

function allSets(env) {
  writeSet(join(env.smDir, 'bench', 'sets', 'classify.json'), 'classify', CLASSIFY);
  writeSet(join(env.setsDir, 'code.json'), 'code', CODE);
  writeSet(join(env.setsDir, 'review.json'), 'review', REVIEW);
  writeSet(join(env.setsDir, 'pt.json'), 'pt', PT);
}

// A fake that answers every kind right, and remembers who was asked what.
function perfect({ cost = 0.01, calls = [] } = {}) {
  const call = async (contestant, prompt, schemaHint) => {
    calls.push({ contestant: contestant.id, prompt, schemaHint });
    let value;
    if (prompt.includes('Place this other')) value = { partId: null, why: prompt };
    else if (prompt.includes('Place this')) value = { partId: 'map', why: prompt };
    else if (prompt.includes('Return the sum')) value = { code: '```js\nexport function add(a, b) { return a + b; }\n```' };
    else if (prompt.includes('a.mjs')) value = { bugs: [{ line: 3, why: 'minus' }] };
    else if (prompt.includes('b.mjs')) value = { bugs: [] };
    else value = { text: `${GOOD_PT} (${contestant.id})` };
    return { ok: true, value, costUSD: cost, error: null };
  };
  call.calls = calls;
  return call;
}

const base = (env, extra = {}) => ({ smDir: env.smDir, setsDir: env.setsDir, runId: 'run-a', maxUSD: 8, ...extra });

test('every contestant does every item in a fixed order, and the run folder gets results and the reports', async () => {
  const env = scratch();
  try {
    allSets(env);
    const call = perfect();
    const out = await runBench(base(env, { only: ['claude:haiku', 'openai:gpt-6-luna'] }), { call, keyedProviders: ['openai'] });
    const order = out.results.map((r) => `${r.kind}:${r.itemId}:${r.contestant}`);
    assert.deepEqual(order, [
      'classify:s1:claude:haiku', 'classify:s1:openai:gpt-6-luna', 'classify:s2:claude:haiku', 'classify:s2:openai:gpt-6-luna',
      'code:k1:claude:haiku', 'code:k1:openai:gpt-6-luna',
      'review:r1:claude:haiku', 'review:r1:openai:gpt-6-luna', 'review:r2:claude:haiku', 'review:r2:openai:gpt-6-luna',
      'pt:p1:claude:haiku', 'pt:p1:openai:gpt-6-luna',
    ]);
    assert.ok(out.results.every((r) => r.score === 1), JSON.stringify(out.results.filter((r) => r.score !== 1)));
    const dir = join(env.smDir, 'bench', 'runs', 'run-a');
    assert.equal(out.runDir, dir);
    const saved = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    assert.equal(saved.results.length, 12);
    for (const r of saved.results) for (const k of ['contestant', 'itemId', 'ok', 'score', 'costUSD', 'ms', 'error']) assert.ok(k in r, `${k} missing`);
    assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /Banco de medição/);
    assert.ok(existsSync(join(dir, 'pt-blind.md')));
    assert.equal(Object.keys(JSON.parse(readFileSync(join(dir, 'pt-key.json'), 'utf8')).p1).length, 2);
    assert.equal(out.spentUSD, 0.12);
  } finally {
    env.done();
  }
});

test('nothing from the owner\'s conversations is stored: classify keeps ids and the chosen part only', async () => {
  const env = scratch();
  try {
    allSets(env);
    await runBench(base(env, { kinds: ['classify'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [] });
    const dir = join(env.smDir, 'bench', 'runs', 'run-a');
    for (const f of ['results.json', 'report.md', 'run.json']) {
      assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /SEGREDO/, `${f} holds the owner's words`);
    }
  } finally {
    env.done();
  }
});

test('DeepSeek is kept off the owner\'s conversations unless the run allows it', async () => {
  const env = scratch();
  try {
    allSets(env);
    const call = perfect();
    const out = await runBench(base(env, { kinds: ['classify', 'review'], only: ['deepseek:deepseek-flash'] }), { call, keyedProviders: ['deepseek'] });
    assert.ok(call.calls.every((c) => !c.prompt.includes('SEGREDO')));
    const classify = out.results.filter((r) => r.kind === 'classify');
    assert.deepEqual(classify.map((r) => r.skipped), ['privacy', 'privacy']);
    assert.equal(out.results.filter((r) => r.kind === 'review' && !r.skipped).length, 2);
    assert.ok(out.notes.some((n) => /DeepSeek/.test(n)));

    const allowed = perfect();
    await runBench(base(env, { runId: 'run-b', kinds: ['classify'], only: ['deepseek:deepseek-flash'], allowDeepseekPersonal: true }), { call: allowed, keyedProviders: ['deepseek'] });
    assert.equal(allowed.calls.length, 2);
  } finally {
    env.done();
  }
});

test('the total cap is checked before every call with a cautious estimate, and the run stops cleanly', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', Array.from({ length: 5 }, (_, i) => ({ ...REVIEW[1], id: `r${i}` })));
    // Haiku's first call is estimated at US$ 0.08, then at 1.5 x the dearest real call (0.04 -> 0.06).
    const call = perfect({ cost: 0.04 });
    const out = await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'], maxUSD: 0.15 }), { call, keyedProviders: [] });
    assert.equal(call.calls.length, 3);
    assert.deepEqual(out.results.map((r) => r.skipped ?? null), [null, null, null, 'budget', 'budget']);
    assert.ok(out.spentUSD <= 0.15);
    assert.ok(out.notes.some((n) => /limite/.test(n) && /2/.test(n)), out.notes.join('\n'));
    assert.match(readFileSync(join(out.runDir, 'report.md'), 'utf8'), /limite/);
  } finally {
    env.done();
  }
});

test('the cap for one contestant stops only that contestant', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', Array.from({ length: 4 }, (_, i) => ({ ...REVIEW[1], id: `r${i}` })));
    const call = perfect({ cost: 0.04 });
    const out = await runBench(base(env, { kinds: ['review'], only: ['claude:haiku', 'openai:gpt-6-luna'], maxUSD: 8, maxUSDEach: 0.1 }), { call, keyedProviders: ['openai'] });
    const haiku = out.results.filter((r) => r.contestant === 'claude:haiku');
    const luna = out.results.filter((r) => r.contestant === 'openai:gpt-6-luna');
    assert.ok(haiku.some((r) => r.skipped === 'budget-each'));
    assert.ok(luna.filter((r) => !r.skipped).length >= 2);
    assert.ok(haiku.filter((r) => !r.skipped).reduce((s, r) => s + r.costUSD, 0) <= 0.1);
  } finally {
    env.done();
  }
});

test('a contestant stopped by its own cap does not stop the others through the total cap', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', Array.from({ length: 6 }, (_, i) => ({ ...REVIEW[1], id: `r${i}` })));
    // Opus first guess 0.8 is over its own cap of 0.5 and over the 0.7 total: its own cap skips it, the run goes on.
    const call = perfect({ cost: 0.001 });
    const out = await runBench(base(env, { kinds: ['review'], only: ['claude:opus', 'openai:gpt-6-luna'], maxUSD: 0.7, maxUSDEach: 0.5 }), { call, keyedProviders: ['openai'] });
    assert.ok(out.results.filter((r) => r.contestant === 'claude:opus').every((r) => r.skipped === 'budget-each'));
    assert.ok(out.results.filter((r) => r.contestant === 'openai:gpt-6-luna').every((r) => !r.skipped));
  } finally {
    env.done();
  }
});

test('a sandbox that breaks marks the answer and the run goes on', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'code.json'), 'code', [CODE[0], { ...CODE[0], id: 'k2' }]);
    const runCode = async () => { throw new Error('disk full'); };
    const out = await runBench(base(env, { kinds: ['code'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [], runCode });
    assert.deepEqual(out.results.map((r) => r.error), ['sandbox-failed', 'sandbox-failed']);
    assert.ok(out.results.every((r) => r.score === 0 && r.costUSD === 0.01));
  } finally {
    env.done();
  }
});

test('a resumed run reuses what it already has and redoes only what was skipped or broke on the way', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', Array.from({ length: 4 }, (_, i) => ({ ...REVIEW[1], id: `r${i}` })));
    let n = 0;
    const flaky = perfect({ cost: 0.04 });
    const first = async (...args) => (++n === 2 ? { ok: false, value: null, costUSD: 0, error: 'timeout' } : flaky(...args));
    // Estimates: 0.08, then 0.06 each; the timed-out call costs nothing, so the fourth (0.08 + 0.06) passes 0.13.
    const out1 = await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'], maxUSD: 0.13 }), { call: first, keyedProviders: [] });
    assert.deepEqual(out1.results.map((r) => r.skipped ?? r.error), [null, 'timeout', null, 'budget']);

    const again = perfect({ cost: 0.04 });
    const out2 = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['claude:haiku'], maxUSD: 8 }, { call: again, keyedProviders: [] });
    assert.equal(out2.runId, 'run-a');
    assert.equal(again.calls.length, 2, 'only the broken and the skipped item are asked again');
    assert.ok(out2.results.every((r) => r.score === 1 && !r.skipped));
    assert.equal(out2.results.length, 4);
  } finally {
    env.done();
  }
});

test('a resumed run still counts the money of answers it throws away and asks again', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [REVIEW[1]]);
    const broke = async () => ({ ok: false, value: null, costUSD: 0.05, error: 'timeout' });
    await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'] }), { call: broke, keyedProviders: [] });
    // 0.05 already gone; the retry is estimated at 0.075 (1.5 x 0.05): 0.125 is over a 0.1 cap.
    const again = perfect({ cost: 0.05 });
    const out = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['claude:haiku'], maxUSD: 0.1 }, { call: again, keyedProviders: [] });
    assert.equal(again.calls.length, 0);
    assert.equal(out.results[0].skipped, 'budget');
    // And again: the thrown-away answer is gone from the results, but its cost is not forgotten.
    const third = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['claude:haiku'], maxUSD: 0.1 }, { call: again, keyedProviders: [] });
    assert.equal(again.calls.length, 0);
    assert.equal(third.spentUSD, 0.05);
  } finally {
    env.done();
  }
});

test('--limit trims every set, a missing set is left out with a note, and an unknown contestant is named', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', REVIEW);
    const out = await runBench(base(env, { kinds: ['review', 'code'], only: ['claude:haiku', 'gemini:gemini-3.8-flash'], limit: 1 }), { call: perfect(), keyedProviders: [] });
    assert.deepEqual(out.results.map((r) => r.itemId), ['r1']);
    assert.ok(out.notes.some((n) => /code/.test(n)), out.notes.join('\n'));
    assert.ok(out.notes.some((n) => /gemini:gemini-3.8-flash/.test(n)), out.notes.join('\n'));
  } finally {
    env.done();
  }
});

test('an empty set is named in the notes rather than passing in silence', async () => {
  const env = scratch();
  try {
    writeSet(join(env.smDir, 'bench', 'sets', 'classify.json'), 'classify', []);
    const out = await runBench(base(env, { kinds: ['classify'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [] });
    assert.ok(out.notes.some((n) => /classify/.test(n) && /vazio/.test(n)), out.notes.join('\n'));
  } finally {
    env.done();
  }
});

test('a missing classify set is built from the owner\'s data when a builder is given', async () => {
  const env = scratch();
  try {
    let built = 0;
    const buildClassify = async () => { built++; writeSet(join(env.smDir, 'bench', 'sets', 'classify.json'), 'classify', CLASSIFY); };
    const out = await runBench(base(env, { kinds: ['classify'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [], buildClassify });
    assert.equal(built, 1);
    assert.equal(out.results.length, 2);
  } finally {
    env.done();
  }
});

test('a dry run makes no call, writes nothing and gives the worst case', async () => {
  const env = scratch();
  try {
    allSets(env);
    const call = perfect();
    const out = await runBench(base(env, { dryRun: true, only: ['claude:haiku', 'openai:gpt-6-luna'] }), { call, keyedProviders: ['openai'] });
    assert.equal(call.calls.length, 0);
    assert.equal(existsSync(join(env.smDir, 'bench', 'runs')), false);
    assert.equal(out.plan.calls, 12);
    assert.ok(out.plan.worstUSD > 0);
    assert.deepEqual(out.plan.byKind, { classify: 2, code: 1, review: 2, pt: 1 });
  } finally {
    env.done();
  }
});

test('a wrong answer, a broken answer and code that fails its tests all score zero without stopping the run', async () => {
  const env = scratch();
  try {
    allSets(env);
    const call = async (c, prompt) => {
      if (prompt.includes('Return the sum')) return { ok: true, value: { code: 'export function add(a, b) { return a * b; }' }, costUSD: 0.01 };
      if (prompt.includes('a.mjs')) return { ok: false, value: null, costUSD: 0.01, error: 'no-json' };
      if (prompt.includes('b.mjs')) return { ok: true, value: { bugs: [{ line: 1, why: 'x' }] }, costUSD: 0.01 };
      if (prompt.includes('Place')) return { ok: true, value: { partId: 'chat' }, costUSD: 0.01 };
      return { ok: true, value: { code: 'no text field' }, costUSD: 0.01 };
    };
    const out = await runBench(base(env, { only: ['claude:haiku'] }), { call, keyedProviders: [] });
    assert.equal(out.results.length, 6);
    assert.ok(out.results.every((r) => r.score === 0), JSON.stringify(out.results));
    const review = out.results.find((r) => r.itemId === 'r2');
    assert.equal(review.falseAlarms, 1);
    assert.equal(out.results.find((r) => r.itemId === 'r1').error, 'no-json');
    assert.equal(out.results.find((r) => r.itemId === 'k1').error, 'tests-failed');
  } finally {
    env.done();
  }
});

test('the prompts: code asks for a module from the spec and signature; review numbers the lines', () => {
  const code = promptFor('code', CODE[0]);
  assert.match(code.prompt, /Return the sum of a and b/);
  assert.match(code.prompt, /export function add\(a, b\)/);
  assert.doesNotMatch(code.prompt, /assert/, 'the tests are not shown');
  assert.match(code.schemaHint, /"code"/);
  const review = promptFor('review', REVIEW[0]);
  assert.match(review.prompt, /^\s*3\| export const sum = a - b;$/m);
  assert.doesNotMatch(review.prompt, /minus instead of plus/, 'the answer is not shown');
  assert.match(review.schemaHint, /"bugs"/);
  assert.equal(promptFor('classify', CLASSIFY[0]).prompt, CLASSIFY[0].prompt);
  assert.equal(promptFor('pt', PT[0]).prompt, PT[0].prompt);
});

test('the command line reads lists, numbers and switches', () => {
  const o = parseCli(['--kinds', 'code,review', '--only', 'claude:haiku,openai:gpt-6-luna', '--limit', '3', '--max-usd', '2.5', '--dry-run', '--allow-deepseek-personal']);
  assert.deepEqual(o.kinds, ['code', 'review']);
  assert.deepEqual(o.only, ['claude:haiku', 'openai:gpt-6-luna']);
  assert.equal(o.limit, 3);
  assert.equal(o.maxUSD, 2.5);
  assert.equal(o.dryRun, true);
  assert.equal(o.allowDeepseekPersonal, true);
  assert.equal(parseCli([]).maxUSD, 8);
  assert.throws(() => parseCli(['--kinds', 'poetry']), /poetry/);
  assert.throws(() => parseCli(['--max-usd', '-1']), /max-usd/);
  assert.equal(parseCli(['--resume', 'run-x']).resume, 'run-x');
  assert.throws(() => parseCli(['--resume', '../etc']), /resume/);
});
