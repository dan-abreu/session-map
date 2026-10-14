import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';

// The entry brain in the hub (or31/or29): each message of the person is weighed before it runs, and the chat starts or moves
// to the model and effort that weight asks for. Up at once, down only when the talk gets small, never mid-turn.

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

test('a talk message starts on Sonnet at low, the prompt names it, and the run event says why', async () => {
  await withBrain({}, async ({ hub, state, argv, level }) => {
    const { r } = await open(hub, state, 'o que acha de usar Ollama?');
    await nthTurnEnd(r, 1);
    assert.equal(level(), 'sonnet/low');
    assert.match(flagOf(argv(), '--append-system-prompt'), /on Sonnet at low effort/);
    const run = r.events.find((e) => e.type === 'run').data;
    assert.deepEqual(run.run, { kind: 'autonomous' }, 'the run the person chose is kept');
    assert.deepEqual(run.brain, { phase: 'talk', why: 'talk' });
    assert.equal(run.effort, 'low');
    assert.equal(run.model, 'claude-sonnet-5-5');
    assert.ok(!echoOf(r, 1).includes('phase of this turn'), 'talk carries no directive');
  });
});

test('the level follows the talk: up at once, down when it gets small, and the page keeps its stream', async () => {
  await withBrain({}, async ({ hub, state, log, level }) => {
    const { key, r } = await open(hub, state, 'o que acha de usar Ollama?');
    await nthTurnEnd(r, 1);
    assert.equal(level(), 'sonnet/low');

    // A large plan moves up to Sonnet at medium (the bench, or30) and carries the plan directive; the person's words are shown as written.
    rmSync(log);
    assert.equal(hub.send(key, { text: 'vamos planejar o sistema novo de login do zero' }).status, 200);
    await nthTurnEnd(r, 2);
    assert.equal(level(), 'sonnet/medium');
    assert.match(echoOf(r, 2), /Plan phase: organize the idea/);
    assert.match(echoOf(r, 2), /Write no code until the person approves/);
    assert.deepEqual(r.events.filter((e) => e.type === 'user').map((e) => e.data.text), ['o que acha de usar Ollama?', 'vamos planejar o sistema novo de login do zero']);
    assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0, 'same key, same stream');
    assert.deepEqual(r.events.filter((e) => e.type === 'run').at(-1).data.brain, { phase: 'plan', why: 'plan-big' });

    // "pode construir" after a large plan builds at the plan's size: Sonnet at medium still (high only after a failure, or33), so the same process, with the build directive.
    rmSync(log);
    assert.equal(hub.send(key, { text: 'pode construir' }).status, 200);
    await nthTurnEnd(r, 3);
    assert.equal(existsSync(log), false, 'plan and build share a level: the same process');
    assert.match(echoOf(r, 3), /Build phase: follow the approved plan/);
    // The same level keeps the same process.
    assert.equal(hub.send(key, { text: 'pode seguir' }).status, 200);
    await nthTurnEnd(r, 4);
    assert.equal(existsSync(log), false, 'the same level keeps the same process');

    // "obrigado" moves down to Haiku at low.
    assert.equal(hub.send(key, { text: 'obrigado' }).status, 200);
    await nthTurnEnd(r, 5);
    assert.equal(level(), 'haiku/low');
    assert.doesNotMatch(echoOf(r, 5), /phase of this turn/);

    // A sensitive build moves up to Opus at high; a small build after it does not move down.
    assert.equal(hub.send(key, { text: 'corrige o bug do pagamento' }).status, 200);
    await nthTurnEnd(r, 6);
    assert.equal(level(), 'opus/high');
    rmSync(log);
    assert.equal(hub.send(key, { text: 'corrige o título cortado em header.js' }).status, 200);
    await nthTurnEnd(r, 7);
    assert.equal(existsSync(log), false, 'a build does not step down from Opus');
    assert.equal(r.count((e) => e.type === 'session' && e.data.state === 'ended'), 0);
    // The cost of the processes before the swaps counts on.
    assert.ok(r.events.filter((e) => e.type === 'turn-end').at(-1).data.costUSD >= 0.007 - 1e-9);
  });
});

test('a turn in progress is never switched: the next message waits for its end', async () => {
  await withBrain({}, async ({ hub, state, log, level }) => {
    const { key, r } = await open(hub, state, 'SLOW o que acha disso?');
    await r.until((e) => e.type === 'text' && e.data.partial);
    assert.equal(level(), 'sonnet/low');
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
    assert.equal(level(), 'opus/high');
  });
});

test('Haiku settles a long text the rules cannot read: the higher level wins, a failed call never blocks, a short text never asks', async () => {
  const LONG = `Hoje o time conversou bastante sobre o jeito da pessoa escrever mensagens longas, cheias de contexto. ${'Eu queria registrar o que foi dito. '.repeat(6)}`;
  const asked = [];
  let reply = { ok: true, value: { phase: 'build', size: 'large', sensitive: true } };
  await withBrain({ askHaiku: async (text) => { asked.push(text); if (reply instanceof Error) throw reply; return reply; } }, async ({ hub, state, level }) => {
    const first = await open(hub, state, LONG);
    await nthTurnEnd(first.r, 1);
    assert.equal(asked.length, 1);
    assert.equal(level(), 'opus/high', 'Haiku said sensitive build; the rules said talk; the higher wins');
    await hub.close();

    reply = new Error('boom');
    const second = await open(hub, state, LONG);
    await nthTurnEnd(second.r, 1);
    assert.equal(asked.length, 2);
    assert.equal(level(), 'sonnet/low', 'the rules decide alone');

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

test('only the Autonomous and Automatic runs without a named model are weighed', async () => {
  await withBrain({}, async ({ hub, state, level }) => {
    const named = await open(hub, state, 'oi', { run: { kind: 'autonomous', model: 'opus', effort: 'high' } });
    await nthTurnEnd(named.r, 1);
    assert.equal(level(), 'opus/high', 'a named model is kept');
    assert.equal(named.r.events.find((e) => e.type === 'run').data.brain, null);
    const fixed = await open(hub, state, 'oi', { run: { kind: 'fixed', model: 'sonnet', effort: 'medium' } });
    await nthTurnEnd(fixed.r, 1);
    assert.equal(level(), 'sonnet/medium');
    const auto = await open(hub, state, 'oi', { run: { kind: 'auto', selfReinforce: false } });
    await nthTurnEnd(auto.r, 1);
    assert.equal(level(), 'haiku/low', 'Automatic is weighed too');
  });
});
