import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clashItems, collect, settleAi } from '../server/collect.mjs';
import { forgetLife } from '../server/ai/life.mjs';
import { appendEvents, readEvents } from '../server/brain/events.mjs';
import { AiQueue } from '../server/ai/runner.mjs';
import { projectIdOf } from '../server/paths.mjs';
import { isoDay } from '../server/web/range.js';

const INTERNALS = Symbol.for('session-map.internals');

const NOW = new Date('2026-09-10T12:00:00Z');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'sm-collect-')));
const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const HOUR = 3_600_000;

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: iso(2 * HOUR), GIT_COMMITTER_DATE: iso(2 * HOUR) },
  });
}

const ARCH_FILES = {
  'README.md': '# Shop parts\n\n## Front\n\n- [Shop](shop.md)\n\n## Back office\n\n- [Billing](billing.md)\n',
  'shop.md': [
    '# Shop', '', 'Where people fill the cart.', '', '## Where in the code', '', '- `src/shop/`', '',
    "## What's missing", '', '- [ ] **with Ana:** Pick the cart icon `sh01`', '- [ ] Cart totals `sh02`', '- [ ] **Claude:** Rename the cart store `sh03`', '',
  ].join('\n'),
  'billing.md': ['# Billing', '', 'Invoices and taxes.', '', '## Where in the code', '', '- `src/billing/`', '', "## What's missing", '', '- [ ] Tax table `bi01`', ''].join('\n'),
};

function repo(root, { arch = false } = {}) {
  mkdirSync(join(root, 'src', 'shop'), { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'src', 'shop', 'cart.ts'), 'a\n');
  if (arch) {
    mkdirSync(join(root, 'docs', 'architecture'), { recursive: true });
    for (const [name, text] of Object.entries(ARCH_FILES)) writeFileSync(join(root, 'docs', 'architecture', name), text);
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

// One conversation file: 2 USD of claude-fake-1 per assistant line (200k input at 5/M + 40k output at 25/M).
function writeChat(dir, { id, cwd, branch = 'main', title, prompts = ['add the cart'], edits = [], card, endedAgo = HOUR, question = false, mtimeAgo = endedAgo, entrypoint }) {
  const ts = iso(endedAgo);
  const base = { sessionId: id, cwd, gitBranch: branch, timestamp: ts, ...(entrypoint ? { entrypoint } : {}) };
  const lines = [];
  if (title) lines.push({ type: 'ai-title', aiTitle: title, sessionId: id });
  for (const text of prompts) lines.push({ ...base, type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text }] } });
  edits.forEach((file, i) => {
    lines.push({ ...base, type: 'assistant', message: { id: `${id}-e${i}`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: `${id}-t${i}`, name: 'Edit', input: { file_path: join(cwd, file) } }] } });
    lines.push({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${id}-t${i}`, content: 'ok' }] } });
  });
  const block = card ? `\`\`\`session-map\n${JSON.stringify(card)}\n\`\`\`\n` : '';
  const text = `${block}${'x'.repeat(400)} done${question ? ' Should I push?' : '.'}`;
  lines.push({ ...base, type: 'assistant', message: { id: `${id}-m`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 200_000, output_tokens: 40_000 } } });
  const projDir = join(dir, 'projects', cwd.replace(/[^a-z0-9]/gi, '-'));
  mkdirSync(projDir, { recursive: true });
  const file = join(projDir, `${id}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const t = (NOW.getTime() - mtimeAgo) / 1000;
  utimesSync(file, t, t);
}

function writeSession(dir, { pid, id, cwd, status = 'idle', entrypoint = 'cli', bridge = null }) {
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: id, cwd, name: 'x', status, updatedAt: NOW.getTime(), kind: 'interactive', entrypoint, bridgeSessionId: bridge }));
}

const alive = () => true;
// No claude binary: the AI is off, as on a machine without Claude Code.
const NO_AI = { bin: null };

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test('AiQueue: an uncapped ask passes the hourly cap and does not use it up', async () => {
  const smDir = tmp();
  try {
    let calls = 0;
    const run = async () => { calls++; return { ok: true, value: { n: calls }, costUSD: 0.001 }; };
    const q = new AiQueue({ smDir, bin: 'claude', run, maxCallsPerHour: 1, now: () => NOW.getTime() });
    assert.equal((await q.ask({ key: 'a', prompt: 'p', uncapped: true })).ok, true);
    assert.equal((await q.ask({ key: 'b', prompt: 'p', uncapped: true })).ok, true);
    assert.equal((await q.ask({ key: 'c', prompt: 'p' })).ok, true);
    assert.equal((await q.ask({ key: 'd', prompt: 'p' })).error, 'rate-limited');
    assert.equal(calls, 3);
  } finally { cleanup(smDir); }
});

test('collect with no conversations returns a valid empty state', async () => {
  const dir = tmp();
  const smDir = tmp();
  try {
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    assert.equal(state.generatedAt, NOW.toISOString());
    assert.equal(state.waitingCount, 0);
    assert.deepEqual(state.projects, []);
    assert.deepEqual(state.totals, { today: 0, d7: 0, d30: 0 });
    assert.deepEqual(state.currency, { code: 'USD', rate: 1 });
    assert.equal(state.budget, null);
  } finally { cleanup(dir, smDir); }
});

test('collect reads the architecture and hangs chats on its parts: an item code first, then the files edited', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { monthlyUSD: 100 }, currency: { code: 'BRL', rate: 5 } }));
    writeChat(dir, { id: A, cwd: root, title: 'Cart page', edits: ['src/shop/cart.ts', 'src/shop/list.ts'] });
    writeChat(dir, { id: B, cwd: root, title: 'Invoices', prompts: ['work on `bi01` now'], edits: ['src/shop/cart.ts'], card: { title: 'Invoices', waiting: ['approve tax rule'] }, question: true });
    writeChat(dir, { id: C, cwd: root, title: 'Old idea', endedAgo: 5 * 24 * HOUR });
    writeChat(dir, { id: D, cwd: join(smDir, 'ai-runner'), title: 'map ai call' });
    writeSession(dir, { pid: 4242, id: A, cwd: root, status: 'busy', bridge: 'session_abc' });

    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    assert.equal(state.projects.length, 1, 'the ai-runner conversation is hidden');
    const [p] = state.projects;
    assert.equal(p.id, projectIdOf(root));
    assert.equal(p.name, 'acme-shop');
    assert.equal(p.mainBranch, 'main');
    assert.equal(p.units, undefined, 'the cell tree is gone');
    assert.equal(p.unitLinks, undefined);
    assert.equal(p.arch.source, 'worktree');
    assert.equal(p.arch.dir, 'docs/architecture');
    assert.deepEqual(p.arch.layers.map((l) => [l.name, l.partIds]), [['Front', ['shop']], ['Back office', ['billing']]]);
    assert.deepEqual([...p.chats.map((c) => c.sessionId)].sort(), [A, B], 'live + touched in the last 24 h; the 5-day-old one is left out');

    const a = p.chats.find((c) => c.sessionId === A);
    assert.equal(a.partId, 'shop');
    assert.equal(a.partSource, 'files');
    assert.equal(a.unitId, undefined);
    assert.equal(a.status, 'busy');
    assert.equal(a.live, true);
    assert.equal(a.chattable, false);
    assert.equal(a.bridgeUrl, 'https://claude.ai/code/session_abc');
    assert.equal(a.lastAssistantText.length, 280);
    assert.equal(a.costUSD, 2);

    const b = p.chats.find((c) => c.sessionId === B);
    assert.equal(b.partId, 'billing', 'the item code beats the files');
    assert.equal(b.partSource, 'code');
    assert.equal(b.itemCode, 'bi01', 'the item it cites is the tip it works on');
    assert.equal(a.itemCode, null);
    assert.ok(Array.isArray(a.liveSteps) && a.liveSteps.every((st) => typeof st.kind === 'string' && 'target' in st), 'every chat carries its live steps');
    assert.ok(a.liveSteps.some((st) => st.kind === 'edit'), 'the edits of the transcript are steps');
    assert.equal(b.chattable, true);
    assert.deepEqual(b.waiting, { strong: false, weak: true, items: ['approve tax rule'] });

    const part = (id) => p.arch.parts.find((x) => x.id === id);
    assert.deepEqual(part('shop').chatIds, [A]);
    assert.deepEqual(part('billing').chatIds, [B]);
    assert.deepEqual(part('shop').counts, { todo: 3, doing: 0, done: 0, withUser: 1, blocks: 0 });

    const items = p.decisions.filter((d) => d.kind === 'item');
    assert.deepEqual(items.map((i) => [i.partId, i.code, i.text]), [['shop', 'sh01', 'Pick the cart icon']], 'only the item waiting on a person');
    assert.equal(state.waitingCount, 3, 'the chat\'s weak end and item, plus the item waiting on Ana');

    assert.deepEqual(p.cost, { today: 4, d7: 6, d30: 6 });
    const todayKey = isoDay(NOW);
    assert.equal(p.costByDay[todayKey], 4, 'the same money, day by day (mm06)');
    assert.equal(Object.values(p.costByDay).reduce((s, v) => s + v, 0), 6);
    assert.deepEqual(state.totals, { today: 4, d7: 6, d30: 6 });
    assert.deepEqual(state.currency, { code: 'BRL', rate: 5 });
    assert.deepEqual(state.budget, { monthlyUSD: 100, used: 6 });
    assert.equal(p.ai, null, 'no claude: rules only');
    const init = p.activity.find((i) => i.kind === 'commit' && i.subject === 'init');
    assert.ok(init.partIds.includes('shop'), 'commits hang on the parts their files fall in');
    assert.deepEqual(p.arch.links.map((l) => [l.a, l.b, l.weight, l.reasons.map((r) => [r.kind, r.sessionId])]), [['billing', 'shop', 1, [['shared-chat', B]]]], 'the chat on billing that edited the shop links the two');
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('collect hangs branches on parts by their diff and fills them from their chats', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'shop'), { arch: true });
  try {
    git(root, ['checkout', '-q', '-b', 'feature/cart']);
    writeFileSync(join(root, 'src', 'shop', 'cart.ts'), 'b\n');
    git(root, ['commit', '-q', '-am', 'cart totals']);
    git(root, ['checkout', '-q', 'main']);
    writeChat(dir, { id: A, cwd: root, branch: 'feature/cart', title: 'Cart totals', card: { title: 'x', doing: 'summing lines', estimateUSD: 10 } });
    // Older than 24 h but on an open branch: still shown.
    writeChat(dir, { id: B, cwd: root, branch: 'feature/cart', title: 'Cart start', endedAgo: 3 * 24 * HOUR });

    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    const cell = p.workCells.find((w) => w.id === 'feature/cart');
    assert.equal(cell.partId, 'shop');
    assert.equal(cell.unitId, undefined);
    assert.deepEqual([...cell.chatIds].sort(), [A, B]);
    assert.equal(cell.costUSD, 4);
    assert.equal(cell.estimateUSD, 10);
    assert.equal(cell.nucleus.doing, 'summing lines');
    assert.deepEqual(p.arch.parts.find((x) => x.id === 'shop').workCellIds, ['feature/cart']);
    const a = p.chats.find((c) => c.sessionId === A);
    assert.equal(a.workCellId, 'feature/cart');
    assert.equal(a.workCellSource, 'branch');
    assert.ok(readEvents(smDir, p.id).some((e) => e.kind === 'born' && e.workCellId === 'feature/cart'));
    const born = p.activity.find((i) => i.kind === 'born' && i.workCellId === 'feature/cart');
    assert.deepEqual(born.partIds, ['shop']);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('a chat the page opened on a part stays there when no item code places it, before the files and the AI', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    const id = projectIdOf(root);
    writeChat(dir, { id: A, cwd: root, title: 'Opened on billing', edits: ['src/shop/cart.ts'] });
    writeChat(dir, { id: B, cwd: root, title: 'Cites an item', prompts: ['see `sh02`'] });
    writeChat(dir, { id: C, cwd: root, title: 'Part gone', endedAgo: HOUR });
    writeChat(dir, { id: D, cwd: root, title: 'Other project', endedAgo: HOUR });
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [A]: { projectId: id, partId: 'billing' }, [B]: { projectId: id, partId: 'billing' }, [C]: { projectId: id, partId: 'ghost' }, [D]: { projectId: 'other-123456', partId: 'billing' },
    }));
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    const placed = (sessionId) => { const c = p.chats.find((x) => x.sessionId === sessionId); return [c.partId, c.partSource]; };
    assert.deepEqual(placed(A), ['billing', 'page']);
    assert.deepEqual(placed(B), ['shop', 'code']);
    assert.deepEqual(placed(C), [null, 'none']);
    assert.deepEqual(placed(D), [null, 'none']);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('files edited in a sibling checkout of the repo place the chat too', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Tax from the worktree', edits: [join('..', 'acme-shop-hotfix', 'src', 'billing', 'tax.ts')] });
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.deepEqual([p.chats[0].partId, p.chats[0].partSource], ['billing', 'files']);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('a project without architecture shows only the project and loose chats, and never asks the AI', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'plain'));
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Cart', edits: ['src/shop/cart.ts'] });
    let calls = 0;
    const ai = { bin: 'fake-claude', run: async () => { calls++; return { ok: true, value: { partId: null }, costUSD: 0.001 }; } };
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai })).projects;
    await settleAi(smDir);
    assert.deepEqual(p.arch, { source: 'none', dir: null, lang: 'en', mermaid: null, layers: [], parts: [], links: [] });
    assert.equal(p.chats[0].partId, null);
    assert.equal(p.chats[0].partSource, 'none');
    assert.equal(calls, 0);
    assert.deepEqual(p.decisions, []);
  } finally {
    forgetLife(smDir);
    cleanup(dir, smDir, join(root, '..'));
  }
});

test('a chat no code or file places is shown to the AI with the parts as candidates; placed ones never are', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'garden'), { arch: true });
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: true, maxCallsPerHour: 30 } }));
    writeChat(dir, { id: A, cwd: root, title: 'Tax rounding', prompts: ['round the taxes like the accountant asked'] });
    writeChat(dir, { id: B, cwd: root, title: 'Cart page', edits: ['src/shop/cart.ts'] });
    const prompts = [];
    const run = async (prompt) => { prompts.push(prompt); return { ok: true, value: { partId: 'billing' }, costUSD: 0.002 }; };
    const ai = { bin: 'fake-claude', run };

    const first = await collect({ dir, smDir, now: NOW, isAlive: alive, ai });
    assert.equal(first.projects[0].ai.enabled, true);
    assert.equal(first.projects[0].chats.find((c) => c.sessionId === A).partSource, 'none', 'the answer comes in the background');
    await settleAi(smDir);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Tax rounding/);
    assert.match(prompts[0], /"billing"/);

    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai })).projects;
    await settleAi(smDir);
    const a = p.chats.find((c) => c.sessionId === A);
    assert.equal(a.partId, 'billing');
    assert.equal(a.partSource, 'ai');
    assert.deepEqual(p.arch.parts.find((x) => x.id === 'billing').chatIds, [A]);
    assert.equal(prompts.length, 1, 'nothing changed, nothing asked again');
  } finally {
    forgetLife(smDir);
    cleanup(dir, smDir, join(root, '..'));
  }
});

test('with ai.enabled false collect stays on the rules and never calls claude', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'quiet'), { arch: true });
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: false } }));
    writeChat(dir, { id: A, cwd: root, title: 'x' });
    let calls = 0;
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: { bin: 'fake', run: async () => { calls++; return { ok: false }; } } });
    await settleAi(smDir);
    assert.equal(calls, 0);
    assert.equal(state.projects[0].ai, null);
    assert.equal(state.projects[0].chats[0].partSource, 'none');
  } finally {
    forgetLife(smDir);
    cleanup(dir, smDir, join(root, '..'));
  }
});

async function twoProjects(setupBroken) {
  const dir = tmp();
  const smDir = tmp();
  const base = tmp();
  const good = repo(join(base, 'good-app'));
  const bad = repo(join(base, 'bad-app'));
  try {
    writeChat(dir, { id: A, cwd: good, title: 'Good chat' });
    writeChat(dir, { id: B, cwd: bad, title: 'Bad chat' });
    setupBroken({ smDir, bad });
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    return { state, names: state.projects.map((p) => p.name).sort() };
  } finally { cleanup(dir, smDir, base); }
}

test('an OpenSpec tasks.md that is a directory does not break collect', async () => {
  const { names } = await twoProjects(({ bad }) => {
    mkdirSync(join(bad, 'openspec', 'changes', 'add-x', 'tasks.md'), { recursive: true });
  });
  assert.deepEqual(names, ['bad-app', 'good-app']);
});

test('a config roadmap that is not a string, or decisions without heading, are ignored', async () => {
  const { state } = await twoProjects(({ bad }) => {
    mkdirSync(join(bad, '.claude'), { recursive: true });
    writeFileSync(join(bad, '.claude', 'session-map.json'), JSON.stringify({ roadmap: 42 }));
  });
  assert.equal(state.projects.find((p) => p.name === 'bad-app').roadmap, null);
  const { state: s2 } = await twoProjects(({ bad }) => {
    mkdirSync(join(bad, '.claude'), { recursive: true });
    writeFileSync(join(bad, 'ROADMAP.md'), '## Plan\n- [ ] 1. Ship it\n## Decisions\n| x | pending |\n');
    writeFileSync(join(bad, '.claude', 'session-map.json'), JSON.stringify({ roadmap: 'ROADMAP.md', decisions: { pendingWhen: 'pending' } }));
  });
  const p = s2.projects.find((x) => x.name === 'bad-app');
  assert.equal(p.roadmap.length, 1);
  assert.deepEqual(p.decisions, []);
});

test('one project that throws while being built is skipped; the others still come back', async () => {
  const { names } = await twoProjects(({ smDir, bad }) => {
    git(bad, ['checkout', '-q', '-b', 'feature/x']);
    writeFileSync(join(bad, 'src', 'shop', 'x.ts'), 'x\n');
    git(bad, ['add', '.']);
    git(bad, ['commit', '-q', '-m', 'x']);
    git(bad, ['checkout', '-q', 'main']);
    git(bad, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature/x'", 'feature/x']);
    // events.jsonl as a folder: the first write of the merge history fails.
    mkdirSync(join(smDir, 'brain', projectIdOf(bad), 'events.jsonl'), { recursive: true });
  });
  assert.deepEqual(names, ['good-app']);
});

test('the merge backfill is skipped when events.jsonl already holds the project', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'merged-app'));
  try {
    git(root, ['checkout', '-q', '-b', 'feature/x']);
    writeFileSync(join(root, 'src', 'shop', 'x.ts'), 'x\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'x']);
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', '-m', "Merge branch 'feature/x'", 'feature/x']);
    git(root, ['branch', '-q', '-D', 'feature/x']);
    appendEvents(smDir, projectIdOf(root), [{ kind: 'born', ts: iso(HOUR), workCellId: 'feature/old' }]);
    writeChat(dir, { id: A, cwd: root, title: 'Merged' });
    await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    assert.equal(readEvents(smDir, projectIdOf(root)).filter((e) => e.kind === 'fused').length, 0);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('activity keeps branch births and fusions, and drops the events of the old cell tree', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'history'));
  try {
    appendEvents(smDir, projectIdOf(root), [
      { kind: 'born', ts: iso(HOUR), workCellId: 'feature/gone' },
      { kind: 'renamed', ts: iso(HOUR), branch: null, unitIds: ['shop'], subject: 'Shop → Store' },
      { kind: 'grouped', ts: iso(HOUR), branch: null, unitIds: ['a', 'b'] },
    ]);
    writeChat(dir, { id: A, cwd: root, title: 'History' });
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.deepEqual(p.activity.filter((i) => i.kind !== 'commit').map((i) => [i.kind, i.workCellId, i.partIds]), [['born', 'feature/gone', []]]);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('tunnelUrl comes from the machine-wide config and only when it is an https link', async () => {
  const withConfig = async (config) => {
    const { state } = await twoProjects(({ smDir }) => writeFileSync(join(smDir, 'config.json'), JSON.stringify(config)));
    return state.projects.map((p) => p.tunnelUrl);
  };
  assert.deepEqual(await withConfig({ tunnelUrl: 'https://vscode.dev/tunnel/my-pc' }), ['https://vscode.dev/tunnel/my-pc', 'https://vscode.dev/tunnel/my-pc']);
  assert.deepEqual(await withConfig({ tunnelUrl: 'http://vscode.dev/tunnel/my-pc' }), [null, null]);
  assert.deepEqual(await withConfig({ tunnelUrl: 'javascript:alert(1)' }), [null, null]);
  assert.deepEqual(await withConfig({ tunnelUrl: 42 }), [null, null]);
  assert.deepEqual(await withConfig({}), [null, null]);
});

// `git commit -q` prints no "[branch hash]" line, and Workflow agents commit from their own transcripts.
test('collect ties commits to the chat by subject when no hash was printed, including commits made by its agents', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'shop'));
  try {
    writeFileSync(join(root, 'src', 'shop', 'cart.ts'), 'b\n');
    git(root, ['commit', '-q', '-am', 'cart totals']);
    writeFileSync(join(root, 'src', 'shop', 'cart.ts'), 'c\n');
    git(root, ['commit', '-q', '-am', 'tax rule']);
    writeChat(dir, { id: A, cwd: root, title: 'Cart' });
    const projDir = join(dir, 'projects', root.replace(/[^a-z0-9]/gi, '-'));
    const commitLines = (id, subject) => [
      { sessionId: A, cwd: root, timestamp: iso(HOUR), type: 'assistant', message: { id: `${id}-m`, role: 'assistant', content: [{ type: 'tool_use', id: `${id}-t`, name: 'Bash', input: { command: `git add . && git commit -q -m "${subject}"` } }] } },
      { sessionId: A, cwd: root, timestamp: iso(HOUR), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${id}-t`, content: '' }] } },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n';
    const main = join(projDir, `${A}.jsonl`);
    writeFileSync(main, readFileSync(main, 'utf8') + commitLines('c1', 'cart totals'));
    const t = (NOW.getTime() - HOUR) / 1000;
    utimesSync(main, t, t);
    mkdirSync(join(projDir, A, 'subagents'), { recursive: true });
    writeFileSync(join(projDir, A, 'subagents', 'agent-1.jsonl'), commitLines('c2', 'tax rule'));

    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    const bySubject = (s) => p.activity.find((i) => i.kind === 'commit' && i.subject === s);
    assert.equal(bySubject('cart totals').sessionId, A);
    assert.equal(bySubject('tax rule').sessionId, A);
    assert.equal(bySubject('init').sessionId, undefined);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('clashItems says "your branches" when one person owns both, and names both people otherwise', () => {
  const cell = (id, owner, paths) => ({ id, branch: id, status: 'active', owner: { name: owner, email: `${owner}@example.com` }, files: paths.map((path) => ({ path, status: 'M' })), clashWith: [] });
  const a = cell('feat/a', 'Ana', ['src/index.ts', 'src/a.ts']);
  const b = cell('feat/b', 'Ana', ['src/index.ts']);
  const c = cell('feat/c', 'Rui', ['src/a.ts']);
  a.clashWith = ['feat/b', 'feat/c'];
  b.clashWith = ['feat/a'];
  c.clashWith = ['feat/a'];
  const items = clashItems([a, b, c], 'p1');
  assert.equal(items.length, 2);
  const mine = items.find((i) => i.sameOwner);
  assert.deepEqual(mine.workCellIds, ['feat/a', 'feat/b']);
  assert.deepEqual(mine.files, ['src/index.ts']);
  assert.equal(mine.text, 'Your branches feat/a and feat/b touch the same file: src/index.ts');
  const theirs = items.find((i) => !i.sameOwner);
  assert.deepEqual(theirs.owners, ['Ana', 'Rui']);
  assert.equal(theirs.text, 'Ana (feat/a) and Rui (feat/c) touch the same file: src/a.ts');
});

test('conversations lists every conversation of the window, the page ones older than it, where each is and where it came from', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Cart page', edits: ['src/shop/cart.ts'], entrypoint: 'cli' });
    writeChat(dir, { id: B, cwd: root, title: 'Invoices', prompts: ['work on `bi01` now'], question: true, entrypoint: 'claude-vscode' });
    writeChat(dir, { id: C, cwd: root, title: 'Old idea', endedAgo: 5 * 24 * HOUR, entrypoint: 'cli' });
    writeChat(dir, { id: D, cwd: join(smDir, 'ai-runner'), title: 'map ai call' });
    writeChat(dir, { id: E, cwd: root, title: 'Dark mode', endedAgo: 2 * HOUR, entrypoint: 'sdk-cli' });
    writeSession(dir, { pid: 4242, id: A, cwd: root, status: 'busy' });
    const projectId = projectIdOf(root);
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [E]: { projectId, root, cwd: root, partId: null, node: { kind: 'idea' }, title: 'Dark mode', startedAt: iso(3 * HOUR), updatedAt: iso(2 * HOUR) },
      [F]: { projectId, root, cwd: root, partId: 'billing', node: { kind: 'part' }, title: 'Old billing chat', startedAt: iso(41 * 24 * HOUR), updatedAt: iso(40 * 24 * HOUR) },
      'not-a-uuid': { projectId, title: 'junk' },
      '99999999-9999-4999-8999-999999999999': { projectId: 'another-project', title: 'elsewhere' },
    }));

    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    const [p] = state.projects;
    const rows = p.conversations;
    assert.deepEqual(rows.map((r) => r.sessionId), [A, B, E, C, F], 'newest first; the ai-runner, junk and other projects left out');
    const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
    assert.deepEqual(rows.map((r) => r.origin), ['terminal', 'vscode', 'map', 'terminal', 'map']);
    assert.equal(by[A].status, 'busy');
    assert.deepEqual({ kind: by[A].lastStep.kind, target: by[A].lastStep.target }, { kind: 'edit', target: 'src/shop/cart.ts' });
    assert.equal(by[A].partId, 'shop');
    assert.equal(by[A].onMap, true);
    assert.equal(by[A].costUSD, 2);
    assert.equal(by[B].waiting, true, 'it ends with a question');
    assert.equal(by[B].itemCode, 'bi01');
    assert.equal(by[B].status, 'closed');
    assert.equal(by[C].onMap, false, 'five days old: off the map, still in the list');
    assert.equal(by[C].waiting, false);
    assert.equal(by[C].chattable, true);
    assert.deepEqual(by[E].node, { kind: 'idea' });
    assert.equal(by[E].title, 'Dark mode');
    assert.deepEqual([by[F].title, by[F].partId, by[F].status, by[F].costUSD, by[F].updatedAt], ['Old billing chat', 'billing', 'closed', null, iso(40 * 24 * HOUR)]);
    for (const r of rows) assert.equal(r.cwd, undefined, 'the folder stays on the server');
    assert.equal(state[INTERNALS].chats.get(C).cwd, root, 'an older conversation can still be opened in a terminal');
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('collect reads the workflows of a live conversation again on every pass, though its transcript did not change', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Cart page', edits: ['src/shop/cart.ts'] });
    writeSession(dir, { pid: 4242, id: A, cwd: root, status: 'busy' });
    const flowDir = join(dir, 'projects', root.replace(/[^a-z0-9]/gi, '-'), A, 'subagents', 'workflows', 'wf_build');
    mkdirSync(flowDir, { recursive: true });
    const journal = join(flowDir, 'journal.jsonl');
    writeFileSync(journal, `${JSON.stringify({ type: 'started', agentId: 'x1', label: 'Write tests' })}\n`);
    writeFileSync(join(flowDir, 'agent-x1.meta.json'), JSON.stringify({ model: 'haiku' }));

    const first = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects[0].chats[0].workflows[0];
    assert.deepEqual([first.done, first.started, first.running.map(({ label, model }) => ({ label, model }))], [0, 1, [{ label: 'Write tests', model: 'haiku' }]]);

    writeFileSync(journal, `${JSON.stringify({ type: 'started', agentId: 'x1', label: 'Write tests' })}\n${JSON.stringify({ type: 'result', agentId: 'x1' })}\n`);
    const second = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects[0].chats[0].workflows[0];
    assert.deepEqual([second.done, second.running], [1, []], 'the agent that answered leaves the running list');
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('the origin tells VS Code, the Claude app, a terminal, the phone, the map and an automation apart, and a chat names its model', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  try {
    writeChat(dir, { id: A, cwd: root, title: 'From the terminal', entrypoint: 'cli' });
    writeChat(dir, { id: B, cwd: root, title: 'From VS Code', entrypoint: 'claude-vscode' });
    writeChat(dir, { id: C, cwd: root, title: 'From the Claude app', entrypoint: 'claude-desktop' });
    writeChat(dir, { id: D, cwd: root, title: 'From the phone', entrypoint: 'remote' });
    writeChat(dir, { id: E, cwd: root, title: 'From the map', entrypoint: 'sdk-cli' });
    writeChat(dir, { id: F, cwd: root, title: 'A script', entrypoint: 'sdk-ts' });
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [E]: { projectId: projectIdOf(root), title: 'From the map' } }));
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    const origin = Object.fromEntries(p.conversations.map((r) => [r.title, r.origin]));
    assert.deepEqual(origin, {
      'From the terminal': 'terminal', 'From VS Code': 'vscode', 'From the Claude app': 'desktop', 'From the phone': 'remote', 'From the map': 'map', 'A script': 'sdk',
    });
    assert.equal(p.chats.find((c) => c.sessionId === A).model, 'claude-fake-1', 'the model of its last reply');
    assert.equal(p.chats.find((c) => c.sessionId === A).turnStartedAt, iso(HOUR), 'the turn started at the last thing the person wrote');
    assert.equal(p.conversations.find((r) => r.sessionId === A).partSource, 'none', 'the list knows how a row was placed');
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('the owner moves a conversation to another project and part and renames it: that choice wins over every rule', async () => {
  const dir = tmp();
  const smDir = tmp();
  const shop = repo(join(tmp(), 'acme-shop'), { arch: true });
  const garden = repo(join(tmp(), 'garden'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: shop, title: 'Long chat about the garden', prompts: ['see `sh02`'] });
    writeChat(dir, { id: B, cwd: shop, title: 'Stays here', prompts: ['see `sh02`'] });
    writeChat(dir, { id: C, cwd: garden, title: 'Renamed only', prompts: ['see `sh02`'] });
    writeFileSync(join(smDir, 'placements.json'), JSON.stringify({
      [A]: { root: garden, partId: 'billing', title: 'Garden invoices' },
      [C]: { title: 'Seed list' },
    }));
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    const byName = Object.fromEntries(state.projects.map((p) => [p.name, p]));
    assert.deepEqual(byName['acme-shop'].conversations.map((r) => r.sessionId), [B]);
    const moved = byName.garden.chats.find((c) => c.sessionId === A);
    assert.deepEqual([moved.partId, moved.partSource, moved.title], ['billing', 'owner', 'Garden invoices']);
    const row = byName.garden.conversations.find((r) => r.sessionId === A);
    assert.deepEqual([row.partId, row.title], ['billing', 'Garden invoices']);
    assert.deepEqual(byName.garden.arch.parts.find((x) => x.id === 'billing').chatIds, [A]);
    const renamed = byName.garden.chats.find((c) => c.sessionId === C);
    assert.deepEqual([renamed.title, renamed.partId, renamed.partSource], ['Seed list', 'shop', 'code'], 'a rename alone keeps the place the rules found');
    assert.equal(state[INTERNALS].chats.get(A).cwd, shop, 'it still resumes in the folder it ran in');
  } finally { cleanup(dir, smDir, join(shop, '..'), join(garden, '..')); }
});

test('the owner\'s moves teach the AI: its prompt lists them as examples', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'garden'), { arch: true });
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: true, maxCallsPerHour: 30 } }));
    writeChat(dir, { id: A, cwd: root, title: 'Tax rounding', prompts: ['round the taxes like the accountant asked'] });
    writeChat(dir, { id: B, cwd: root, title: 'VAT question', prompts: ['what about VAT'] });
    writeFileSync(join(smDir, 'placements.json'), JSON.stringify({ [B]: { root, partId: 'billing', title: 'VAT for invoices' } }));
    const prompts = [];
    const run = async (prompt) => { prompts.push(prompt); return { ok: true, value: { partId: 'billing' }, costUSD: 0.002 }; };
    await collect({ dir, smDir, now: NOW, isAlive: alive, ai: { bin: 'fake-claude', run } });
    await settleAi(smDir);
    assert.equal(prompts.length, 1, 'the moved conversation is never asked about');
    assert.match(prompts[0], /Tax rounding/);
    assert.match(prompts[0], /VAT for invoices/);
    assert.match(prompts[0], /owner/i);
  } finally {
    forgetLife(smDir);
    cleanup(dir, smDir, join(root, '..'));
  }
});
