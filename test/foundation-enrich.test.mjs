import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateStudy, sliceSpans, studySlice, STUDY_RULES } from '../server/foundation/enrich.mjs';
import { buildModel } from '../server/foundation/model.mjs';
import { refreshFoundation, readStep } from '../server/foundation/refresh.mjs';
import { readFd } from '../server/foundation/store.mjs';
import { readArch } from '../server/arch/detect.mjs';
import { loadConfig } from '../server/config.mjs';
import { loadPrices } from '../server/cost.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

// Block 2, B2-T7: the AI study of a slice. The program puts the text of the lines in the request, records in the ledger
// exactly what it sent, and every claim that comes back goes through the checker. No network: `exec` is a fake claude.

const PLANTED = JSON.parse(readFileSync(new URL('./fixtures/claims/acme-shop.claims.json', import.meta.url), 'utf8')).claims;
// What the AI would send: the claim without the sha, which only the program attaches.
const asSent = (id) => {
  const { claim } = PLANTED.find((c) => c.claim.id === id);
  return { ...claim, cites: claim.cites.map(({ sha, ...rest }) => rest) };
};
const NOW = () => new Date('2026-10-10T10:00:00.000Z');

async function fixture() {
  const name = 'acme-shop';
  const root = copyFixtureRepo(name);
  const smDir = mkdtempSync(join(tmpdir(), 'sm-enrich-'));
  const id = `${name}-0a0b0c`;
  const out = await refreshFoundation({ id, name, root }, smDir, { steps: [readStep()], now: () => Date.now() });
  assert.ok(out.steps?.[0]?.ok, JSON.stringify(out));
  const arch = await readArch(root, loadConfig(root, smDir), { mainBranch: 'main' });
  const census = readFd(smDir, id, 'census.json');
  const facts = readFd(smDir, id, 'facts.json');
  const model = buildModel(facts, census, arch, {}, { name });
  return { root, smDir, id, census, facts, model, done: () => { removeFixtureRepo(root); rmSync(smDir, { recursive: true, force: true }); } };
}

// A fake claude: answers `reply(input, n)` in the envelope of `claude -p --output-format json`, and keeps every stdin.
function fakeClaude(reply) {
  const calls = [];
  const exec = async (bin, args, { input }) => {
    calls.push({ bin, args, input });
    const value = typeof reply === 'function' ? reply(input, calls.length) : reply;
    return { code: 0, stdout: JSON.stringify({ result: JSON.stringify(value), total_cost_usd: 0.01, is_error: false }) };
  };
  return { exec, calls };
}

const study = (fx, over) => studySlice({
  id: fx.id, model: fx.model, facts: fx.facts, root: fx.root, smDir: fx.smDir, bin: 'claude', now: NOW, maxUSD: 100, ...over,
});

// ---------- the estimate and the ceiling ----------

test('the estimate counts the characters of the slice into tokens and dollars, and asks above the ceiling', () => {
  const census = { files: [
    { path: 'a.ts', included: true, chars: 4000, lines: { total: 100 }, sha: 'aaaa' },
    { path: 'b.ts', included: true, chars: 8000, lines: { total: 200 }, sha: 'bbbb' },
  ] };
  const prices = loadPrices();
  const whole = estimateStudy({ spans: [{ path: 'a.ts', from: 1, to: 100 }, { path: 'b.ts', from: 1, to: 200 }] }, census, prices);
  assert.equal(whole.chars, 12000);
  assert.ok(whole.tokensIn >= 3000, 'about 4 characters a token');
  assert.ok(whole.estimateUSD > 0);
  assert.equal(whole.maxUSD, 5, 'the default ceiling of bootstrap.maxUSD');
  assert.equal(whole.ask, false);
  const half = estimateStudy({ spans: [{ path: 'b.ts', from: 1, to: 100 }] }, census, prices);
  assert.equal(half.chars, 4000, 'half the lines of b.ts, half its characters');
  assert.equal(estimateStudy({ spans: [{ path: 'a.ts', from: 1, to: 100 }] }, census, prices, { maxUSD: 0.000001 }).ask, true);
  // a model with no price cannot be bounded: ask
  const unpriced = estimateStudy({ spans: [{ path: 'a.ts', from: 1, to: 100 }] }, census, prices, { model: 'mystery-model' });
  assert.equal(unpriced.estimateUSD, null);
  assert.equal(unpriced.ask, true);
});

test('an estimate above the ceiling answers ask: true and never calls the AI', async () => {
  const fx = await fixture();
  try {
    const { exec, calls } = fakeClaude({ claims: [] });
    const out = await study(fx, { slice: { focus: 'sys' }, exec, maxUSD: 0.000001 });
    assert.equal(out.ok, false);
    assert.equal(out.ask, true);
    assert.ok(out.estimateUSD > 0.000001);
    assert.equal(calls.length, 0, 'the AI was not called');
    assert.equal(readFd(fx.smDir, fx.id, 'claims.json', null), null, 'nothing written');
    assert.equal(readFd(fx.smDir, fx.id, 'read-ledger.json', null), null, 'nothing read');
    // with the owner's confirmation it goes
    const go = await study(fx, { slice: { focus: 'sys' }, exec, maxUSD: 0.000001, confirm: true });
    assert.equal(go.ok, true, JSON.stringify(go));
    assert.equal(calls.length, 1);
  } finally { fx.done(); }
});

// ---------- the checker on what comes back ----------

test('a planted false claim in the answer is removed: only the true ones stay in claims.json (fd04)', async () => {
  const fx = await fixture();
  try {
    const { exec, calls } = fakeClaude({ claims: [asSent('claim:01'), asSent('claim:02'), asSent('claim:10'), asSent('claim:03')] });
    const out = await study(fx, { slice: { focus: 'sys' }, exec });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(calls.length, 1);
    const doc = readFd(fx.smDir, fx.id, 'claims.json');
    assert.equal(doc.version, 1);
    assert.equal(doc.run, out.run);
    const kept = doc.claims.map((c) => `${c.about}:${c.badge}`).sort();
    assert.deepEqual(kept, ['cmp:apps/api#root:confirmed', 'ctr:apps/api:not-found', 'ctr:apps/worker:interpretation']);
    assert.deepEqual(doc.rejected.map((c) => `${c.about}:${c.reason}`), ['cmp:apps/api/src/routes:quote-mismatch']);
    // the program stamps the sha of the text it sent, the hash at check and the run; the AI does not choose its id
    const fact = doc.claims.find((c) => c.about === 'cmp:apps/api#root');
    const row = fx.census.files.find((f) => f.path === 'apps/api/src/server.ts');
    assert.equal(fact.cites[0].sha, row.sha);
    assert.equal(fact.run, out.run);
    assert.match(fact.id, /^claim:[0-9a-f]{16}$/);
    assert.ok(fact.hashAtCheck, 'a claim about a node keeps its hash');
    assert.equal(out.approved, 3);
    assert.equal(out.rejected, 1);
  } finally { fx.done(); }
});

test('the request carries the fixed rule, the ids of the slice and the text of the lines, never memory', async () => {
  const fx = await fixture();
  try {
    const { exec, calls } = fakeClaude({ claims: [] });
    await study(fx, { slice: { focus: 'ctr:apps/api' }, exec });
    const input = calls[0].input;
    assert.ok(input.includes(STUDY_RULES), 'the fixed instruction');
    assert.match(STUDY_RULES, /only ids from the list/i);
    assert.match(STUDY_RULES, /not-found/);
    assert.ok(input.includes('route:GET /status'), 'a fact of the slice');
    assert.ok(input.includes('ctr:apps/api'), 'the node of the slice');
    assert.ok(input.includes("13| app.get('/status', async () => ({ ok: true }));"), 'the line, with its number');
    assert.ok(!input.includes("new Worker('emails'"), 'a file of another container is not sent');
    assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--tools'), calls[0].args.indexOf('--tools') + 2), ['--tools', ''], 'no tools: it reads only what is in the request');
  } finally { fx.done(); }
});

// ---------- the ledger: what the program sent, nothing else ----------

test('the ledger shows exactly the lines sent: a span skipped on purpose shows up as missing (fd01)', async () => {
  const fx = await fixture();
  try {
    const file = 'apps/api/src/server.ts';
    const total = fx.census.files.find((f) => f.path === file).lines.total;
    const { exec, calls } = fakeClaude({ claims: [] });
    const out = await study(fx, { slice: { spans: [{ path: file, from: 1, to: 5 }, { path: file, from: 10, to: total }] }, exec });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.ok(!calls[0].input.includes('legacy-orders'), 'lines 6 to 9 were not sent');
    const ledger = readFd(fx.smDir, fx.id, 'read-ledger.json');
    assert.deepEqual(Object.keys(ledger.files), [file]);
    assert.deepEqual(ledger.files[file].spans, [[1, 5], [10, total]]);
    assert.deepEqual(ledger.files[file].reads.map((r) => r.run), [out.run]);
    assert.deepEqual(ledger.summary.missing.find((m) => m.path === file), { path: file, spans: [[6, 9]] });
    assert.ok(ledger.summary.percent < 100);
  } finally { fx.done(); }
});

test('after a study of the whole project the ledger reads 100%', async () => {
  const fx = await fixture();
  try {
    const { exec } = fakeClaude({ claims: [] });
    const out = await study(fx, { slice: { focus: 'sys' }, exec });
    assert.equal(out.ok, true, JSON.stringify(out));
    const ledger = readFd(fx.smDir, fx.id, 'read-ledger.json');
    assert.deepEqual(ledger.summary.missing, []);
    assert.equal(ledger.summary.percent, 100);
    assert.equal(out.read.percent, 100);
  } finally { fx.done(); }
});

test('the AI saying it read a file that was not sent does not count in the ledger, and its claim falls', async () => {
  const fx = await fixture();
  try {
    const sent = 'apps/api/src/server.ts';
    const lie = asSent('claim:02');
    // the AI even forges the sha of today's worker.ts
    const workerSha = fx.census.files.find((f) => f.path === 'apps/worker/src/worker.ts').sha;
    lie.cites = lie.cites.map((c) => ({ ...c, sha: workerSha }));
    const { exec } = fakeClaude({ read: ['apps/worker/src/worker.ts', 'apps/web/app/page.tsx'], claims: [asSent('claim:01'), lie] });
    const total = fx.census.files.find((f) => f.path === sent).lines.total;
    const out = await study(fx, { slice: { spans: [{ path: sent, from: 1, to: total }] }, exec });
    assert.equal(out.ok, true, JSON.stringify(out));
    const ledger = readFd(fx.smDir, fx.id, 'read-ledger.json');
    assert.deepEqual(Object.keys(ledger.files), [sent]);
    const doc = readFd(fx.smDir, fx.id, 'claims.json');
    assert.deepEqual(doc.claims.map((c) => c.about), ['cmp:apps/api#root']);
    assert.deepEqual(doc.rejected.map((c) => `${c.about}:${c.reason}`), ['ctr:apps/worker:stale-sha']);
  } finally { fx.done(); }
});

// ---------- secrets ----------

test('the .env of the fixture never enters the request, whatever the slice asks', async () => {
  const fx = await fixture();
  try {
    const { exec, calls } = fakeClaude({ claims: [] });
    const spans = [{ path: '.env', from: 1, to: 1 }, { path: '../.env', from: 1, to: 1 }, { path: 'apps/api/src/server.ts', from: 1, to: 3 }];
    await study(fx, { slice: { spans }, exec });
    await study(fx, { slice: { focus: 'sys' }, exec });
    assert.equal(calls.length, 2);
    for (const { input } of calls) {
      assert.ok(!input.includes('do-not-read-42'), 'the secret value');
      assert.ok(!input.includes('SECRET_TOKEN'), 'not even the name of the variable from the .env');
    }
    const ledger = readFd(fx.smDir, fx.id, 'read-ledger.json');
    assert.ok(!Object.keys(ledger.files).some((p) => p.includes('.env') && !p.endsWith('.env.example')));
  } finally { fx.done(); }
});

test('the slice keeps only included files of the census, cut to their lines', () => {
  const census = { files: [
    { path: 'a.ts', included: true, kind: 'code', chars: 10, lines: { total: 10 }, sha: 'a' },
    { path: '.env', included: false, kind: 'secret', chars: null, lines: null, sha: null },
    { path: 'config/.env.local', included: true, kind: 'code', chars: 10, lines: { total: 2 }, sha: 'c' },
    { path: 'pnpm-lock.yaml', included: false, kind: 'generated', chars: null, lines: null, sha: null },
  ] };
  const got = sliceSpans(null, census, { spans: [
    { path: 'a.ts', from: 8, to: 50 }, { path: '.env', from: 1, to: 1 }, { path: 'config/.env.local', from: 1, to: 2 },
    { path: 'pnpm-lock.yaml', from: 1, to: 1 }, { path: 'nope.ts', from: 1, to: 1 }, { path: 'a.ts', from: 0, to: 2 },
    { path: 'a.ts', from: 20, to: 30 },
  ] });
  assert.deepEqual(got, [{ path: 'a.ts', from: 8, to: 10 }]);
});

// ---------- important points: two readers and an adversary ----------

const isTask = (input, task) => input.startsWith(`TASK: ${task}`);

test('an important point is read by two independent readers and an adversary; agreement keeps it', async () => {
  const fx = await fixture();
  try {
    const important = asSent('claim:04');
    const { exec, calls } = fakeClaude((input) => {
      if (isTask(input, 'study')) return { claims: [important] };
      if (isTask(input, 'reader')) return { about: 'ctr:packages/adapters', factIds: ['integration:stripe'] };
      if (isTask(input, 'adversary')) return { rejects: [] };
      return {};
    });
    const out = await study(fx, { slice: { focus: 'sys' }, exec });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(calls.map((c) => c.input.split('\n')[0]), ['TASK: study', 'TASK: reader', 'TASK: reader', 'TASK: adversary']);
    // the readers are not told the answer
    for (const c of calls.filter((x) => isTask(x.input, 'reader'))) {
      assert.ok(!c.input.includes('"about":"ctr:packages/adapters"') && !c.input.includes('integration:stripe"]'), 'the claim\'s own about and facts are not given');
      assert.ok(c.input.includes('new Stripe(key)'), 'the cited text is present');
    }
    const doc = readFd(fx.smDir, fx.id, 'claims.json');
    assert.deepEqual(doc.claims.map((c) => [c.about, c.badge, c.reason ?? null]), [['ctr:packages/adapters', 'interpretation', null]]);
  } finally { fx.done(); }
});

test('readers who disagree turn the important point into "not confirmed"', async () => {
  const fx = await fixture();
  try {
    const { exec } = fakeClaude((input, n) => {
      if (isTask(input, 'study')) return { claims: [asSent('claim:11')] };
      if (isTask(input, 'reader')) return n === 2 ? { about: 'ctr:apps/api', factIds: ['route:GET /status'] } : { about: 'ctr:apps/web', factIds: [] };
      return { rejects: [] };
    });
    const out = await study(fx, { slice: { focus: 'sys' }, exec });
    assert.equal(out.ok, true, JSON.stringify(out));
    const doc = readFd(fx.smDir, fx.id, 'claims.json');
    assert.deepEqual(doc.claims.map((c) => [c.about, c.badge, c.reason]), [['ctr:apps/api', 'not-found', 'disagreement']]);
  } finally { fx.done(); }
});

test('an adversary that knocks down a citation turns the important point into "not confirmed"', async () => {
  const fx = await fixture();
  try {
    const { exec } = fakeClaude((input) => {
      if (isTask(input, 'study')) return { claims: [asSent('claim:04')] };
      if (isTask(input, 'reader')) return { about: 'ctr:packages/adapters', factIds: ['integration:stripe'] };
      return { rejects: [0] };
    });
    await study(fx, { slice: { focus: 'sys' }, exec });
    const doc = readFd(fx.smDir, fx.id, 'claims.json');
    assert.deepEqual(doc.claims.map((c) => [c.badge, c.reason]), [['not-found', 'disagreement']]);
  } finally { fx.done(); }
});

// ---------- failures and the file of claims ----------

test('a failed call writes nothing: no claims, no reading', async () => {
  const fx = await fixture();
  try {
    const exec = async () => ({ code: 1, stdout: 'not json' });
    const out = await study(fx, { slice: { focus: 'sys' }, exec });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'bad-output');
    assert.equal(readFd(fx.smDir, fx.id, 'claims.json', null), null);
    assert.equal(readFd(fx.smDir, fx.id, 'read-ledger.json', null), null);
  } finally { fx.done(); }
});

test('a second study of another slice keeps the claims of the first and replaces only its own', async () => {
  const fx = await fixture();
  try {
    const first = fakeClaude({ claims: [asSent('claim:02')] });
    await study(fx, { slice: { focus: 'ctr:apps/worker' }, exec: first.exec });
    const second = fakeClaude({ claims: [asSent('claim:01')] });
    await study(fx, { slice: { focus: 'ctr:apps/api' }, exec: second.exec });
    const doc = readFd(fx.smDir, fx.id, 'claims.json');
    assert.deepEqual(doc.claims.map((c) => c.about).sort(), ['cmp:apps/api#root', 'ctr:apps/worker']);
    // studying the worker again with nothing to say drops its old claim
    const again = fakeClaude({ claims: [] });
    await study(fx, { slice: { focus: 'ctr:apps/worker' }, exec: again.exec });
    assert.deepEqual(readFd(fx.smDir, fx.id, 'claims.json').claims.map((c) => c.about), ['cmp:apps/api#root']);
  } finally { fx.done(); }
});

// ---------- hardening: the estimate of a focus, one study at a time, the shape of the answer ----------

test('the estimate of a focus counts the lines of that focus, and a focus without the model is refused', async () => {
  const fx = await fixture();
  try {
    const prices = loadPrices();
    const spans = sliceSpans(fx.model, fx.census, { focus: 'ctr:apps/api' });
    assert.ok(spans.length > 0);
    const bySpans = estimateStudy({ spans }, fx.census, prices);
    const byFocus = estimateStudy({ focus: 'ctr:apps/api' }, fx.census, prices, { graph: fx.model });
    assert.ok(byFocus.chars > 0, 'a focus is not an empty slice');
    assert.equal(byFocus.chars, bySpans.chars);
    assert.equal(byFocus.estimateUSD, bySpans.estimateUSD);
    assert.throws(() => estimateStudy({ focus: 'ctr:apps/api' }, fx.census, prices), /graph/);
  } finally { fx.done(); }
});

test('one study at a time per project: a second one while the first runs answers busy and calls nothing', async () => {
  const fx = await fixture();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = [];
    const exec = async (bin, args, { input }) => {
      calls.push(input);
      await gate;
      return { code: 0, stdout: JSON.stringify({ result: JSON.stringify({ claims: [] }), total_cost_usd: 0.01, is_error: false }) };
    };
    const first = study(fx, { slice: { focus: 'sys' }, exec });
    await new Promise((r) => setTimeout(r, 50));
    const late = new Promise((r) => setTimeout(() => r('still waiting'), 2000));
    const second = await Promise.race([study(fx, { slice: { focus: 'ctr:apps/api' }, exec }), late]);
    release();
    assert.deepEqual(second, { ok: false, error: 'busy' });
    assert.equal((await first).ok, true);
    assert.equal(calls.length, 1, 'only the first study called the AI');
    const third = await study(fx, { slice: { focus: 'ctr:apps/api' }, exec });
    assert.equal(third.ok, true, 'free again once the first one ended');
  } finally { fx.done(); }
});

test('a claim sent without the empty lists keeps them empty, and a claim sent twice is kept once', async () => {
  const fx = await fixture();
  try {
    const { cites, factIds, ...bare } = asSent('claim:03');
    assert.deepEqual([cites, factIds], [[], []]);
    const { exec } = fakeClaude({ claims: [bare, asSent('claim:01'), asSent('claim:01')] });
    const out = await study(fx, { slice: { focus: 'sys' }, exec });
    assert.equal(out.ok, true, JSON.stringify(out));
    const doc = readFd(fx.smDir, fx.id, 'claims.json');
    assert.deepEqual(doc.claims.map((c) => `${c.about}:${c.badge}`).sort(), ['cmp:apps/api#root:confirmed', 'ctr:apps/api:not-found']);
    assert.deepEqual(doc.rejected, []);
    assert.equal(out.approved, 2);
  } finally { fx.done(); }
});
