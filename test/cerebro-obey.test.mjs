import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/main.mjs';
import { loadToken } from '../server/auth.mjs';
import { guardObey, guardStep, shellWritesCode } from '../server/chat/guard.mjs';
import { mergeFunctionChoice, obeyOf } from '../server/ai/brainpanel.mjs';
import { OBEY_LINE, cerebroNote } from '../server/ai/cerebro-note.mjs';
import { reviewerFor } from '../server/ai/runroute.mjs';

// The Cérebro obeyed (id176, or77). Watched live on 2026-10-17: told the owner's table, a page chat on DeepSeek wrote 25
// files itself, never called run_other_ai and had nothing reviewed. With the owner's switch on, the program holds it: the
// talk's own code edits are refused, the work goes to the row's AI, and the program reviews before it merges.

const ROWS = { code: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' }, screen: { provider: 'deepseek', model: 'deepseek-flash' } };
const edit = (file_path, extra = {}) => ({ tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' }, ...extra });

test('the switch is saved and read: on, off, and anything but a yes or no refused', () => {
  const on = mergeFunctionChoice({ others: { dailyUSD: 5, functions: ROWS } }, { obey: true });
  assert.equal(on.ok, true);
  assert.equal(obeyOf(on.ai), true);
  assert.deepEqual(on.ai.others.functions, ROWS, 'the rows stay');
  assert.equal(on.ai.others.dailyUSD, 5);
  const off = mergeFunctionChoice(on.ai, { obey: false });
  assert.equal(obeyOf(off.ai), false);
  assert.equal('obey' in off.ai.others, false);
  assert.equal(mergeFunctionChoice(on.ai, { obey: 'yes' }).error, 'bad-obey');
});

test('on, the talk cannot write a code file itself: it is told the row\'s AI and how to hand it over', () => {
  const denied = guardObey(edit('C:/dev/cverino/packages/core/src/selos/calcular-selos.ts'), { functions: ROWS });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /deepseek deepseek-flash high/);
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /run_other_ai \(kind code, provider deepseek/);
  for (const tool of ['Write', 'MultiEdit']) assert.ok(guardObey({ tool_name: tool, tool_input: { file_path: 'a.py' } }, { functions: ROWS }), tool);
  // Plans, specs and text stay the talk's; an agent's own steps are the hand-over itself.
  assert.equal(guardObey(edit('openspec/changes/selos/proposal.md'), { functions: ROWS }), null);
  assert.equal(guardObey(edit('VERSION'), { functions: ROWS }), null);
  assert.equal(guardObey(edit('src/a.ts', { agent_id: 'a1' }), { functions: ROWS }), null);
  // With the code row on Claude, the hand-over is a [code] agent.
  const onClaude = guardObey(edit('src/a.ts'), { functions: {} });
  assert.match(onClaude.hookSpecificOutput.permissionDecisionReason, /\[code\]/);
});

test('on, a Claude agent cannot take work whose row names another AI; the general rule counts too', () => {
  const agent = (description) => ({ tool_name: 'Agent', tool_input: { description, prompt: 'fix it, tests green' } });
  assert.match(guardObey(agent('[code] selos cron'), { functions: ROWS }).hookSpecificOutput.permissionDecisionReason, /run_other_ai \(kind code, provider deepseek\)/);
  assert.ok(guardObey(agent('[test] selos'), { functions: ROWS }), 'test is the code row');
  assert.ok(guardObey(agent('[screen] the badge'), { functions: ROWS }));
  assert.equal(guardObey(agent('[review] the selos diff'), { functions: ROWS }), null, 'the review row is on Claude');
  assert.equal(guardObey(agent('[search] where are the crons'), { functions: ROWS }), null);
  assert.equal(guardObey(agent('[code] selos'), { functions: {} }), null, 'row on Claude: the agent is the hand-over');
  assert.ok(guardObey(agent('[debug] the cron'), { functions: { agents: { provider: 'openai' } } }), 'the rule over every row');
  // An untagged agent could do the code row's work unseen: with a row on another AI, the kind must be said.
  assert.match(guardObey(agent('fix the cron'), { functions: ROWS }).hookSpecificOutput.permissionDecisionReason, /\[code\], \[review\]/);
  assert.equal(guardObey(agent('fix the cron'), { functions: {} }), null, 'every row on Claude: no tag needed');
  assert.ok(guardObey({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'a.ipynb' } }, { functions: ROWS }));
  assert.equal(guardObey(edit('package.json'), { functions: ROWS }), null, 'config and data files stay the talk\'s');
});

test('on, the shell ways of writing a code file are held; reading, testing and committing are not', () => {
  for (const c of ['cat > src/a.ts <<EOF\nconst x = 1;\nEOF', "sed -i 's/a/b/' src/x.mjs", 'Set-Content -Path app.ts -Value 1', `node -e "fs.writeFileSync('a.js','1')"`, 'cp tmp/new.ts src/new.ts',
    'echo hi >| foo.js', 'curl -o x.js https://a', 'printf x | dd of=a.js', 'npx prettier --write a.js', 'eslint --fix a.js', `powershell -c "[IO.File]::WriteAllText('a.js','x')"`,
    'git checkout other -- a.js', 'touch a.js', 'git apply fix.patch', `python -c "open('a.py','w').write('x')"`, 'echo x | tee src/a.ts']) {
    assert.ok(shellWritesCode(c), c);
    assert.ok(guardObey({ tool_name: 'Bash', tool_input: { command: c } }, { functions: ROWS }), c);
  }
  // The review of 2026-10-17 found these held by a write word next to any code path: only a write's target counts.
  for (const c of ['cat a.ts', 'sed -n 1,5p src/x.mjs', 'npx vitest run src/selos.test.ts', 'npm test 2>&1 | tail', 'echo hi > notes.md', 'ls > /dev/null',
    'git commit -m "move the helper to utils.ts"', "git commit -F - <<'EOF'\nfeat: copy the badge to badge.ts\nEOF", 'pnpm test > /tmp/out.txt',
    'node --test test/a.test.mjs 2>&1 | tee run.log', 'node --test --test-name-pattern="copy" test/a.test.mjs', 'rg -n "move" server/a.mjs', 'git log --grep=patch -- a.js',
    'gh pr create --body "copy foo.js"', 'echo "<a>index.html</a>"', 'node -e "const f=x=>x.js"', 'node scripts/agent-usage.mjs > report.json', 'cp src/a.ts /tmp/backup.txt', 'git format-patch -1']) {
    assert.equal(shellWritesCode(c), null, c);
  }
});

test('the switch is the gate: off, the open guard lets the talk edit as before; on, it holds even in the open guard', async () => {
  assert.equal(await guardStep(edit('src/a.ts'), { open: true, functions: ROWS, mapEdit: false }), null);
  const on = await guardStep(edit('src/a.ts'), { open: true, functions: ROWS, mapEdit: false, obey: true });
  assert.equal(on.hookSpecificOutput.permissionDecision, 'deny');
});

test('the talk is told first, only when the switch is on', () => {
  const status = { deepseek: { edits: 'worktree' } };
  const off = cerebroNote({ ai: { others: { functions: ROWS } }, status });
  const on = cerebroNote({ ai: { others: { functions: ROWS, obey: true } }, status });
  assert.ok(!off.includes(OBEY_LINE));
  assert.ok(on.startsWith(OBEY_LINE));
  assert.match(on, /- code \(code, test\): deepseek deepseek-flash high/, 'the rows are still listed');
  assert.ok(cerebroNote({ ai: { others: { obey: true } }, status }).startsWith(OBEY_LINE), 'with every row on Claude too');
});

test('the reviewer is the Review row\'s AI, never the author\'s family', () => {
  assert.deepEqual(reviewerFor({}, 'deepseek'), { provider: 'claude', model: 'sonnet', effort: 'medium' });
  assert.deepEqual(reviewerFor({ others: { functions: { review: { provider: 'claude', model: 'opus', effort: 'high' } } } }, 'deepseek'), { provider: 'claude', model: 'opus', effort: 'high' });
  assert.deepEqual(reviewerFor({ others: { functions: { review: { provider: 'gemini', model: 'gemini-3.8-flash' } } } }, 'deepseek'), { provider: 'gemini', model: 'gemini-3.8-flash' });
  assert.equal(reviewerFor({ others: { functions: { review: { provider: 'deepseek' } } } }, 'deepseek').provider, 'claude');
});

// The run and merge through the real server, with the CLI, git and the reviewer faked.
async function withServer({ config, review, diff = 'diff --git a/src/a.ts b/src/a.ts\n+export const x = 1;\n' }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-obey-dir-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-obey-sm-'));
  const gitCalls = [];
  const exec = async (cmd, args) => { gitCalls.push([cmd, ...(args ?? [])]); };
  const app = createApp({
    dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => ({ generatedAt: new Date().toISOString(), waitingCount: 0, projects: [] }),
    runAi: { exec, bin: (n) => n === 'codex' || n === 'claude', keyOf: async () => 'sk-test-key-1234', review, diffOf: async () => diff },
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(smDir, 'config.json'), JSON.stringify(config));
  const { port } = app.address();
  const token = loadToken(smDir);
  const call = (path, body) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'x-session-map-token': token, 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  try {
    await fn({ call, smDir, gitCalls });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
}
const TASK = 'add the badge cron, the tests must pass';
const OPENAI_ROWS = { code: { provider: 'openai', model: 'gpt-6.1-sol' } };

test('on, a run goes only to the AI its row names; off, any AI may take it', async () => {
  await withServer({ config: { ai: { others: { obey: true, functions: OPENAI_ROWS } } } }, async ({ call }) => {
    const wrong = await call('/api/ai/run', { kind: 'code', provider: 'deepseek', task: TASK, cwd: 'C:/repo' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error, 'not-the-row');
    assert.match(wrong.json.note, /provider openai/);
    const screen = await call('/api/ai/run', { kind: 'screen', provider: 'openai', task: TASK, cwd: 'C:/repo' });
    assert.equal(screen.json.error, 'not-the-row', 'the screen row is on Claude');
    assert.match(screen.json.note, /\[screen\]/);
    const right = await call('/api/ai/run', { kind: 'code', provider: 'openai', task: TASK, cwd: 'C:/repo' });
    assert.equal(right.status, 200);
  });
  await withServer({ config: { ai: { others: { functions: OPENAI_ROWS } } } }, async ({ call }) => {
    const any = await call('/api/ai/run', { kind: 'code', provider: 'deepseek', task: TASK, cwd: 'C:/repo' });
    assert.notEqual(any.json.error, 'not-the-row');
  });
});

test('on, the program reviews before it merges: a refusal sends the defects back, the second stops for the owner, a yes merges', async () => {
  const verdicts = [
    { ok: true, value: { accept: false, defects: ['src/a.ts:1 — the badge is never removed'] }, costUSD: 0.01 },
    { ok: true, value: { accept: false, defects: ['src/a.ts:1 — still never removed'] }, costUSD: 0.01 },
    { ok: true, value: { accept: true, defects: [] }, costUSD: 0.01 },
  ];
  const asked = [];
  const review = async (who, prompt) => { asked.push({ who, prompt }); return verdicts.shift(); };
  await withServer({ config: { ai: { others: { obey: true, functions: OPENAI_ROWS } } }, review }, async ({ call, smDir, gitCalls }) => {
    const run = async (task = TASK) => (await call('/api/ai/run', { kind: 'code', provider: 'openai', task, cwd: 'C:/repo' })).json.runId;
    const first = await call('/api/ai/merge', { runId: await run(), accepted: true, why: 'the talk says it is fine' });
    assert.equal(first.status, 409, 'the talk\'s own "accepted" is not enough');
    assert.equal(first.json.error, 'review-refused');
    assert.deepEqual(first.json.defects, ['src/a.ts:1 — the badge is never removed']);
    assert.equal(first.json.stop, false);
    assert.deepEqual(asked[0].who, { provider: 'claude', model: 'sonnet', effort: 'medium' }, 'the Review row: Claude by default');
    assert.match(asked[0].prompt, /add the badge cron/);
    assert.match(asked[0].prompt, /export const x = 1/);
    // The retry carries the defects in its task, as the note says: it is still the second round.
    const second = await call('/api/ai/merge', { runId: await run(`${TASK}\nDefects to fix: ${first.json.defects.join('; ')}`), accepted: true });
    assert.equal(second.json.round, 2);
    assert.equal(second.json.stop, true);
    assert.match(second.json.note, /tell the owner/);
    assert.ok(!gitCalls.some((c) => c[1] === 'merge'), 'nothing merged');
    const third = await call('/api/ai/merge', { runId: await run() });
    assert.equal(third.status, 200, 'a yes merges without the talk saying accepted');
    assert.deepEqual(third.json.reviewedBy, { provider: 'claude', model: 'sonnet', effort: 'medium' });
    assert.ok(gitCalls.some((c) => c[1] === 'merge'));
    const reviews = readFileSync(join(smDir, 'ai-activity.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((l) => l.kind === 'review');
    assert.equal(reviews.length, 3, 'each review is one line of the activity log');
  });
});

test('on, an empty delivery or a reviewer that does not answer never merges', async () => {
  await withServer({ config: { ai: { others: { obey: true, functions: OPENAI_ROWS } } }, diff: '', review: async () => assert.fail('nothing to review') }, async ({ call }) => {
    const runId = (await call('/api/ai/run', { kind: 'code', provider: 'openai', task: TASK, cwd: 'C:/repo' })).json.runId;
    const r = await call('/api/ai/merge', { runId, accepted: true });
    assert.equal(r.json.error, 'review-refused');
    assert.match(r.json.defects[0], /changed nothing/);
  });
  await withServer({ config: { ai: { others: { obey: true, functions: OPENAI_ROWS } } }, review: async () => ({ ok: false, error: 'timeout' }) }, async ({ call }) => {
    const runId = (await call('/api/ai/run', { kind: 'code', provider: 'openai', task: TASK, cwd: 'C:/repo' })).json.runId;
    const r = await call('/api/ai/merge', { runId, accepted: true });
    assert.equal(r.status, 502);
    assert.equal(r.json.error, 'review-failed');
  });
});

test('on, a diff too big to read whole is refused, not reviewed in part; the rows the guard leaves free stay free', async () => {
  const big = `diff --git a/src/a.ts b/src/a.ts\n${'+const x = 1;\n'.repeat(6000)}`;
  await withServer({ config: { ai: { others: { obey: true, functions: OPENAI_ROWS } } }, diff: big, review: async () => assert.fail('a cut diff is never sent') }, async ({ call }) => {
    const runId = (await call('/api/ai/run', { kind: 'code', provider: 'openai', task: TASK, cwd: 'C:/repo' })).json.runId;
    const r = await call('/api/ai/merge', { runId, accepted: true });
    assert.equal(r.json.error, 'review-refused');
    assert.match(r.json.defects[0], /split the task/);
    assert.equal(r.json.round, 0, 'not a round: nothing was reviewed');
    const docs = await call('/api/ai/run', { kind: 'docs', provider: 'openai', task: TASK, cwd: 'C:/repo' });
    assert.notEqual(docs.json.error, 'not-the-row', 'docs is not a held row');
  });
});
