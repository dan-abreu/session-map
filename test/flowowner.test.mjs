// The mechanical owner of a function (fl16): server > ai > bot > script, with the reasons kept for the hover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile } from '../server/arch/flowowner.mjs';

test('a module that imports from an ai folder is the AI', () => {
  const out = classifyFile({ path: 'server/collect-ai.mjs', text: '', imports: [{ spec: './ai/helper.mjs', target: 'server/ai/helper.mjs' }] });
  assert.equal(out.owner, 'ai');
  assert.ok(out.reasons.some((r) => r.includes('ai-folder')));
});

test('a pure ai helper import (digest, redact) is not the AI', () => {
  const out = classifyFile({ path: 'server/collect.mjs', text: '', imports: [{ spec: './ai/digest.mjs', target: 'server/ai/digest.mjs' }] });
  assert.equal(out.owner, 'script');
});

test('an AI SDK import is the AI even when it does not resolve', () => {
  const out = classifyFile({ path: 'server/llm.mjs', text: '', imports: [{ spec: '@anthropic-ai/sdk', target: null }] });
  assert.equal(out.owner, 'ai');
  assert.ok(out.reasons.some((r) => r.includes('ai-sdk')));
});

test('the claude driver and the hub are the AI whatever they import', () => {
  for (const path of ['server/chat/driver.mjs', 'server/chat/hub.mjs']) {
    const out = classifyFile({ path, text: '' });
    assert.equal(out.owner, 'ai', path);
    assert.deepEqual(out.reasons, ['driver']);
  }
});

test('a file that only offers a claude shortcut (the actions) is a script', () => {
  const out = classifyFile({ path: 'server/actions.mjs', text: '', signals: [{ type: 'command', value: 'claude', line: 140 }] });
  assert.equal(out.owner, 'script');
});

test('the robots by definition are bots even without a timer in their head', () => {
  for (const path of ['server/restart.mjs', 'server/arch/clerk.mjs', 'server/arch/livemark.mjs']) {
    const out = classifyFile({ path, text: '' });
    assert.equal(out.owner, 'bot', path);
    assert.deepEqual(out.reasons, ['robot']);
  }
});

test('a hook runs inside Claude Code and is the AI', () => {
  const out = classifyFile({ path: 'hooks/guard.mjs', text: '', isHook: true });
  assert.equal(out.owner, 'ai');
  assert.deepEqual(out.reasons, ['hook']);
});

test('the server wins over the AI: it listens and calls everything', () => {
  const out = classifyFile({ path: 'server/main.mjs', text: '', imports: [{ spec: 'node:http', target: null }, { spec: './ai/askroute.mjs', target: 'server/ai/askroute.mjs', names: [] }], signals: [{ type: 'listen', value: 'listen', line: 4 }] });
  assert.equal(out.owner, 'bot');
  assert.deepEqual(out.reasons, ['server']);
});

test('a listen signal in a scanner is not a server', () => {
  const out = classifyFile({ path: 'server/arch/flowscan.mjs', text: '', signals: [{ type: 'listen', value: 'listen', line: 3 }] });
  assert.equal(out.owner, 'script');
});

test('the hub stays the AI even though its relay listens', () => {
  const out = classifyFile({ path: 'server/chat/hub.mjs', text: '', imports: [{ spec: 'node:http', target: null, names: [] }], signals: [{ type: 'listen', value: 'listen', line: 4 }] });
  assert.equal(out.owner, 'ai');
  assert.deepEqual(out.reasons, ['driver']);
});

test('a pure helper import from the runner (isAiRunnerCwd) is not the AI', () => {
  const out = classifyFile({ path: 'server/collect.mjs', text: '', imports: [{ spec: './ai/runner.mjs', target: 'server/ai/runner.mjs', names: ['isAiRunnerCwd'] }] });
  assert.equal(out.owner, 'script');
});

test('the runner import that calls the model (runClaudeJSON) is the AI', () => {
  const out = classifyFile({ path: 'server/bench/classify-build.mjs', text: '', imports: [{ spec: '../ai/runner.mjs', target: 'server/ai/runner.mjs', names: ['runClaudeJSON'] }] });
  assert.equal(out.owner, 'ai');
});

test('a chokidar import is a bot, and its name in a regex literal is not', () => {
  assert.equal(classifyFile({ path: 'server/watch.mjs', text: '', imports: [{ spec: 'chokidar', target: null, names: [] }] }).owner, 'bot');
  assert.equal(classifyFile({ path: 'server/arch/flowowner.mjs', text: 'const R = /\\bchokidar\\b|cron\\.schedule/;' }).owner, 'script');
});

test('a page module with a loop is still a script: the server is the bot', () => {
  const out = classifyFile({ path: 'server/web/censusview.js', text: 'setInterval(refresh, 1000);' });
  assert.equal(out.owner, 'script');
});

test('a watcher with an interval loop is a bot', () => {
  const out = classifyFile({ path: 'server/alerts/watcher.mjs', text: 'setInterval(() => look(), 10000);' });
  assert.equal(out.owner, 'bot');
  assert.ok(out.reasons.includes('loop') || out.reasons.includes('name'));
});

test('a parser loop (for (;;)) is not a bot', () => {
  const out = classifyFile({ path: 'server/sources/deepseek.mjs', text: 'for (;;) { readBlock(); }' });
  assert.equal(out.owner, 'script');
});

test('a plain module is a script', () => {
  const out = classifyFile({ path: 'server/arch/parse.mjs', text: '// parses markdown files' });
  assert.equal(out.owner, 'script');
  assert.deepEqual(out.reasons, []);
});

test('ai beats bot and script when both match', () => {
  const out = classifyFile({ path: 'server/watch.mjs', text: 'setInterval(() => ask(), 1000);', imports: [{ spec: './ai/router.mjs', target: 'server/ai/router.mjs' }] });
  assert.equal(out.owner, 'ai');
});
