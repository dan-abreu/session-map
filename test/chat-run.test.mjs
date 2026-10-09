import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RUN, parseRun, runArgs, runPrompt, expectedRun, settingsRun, readRunBlock, mayReinforce,
  reinforcedSpend, addReinforcedSpend, reinforcedLimit, setReinforcedLimit, withRunNote,
} from '../server/chat/run.mjs';
import { personsWords } from '../server/chat/prompt.mjs';

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

test('parseRun keeps the five shapes and refuses anything else', () => {
  assert.deepEqual(DEFAULT_RUN, { kind: 'auto', selfReinforce: false });
  assert.deepEqual(parseRun({ kind: 'auto' }), { kind: 'auto', selfReinforce: false });
  assert.deepEqual(parseRun({ kind: 'auto', selfReinforce: true }), { kind: 'auto', selfReinforce: true });
  assert.deepEqual(parseRun({ kind: 'maestro', model: 'haiku' }), { kind: 'maestro' });
  assert.deepEqual(parseRun({ kind: 'ultracode' }), { kind: 'ultracode' });
  assert.deepEqual(parseRun({ kind: 'settings' }), { kind: 'settings' });
  assert.deepEqual(parseRun({ kind: 'fixed', model: 'sonnet', effort: 'medium' }), { kind: 'fixed', model: 'sonnet', effort: 'medium' });
  for (const bad of [null, 'auto', {}, { kind: 'turbo' }, { kind: 'fixed', model: 'gpt', effort: 'low' }, { kind: 'fixed', model: 'opus', effort: 'ultracode' },
    { kind: 'fixed', model: 'opus' }, { kind: 'fixed', model: '--dangerously-skip-permissions', effort: 'low' }]) {
    assert.equal(parseRun(bad), null, JSON.stringify(bad));
  }
});

test('runArgs: Automatic and Maestro run Opus at high with their prompt, Ultracode uses the documented flag, Same as my Claude passes nothing', () => {
  const auto = runArgs(DEFAULT_RUN);
  assert.equal(flag(auto, '--model'), 'opus');
  assert.equal(flag(auto, '--effort'), 'high');
  assert.match(flag(auto, '--append-system-prompt'), /session-map-run/);
  assert.match(flag(auto, '--append-system-prompt'), /ask-reinforce/);
  const maestro = runArgs({ kind: 'maestro' });
  assert.equal(flag(maestro, '--model'), 'opus');
  assert.equal(flag(maestro, '--effort'), 'high');
  assert.doesNotMatch(flag(maestro, '--append-system-prompt'), /ask-reinforce/);
  assert.deepEqual(runArgs({ kind: 'ultracode' }), ['--model', 'opus', '--effort', 'ultracode']);
  assert.deepEqual(runArgs({ kind: 'fixed', model: 'haiku', effort: 'max' }), ['--model', 'haiku', '--effort', 'max']);
  assert.deepEqual(runArgs({ kind: 'settings' }), []);
  assert.equal(runPrompt({ kind: 'settings' }), null);
  assert.equal(runPrompt({ kind: 'fixed', model: 'opus', effort: 'low' }), null);
});

test('expectedRun says what will run before claude reports its model', () => {
  const mine = { model: 'opus[1m]', effort: 'xhigh', ultracode: false };
  assert.deepEqual(expectedRun(DEFAULT_RUN, mine), { model: 'opus', effort: 'high', ultracode: false });
  assert.deepEqual(expectedRun({ kind: 'ultracode' }, mine), { model: 'opus', effort: 'xhigh', ultracode: true });
  assert.deepEqual(expectedRun({ kind: 'fixed', model: 'sonnet', effort: 'low' }, mine), { model: 'sonnet', effort: 'low', ultracode: false });
  assert.deepEqual(expectedRun({ kind: 'settings' }, mine), mine);
});

test('settingsRun reads model, effort and ultracode as Claude does: user, then project, then local; a per-model level wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-run-dir-'));
  const root = mkdtempSync(join(tmpdir(), 'sm-run-root-'));
  try {
    assert.deepEqual(settingsRun(root, dir), { model: null, effort: null, ultracode: false });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus[1m]', effortLevel: 'xhigh' }));
    assert.deepEqual(settingsRun(root, dir), { model: 'opus[1m]', effort: 'xhigh', ultracode: false });
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ model: 'sonnet', ultracode: true, modelSettings: { sonnet: { effortLevel: 'low' } } }));
    assert.deepEqual(settingsRun(root, dir), { model: 'sonnet', effort: 'low', ultracode: true });
    writeFileSync(join(root, '.claude', 'settings.local.json'), '{ not json');
    assert.deepEqual(settingsRun(root, dir), { model: 'opus[1m]', effort: 'xhigh', ultracode: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
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

    assert.equal(reinforcedLimit(smDir), null);
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
  const sent = withRunNote({ kind: 'maestro' }, 'Fix the header');
  assert.notEqual(sent, 'Fix the header');
  assert.match(sent, /Maestro|maestro/);
  assert.equal(personsWords(sent), 'Fix the header');
  const fixed = withRunNote({ kind: 'fixed', model: 'haiku', effort: 'low' }, 'Rename it');
  assert.equal(personsWords(fixed), 'Rename it');
  assert.equal(personsWords('plain words'), 'plain words');
});
