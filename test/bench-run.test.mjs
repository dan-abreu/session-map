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
    // Estimates: 0.08, then 0.06 each. The timed-out call may have been billed, so its 0.06 is booked: 0.10 spent,
    // and the third call (0.06 more) would pass 0.13.
    const out1 = await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'], maxUSD: 0.13 }), { call: first, keyedProviders: [] });
    assert.deepEqual(out1.results.map((r) => r.skipped ?? r.error), [null, 'timeout', 'budget', 'budget']);
    assert.deepEqual([out1.results[1].costUSD, out1.results[1].costEstimated], [0.06, true]);
    assert.equal(out1.spentUSD, 0.1);

    const again = perfect({ cost: 0.04 });
    const out2 = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['claude:haiku'], maxUSD: 8 }, { call: again, keyedProviders: [] });
    assert.equal(out2.runId, 'run-a');
    assert.equal(again.calls.length, 3, 'only the broken and the skipped items are asked again');
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

test('a long prompt after a short one is estimated by its size, so the total cap holds', async () => {
  const env = scratch();
  try {
    const long = 'x'.repeat(100_000);
    writeSet(join(env.setsDir, 'pt.json'), 'pt', [{ id: 'p0', prompt: 'x'.repeat(100) }, ...[1, 2, 3].map((i) => ({ id: `p${i}`, prompt: long }))]);
    const call = async (c, prompt) => ({ ok: true, value: { text: GOOD_PT }, costUSD: prompt.length / 1e5 });
    const out = await runBench(base(env, { kinds: ['pt'], only: ['claude:haiku'], maxUSD: 0.5 }), { call, keyedProviders: [] });
    assert.ok(out.spentUSD <= 0.5, `spent ${out.spentUSD}`);
    assert.deepEqual(out.results.map((r) => r.skipped ?? null), [null, 'budget', 'budget', 'budget']);
  } finally {
    env.done();
  }
});

test('an answer in the wrong shape is a failure, never a free "no part" or "no bug"', async () => {
  const env = scratch();
  try {
    allSets(env);
    const call = async () => ({ ok: true, value: {}, costUSD: 0.01 });
    const out = await runBench(base(env, { kinds: ['classify', 'review'], only: ['claude:haiku'] }), { call, keyedProviders: [] });
    assert.ok(out.results.every((r) => r.score === 0 && r.ok === false && r.error === 'bad-shape'), JSON.stringify(out.results));
  } finally {
    env.done();
  }
});

test('code that hangs in the sandbox is the answer\'s fault: a resumed run does not ask again', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'code.json'), 'code', CODE);
    // The reference has no expectedTests; the answers are tested with the count the reference gave.
    const runCode = async ({ expectedTests }) => (expectedTests === undefined
      ? { ok: true, passed: 1, failed: 0, total: 1, ms: 1 }
      : { ok: false, passed: 0, failed: 0, total: 0, timedOut: true, error: 'tests-timeout', ms: 20_000 });
    const out = await runBench(base(env, { kinds: ['code'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [], runCode });
    assert.equal(out.results[0].error, 'tests-timeout');
    const again = perfect();
    await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['code'], only: ['claude:haiku'] }, { call: again, keyedProviders: [], runCode });
    assert.equal(again.calls.length, 0);
  } finally {
    env.done();
  }
});

test('when the sandbox broke on this machine, a resumed run tests the stored answer again without paying twice', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'code.json'), 'code', CODE);
    const broken = async () => { throw new Error('disk full'); };
    const first = await runBench(base(env, { kinds: ['code'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [], runCode: broken });
    assert.equal(first.results[0].error, 'sandbox-failed');
    const again = perfect();
    const out = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['code'], only: ['claude:haiku'] }, { call: again, keyedProviders: [] });
    assert.equal(again.calls.length, 0);
    assert.deepEqual([out.results[0].score, out.results[0].error, out.results[0].costUSD], [1, null, 0.01]);
    assert.equal(out.spentUSD, 0.01);
  } finally {
    env.done();
  }
});

test('a Node with no sandbox is this machine\'s fault: the item is not called broken and a resume tests again', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'code.json'), 'code', CODE);
    const unsupported = async () => ({ ok: false, passed: 0, failed: 0, total: 0, timedOut: false, error: 'sandbox-unsupported', ms: 0, tail: 'no permission model' });
    const first = await runBench(base(env, { kinds: ['code'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [], runCode: unsupported });
    assert.equal(first.results[0].skipped, undefined, 'the reference did not run: the item is not known broken');
    assert.equal(first.results[0].error, 'sandbox-unsupported');
    const again = perfect();
    const out = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['code'], only: ['claude:haiku'] }, { call: again, keyedProviders: [] });
    assert.equal(again.calls.length, 0);
    assert.deepEqual([out.results[0].score, out.results[0].error], [1, null]);
  } finally {
    env.done();
  }
});

test('a code item whose reference fails its own tests is left out for everyone, with a note', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'code.json'), 'code', [{ ...CODE[0], reference: 'export function add(a, b) { return a - b; }' }]);
    const call = perfect();
    const out = await runBench(base(env, { kinds: ['code'], only: ['claude:haiku'] }), { call, keyedProviders: [] });
    assert.equal(call.calls.length, 0);
    assert.equal(out.results[0].skipped, 'broken-item');
    assert.ok(out.notes.some((n) => /k1/.test(n)), out.notes.join('\n'));
  } finally {
    env.done();
  }
});

test('an answer that adds tests of its own is not trusted: the count must match the reference', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'code.json'), 'code', CODE);
    const code = "import { test } from 'node:test';\ntest('free', () => {});\nexport function add(a, b) { return a + b; }";
    const call = async () => ({ ok: true, value: { code }, costUSD: 0.01 });
    const out = await runBench(base(env, { kinds: ['code'], only: ['claude:haiku'] }), { call, keyedProviders: [] });
    assert.deepEqual([out.results[0].score, out.results[0].error], [0, 'tests-miscounted']);
  } finally {
    env.done();
  }
});

test('an answer cut off before its JSON closed (no-json, bad-output) is asked again on resume', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [{ ...REVIEW[1], id: 'r0' }, { ...REVIEW[1], id: 'r1' }]);
    let n = 0;
    const flaky = perfect({ cost: 0.01 });
    const first = async (...args) => (++n === 1 ? { ok: false, value: null, costUSD: 0.001, error: 'no-json' } : flaky(...args));
    const out1 = await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'] }), { call: first, keyedProviders: [] });
    assert.equal(out1.results[0].error, 'no-json');
    const again = perfect({ cost: 0.01 });
    const out2 = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['claude:haiku'], maxUSD: 8 }, { call: again, keyedProviders: [] });
    assert.equal(again.calls.length, 1, 'only the cut-off answer is asked again');
    assert.ok(out2.results.every((r) => r.ok && r.score === 1));
  } finally {
    env.done();
  }
});

test('an answer the length limit cut off (answer-cut) is asked again on resume', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [{ ...REVIEW[1], id: 'r0' }]);
    const cut = async () => ({ ok: false, value: null, costUSD: 0.001, error: 'answer-cut' });
    await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'] }), { call: cut, keyedProviders: [] });
    const again = perfect({ cost: 0.01 });
    const out = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['claude:haiku'], maxUSD: 8 }, { call: again, keyedProviders: [] });
    assert.equal(again.calls.length, 1);
    assert.ok(out.results.every((r) => r.ok && r.score === 1));
  } finally {
    env.done();
  }
});

test('a resumed run with --only measures new contestants under the cap: earlier money of the others does not count', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [REVIEW[0], REVIEW[1]]);
    await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'] }), { call: perfect({ cost: 0.5 }), keyedProviders: [] });
    const again = perfect({ cost: 0.001 });
    const out = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['openai:gpt-6-luna'], maxUSD: 0.5 }, { call: again, keyedProviders: ['openai'] });
    assert.deepEqual(again.calls.map((c) => c.contestant), ['openai:gpt-6-luna', 'openai:gpt-6-luna']);
    assert.equal(out.spentUSD, 1.002, 'the run still reports everything it cost');
    assert.deepEqual(out.results.map((r) => r.contestant).sort(), ['claude:haiku', 'claude:haiku', 'openai:gpt-6-luna', 'openai:gpt-6-luna']);
    const saved = JSON.parse(readFileSync(join(env.smDir, 'bench', 'runs', 'run-a', 'results.json'), 'utf8'));
    assert.deepEqual(saved.spentEachUSD, { 'claude:haiku': 1, 'openai:gpt-6-luna': 0.002 });
  } finally {
    env.done();
  }
});

test('money a run cannot put on one contestant still counts against the cap of a resumed --only run', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [REVIEW[1]]);
    mkdirSync(join(env.smDir, 'bench', 'runs', 'run-a'), { recursive: true });
    writeFileSync(join(env.smDir, 'bench', 'runs', 'run-a', 'results.json'), JSON.stringify({ runId: 'run-a', spentUSD: 1, results: [] }));
    const again = perfect({ cost: 0.001 });
    const out = await runBench({ smDir: env.smDir, setsDir: env.setsDir, resume: 'run-a', kinds: ['review'], only: ['openai:gpt-6-luna'], maxUSD: 0.5 }, { call: again, keyedProviders: ['openai'] });
    assert.equal(again.calls.length, 0);
    assert.equal(out.results[0].skipped, 'budget');
  } finally {
    env.done();
  }
});

test('each run writes bench/routing.json the router reads, merged with what earlier runs measured', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [REVIEW[0], REVIEW[1]]);
    const routing = join(env.smDir, 'bench', 'routing.json');
    mkdirSync(join(env.smDir, 'bench'), { recursive: true });
    writeFileSync(routing, JSON.stringify({ updatedAt: '2026-01-01T00:00:00.000Z', entries: [
      { kind: 'review', contestant: 'claude:haiku', accuracy: 0.1, costPerCorrectUSD: 9, n: 40 },
      { kind: 'code', contestant: 'claude:haiku', accuracy: 0.9, costPerCorrectUSD: 0.01, n: 30 },
    ] }));
    let n = 0;
    const good = perfect({ cost: 0.02 });
    const call = async (c, ...rest) => (c.id === 'openai:gpt-6-luna' && ++n === 1 ? { ok: true, value: { bugs: [] }, costUSD: 0.02, error: null } : good(c, ...rest));
    await runBench(base(env, { kinds: ['review', 'pt'], only: ['claude:haiku', 'openai:gpt-6-luna'] }), { call, keyedProviders: ['openai'] });
    const data = JSON.parse(readFileSync(routing, 'utf8'));
    assert.match(data.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.notEqual(data.updatedAt, '2026-01-01T00:00:00.000Z');
    const by = Object.fromEntries(data.entries.map((e) => [`${e.kind} ${e.contestant}`, e]));
    assert.deepEqual(Object.keys(by).sort(), ['code claude:haiku', 'review claude:haiku', 'review openai:gpt-6-luna'], 'no pt set: nothing measured there, nothing written');
    const pick = (e) => ({ kind: e.kind, contestant: e.contestant, accuracy: e.accuracy, costPerCorrectUSD: e.costPerCorrectUSD, n: e.n });
    assert.deepEqual(pick(by['review claude:haiku']), { kind: 'review', contestant: 'claude:haiku', accuracy: 1, costPerCorrectUSD: 0.02, n: 2 }, 'the newer measure replaces the older');
    assert.deepEqual(pick(by['review openai:gpt-6-luna']), { kind: 'review', contestant: 'openai:gpt-6-luna', accuracy: 0.5, costPerCorrectUSD: 0.04, n: 2 });
    assert.deepEqual(pick(by['code claude:haiku']), { kind: 'code', contestant: 'claude:haiku', accuracy: 0.9, costPerCorrectUSD: 0.01, n: 30 }, 'what this run did not measure is kept');
  } finally {
    env.done();
  }
});

test('routing.json: a kind with no right answer is booked at its whole cost, and a broken file is replaced', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [REVIEW[0]]);
    const routing = join(env.smDir, 'bench', 'routing.json');
    mkdirSync(join(env.smDir, 'bench'), { recursive: true });
    writeFileSync(routing, '{ not json');
    const wrong = async () => ({ ok: true, value: { bugs: [] }, costUSD: 0.03, error: null });
    await runBench(base(env, { kinds: ['review'], only: ['claude:haiku'] }), { call: wrong, keyedProviders: [] });
    const [e] = JSON.parse(readFileSync(routing, 'utf8')).entries;
    assert.deepEqual([e.accuracy, e.costPerCorrectUSD, e.n], [0, 0.03, 1]);
  } finally {
    env.done();
  }
});

test('routing.json keeps a measure from a later run over one from the run being resumed', async () => {
  const env = scratch();
  try {
    writeSet(join(env.setsDir, 'review.json'), 'review', [REVIEW[1]]);
    const routing = join(env.smDir, 'bench', 'routing.json');
    mkdirSync(join(env.smDir, 'bench'), { recursive: true });
    const later = { kind: 'review', contestant: 'claude:haiku', accuracy: 0.7, costPerCorrectUSD: 0.5, n: 25, runId: '2099-01-01-00-00-00' };
    writeFileSync(routing, JSON.stringify({ updatedAt: '2099-01-01T00:00:00.000Z', entries: [later] }));
    await runBench(base(env, { runId: '2026-10-10-21-43-44', kinds: ['review'], only: ['claude:haiku'] }), { call: perfect(), keyedProviders: [] });
    assert.deepEqual(JSON.parse(readFileSync(routing, 'utf8')).entries, [later]);
  } finally {
    env.done();
  }
});
