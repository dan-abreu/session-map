// Workflows you can trace (mind-map-page mm31): the request that launched each workflow, every agent with its state, its
// phase, its last step and the files and commits it made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { helperAgents, readTranscript, readWorkflows } from '../server/sources/claude.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-wf-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const RUN = 'wf_1a2b3c4d-5e6';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const at = (min) => `2026-10-09T10:${String(min).padStart(2, '0')}:00.000Z`;
const human = (text, min) => JSON.stringify({ type: 'user', sessionId: 's', cwd: '/work/a', timestamp: at(min), message: { role: 'user', content: text } });
const launchUse = (min) => JSON.stringify({ type: 'assistant', sessionId: 's', cwd: '/work/a', timestamp: at(min), message: { id: `m${min}`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: `t${min}`, name: 'Workflow', input: { script: 'x' } }], usage: { input_tokens: 1, output_tokens: 1 } } });
const launchResult = (min, toolUseResult) => JSON.stringify({ type: 'user', sessionId: 's', cwd: '/work/a', timestamp: at(min), toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${min - 1}`, content: `Workflow launched (${RUN})` }] } });
const filler = (min) => JSON.stringify({ type: 'user', sessionId: 's', cwd: '/work/a', timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'zz', content: 'y'.repeat(200) }] } });

test('readTranscript keeps the request that launched each workflow: the owner\'s last message before it, its time and its item codes', () => {
  withTempDir((dir) => {
    const file = join(dir, 's.jsonl');
    writeFileSync(file, [
      human('first, something else', 1),
      human('Build the traceable workflows of mm31 now', 2),
      launchUse(3),
      launchResult(4, { status: 'async_launched', runId: RUN, workflowName: 'trace' }),
      human('and how is it going?', 5),
      launchUse(6),
      launchResult(7, 'still running'),
    ].join('\n') + '\n');
    const s = readTranscript(file);
    assert.deepEqual(s.launches, { [RUN]: { text: 'Build the traceable workflows of mm31 now', ts: at(2), codes: ['mm31'] } });
  });
});

test('a launch far before the tail it reads is still tied to its request', () => {
  withTempDir((dir) => {
    const file = join(dir, 's.jsonl');
    writeFileSync(file, [
      human('Polish the list (mm33)', 1),
      launchUse(2),
      launchResult(3, { status: 'async_launched', runId: RUN }),
      ...Array.from({ length: 40 }, (_, i) => filler(10 + (i % 40))),
    ].join('\n') + '\n');
    const s = readTranscript(file, { tailBytes: 1500 });
    assert.deepEqual(s.launches[RUN], { text: 'Polish the list (mm33)', ts: at(1), codes: ['mm33'] });
  });
});

// A session folder with one workflow: two phases, three agents (one answered, one failed, one still at work).
function session(dir, { meta = null, script = null } = {}) {
  const s = join(dir, 'sess');
  const wf = join(s, 'subagents', 'workflows', RUN);
  mkdirSync(wf, { recursive: true });
  mkdirSync(join(s, 'workflows', 'scripts'), { recursive: true });
  const journal = [
    { type: 'launched' },
    { type: 'started', agentId: 'a1', label: 'Read the code', phase: 'Look' },
    { type: 'result', agentId: 'a1', result: {} },
    { type: 'started', agentId: 'a2', label: 'Write the tests', phase: 'Build' },
    { type: 'failed', agentId: 'a2' },
    { type: 'started', agentId: 'a3', label: 'Write the code', phase: 'Build' },
  ];
  writeFileSync(join(wf, 'journal.jsonl'), journal.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const edit = (id, name, input, min) => JSON.stringify({ type: 'assistant', sessionId: 's', cwd: '/work/a', timestamp: at(min), message: { id, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: `t-${id}`, name, input }], usage: { input_tokens: 1, output_tokens: 1 } } });
  const out = (id, text, min) => JSON.stringify({ type: 'user', sessionId: 's', cwd: '/work/a', timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${id}`, content: text }] } });
  writeFileSync(join(wf, 'agent-a3.jsonl'), [
    edit('e1', 'Edit', { file_path: '/work/a/src/pay.js' }, 20),
    edit('e2', 'Bash', { command: 'git commit -m "feat: pay"', description: 'Save the change' }, 21),
    out('e2', '[main 1234abc] feat: pay\n 1 file changed', 21),
    edit('e3', 'Write', { file_path: '/work/b/docs/notes.md' }, 22),
  ].join('\n') + '\n');
  writeFileSync(join(wf, 'agent-a3.meta.json'), JSON.stringify({ model: 'sonnet' }));
  writeFileSync(join(wf, 'agent-a1.jsonl'), `${edit('r1', 'Read', { file_path: '/work/a/src/pay.js' }, 15)}\n`);
  if (meta) writeFileSync(join(s, 'workflows', `${RUN}.json`), JSON.stringify(meta));
  if (script) writeFileSync(join(s, 'workflows', 'scripts', `trace-${RUN}.js`), script);
  return s;
}

test('readWorkflows lists every agent with its state, phase, model, last step and the files and commits it made', () => {
  withTempDir((dir) => {
    const [w] = readWorkflows(session(dir));
    assert.equal(w.status, 'running');
    assert.deepEqual({ started: w.started, done: w.done, failed: w.failed, total: w.total }, { started: 3, done: 1, failed: 1, total: 3 });
    assert.deepEqual(w.agents.map((a) => [a.id, a.label, a.phase, a.state]), [
      ['a1', 'Read the code', 'Look', 'done'],
      ['a2', 'Write the tests', 'Build', 'failed'],
      ['a3', 'Write the code', 'Build', 'running'],
    ]);
    const a3 = w.agents[2];
    assert.equal(a3.model, 'sonnet');
    assert.deepEqual(a3.step, { kind: 'edit', target: '…/b/docs/notes.md', ts: at(22) }, 'outside its folder, only the last folders');
    assert.equal(a3.lastFile, '/work/b/docs/notes.md');
    assert.deepEqual(a3.editedFiles, ['/work/a/src/pay.js', '/work/b/docs/notes.md']);
    assert.deepEqual(a3.commits, [{ hash: '1234abc', subject: 'feat: pay' }]);
    assert.deepEqual(w.agents[0].editedFiles, [], 'reading is not editing');
    assert.deepEqual(w.running.map((a) => a.label), ['Write the code'], 'a failed agent is not running forever');
    assert.deepEqual(w.phases, [{ title: 'Look', total: 1, done: 1, failed: 0, running: 0 }, { title: 'Build', total: 2, done: 0, failed: 1, running: 1 }]);
  });
});

test('readWorkflows takes the phases still to come from the script while it runs, and the end state from the meta file', () => {
  withTempDir((dir) => {
    const script = "export const meta = {\n  name: 'trace',\n  phases: [\n    { title: 'Look', detail: 'read' },\n    { title: \"Build\" },\n    { title: 'Review' },\n  ],\n};\n";
    const [running] = readWorkflows(session(dir, { script }));
    assert.deepEqual(running.phases.map((p) => [p.title, p.total]), [['Look', 1], ['Build', 2], ['Review', 0]]);
  });
  withTempDir((dir) => {
    const [ended] = readWorkflows(session(dir, { meta: { workflowName: 'trace', status: 'completed', agentCount: 3, phases: [{ title: 'Look' }, { title: 'Build' }] } }));
    assert.equal(ended.status, 'completed');
    assert.equal(ended.name, 'trace');
    assert.deepEqual(ended.phases.map((p) => p.title), ['Look', 'Build']);
  });
});

test('helperAgents names the workflow a workflow agent works for', () => {
  withTempDir((dir) => {
    const s = session(dir);
    writeFileSync(join(s, 'subagents', 'agent-h1.jsonl'), '');
    const byFile = Object.fromEntries(helperAgents(s).map((a) => [a.file.split(/[\\/]/).pop(), a.workflowId ?? null]));
    assert.deepEqual(byFile, { 'agent-h1.jsonl': null, 'agent-a1.jsonl': RUN, 'agent-a3.jsonl': RUN });
  });
});

// ---- the trace hung on each conversation's workflows (server/workflows.mjs) ----

const { workflowView } = await import('../server/workflows.mjs');

const ITEMS = [{ id: 'b', arch: { parts: [{ id: 'notes', groups: [{ items: [{ code: 'no01' }] }] }] } }, { id: 'a', arch: { parts: [{ id: 'pay', groups: [{ items: [{ code: 'mm31' }, { code: 'pa02' }] }] }, { id: 'docs', groups: [] }] } }];
const PLACES = {
  '/work/a/src/pay.js': { projectId: 'a', name: 'shop', partId: 'pay', path: 'src/pay.js' },
  '/work/b/docs/notes.md': { projectId: 'b', name: 'notes', partId: null, path: 'docs/notes.md' },
};
const place = (file) => PLACES[file] ?? null;
const raw = () => ({
  id: RUN, name: 'trace', status: 'running', started: 2, done: 1, failed: 0, total: 2, lastLabel: 'Write the code', phases: [], running: [], updatedAt: at(30),
  agents: [
    { id: 'a1', label: 'Read', phase: 'Look', state: 'done', model: null, activeAt: at(15), step: null, lastFile: '/work/a/src/pay.js', editedFiles: [], commits: [] },
    { id: 'a3', label: 'Write the code', phase: 'Build', state: 'running', model: 'sonnet', activeAt: at(22), step: { kind: 'edit', target: '…/b/docs/notes.md', ts: at(22) },
      lastFile: '/work/b/docs/notes.md', editedFiles: ['/work/a/src/pay.js', '/work/b/docs/notes.md', '/tmp/elsewhere.txt'], commits: [{ hash: '1234abc', subject: 'feat: pay' }] },
  ],
});

test('workflowView ties the workflow to its request and the map item it names, and places every agent', () => {
  const view = workflowView(raw(), {
    launch: { text: 'Build mm31 now', ts: at(2), codes: ['zz99', 'mm31'] }, items: ITEMS, place,
    commitOf: (c) => (c.hash === '1234abc' ? { projectId: 'a', tag: 'v1.2.0' } : null),
  });
  assert.deepEqual(view.request, { text: 'Build mm31 now', ts: at(2), item: { projectId: 'a', partId: 'pay', code: 'mm31' } }, 'the first project whose map has the code');
  const [a1, a3] = view.agents;
  assert.deepEqual(a1.place, PLACES['/work/a/src/pay.js'], 'where its last step was, even reading');
  assert.deepEqual(a3.place, PLACES['/work/b/docs/notes.md']);
  assert.deepEqual(a3.files, [PLACES['/work/a/src/pay.js'], PLACES['/work/b/docs/notes.md']], 'a file outside every project is left out');
  assert.equal(a3.fileCount, 2);
  assert.deepEqual(a3.commits, [{ hash: '1234abc', subject: 'feat: pay', projectId: 'a', tag: 'v1.2.0' }]);
  assert.equal(JSON.stringify(view).includes('/work/'), false, 'no path of the PC reaches the page');
  assert.deepEqual(view.places, [
    { projectId: 'a', name: 'shop', files: 1, partIds: ['pay'] },
    { projectId: 'b', name: 'notes', files: 1, partIds: [] },
  ]);
});

test('workflowView without a launch on record has no request, and a code the map lacks names no item', () => {
  assert.equal(workflowView(raw(), { launch: null, items: ITEMS, place, commitOf: () => null }).request, null);
  const view = workflowView(raw(), { launch: { text: 'go', ts: at(1), codes: ['zz99'] }, items: ITEMS, place, commitOf: () => null });
  assert.equal(view.request.item, null);
  assert.deepEqual(view.agents[1].commits, [{ hash: '1234abc', subject: 'feat: pay', projectId: null, tag: null }]);
});

test('collect hangs the trace on a workflow: its request, each agent on the project and part it works in, and the version of its commit', async () => {
  const { execFileSync } = await import('node:child_process');
  const { realpathSync, utimesSync } = await import('node:fs');
  const { collect } = await import('../server/collect.mjs');
  const { projectIdOf } = await import('../server/paths.mjs');
  const NOW = new Date('2026-09-10T12:00:00Z');
  const iso = (ms) => new Date(NOW.getTime() - ms).toISOString();
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'sm-wf-e2e-')));
  const env = { ...process.env, GIT_AUTHOR_DATE: iso(7_200_000), GIT_COMMITTER_DATE: iso(7_200_000) };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const repo = (root, files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    return root;
  };
  try {
    const dir = join(base, 'claude');
    const smDir = join(base, 'sm');
    mkdirSync(smDir, { recursive: true });
    const home = repo(join(base, 'home'), { 'src/main.js': 'm\n' });
    const shop = repo(join(base, 'shop'), {
      'docs/architecture/README.md': '# Parts\n\n## Back office\n\n- [Billing](billing.md)\n',
      'docs/architecture/billing.md': "# Billing\n\nInvoices.\n\n## Where in the code\n\n- `src/billing/`\n\n## What's missing\n\n- [ ] **Claude:** Taxes per city `bi07`\n",
      'src/billing/tax.ts': 't\n',
    });
    writeFileSync(join(shop, 'src', 'billing', 'tax.ts'), 't2\n');
    git(shop, 'commit', '-q', '-am', 'feat: tax per city');
    const hash = git(shop, 'rev-parse', '--short', 'HEAD').trim();
    git(shop, 'tag', 'v1.0.0');

    const projDir = join(dir, 'projects', home.replace(/[^a-z0-9]/gi, '-'));
    const flow = join(projDir, A, 'subagents', 'workflows', RUN);
    mkdirSync(flow, { recursive: true });
    const line = (o) => JSON.stringify({ sessionId: A, cwd: home, gitBranch: 'main', timestamp: iso(3_600_000), ...o });
    writeFileSync(join(projDir, `${A}.jsonl`), [
      line({ type: 'ai-title', aiTitle: 'Taxes' }),
      line({ type: 'user', message: { role: 'user', content: 'Do the taxes per city, bi07' } }),
      line({ type: 'assistant', message: { id: 'm1', model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: 'w1', name: 'Workflow', input: { script: 'x' } }] } }),
      line({ type: 'user', toolUseResult: { status: 'async_launched', runId: RUN }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'launched' }] } }),
    ].join('\n') + '\n');
    writeFileSync(join(flow, 'journal.jsonl'), `${JSON.stringify({ type: 'started', agentId: 'x1', label: 'Write the taxes', phase: 'Build' })}\n`);
    writeFileSync(join(flow, 'agent-x1.jsonl'), [
      line({ type: 'assistant', message: { id: 'a1', model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: join(shop, 'src', 'billing', 'tax.ts') } }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] }, toolUseResult: { filePath: join(shop, 'src', 'billing', 'tax.ts'), oldString: 't', newString: 't2', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-t', '+t2'] }] } }),
      line({ type: 'assistant', message: { id: 'a2', model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: 'e2', name: 'Bash', input: { command: 'git commit -am "feat: tax per city"' } }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e2', content: `[main ${hash}] feat: tax per city` }] } }),
    ].join('\n') + '\n');
    const t = (NOW.getTime() - 3_600_000) / 1000;
    utimesSync(join(projDir, `${A}.jsonl`), t, t);
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    writeFileSync(join(dir, 'sessions', '7.json'), JSON.stringify({ pid: 7, sessionId: A, cwd: home, status: 'busy', updatedAt: NOW.getTime(), kind: 'interactive', entrypoint: 'cli' }));

    const state = await collect({ dir, smDir, now: NOW, isAlive: () => true, ai: { bin: null } });
    const byId = new Map(state.projects.map((p) => [p.id, p]));
    const h = byId.get(projectIdOf(home));
    const s = byId.get(projectIdOf(shop));
    const w = h.chats.find((c) => c.sessionId === A).workflows[0];
    assert.equal(w.request.text, 'Do the taxes per city, bi07');
    assert.deepEqual(w.request.item, { projectId: s.id, partId: 'billing', code: 'bi07' });
    const [agent] = w.agents;
    assert.deepEqual(agent.place, { projectId: s.id, name: 'shop', partId: 'billing', path: 'src/billing/tax.ts' });
    assert.deepEqual(agent.commits, [{ hash, subject: 'feat: tax per city', projectId: s.id, tag: 'v1.0.0' }]);
    assert.deepEqual(w.places, [{ projectId: s.id, name: 'shop', files: 1, partIds: ['billing'] }]);
    assert.deepEqual(s.visitors[0].workflows, w ? h.chats[0].workflows : null, 'the project it works in sees the same trace');
    assert.equal(JSON.stringify(h.chats[0].workflows).includes(base), false, 'no folder of the PC in the trace');

    const { changesOf } = await import('../server/changes-state.mjs');
    const change = changesOf(state, s.id).find((r) => r.path === 'src/billing/tax.ts' && r.sessionId === A);
    assert.deepEqual(change.agent.workflow, { id: RUN, name: RUN }, 'a changed file leads back to its workflow');
    assert.deepEqual(change.agent.request, { text: 'Do the taxes per city, bi07', ts: iso(3_600_000) }, 'and to the request that launched it');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a Workflow step names the team it starts, from the script or its file, instead of an empty "Helper:"', async () => {
  const { stepOf } = await import('../server/sources/claude.mjs');
  const script = "export const meta = {\n  name: 'refund-with-notice',\n  phases: [],\n};\n";
  assert.deepEqual(stepOf({ name: 'Workflow', input: { script } }, '/work/a', true), { kind: 'team', target: 'refund-with-notice' });
  assert.deepEqual(stepOf({ name: 'Workflow', input: { scriptPath: 'C:/x/workflows/scripts/shop-launch-wf_1a2b3c4d-5e6.js' } }, '/work/a', true), { kind: 'team', target: 'shop-launch' });
  assert.deepEqual(stepOf({ name: 'Workflow', input: {} }, '/work/a', true), { kind: 'team', target: '' });
});
