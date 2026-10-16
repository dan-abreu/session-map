import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';

// The entry brain in the hub (or31/or35, id146): every message of the person is weighed before it runs, for its phase.
// The level is the policy's chat row and never moves on its own; the phase only shapes the turn (its directive) and the
// run line the page shows.

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const flagOf = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recorder() {
  const events = [];
  const waiters = [];
  const sink = {
    write(evt) {
      events.push(evt);
      for (const w of [...waiters]) if (w.pred(evt)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(evt); }
    },
    end() { sink.ended = true; },
  };
  const until = (pred, ms = 10000) => {
    const hit = events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: setTimeout(() => reject(new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`)), ms) };
      waiters.push(w);
    });
  };
  const count = (pred) => events.filter(pred).length;
  return { sink, events, until, count };
}
const turnEnds = (r) => r.count((e) => e.type === 'turn-end');
const nthTurnEnd = (r, n) => r.until(() => turnEnds(r) >= n);

// A hub on the fake claude; the log holds the flags of the newest process it started.
async function withBrain(opts, fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-brain-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-brain-sm-'));
  const log = join(smDir, 'argv.json');
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env, FAKE_LOG: log }, snapshot: async () => null, ...opts });
  const state = { projects: [{ id: 'demo', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  const argv = () => JSON.parse(readFileSync(log, 'utf8')).argv;
  const level = () => `${flagOf(argv(), '--model')}/${flagOf(argv(), '--effort')}`;
  try {
    await fn({ hub, state, smDir, log, argv, level });
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

const open = async (hub, state, text, extra = {}) => {
  const res = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text, ...extra }, state);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = recorder();
  hub.subscribe(res.body.chatKey, r.sink);
  return { key: res.body.chatKey, r };
};
const echoOf = (r, n) => r.events.filter((e) => e.type === 'text' && !e.data.partial)[n - 1].data.text;

test('a talk message starts on the policy\'s chat level, and the run event says the phase and why', async () => {
  await withBrain({}, async ({ hub, state, argv, level }) => {
    const { r } = await open(hub, state, 'o que acha de usar Ollama?');
    await nthTurnEnd(r, 1);
    assert.equal(level(), 'opus/high');
    assert.equal(flagOf(argv(), '--append-system-prompt').includes('session-map-run'), false, 'the stance alone, never a conductor prompt');
    const run = r.events.find((e) => e.type === 'run').data;
    assert.deepEqual(run.run, { kind: 'talk' }, 'the brain\'s talk is the default');
    assert.deepEqual(run.brain, { phase: 'talk', why: 'talk' });
    assert.equal(run.effort, 'high');
    assert.equal(run.model, 'claude-opus-5-5');
    assert.ok(!echoOf(r, 1).includes('phase of this turn'), 'talk carries no directive');
  });
});

test('the level is the policy\'s and never moves: the phases only shape each turn\'s directive, the same process runs', async () => {
  await withBrain({}, async ({ hub, state, log, level }) => {
    const { key, r } = await open(hub, state, 'o que acha de usar Ollama?');
    await nthTurnEnd(r, 1);
    assert.equal(level(), 'opus/high');

    // A large plan carries the plan directive; the level stays (or35).
    rmSync(log);
    assert.equal(hub.send(key, { text: 'vamos planejar o sistema novo de login do zero' }).status, 200);
    await nthTurnEnd(r, 2);
    assert.equal(existsSync(log), false, 'the level never moves: the same process');
    assert.match(echoOf(r, 2), /Plan phase: organize the idea/);
    assert.match(echoOf(r, 2), /Write no code until the person approves/);
    assert.deepEqual(r.events.filter((e) => e.type === 'user').map((e) => e.data.text), ['o que acha de usar Ollama?', 'vamos planejar o sistema novo de login do zero']);
    assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0, 'same key, same stream');
    assert.deepEqual(r.events.filter((e) => e.type === 'run').at(-1).data.brain, { phase: 'plan', why: 'plan-big' });

    // "pode construir" after a large plan builds at the plan's size, with the build directive.
    assert.equal(hub.send(key, { text: 'pode construir' }).status, 200);
    await nthTurnEnd(r, 3);
    assert.match(echoOf(r, 3), /Build phase: follow the approved plan/);

    // A greeting carries no directive; a sensitive build is weighed as such; the level still never moves.
    assert.equal(hub.send(key, { text: 'obrigado' }).status, 200);
    await nthTurnEnd(r, 4);
    assert.doesNotMatch(echoOf(r, 4), /phase of this turn/);
    assert.equal(hub.send(key, { text: 'corrige o bug do pagamento' }).status, 200);
    await nthTurnEnd(r, 5);
    assert.deepEqual(r.events.filter((e) => e.type === 'run').at(-1).data.brain, { phase: 'build', why: 'money' });
    assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0);
    // The cost of the process counts on.
    assert.ok(r.events.filter((e) => e.type === 'turn-end').at(-1).data.costUSD >= 0.005 - 1e-9);
  });
});

test('a turn in progress never starts another: the next message waits for its end', async () => {
  await withBrain({}, async ({ hub, state, log, level }) => {
    const { key, r } = await open(hub, state, 'SLOW o que acha disso?');
    await r.until((e) => e.type === 'text' && e.data.partial);
    assert.equal(level(), 'opus/high');
    rmSync(log);
    assert.deepEqual(hub.send(key, { text: 'corrige o bug do pagamento' }), { status: 409, body: { ok: false, error: 'busy' } });
    const again = await hub.start({ projectId: 'demo', sessionId: r.events.find((e) => e.type === 'session').data.sessionId, text: 'corrige o bug do pagamento' }, state);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'busy');
    await pause(300);
    assert.equal(existsSync(log), false, 'no new process while the turn runs');
    assert.equal(hub.stop(key).status, 200);
    await nthTurnEnd(r, 1);
    assert.equal(hub.send(key, { text: 'corrige o bug do pagamento' }).status, 200);
    await nthTurnEnd(r, 2);
    assert.equal(existsSync(log), false, 'the level never moved: the same process, no new flags');
  });
});

test('Haiku settles a long text the rules cannot read: the higher phase wins, a failed call never blocks, a short text never asks', async () => {
  const LONG = `Hoje o time conversou bastante sobre o jeito da pessoa escrever mensagens longas, cheias de contexto. ${'Eu queria registrar o que foi dito. '.repeat(6)}`;
  const asked = [];
  let reply = { ok: true, value: { phase: 'build', size: 'large', sensitive: true } };
  await withBrain({ askHaiku: async (text) => { asked.push(text); if (reply instanceof Error) throw reply; return reply; } }, async ({ hub, state, level }) => {
    const first = await open(hub, state, LONG);
    await nthTurnEnd(first.r, 1);
    assert.equal(asked.length, 1);
    assert.equal(level(), 'opus/high', 'the level is the policy\'s whatever the phase');
    assert.equal(first.r.events.find((e) => e.type === 'run').data.brain.phase, 'build', 'Haiku said build; the rules said talk; the higher wins');
    await hub.close();

    reply = new Error('boom');
    const second = await open(hub, state, LONG);
    await nthTurnEnd(second.r, 1);
    assert.equal(asked.length, 2);
    assert.equal(second.r.events.find((e) => e.type === 'run').data.brain.phase, 'talk', 'the rules decide alone');

    reply = { ok: false, error: 'timeout' };
    const third = await open(hub, state, 'corrige o bug do pagamento');
    await nthTurnEnd(third.r, 1);
    assert.equal(asked.length, 2, 'a short text and a sure rule never ask');
  });
});

test('Haiku is not asked for a request the chat limit would refuse', async () => {
  const LONG = `Hoje o time conversou bastante sobre o jeito da pessoa escrever mensagens longas, cheias de contexto. ${'Eu queria registrar o que foi dito. '.repeat(6)}`;
  const asked = [];
  await withBrain({ chatsMax: 1, askHaiku: async (text) => { asked.push(text); return { ok: false }; } }, async ({ hub, state }) => {
    await open(hub, state, 'oi');
    assert.equal(asked.length, 0);
    const refused = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: LONG }, state);
    assert.equal(refused.status, 429);
    assert.equal(asked.length, 0, 'no subprocess for a refused request');
  });
});

test('only the runs without a named model are weighed', async () => {
  await withBrain({}, async ({ hub, state, level }) => {
    const named = await open(hub, state, 'oi', { run: { kind: 'autonomous', model: 'opus', effort: 'high' } });
    await nthTurnEnd(named.r, 1);
    assert.equal(level(), 'opus/high', 'a named model is kept');
    assert.equal(named.r.events.find((e) => e.type === 'run').data.brain, null);
    const talk = await open(hub, state, 'oi', { run: { kind: 'talk' } });
    await nthTurnEnd(talk.r, 1);
    assert.equal(level(), 'opus/high', 'the talk runs at the policy\'s chat level');
    assert.equal(talk.r.events.find((e) => e.type === 'run').data.brain.phase, 'trivial', 'talk is weighed too');
  });
});

test('the Conversa row of the Cérebro sets the talk level; the policy\'s chat row is the default (id146)', async () => {
  await withBrain({}, async ({ hub, state, smDir, level }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { chat: { model: 'sonnet', effort: 'low' } } } } }));
    const { r } = await open(hub, state, 'o que acha de usar Ollama?');
    await nthTurnEnd(r, 1);
    assert.equal(level(), 'sonnet/low', 'the owner\'s choice in the Cérebro runs');
    const run = r.events.find((e) => e.type === 'run').data;
    assert.equal(run.effort, 'low');
    assert.deepEqual(run.brain, { phase: 'talk', why: 'talk' }, 'the phase still comes from the entry brain');
    await hub.close();
  });
});

test('the Cérebro\'s brain row on another company\'s AI (id154): the weighing goes there; its model never reaches Claude; a failure falls back', async () => {
  const LONG = `Hoje o time conversou bastante sobre o jeito da pessoa escrever mensagens longas, cheias de contexto. ${'Eu queria registrar o que foi dito. '.repeat(6)}`;
  const sent = [];
  let reply = { ok: true, value: { phase: 'build', size: 'large', sensitive: false } };
  const weighOther = async (prompt, o) => { sent.push(o.choice); return reply; };
  await withBrain({ weighOther }, async ({ hub, state, smDir, level }) => {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { brain: { provider: 'deepseek', model: 'deepseek-v4-pro' }, chat: { provider: 'deepseek', model: 'deepseek-v4-pro' } } } } }));
    const first = await open(hub, state, LONG);
    await nthTurnEnd(first.r, 1);
    assert.deepEqual(sent, [{ provider: 'deepseek', model: 'deepseek-v4-pro' }], 'the row\'s AI weighs the message');
    assert.equal(first.r.events.find((e) => e.type === 'run').data.brain.phase, 'build');
    assert.equal(level(), 'opus/high', 'a chat row on another AI never sends its model to the Claude CLI');
    await hub.close();

    reply = null;
    const second = await open(hub, state, LONG);
    await nthTurnEnd(second.r, 1);
    assert.equal(sent.length, 2, 'asked again; nothing came back, so the Claude call (the fake) took over');
    await hub.close();

    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { functions: { chat: { model: 'deepseek-v4-pro' } } } } }));
    const third = await open(hub, state, 'oi');
    await nthTurnEnd(third.r, 1);
    assert.equal(level(), 'opus/high', 'a model of another company with no AI named never reaches the Claude CLI');
  });
});
