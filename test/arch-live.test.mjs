import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync as realRename, rmSync, utimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveStatus, withLive, ACTIVE_MS } from '../server/arch/live.mjs';
import { markedLine, writeMarks } from '../server/arch/livemark.mjs';
import { parseArch } from '../server/arch/parse.mjs';
import { liveBadge } from '../server/web/itemlive.js';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readAgentBriefs } from '../server/sources/claude.mjs';
import { mainCommitsOf, workCellsOf } from '../server/brain/workcells.mjs';
import { translator } from '../server/web/i18n.js';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const items = [
  { code: 'sb13', status: 'todo', detail: [] },
  { code: 'sb14', status: 'todo', detail: [] },
  { code: 'sb15', status: 'done', detail: [] },
  { code: 'id112', status: 'todo', detail: ['Asked: 2026-10-12', 'Where it went: `sb13`, `sb99`.'] },
  { code: 'id113', status: 'todo', detail: ['Where it went: `sb14`.'] },
];
const none = { chats: [], agents: [], workcells: [], mainCommits: [], now: NOW };

test('an agent active now whose brief names the code is working on it', () => {
  const live = liveStatus({ ...none, items, agents: [{ label: 'worker sb13', brief: 'Build the status robot (sb13). Tick your items.', activeAt: ago(2 * MIN), startedAt: ago(10 * MIN) }] });
  assert.equal(live.get('sb13').live, 'working');
  assert.deepEqual(live.get('sb13').who, ['worker sb13']);
  assert.equal(live.get('sb13').since, ago(10 * MIN));
  assert.equal(live.get('sb14'), undefined);
});

test('a chat older than 15 minutes does not count', () => {
  const chats = [{ sessionId: 'a', label: 'old chat', activeAt: ago(ACTIVE_MS + MIN), card: { title: 'sb13 robot' }, branch: null }];
  assert.equal(liveStatus({ ...none, items, chats }).get('sb13'), undefined);
  const fresh = [{ ...chats[0], activeAt: ago(14 * MIN) }];
  assert.equal(liveStatus({ ...none, items, chats: fresh }).get('sb13').live, 'working');
});

test('a chat names the code by its card doing, its branch or the commits of its worktree', () => {
  const chats = [
    { sessionId: 'a', label: 'A', activeAt: ago(MIN), card: { title: 'x', doing: 'building sb13' } },
    { sessionId: 'b', label: 'B', activeAt: ago(MIN), branch: 'feat/sb14-badge' },
    { sessionId: 'c', label: 'C', activeAt: ago(MIN), workCellId: 'wt', card: { title: 'y' } },
  ];
  const workcells = [{ id: 'wt', branch: 'worktree-agent-1', path: 'C:/dev/x', subjects: ['feat(a): thing (id113)'] }];
  const live = liveStatus({ ...none, items, chats, workcells });
  assert.deepEqual(live.get('sb13').who, ['A']);
  assert.deepEqual(live.get('sb14').who, ['B']);
  assert.deepEqual(live.get('id113').who, ['C', 'B']); // C by its worktree; B too, because the request lists sb14
});

test('an agent working inside a worktree is tied to its commits by folder', () => {
  const workcells = [{ id: 'wt', branch: 'worktree-agent-1', path: 'C:\\dev\\x\\.claude\\worktrees\\agent-1', subjects: ['feat(a): thing (sb14)'] }];
  const agents = [{ label: 'agent 1', brief: 'no codes here', cwd: 'c:/dev/x/.claude/worktrees/agent-1/server', activeAt: ago(MIN) }];
  assert.equal(liveStatus({ ...none, items, agents, workcells }).get('sb14').live, 'working');
});

test('a time ahead of the clock is not activity', () => {
  const chats = [{ sessionId: 'a', label: 'A', activeAt: new Date(NOW + 3_600_000).toISOString(), card: { title: 'sb13' } }];
  assert.equal(liveStatus({ ...none, items, chats }).get('sb13'), undefined);
});

test('of worktrees inside one another, the deepest folder is the one a chat works in', () => {
  const workcells = [
    { id: 'outer', branch: 'outer', path: 'C:/repo', subjects: ['feat: x (sb13)'] },
    { id: 'inner', branch: 'inner', path: 'C:/repo/nested', subjects: ['feat: y (sb14)'] },
  ];
  const agents = [{ label: 'a', brief: 'no codes', cwd: 'C:/repo/nested/src', activeAt: ago(MIN) }];
  const live = liveStatus({ ...none, items, agents, workcells });
  assert.equal(live.get('sb14').live, 'working');
  assert.equal(live.get('sb13'), undefined);
});

test('a done item is never working', () => {
  const agents = [{ label: 'a', brief: 'sb15', activeAt: ago(MIN) }];
  assert.equal(liveStatus({ ...none, items, agents }).get('sb15'), undefined);
});

test('a docs commit on main does not make an item built', () => {
  const mainCommits = [
    { subject: 'docs(plan): tick (sb13)', ts: ago(MIN), hash: 'a1' },
    { subject: 'chore: bump `sb13`', ts: ago(MIN), hash: 'a2' },
    { subject: 'test(arch): cover (sb13)', ts: ago(MIN), hash: 'a3' },
    { subject: 'feat(arch): sb13 without marks', ts: ago(MIN), hash: 'a4' },
  ];
  assert.equal(liveStatus({ ...none, items, mainCommits }).get('sb13'), undefined);
});

test('a feat or fix commit on main naming the code makes an open item built', () => {
  const mainCommits = [
    { subject: 'feat(arch): the status robot (sb13, id112)', ts: ago(5 * MIN), hash: 'b1' },
    { subject: 'fix(web): the badge `sb14`', ts: ago(9 * MIN), hash: 'b2' },
    { subject: 'feat(sb15): already ticked item', ts: ago(MIN), hash: 'b3' },
  ];
  const live = liveStatus({ ...none, items, mainCommits });
  assert.equal(live.get('sb13').live, 'built');
  assert.equal(live.get('sb13').since, ago(5 * MIN));
  assert.equal(live.get('sb14').live, 'built');
  assert.equal(live.get('sb15'), undefined);
});

test('working wins over built', () => {
  const live = liveStatus({
    ...none, items,
    mainCommits: [{ subject: 'feat(a): part one (sb13)', ts: ago(30 * MIN), hash: 'c1' }],
    agents: [{ label: 'a', brief: 'sb13 part two', activeAt: ago(MIN) }],
  });
  assert.equal(live.get('sb13').live, 'working');
});

test('a request item inherits working from what it lists under Where it went', () => {
  const agents = [{ label: 'a', brief: 'sb13', activeAt: ago(MIN) }];
  const live = liveStatus({ ...none, items, agents });
  assert.equal(live.get('id112').live, 'working');
  assert.deepEqual(live.get('id112').who, ['a']);
  assert.equal(live.get('id113'), undefined);
});

test('withLive hangs the answer on the items of the parts', () => {
  const arch = { parts: [{ id: 'p', groups: [{ name: '', items: [{ code: 'sb13', status: 'todo' }, { code: 'x1', status: 'todo' }] }] }] };
  const live = new Map([['sb13', { live: 'working', who: ['a'], since: ago(MIN) }]]);
  const out = withLive(arch, live);
  assert.equal(out.parts[0].groups[0].items[0].live.live, 'working');
  assert.equal('live' in out.parts[0].groups[0].items[1], false);
  assert.equal(arch.parts[0].groups[0].items[0].live, undefined);
});

// ---- the line writer ------------------------------------------------------------------

test('markedLine puts the mark in front of a bare line and inside an existing bold prefix', () => {
  assert.equal(markedLine('- [ ] Build the robot `sb13`', 'in progress'), '- [ ] **in progress:** Build the robot `sb13`');
  assert.equal(markedLine('- [ ] **important:** Build `sb13`', 'in progress'), '- [ ] **in progress · important:** Build `sb13`');
  assert.equal(markedLine('- [ ] **Claude:** Build `sb13`', 'em andamento'), '- [ ] **em andamento · Claude:** Build `sb13`');
  assert.equal(markedLine('- [ ] **Not a mark** Build `sb13`', 'in progress'), '- [ ] **in progress:** **Not a mark** Build `sb13`');
  assert.equal(markedLine('- [ ] Build `sb13`\r', 'in progress'), '- [ ] **in progress:** Build `sb13`\r');
});

test('markedLine leaves a marked, ticked or other line alone', () => {
  assert.equal(markedLine('- [ ] **in progress · important:** Build `sb13`', 'in progress'), null);
  assert.equal(markedLine('- [ ] **em andamento:** Build', 'in progress'), null);
  assert.equal(markedLine('- [x] Built `sb13`', 'in progress'), null);
  assert.equal(markedLine('  - sub line', 'in progress'), null);
});

function planFolder(text) {
  const root = mkdtempSync(join(tmpdir(), 'live-'));
  mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
  const file = join(root, 'docs', 'architecture', 'part.md');
  writeFileSync(file, text);
  return { root, file };
}
const PLAN = '# Part\n\nAbout.\n\n## What\'s missing\n\n- [ ] **important:** First `sb13`\n  - sub\n- [ ] Second `sb14`\n- [x] Third `sb15`\n';
const archOf = (root) => ({ ...parseArch('docs/architecture', { 'part.md': readFileSync(join(root, 'docs', 'architecture', 'part.md'), 'utf8') }, 'worktree'), source: 'worktree' });
const working = (...codes) => new Map(codes.map((c) => [c, { live: 'working', who: ['a'], since: null }]));

test('writeMarks writes the in-progress mark into the one line, atomically, and nothing else', async () => {
  const { root, file } = planFolder(PLAN);
  try {
    const old = new Date(NOW - 60_000);
    utimesSync(file, old, old);
    const done = await writeMarks({ root, arch: archOf(root), live: working('sb13', 'sb15'), now: NOW, memo: new Map() });
    assert.deepEqual(done.map((d) => d.code), ['sb13']);
    assert.equal(readFileSync(file, 'utf8'), PLAN.replace('**important:** First', '**in progress · important:** First'));
    assert.deepEqual(readdirSync(join(root, 'docs', 'architecture')), ['part.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeMarks does not touch a line that already carries the mark', async () => {
  const text = PLAN.replace('**important:**', '**in progress · important:**');
  const { root, file } = planFolder(text);
  try {
    const old = new Date(NOW - 60_000);
    utimesSync(file, old, old);
    const done = await writeMarks({ root, arch: archOf(root), live: working('sb13'), now: NOW, memo: new Map() });
    assert.deepEqual(done, []);
    assert.equal(readFileSync(file, 'utf8'), text);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeMarks skips a file changed 2 seconds ago', async () => {
  const { root, file } = planFolder(PLAN);
  try {
    const recent = new Date(NOW - 2000);
    utimesSync(file, recent, recent);
    const done = await writeMarks({ root, arch: archOf(root), live: working('sb13'), now: NOW, memo: new Map() });
    assert.deepEqual(done, []);
    assert.equal(readFileSync(file, 'utf8'), PLAN);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeMarks writes an item once per hour', async () => {
  const { root, file } = planFolder(PLAN);
  try {
    const old = new Date(NOW - 60_000);
    utimesSync(file, old, old);
    const memo = new Map();
    assert.equal((await writeMarks({ root, arch: archOf(root), live: working('sb14'), now: NOW, memo })).length, 1);
    writeFileSync(file, PLAN); // somebody took the mark away
    utimesSync(file, old, old);
    assert.equal((await writeMarks({ root, arch: archOf(root), live: working('sb14'), now: NOW + 30 * MIN, memo })).length, 0);
    utimesSync(file, new Date(NOW + 60 * MIN), new Date(NOW + 60 * MIN));
    assert.equal((await writeMarks({ root, arch: archOf(root), live: working('sb14'), now: NOW + 2 * 60 * MIN, memo })).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeMarks retries the swap once when the file is busy', async () => {
  const { root, file } = planFolder(PLAN);
  try {
    const old = new Date(NOW - 60_000);
    utimesSync(file, old, old);
    let calls = 0;
    const rename = (from, to) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      return realRename(from, to);
    };
    const done = await writeMarks({ root, arch: archOf(root), live: working('sb14'), now: NOW, memo: new Map(), rename, retryMs: 1 });
    assert.equal(done.length, 1);
    assert.equal(calls, 2);
    assert.match(readFileSync(file, 'utf8'), /\*\*in progress:\*\* Second `sb14`/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeMarks gives up after one retry and leaves no temp file', async () => {
  const { root, file } = planFolder(PLAN);
  try {
    const old = new Date(NOW - 60_000);
    utimesSync(file, old, old);
    const rename = () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); };
    const done = await writeMarks({ root, arch: archOf(root), live: working('sb14'), now: NOW, memo: new Map(), rename, retryMs: 1 });
    assert.deepEqual(done, []);
    assert.equal(readFileSync(file, 'utf8'), PLAN);
    assert.deepEqual(readdirSync(join(root, 'docs', 'architecture')), ['part.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeMarks leaves a line that only mentions the code, after the plan moved', async () => {
  const { root, file } = planFolder(PLAN);
  try {
    const old = new Date(NOW - 60_000);
    utimesSync(file, old, old);
    const arch = archOf(root);
    // The plan changed after it was read: the line the item had now only talks about it.
    const moved = PLAN.replace('- [ ] Second `sb14`', '- [ ] Follow up on `sb14` before `sb99`');
    writeFileSync(file, moved);
    utimesSync(file, old, old);
    assert.deepEqual(await writeMarks({ root, arch, live: working('sb14'), now: NOW, memo: new Map() }), []);
    assert.equal(readFileSync(file, 'utf8'), moved);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeMarks does not write a plan read from the main branch', async () => {
  const { root, file } = planFolder(PLAN);
  try {
    const old = new Date(NOW - 60_000);
    utimesSync(file, old, old);
    const arch = { ...archOf(root), source: 'main-branch' };
    assert.deepEqual(await writeMarks({ root, arch, live: working('sb13'), now: NOW, memo: new Map() }), []);
    assert.equal(existsSync(file) && readFileSync(file, 'utf8'), PLAN);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// ---- the badge --------------------------------------------------------------------------

test('the badge says working now with the count, and who on hover', () => {
  const en = translator('en');
  const badge = liveBadge({ live: 'working', who: ['chat A', 'agent B'], since: ago(MIN) }, en);
  assert.equal(badge.text, 'working now · 2');
  assert.equal(badge.title, 'chat A\nagent B');
  assert.equal(badge.kind, 'working');
  assert.equal(liveBadge({ live: 'working', who: ['chat A'] }, translator('pt-BR')).text, 'trabalhando agora · 1');
});

test('the badge for built says it is on main and missing the mark', () => {
  assert.equal(liveBadge({ live: 'built', who: ['feat: x (sb13)'] }, translator('pt-BR')).text, 'construído no main, falta marcar');
  assert.equal(liveBadge({ live: 'built', who: [] }, translator('en')).text, 'built on main, not ticked yet');
  assert.equal(liveBadge(null, translator('en')), null);
  assert.equal(liveBadge({ live: null }, translator('en')), null);
});

// ---- the agents' briefs --------------------------------------------------------------------

test('readAgentBriefs gives each agent its first user message, folder, label and last write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brief-'));
  try {
    mkdirSync(join(dir, 'subagents'), { recursive: true });
    const lines = [
      { type: 'user', cwd: 'C:/dev/x/.claude/worktrees/agent-1', timestamp: '2026-10-13T11:00:00Z', message: { content: 'Build the status robot (sb13).' } },
      { type: 'assistant', timestamp: '2026-10-13T11:00:05Z', message: { content: [{ type: 'text', text: 'ok' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } },
    ].map((e) => JSON.stringify(e)).join('\n');
    writeFileSync(join(dir, 'subagents', 'agent-ab1.jsonl'), lines);
    writeFileSync(join(dir, 'subagents', 'agent-ab1.meta.json'), JSON.stringify({ description: 'status robot worker' }));
    const [a] = readAgentBriefs(dir);
    assert.equal(a.agentId, 'ab1');
    assert.equal(a.label, 'status robot worker');
    assert.equal(a.brief, 'Build the status robot (sb13).');
    assert.equal(a.cwd, 'C:/dev/x/.claude/worktrees/agent-1');
    assert.equal(a.startedAt, '2026-10-13T11:00:00Z');
    assert.ok(Number.isFinite(Date.parse(a.activeAt)));
    assert.deepEqual(readAgentBriefs(join(dir, 'nothing')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the repository facts ---------------------------------------------------------------------

test('a branch carries the subjects of its commits and main lists its own commits', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'live-repo-')));
  const root = join(base, 'repo');
  const run = (...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    mkdirSync(root);
    run('init', '-q', '-b', 'main');
    writeFileSync(join(root, 'a.txt'), '1');
    run('add', 'a.txt');
    run('commit', '-q', '-m', 'feat(core): first thing (sb14)');
    run('checkout', '-q', '-b', 'topic');
    writeFileSync(join(root, 'b.txt'), '2');
    run('add', 'b.txt');
    run('commit', '-q', '-m', 'feat(arch): on the branch (sb13)');
    run('checkout', '-q', 'main');
    const cells = await workCellsOf(root, () => ({ partId: null, touches: [] }), { main: 'main', includeRemote: false });
    assert.deepEqual(cells.find((c) => c.branch === 'topic').subjects, ['feat(arch): on the branch (sb13)']);
    const commits = await mainCommitsOf(root, 'main', { since: '2000-01-01' });
    assert.deepEqual(commits.map((c) => c.subject), ['feat(core): first thing (sb14)']);
    assert.ok(Number.isFinite(Date.parse(commits[0].ts)));
    assert.deepEqual(await mainCommitsOf(root, null), []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
