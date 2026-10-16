import test from 'node:test';
import { STANCE } from '../server/ai/stance.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RUN, parseRun, runArgs, runPrompt, expectedRun, readRunBlock, mayReinforce,
  reinforcedSpend, addReinforcedSpend, reinforcedLimit, setReinforcedLimit, withRunNote, budgetLine, isWeighed, withWeighed,
} from '../server/chat/run.mjs';
import { conductorTail } from '../server/ai/conductor.mjs';
import { personsWords } from '../server/chat/prompt.mjs';

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

test('parseRun keeps the brain\'s two shapes and refuses anything else; a new conversation runs the brain\'s talk', () => {
  assert.deepEqual(DEFAULT_RUN, { kind: 'talk' });
  assert.deepEqual(parseRun({ kind: 'talk' }), { kind: 'talk' });
  assert.deepEqual(parseRun({ kind: 'autonomous', selfReinforce: false }), { kind: 'autonomous' });
  for (const bad of [null, 'auto', {}, { kind: 'turbo' }, { kind: 'auto', selfReinforce: false }, { kind: 'maestro' },
    { kind: 'ultracode' }, { kind: 'settings' }, { kind: 'fixed', model: 'sonnet', effort: 'medium' },
    { kind: 'fixed', model: '--dangerously-skip-permissions', effort: 'low' }]) {
    assert.equal(parseRun(bad), null, JSON.stringify(bad));
  }
});

test('runArgs: the talk chat runs on the policy\'s chat level with the stance alone, never a conductor prompt', () => {
  const talk = runArgs({ kind: 'talk' });
  assert.equal(flag(talk, '--model'), 'opus');
  assert.equal(flag(talk, '--effort'), 'high');
  assert.equal(flag(talk, '--append-system-prompt'), STANCE);
  assert.equal(runPrompt({ kind: 'talk' }), null);
  assert.ok(runPrompt({ kind: 'autonomous' }).includes(STANCE), 'Autonomous agrees or disagrees on evidence (or27)');
});

test('expectedRun says what will run before claude reports its model', () => {
  assert.deepEqual(expectedRun(DEFAULT_RUN), { model: 'opus', effort: 'high', ultracode: false });
  assert.deepEqual(expectedRun({ kind: 'talk' }), { model: 'opus', effort: 'high', ultracode: false });
  assert.deepEqual(expectedRun({ kind: 'autonomous' }), { model: 'opus', effort: 'high', ultracode: false });
  assert.equal(expectedRun(null), null);
  assert.equal(expectedRun({ kind: 'junk' }), null);
});

test('readRunBlock takes the last session-map-run fence of a reply and ignores junk', () => {
  const fence = (body) => `\`\`\`session-map-run\n${body}\n\`\`\``;
  assert.equal(readRunBlock('no block here'), null);
  assert.deepEqual(readRunBlock(`Done.\n\n${fence('{"level":"direct","why":"a question"}')}`), { level: 'direct', why: 'a question' });
  assert.deepEqual(readRunBlock(`${fence('{"level":"direct"}')}\nthen\n${fence('{"level":"ask-reinforce","why":"touches sign in","estimateUSD":4.5}')}`),
    { level: 'ask-reinforce', why: 'touches sign in', estimateUSD: 4.5 });
  assert.equal(readRunBlock(fence('{"level":"turbo"}')), null);
  assert.equal(readRunBlock(fence('not json')), null);
  assert.deepEqual(readRunBlock(fence(`{"level":"helpers","why":"${'x'.repeat(400)}","estimateUSD":-3}`)).why.length, 160);
  assert.equal(readRunBlock(fence('{"level":"helpers","estimateUSD":-3}')).estimateUSD, undefined);
});

// Seen on the real Opus (2026-10-09): a long reason was cut mid-word ("nem servidor de") in the header and the ask card.
test('readRunBlock shortens a long reason at a word and marks the cut', () => {
  const fence = (body) => `\`\`\`session-map-run\n${body}\n\`\`\``;
  const long = 'Login com senha, cobrança por cartão e publicação em produção mexem com segurança, dados pessoais e dinheiro; o projeto ainda não tem aplicativo nem servidor de pagamento';
  const why = readRunBlock(fence(JSON.stringify({ level: 'ask-reinforce', why: long }))).why;
  assert.ok(why.length <= 160, `${why.length} chars`);
  assert.ok(why.endsWith('…'), why);
  assert.ok(long.startsWith(why.slice(0, -1)) && /[\p{L}\p{N}]$/u.test(why.slice(0, -1)), `cut at a word: ${why}`);
  assert.ok(!/\s…$/.test(why) && !/[,;]…$/.test(why), why);
});

test('the Autonomous prompt asks for a short reason', () => {
  assert.match(runPrompt({ kind: 'autonomous' }), /"why": "a short reason[^"]*(\d+) words/);
});

// ---- the Autonomous way (pc16), the orchestrator's own ----

test('runArgs and expectedRun: Autonomous runs Opus at high with its own prompt and the tail', () => {
  const args = runArgs({ kind: 'autonomous' }, 'TAIL');
  assert.equal(flag(args, '--model'), 'opus');
  assert.equal(flag(args, '--effort'), 'high');
  assert.equal(flag(args, '--append-system-prompt'), `${runPrompt({ kind: 'autonomous' })}\nTAIL`);
  assert.deepEqual(expectedRun({ kind: 'autonomous' }), { model: 'opus', effort: 'high', ultracode: false });
});

// The activity chats of the orchestrator (or02/or06) run the Autonomous way on the model and effort it picked.
test('Autonomous takes an optional model and effort from the fixed lists, Opus at high by default', () => {
  assert.deepEqual(parseRun({ kind: 'autonomous', model: 'sonnet', effort: 'medium' }), { kind: 'autonomous', model: 'sonnet', effort: 'medium' });
  assert.deepEqual(parseRun({ kind: 'autonomous', model: 'haiku' }), { kind: 'autonomous', model: 'haiku' });
  assert.deepEqual(parseRun({ kind: 'autonomous', effort: 'low' }), { kind: 'autonomous', effort: 'low' });
  for (const bad of [{ model: 'gpt' }, { effort: 'ultracode' }, { model: '--dangerously-skip-permissions' }, { model: 7 }]) {
    assert.equal(parseRun({ kind: 'autonomous', ...bad }), null, JSON.stringify(bad));
  }
  const sonnet = runArgs({ kind: 'autonomous', model: 'sonnet', effort: 'medium' }, 'TAIL');
  assert.equal(flag(sonnet, '--model'), 'sonnet');
  assert.equal(flag(sonnet, '--effort'), 'medium');
  assert.match(flag(sonnet, '--append-system-prompt'), /Sonnet at medium effort/);
  assert.match(flag(sonnet, '--append-system-prompt'), /TAIL$/);
  assert.equal(flag(runArgs({ kind: 'autonomous', model: 'haiku' }), '--effort'), 'high');
  assert.equal(flag(runArgs({ kind: 'autonomous', effort: 'max' }), '--model'), 'opus');
  assert.deepEqual(expectedRun({ kind: 'autonomous', model: 'fable', effort: 'max' }), { model: 'fable', effort: 'max', ultracode: false });
  assert.deepEqual(expectedRun({ kind: 'autonomous', model: 'haiku' }), { model: 'haiku', effort: 'high', ultracode: false });
  assert.match(runPrompt({ kind: 'autonomous' }), /Opus at high effort/);
});

test('the Autonomous prompt finishes on its own, never asks, decides and lists its decisions, and stops only for the budget', () => {
  const p = runPrompt({ kind: 'autonomous' });
  assert.match(p, /Autonomous/);
  assert.match(p, /end to end/i);
  assert.match(p, /never ask the person/i);
  assert.match(p, /AskUserQuestion/);
  assert.match(p, /senior would recommend/i);
  assert.match(p, /monthly limit/i);
  assert.match(p, /Decisions I took/);
  assert.match(p, /Decisões que tomei/);
  assert.match(p, /Left for you/);
  assert.match(p, /Ficou para você/);
  assert.match(p, /restart_session_map/);
  assert.match(p, /never kill or start/i);
  assert.match(p, /--force-with-lease/);
  assert.match(p, /refs\/session-map\/safety/);
  assert.match(p, /ask_other_ai/, 'the shared arsenal is there');
  assert.match(p, /"level": "direct" \| "helpers" \| "reinforced" \| "ask-reinforce"/);
  assert.match(p, /"why": "a short reason[^"]*(\d+) words/);
});

test('the conductor knows the nine specialists and their entry ingredients (or59)', () => {
  const p = runPrompt({ kind: 'autonomous' });
  for (const role of ['planner', 'finder', 'writer', 'coder', 'designer', 'debugger', 'reviewer', 'architect', 'guardian']) {
    assert.match(p, new RegExp(`\\b${role}\\b`), role);
  }
  assert.match(p, /Specialists: planner/);
  assert.match(p, /Vague brief denied: name defect, delivery, tests, code/);
});

test('the Autonomous prompt stays compact: with the tail of a day with nothing measured it is under 4 KB', () => {
  const tail = [conductorTail({ others: null, stats: [] }), budgetLine({ limitUSD: 1234.5, spentUSD: 999.25 })].join('\n');
  const sent = flag(runArgs({ kind: 'autonomous' }, tail), '--append-system-prompt');
  assert.ok(Buffer.byteLength(sent, 'utf8') < 4096, `${Buffer.byteLength(sent, 'utf8')} bytes`);
});

test('budgetLine tells the conductor the monthly limit and what is left, or that none is set', () => {
  assert.match(budgetLine({ limitUSD: 20, spentUSD: 3 }), /monthly limit[^\n]*US\$ 20\.00[^\n]*US\$ 17\.00 left/i);
  assert.match(budgetLine({ limitUSD: 5, spentUSD: 9 }), /US\$ 0\.00 left/);
  assert.match(budgetLine({ limitUSD: null, spentUSD: 0 }), /no monthly limit is set: ask before reinforcing/i);
  assert.match(budgetLine({ limitUSD: 0, spentUSD: 0 }), /US\$ 0\.00 left/);
});

test('mayReinforce: only when the person allowed it, a limit is set and the estimate still fits this month', () => {
  assert.equal(mayReinforce({ selfReinforce: false, limitUSD: 50, spentUSD: 0, estimateUSD: 1 }), false);
  assert.equal(mayReinforce({ selfReinforce: true, limitUSD: null, spentUSD: 0, estimateUSD: 1 }), false);
  assert.equal(mayReinforce({ selfReinforce: true, limitUSD: 0, spentUSD: 0, estimateUSD: 0 }), false);
  assert.equal(mayReinforce({ selfReinforce: true, limitUSD: 50, spentUSD: 10, estimateUSD: 40 }), true);
  assert.equal(mayReinforce({ selfReinforce: true, limitUSD: 50, spentUSD: 10, estimateUSD: 41 }), false);
  assert.equal(mayReinforce({ selfReinforce: true, limitUSD: 50, spentUSD: 50, estimateUSD: undefined }), false);
  assert.equal(mayReinforce({ selfReinforce: true, limitUSD: 50, spentUSD: 49, estimateUSD: undefined }), true);
});

test('the reinforced spend is counted per calendar month, and the limit lives in session-map\'s own config', () => {
  const smDir = mkdtempSync(join(tmpdir(), 'sm-run-sm-'));
  try {
    const oct = new Date(2026, 9, 9);
    const nov = new Date(2026, 10, 1);
    assert.equal(reinforcedSpend(smDir, oct), 0);
    addReinforcedSpend(smDir, 1.25, oct);
    addReinforcedSpend(smDir, 0.75, oct);
    assert.equal(reinforcedSpend(smDir, oct), 2);
    assert.equal(reinforcedSpend(smDir, nov), 0);
    addReinforcedSpend(smDir, -5, oct);
    addReinforcedSpend(smDir, Number.NaN, oct);
    assert.equal(reinforcedSpend(smDir, oct), 2);

    assert.equal(reinforcedLimit(smDir), 30);
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ currency: { code: 'BRL', rate: 5 }, budget: { monthlyUSD: 100 } }, null, 2));
    assert.deepEqual(setReinforcedLimit(smDir, 30), { ok: true, limitUSD: 30 });
    assert.equal(reinforcedLimit(smDir), 30);
    const saved = JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8'));
    assert.deepEqual(saved, { currency: { code: 'BRL', rate: 5 }, budget: { monthlyUSD: 100, reinforcedMonthlyUSD: 30 } });
    for (const bad of [-1, 'x', Number.NaN, 1e9]) assert.deepEqual(setReinforcedLimit(smDir, bad), { ok: false, error: 'bad-limit' });
    writeFileSync(join(smDir, 'config.json'), '{ broken');
    assert.deepEqual(setReinforcedLimit(smDir, 10), { ok: false, error: 'config-unreadable' });
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('a run note goes before the person\'s words when the way of working changes mid-conversation, and the page never shows it', () => {
  const sent = withRunNote({ kind: 'autonomous' }, 'Fix the header');
  assert.notEqual(sent, 'Fix the header');
  assert.match(sent, /Autonomous/);
  assert.equal(personsWords(sent), 'Fix the header');
  const plain = withRunNote({ kind: 'talk' }, 'Rename it');
  assert.equal(plain, 'Rename it', 'the talk run has no note of its own');
  assert.equal(personsWords('plain words'), 'plain words');
});

// ---- the entry brain's level on top of the run (or31/or35) ----

test('withWeighed puts the weighed level on the talk and the unnamed Autonomous; the prompt names the real model', () => {
  const level = { model: 'sonnet', effort: 'low' };
  assert.equal(isWeighed({ kind: 'talk' }), true);
  assert.equal(isWeighed({ kind: 'autonomous' }), true);
  for (const run of [{ kind: 'autonomous', model: 'opus' }, { kind: 'autonomous', effort: 'high' }]) {
    assert.equal(isWeighed(run), false, JSON.stringify(run));
    assert.deepEqual(withWeighed(run, level), run);
  }
  assert.deepEqual(withWeighed({ kind: 'talk' }, null), { kind: 'talk' });
  const talk = withWeighed({ kind: 'talk' }, level);
  assert.deepEqual(talk, { kind: 'talk', model: 'sonnet', effort: 'low' });
  const args = runArgs(talk);
  assert.deepEqual([flag(args, '--model'), flag(args, '--effort')], ['sonnet', 'low']);
  assert.equal(flag(args, '--append-system-prompt'), STANCE);
  assert.deepEqual(expectedRun(talk), { model: 'sonnet', effort: 'low', ultracode: false });
  assert.match(runPrompt(withWeighed({ kind: 'autonomous' }, { model: 'haiku', effort: 'low' })), /on Haiku at low effort/);
});

test('the weighed Autonomous prompt with its tail stays under 4 KB at every level', () => {
  const tail = [conductorTail({ others: null, stats: [] }), budgetLine({ limitUSD: 1234.5, spentUSD: 999.25 })].join('\n');
  for (const level of [{ model: 'haiku', effort: 'low' }, { model: 'sonnet', effort: 'medium' }, { model: 'opus', effort: 'high' }]) {
    const sent = flag(runArgs(withWeighed({ kind: 'autonomous' }, level), tail), '--append-system-prompt');
    assert.ok(Buffer.byteLength(sent, 'utf8') < 4096, `${level.model}: ${Buffer.byteLength(sent, 'utf8')} bytes`);
  }
});
