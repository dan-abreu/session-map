import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { parseRun } from '../server/chat/run.mjs';
import { functionsOf, mergeFunctionChoice, obeyOf, standbyOf } from '../server/ai/brainpanel.mjs';

// The Cérebro on standby (or78) and the footer's model chip (pc40, id178): the table waits aside untouched, and the person
// picks the AI, the model and the level of a conversation the way Claude Code's own picker does.

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const flagOf = (argv, name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

test('standby keeps the table and the switch aside, no reader sees them, and waking brings them back as they were', () => {
  const ai = { others: { enabled: true, obey: true, functions: { code: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } } } };
  const asleep = mergeFunctionChoice(ai, { standby: true });
  assert.equal(asleep.ok, true);
  assert.equal(standbyOf(asleep.ai), true);
  assert.deepEqual(functionsOf(asleep.ai), {}, 'no row is read on standby');
  assert.equal(obeyOf(asleep.ai), false, 'the "obrigatório" switch is not read either');
  assert.equal(asleep.ai.others.enabled, true, 'the other AIs stay switched on');
  assert.deepEqual(mergeFunctionChoice(asleep.ai, { functions: { code: { provider: 'claude' } } }), { ok: false, error: 'standby' }, 'the kept table is not changed');
  assert.deepEqual(mergeFunctionChoice(asleep.ai, { obey: false }), { ok: false, error: 'standby' });
  const awake = mergeFunctionChoice(asleep.ai, { standby: false });
  assert.equal(awake.ok, true);
  assert.deepEqual(awake.ai, ai, 'the table and the switch come back unchanged');
  assert.deepEqual(mergeFunctionChoice(ai, { standby: 'yes' }), { ok: false, error: 'bad-standby' });
});

test('parseRun: a talk carries the person\'s pick of model and level, and refuses anything that is not one', () => {
  assert.deepEqual(parseRun({ kind: 'talk', model: 'sonnet', effort: 'low' }), { kind: 'talk', model: 'sonnet', effort: 'low' });
  assert.deepEqual(parseRun({ kind: 'talk', model: 'deepseek-v4-pro' }), { kind: 'talk', model: 'deepseek-v4-pro' });
  assert.deepEqual(parseRun({ kind: 'talk', effort: 'minimal' }), { kind: 'talk', effort: 'minimal' });
  for (const bad of [{ model: '--dangerously-skip-permissions' }, { model: 'a b' }, { model: 7 }, { effort: 'turbo' }, { effort: 'ultracode' }]) {
    assert.equal(parseRun({ kind: 'talk', ...bad }), null, JSON.stringify(bad));
  }
});

async function withHub(fn) {
  const root = mkdtempSync(join(tmpdir(), 'sm-pick-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-pick-sm-'));
  const log = join(smDir, 'argv.json');
  writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { others: { enabled: true, standby: {} } } }));
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env, FAKE_LOG: log }, snapshot: async () => null, cliOf: () => null, keyOf: async () => null });
  const state = { projects: [{ id: 'demo', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  const level = () => {
    const argv = JSON.parse(readFileSync(log, 'utf8')).argv;
    return `${flagOf(argv, '--model')}/${flagOf(argv, '--effort')}`;
  };
  try {
    const settings = () => JSON.parse(flagOf(JSON.parse(readFileSync(log, 'utf8')).argv, '--settings') ?? '{}');
    await fn({ hub, state, level, settings });
  } finally {
    await hub.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function recorder() {
  const events = [];
  const sink = { write(evt) { events.push(evt); }, end() {} };
  const until = async (pred, ms = 10000) => {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {
      if (pred(events)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`);
  };
  return { sink, events, until };
}
const turns = (events) => events.filter((e) => e.type === 'turn-end').length;

test('the footer lists what can run the talk: Claude with its models and levels, an AI with no key left out, and the standby', async () => {
  await withHub(async ({ hub }) => {
    const res = await hub.engines();
    assert.equal(res.status, 200);
    assert.equal(res.body.standby, true);
    assert.deepEqual(res.body.engines.map((e) => e.ai), ['claude'], 'DeepSeek has no key here: not offered');
    const claude = res.body.engines[0];
    assert.equal(claude.term, 'Effort', 'Claude Code\'s own name for the control');
    const opus = claude.models.find((m) => m.id === 'opus');
    assert.deepEqual(opus.levels.map((l) => l.id), ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(opus.start, 'medium', 'Opus 5.5 starts on medium, as Claude Code starts it');
    assert.equal(claude.models.find((m) => m.id === 'fable').start, 'high');
    assert.ok(claude.models.every((m) => m.ultracode === true), 'ultracode on the four Claude Code runs it on');
    assert.ok(claude.models.every((m) => !m.levels.some((l) => ['off', 'ultracode', 'minimal'].includes(l.id))), 'no level Claude Code does not take');
  });
});

test('each AI\'s own catalog: Codex\'s listed models with its levels, descriptions and start; DeepSeek low, high, max; Gemini minimal on Flash-Lite only', async () => {
  const { nativeCatalog, nativePick } = await import('../server/ai/native-levels.mjs');
  const smDir = mkdtempSync(join(tmpdir(), 'sm-native-'));
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(smDir, 'codex-home'));
    writeFileSync(join(smDir, 'codex-home', 'models_cache.json'), JSON.stringify({ models: [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast responses with lighter reasoning' }, { effort: 'max', description: 'Maximum reasoning depth for the hardest problems' }, { effort: 'ultra', description: 'Maximum reasoning with automatic task delegation' }] },
      { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }] },
    ] }));
    const openai = nativeCatalog('openai', { smDir });
    assert.equal(openai.term, 'Reasoning effort');
    assert.deepEqual(openai.models.map((m) => m.id), ['gpt-6.1-sol'], 'the hidden one is not offered');
    assert.deepEqual(openai.models[0].levels.map((l) => l.id), ['low', 'max', 'ultra']);
    assert.equal(openai.models[0].levels[2].about, 'Maximum reasoning with automatic task delegation');
    assert.equal(openai.models[0].start, 'low');
    assert.deepEqual(nativePick('openai', { model: 'gpt-6.1-sol', effort: 'ultra' }, { smDir }), { model: 'gpt-6.1-sol', effort: 'ultra', ultracode: false });
    assert.equal(nativePick('openai', { model: 'gpt-6.1-sol', effort: 'medium' }, { smDir }), null, 'a level this model does not list');
    assert.equal(nativePick('openai', { model: 'gpt-6.1-sol', effort: 'low', ultracode: true }, { smDir }), null, 'ultracode is Claude Code\'s alone');
  } finally {
    await rm(smDir, { recursive: true, force: true });
  }
  const deepseek = nativeCatalog('deepseek');
  assert.ok(deepseek.models.every((m) => m.levels.map((l) => l.id).join() === 'low,high,max' && m.start === 'high'), JSON.stringify(deepseek.models));
  const gemini = nativeCatalog('gemini');
  assert.equal(gemini.term, 'Thinking level');
  assert.equal(gemini.models.find((m) => m.id === 'gemini-3.5-flash-lite').start, 'minimal');
  assert.ok(!gemini.models.find((m) => m.id === 'gemini-3.8-flash').levels.some((l) => l.id === 'minimal'), '3.8 Flash refuses minimal');
  assert.equal(nativePick('claude', { model: 'opus', effort: 'max', ultracode: true }).ultracode, true);
});

test('a new talk starts on the picked model and level, a live one switches at once, and Automático goes back to the default', async () => {
  await withHub(async ({ hub, state, level }) => {
    const bad = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'oi', ai: 'claude', run: { kind: 'talk', model: 'deepseek-flash' } }, state);
    assert.equal(bad.status, 400, 'a model its AI does not list is refused');
    assert.equal((await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'oi', ai: 'nobody' }, state)).status, 400);

    const res = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'oi', ai: 'claude', run: { kind: 'talk', model: 'sonnet', effort: 'low' } }, state);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await r.until((ev) => turns(ev) >= 1);
    assert.equal(level(), 'sonnet/low');
    const run = r.events.filter((e) => e.type === 'run').at(-1).data;
    assert.deepEqual(run.run, { kind: 'talk', model: 'sonnet', effort: 'low' });
    assert.equal(run.ai, 'claude');

    assert.equal(hub.run(res.body.chatKey, { model: 'opus', effort: 'turbo' }).status, 400, 'a level the model has not');
    const moved = hub.run(res.body.chatKey, { model: 'haiku', effort: 'medium' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    // The flags are the process's: the idle one ends, and the next message resumes the same conversation on the new pick.
    await r.until((ev) => ev.some((e) => e.type === 'session' && e.data.state === 'ended'));
    const sessionId = r.events.find((e) => e.type === 'session' && e.data.sessionId).data.sessionId;
    const again = await hub.start({ projectId: 'demo', sessionId, text: 'de novo' }, state);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const r2 = recorder();
    hub.subscribe(again.body.chatKey, r2.sink);
    await r2.until((ev) => turns(ev) >= 1);
    assert.equal(level(), 'haiku/medium', 'the next message runs on the new pick');

    assert.equal(hub.run(again.body.chatKey, {}).status, 200, 'Automático');
    await r2.until((ev) => ev.some((e) => e.type === 'session' && e.data.state === 'ended'));
    const third = await hub.start({ projectId: 'demo', sessionId, text: 'mais uma' }, state);
    assert.equal(third.status, 200, JSON.stringify(third.body));
    const r3 = recorder();
    hub.subscribe(third.body.chatKey, r3.sink);
    await r3.until((ev) => turns(ev) >= 1);
    assert.equal(level(), 'opus/high', 'back on the policy\'s chat level');
  });
});

test('ultracode reaches Claude Code as its own setting, at the level picked, and a change of it restarts the process', async () => {
  await withHub(async ({ hub, state, level, settings }) => {
    const res = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'oi', ai: 'claude', run: { kind: 'talk', model: 'opus', effort: 'low', ultracode: true } }, state);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = recorder();
    hub.subscribe(res.body.chatKey, r.sink);
    await r.until((ev) => turns(ev) >= 1);
    assert.equal(level(), 'opus/low', 'the level stays the one picked');
    assert.equal(settings().ultracode, true, 'ultracode rides in the session settings');
    assert.ok(settings().hooks, 'beside the guard hooks, not instead of them');
    const run = r.events.filter((e) => e.type === 'run').at(-1).data;
    assert.equal(run.ultracode, true);
    assert.deepEqual(run.run, { kind: 'talk', model: 'opus', effort: 'low', ultracode: true });
    assert.equal(hub.run(res.body.chatKey, { model: 'opus', effort: 'low' }).status, 200);
    await r.until((ev) => ev.some((e) => e.type === 'session' && e.data.state === 'ended'));
  });
});
