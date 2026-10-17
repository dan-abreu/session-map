import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clashItems, collect, settleAi, topLevelOf } from '../server/collect.mjs';
import { forgetLife } from '../server/ai/life.mjs';
import { appendEvents, readEvents } from '../server/brain/events.mjs';
import { AiQueue } from '../server/ai/runner.mjs';
import { createProject } from '../server/newproject.mjs';
import { normalizePath, projectIdOf } from '../server/paths.mjs';
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
// The turn ends as a finished one does (end_turn); stopReason: null leaves it open, cut mid-stream (mm43).
function writeChat(dir, { id, cwd, branch = 'main', title, prompts = ['add the cart'], edits = [], card, endedAgo = HOUR, question = false, mtimeAgo = endedAgo, entrypoint, stopReason = 'end_turn', tail = [] }) {
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
  lines.push({ ...base, type: 'assistant', message: { id: `${id}-m`, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 200_000, output_tokens: 40_000 }, ...(stopReason ? { stop_reason: stopReason } : {}) } });
  for (const extra of tail) lines.push({ ...base, ...extra });
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

test('a folder the page created is a project before any conversation runs there; a removed one is not (sv14)', async () => {
  const dir = tmp();
  const smDir = tmp();
  const parent = tmp();
  try {
    const made = createProject(smDir, { parent, name: 'novo' });
    const gone = createProject(smDir, { parent, name: 'apagado' });
    rmSync(gone.root, { recursive: true });
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    assert.deepEqual(state.projects.map((p) => p.id), [projectIdOf(made.root)]);
    const [p] = state.projects;
    assert.equal(p.name, 'novo');
    assert.equal(normalizePath(p.root), normalizePath(made.root));
    assert.equal(p.chats.length, 0);
  } finally { cleanup(dir, smDir, parent); }
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
    assert.deepEqual(a.partWhy, { rule: 'files', files: ['src/shop/cart.ts', 'src/shop/list.ts'] }, 'the page can say which files put it here');
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
    assert.deepEqual(b.partWhy, { rule: 'code', codes: ['bi01'] }, 'and which item code');
    assert.deepEqual(p.conversations.find((r) => r.sessionId === B).partWhy, b.partWhy, 'the list row keeps the same reason');
    assert.equal(b.itemCode, 'bi01', 'the item it cites is the tip it works on');
    assert.equal(a.itemCode, null);
    assert.ok(Array.isArray(a.liveSteps) && a.liveSteps.every((st) => typeof st.kind === 'string' && 'target' in st), 'every chat carries its live steps');
    assert.ok(a.liveSteps.some((st) => st.kind === 'edit'), 'the edits of the transcript are steps');
    assert.equal(b.chattable, true);
    assert.deepEqual(b.waiting, { strong: false, weak: true, items: ['approve tax rule'] });

    const part = (id) => p.arch.parts.find((x) => x.id === id);
    assert.deepEqual(part('shop').chatIds, [A]);
    assert.deepEqual(part('billing').chatIds, [B]);
    assert.deepEqual(part('shop').counts, { todo: 3, doing: 0, done: 0, later: 0, withUser: 1, blocks: 0 });

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
    assert.deepEqual(a.workCellWhy, { rule: 'branch', branch: 'feature/cart' });
    assert.ok(readEvents(smDir, p.id).some((e) => e.kind === 'born' && e.workCellId === 'feature/cart'));
    const born = p.activity.find((i) => i.kind === 'born' && i.workCellId === 'feature/cart');
    assert.deepEqual(born.partIds, ['shop']);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('a branch takes the checklist with the longest matching name, not the first tool listed', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'shop'), { arch: true });
  try {
    // "export" (OpenSpec, listed first) is contained in the branch too, but "export-csv" (Kiro) is the closer name.
    mkdirSync(join(root, 'openspec', 'changes', 'export'), { recursive: true });
    writeFileSync(join(root, 'openspec', 'changes', 'export', 'tasks.md'), '- [ ] wide export\n');
    mkdirSync(join(root, '.kiro', 'specs', 'export-csv'), { recursive: true });
    writeFileSync(join(root, '.kiro', 'specs', 'export-csv', 'tasks.md'), '- [x] header row\n- [ ] quote commas\n');
    git(root, ['checkout', '-q', '-b', 'feature/export-csv']);
    writeFileSync(join(root, 'src', 'shop', 'cart.ts'), 'b\n');
    git(root, ['commit', '-q', '-am', 'csv']);
    git(root, ['checkout', '-q', 'main']);
    writeChat(dir, { id: A, cwd: root, branch: 'feature/export-csv', title: 'CSV export' });

    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    const cell = p.workCells.find((w) => w.id === 'feature/export-csv');
    assert.equal(cell.openspec.tool, 'Kiro');
    assert.equal(cell.openspec.change, 'export-csv');
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
    const { sizes, ...arch } = p.arch;
    assert.deepEqual(arch, { source: 'none', dir: null, lang: 'en', mermaid: null, layers: [], parts: [], links: [] });
    assert.deepEqual([sizes.total, sizes.unowned.files], [{ files: 1, lines: 1 }, 1], 'with no map, every file of the program has no box');
    assert.equal(p.chats[0].partId, null);
    assert.equal(p.chats[0].partSource, 'none');
    assert.deepEqual(p.chats[0].partWhy, { rule: 'none' });
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
    writeChat(dir, { id: A, cwd: root, title: 'Tax rounding', prompts: ['round the taxes like the accountant asked'], mtimeAgo: 10 * 60_000 });
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
    assert.deepEqual(a.partWhy, { rule: 'ai' });
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

test('a relation gets its plain-words reason from the motor, at once, with no call — also with the AI off (sb16)', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'garden'), { arch: true });
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: true, maxCallsPerHour: 30 } }));
    writeChat(dir, { id: B, cwd: root, title: 'Invoices', prompts: ['work on `bi01` now'], edits: ['src/shop/cart.ts'], mtimeAgo: 10 * 60_000 });
    const asked = [];
    const run = async (prompt) => { asked.push(prompt); return { ok: true, value: { partId: null }, costUSD: 0.001 }; };
    const ai = { bin: 'fake-claude', run };
    const first = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai })).projects[0];
    assert.equal(first.arch.links.length, 1);
    assert.equal(first.arch.links[0].why, 'The conversation "Invoices" worked on both.', 'the motor writes the sentence at once');
    await settleAi(smDir);
    assert.equal(asked.length, 0, 'no AI call for a sentence');
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai })).projects;
    await settleAi(smDir);
    assert.equal(p.arch.links[0].why, 'The conversation "Invoices" worked on both.', 'nothing changed, nothing asked again');

    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: false } }));
    forgetLife(smDir);
    const [off] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai })).projects;
    assert.equal(off.arch.links[0].why, 'The conversation "Invoices" worked on both.', 'a motor works with the AI off');
  } finally {
    forgetLife(smDir);
    cleanup(dir, smDir, join(root, '..'));
  }
});

// ---- the background work only where the person works (or where they allowed it) --------------------------------------------

async function quietProject(config, fn, { chat = {}, sessions = [], driving, projectFile } = {}) {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'orchard'), { arch: true });
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify(typeof config === 'function' ? config(root) : config));
    if (projectFile) {
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'session-map.json'), JSON.stringify(projectFile));
    }
    writeChat(dir, { id: A, cwd: root, title: 'Tax rounding', prompts: ['round the taxes like the accountant asked'], mtimeAgo: 2 * HOUR, ...chat });
    for (const s of sessions) writeSession(dir, { cwd: root, ...s });
    const prompts = [];
    const run = async (prompt) => { prompts.push(prompt); return { ok: true, value: { partId: 'billing' }, costUSD: 0.002 }; };
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: { bin: 'fake-claude', run }, ...(driving ? { driving } : {}) });
    await settleAi(smDir);
    await fn({ project: state.projects[0], prompts, root });
  } finally {
    forgetLife(smDir);
    cleanup(dir, smDir, join(root, '..'));
  }
}

const AI_ON = { ai: { enabled: true, maxCallsPerHour: 30 } };

test('a project nobody works on spends no tokens: its conversations are never shown to the AI, and it says it is paused', async () => {
  await quietProject(AI_ON, ({ project, prompts }) => {
    assert.equal(prompts.length, 0);
    assert.deepEqual(project.background, { always: false, working: false, on: false });
    assert.equal(project.chats[0].partSource, 'none');
  });
});

test('a conversation running now makes the project worked on, though its file moved hours ago', async () => {
  await quietProject(AI_ON, ({ project, prompts }) => {
    assert.deepEqual(project.background, { always: false, working: true, on: true });
    assert.equal(prompts.length, 1);
  }, { sessions: [{ pid: 4242, id: A, status: 'busy' }] });
});

test('a page chat the hub drives now makes the project worked on', async () => {
  await quietProject(AI_ON, ({ project }) => {
    assert.equal(project.background.working, true);
  }, { driving: new Set([A]) });
});

test('a project the person keeps always up to date is worked on in the background though nobody works there', async () => {
  const config = (root) => ({ ...AI_ON, projects: { [normalizePath(root)]: { background: 'always' } } });
  await quietProject(config, ({ project, prompts }) => {
    assert.deepEqual(project.background, { always: true, working: false, on: true });
    assert.equal(prompts.length, 1);
  });
});

test('a file inside the project cannot keep it always up to date: only the person\'s own settings can', async () => {
  await quietProject(AI_ON, ({ project, prompts }) => {
    assert.equal(project.background.on, false);
    assert.equal(prompts.length, 0);
  }, { projectFile: { background: 'always' } });
});

test('a conversation at work in another repository\'s files makes that one worked on too; hours later it does not', async () => {
  for (const [mtimeAgo, working] of [[5 * 60_000, true], [2 * HOUR, false]]) {
    const dir = tmp();
    const smDir = tmp();
    const base = tmp();
    const home = repo(join(base, 'home'));
    const other = repo(join(base, 'other'));
    try {
      writeFileSync(join(smDir, 'config.json'), JSON.stringify(AI_ON));
      writeChat(dir, { id: A, cwd: home, title: 'Shared cart', edits: ['../other/src/shop/cart.ts'], mtimeAgo });
      const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
      const p = state.projects.find((x) => normalizePath(x.root) === normalizePath(other));
      assert.ok(p, 'the edited repository shows as a project');
      assert.equal(p.background.working, working, `edited ${mtimeAgo / 60_000} minutes ago`);
    } finally {
      forgetLife(smDir);
      cleanup(dir, smDir, base);
    }
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

test('a project chat belongs to the whole project: the codes and files it touches never pin it to one part', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Before launch', prompts: ['what about `bi01`?'], edits: ['src/shop/cart.ts'] });
    const projectId = projectIdOf(root);
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [A]: { projectId, root, cwd: root, partId: null, node: { kind: 'project' }, title: 'Before launch', startedAt: iso(2 * HOUR) } }));
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    const [p] = state.projects;
    const row = p.conversations.find((r) => r.sessionId === A);
    assert.deepEqual([row.node, row.partId, row.partSource, row.itemCode], [{ kind: 'project' }, null, 'project', null]);
    const chat = p.chats.find((c) => c.sessionId === A);
    assert.deepEqual([chat.partId, chat.itemCode], [null, null]);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

// The orchestrator (or03): the list nests its activity chats under it by parentId and knows it by node.kind.
test('conversation rows carry their mother as recorded and their kind of point; the orchestrator belongs to the whole project', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Orchestrator', prompts: ['[session-map: activity `bi01` (sonnet) ended — finished]'] });
    writeChat(dir, { id: B, cwd: root, title: 'Tax table', prompts: ['work on `bi01`'] });
    writeChat(dir, { id: C, cwd: root, title: 'Cart', edits: ['src/shop/cart.ts'] });
    const projectId = projectIdOf(root);
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [A]: { projectId, root, cwd: root, partId: null, node: { kind: 'orchestrator' }, title: 'Orchestrator', startedAt: iso(3 * HOUR), run: { kind: 'settings' } },
      [B]: { projectId, root, cwd: root, partId: 'billing', node: { kind: 'item', code: 'bi01' }, parentId: A, title: 'Tax table', startedAt: iso(2 * HOUR), run: { kind: 'autonomous', model: 'sonnet', effort: 'medium' } },
      [E]: { projectId, root, cwd: root, partId: 'billing', node: { kind: 'item', code: 'bi01' }, parentId: A, title: 'Older tax work', startedAt: iso(41 * 24 * HOUR), run: { kind: 'fixed', model: 'haiku', effort: 'low' } },
    }));
    writeFileSync(join(smDir, 'lineage.json'), JSON.stringify({ [B]: A, [C]: B }));
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    const [p] = state.projects;
    const by = Object.fromEntries(p.conversations.map((r) => [r.sessionId, r]));
    assert.deepEqual([by[A].node, by[A].partId, by[A].partSource, by[A].itemCode, by[A].parentId], [{ kind: 'orchestrator' }, null, 'project', null, null]);
    assert.deepEqual([by[B].node.kind, by[B].parentId, by[B].itemCode], ['item', A, 'bi01']);
    assert.equal(by[C].parentId, B, 'from lineage.json');
    assert.equal(by[E].parentId, A, 'a page chat older than the window keeps it too');
    // The model session-map runs a page chat on (Autonomous with a named one: it shows); none for the rest and for
    // legacy saved ways the brain replaced (id146).
    assert.deepEqual([by[A].runModel, by[B].runModel, by[C].runModel, by[E].runModel], [null, 'sonnet', null, null]);
    assert.equal(p.tidy, false, '"Organize on its own" is off until the owner turns it on in the project');
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ projects: { [normalizePath(root)]: { tidy: true } } }));
    assert.equal((await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects[0].tidy, true);
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

test('a chat the page started reads "Map" even when the page\'s own record of it is gone', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Asked from the map', entrypoint: 'sdk-cli', prompts: ['Context from session-map (this is all you need from earlier work):\n\nArea: Shop\n\nwhat stopped here?'] });
    writeChat(dir, { id: B, cwd: root, title: 'A script', entrypoint: 'sdk-ts', prompts: ['run the nightly report'] });
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    const origin = Object.fromEntries(p.conversations.map((r) => [r.title, r.origin]));
    assert.deepEqual(origin, { 'Asked from the map': 'map', 'A script': 'sdk' });
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
    assert.deepEqual(moved.partWhy, { rule: 'owner' });
    writeFileSync(join(smDir, 'placements.json'), JSON.stringify({ [A]: { root: garden, partId: null } }));
    const off = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    const offChat = off.projects.find((p) => p.name === 'garden').chats.find((c) => c.sessionId === A);
    assert.deepEqual([offChat.partId, offChat.partWhy], [null, { rule: 'owner', none: true }], 'moved to no part: the reason says so');
    const row = byName.garden.conversations.find((r) => r.sessionId === A);
    assert.deepEqual([row.partId, row.title], ['billing', 'Garden invoices']);
    assert.deepEqual(byName.garden.arch.parts.find((x) => x.id === 'billing').chatIds, [A]);
    const renamed = byName.garden.chats.find((c) => c.sessionId === C);
    assert.deepEqual([renamed.title, renamed.partId, renamed.partSource], ['Seed list', 'shop', 'code'], 'a rename alone keeps the place the rules found');
    assert.equal(state[INTERNALS].chats.get(A).cwd, shop, 'it still resumes in the folder it ran in');
  } finally { cleanup(dir, smDir, join(shop, '..'), join(garden, '..')); }
});

test('a page chat the owner moved to another project is listed only there, not again in the project the page opened it in', async () => {
  const dir = tmp();
  const smDir = tmp();
  const shop = repo(join(tmp(), 'acme-shop'), { arch: true });
  const garden = repo(join(tmp(), 'garden'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: shop, title: 'Garden work opened in the shop', entrypoint: 'sdk-cli', prompts: ['plan the garden'] });
    writeChat(dir, { id: B, cwd: shop, title: 'Stays here', prompts: ['fix the cart'] });
    const shopId = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects.find((p) => p.name === 'acme-shop').id;
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [A]: { projectId: shopId, title: 'Garden work opened in the shop', node: { kind: 'project' } } }));
    writeFileSync(join(smDir, 'placements.json'), JSON.stringify({ [A]: { root: garden } }));
    const byName = Object.fromEntries((await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects.map((p) => [p.name, p]));
    assert.deepEqual(byName['acme-shop'].conversations.map((r) => r.sessionId), [B]);
    assert.deepEqual(byName.garden.conversations.map((r) => r.sessionId), [A]);
    assert.deepEqual(byName.garden.visitors.map((v) => v.sessionId), [], 'no visitor copy of it born in the shop');
  } finally { cleanup(dir, smDir, join(shop, '..'), join(garden, '..')); }
});

test('the owner\'s moves teach the AI: its prompt lists them as examples', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'garden'), { arch: true });
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: true, maxCallsPerHour: 30 } }));
    writeChat(dir, { id: A, cwd: root, title: 'Tax rounding', prompts: ['round the taxes like the accountant asked'], mtimeAgo: 10 * 60_000 });
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

test('topLevelOf names the root folders and the root files, so ./README.md in "Where in the code" is read from the root (fd16)', () => {
  const root = tmp();
  try {
    mkdirSync(join(root, 'Server'));
    writeFileSync(join(root, 'README.md'), '# x\n');
    assert.deepEqual([...topLevelOf(root)].sort(), ['readme.md', 'server']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- cut off (mm43): what was working when the server fell or the PC restarted --------------------------------------------

const BOOT = NOW.getTime() - 30 * 60_000;
const ASK_TAIL = [{ type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'ask-1', name: 'AskUserQuestion', input: { questions: [] } }] } }];

async function cutRows(setup, opts = {}) {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'));
  try {
    setup({ dir, smDir, root, projectId: projectIdOf(root) });
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI, bootMs: BOOT, ...opts });
    return Object.fromEntries((state.projects[0]?.conversations ?? []).map((r) => [r.sessionId, r.cutOff]));
  } finally { cleanup(dir, smDir, join(root, '..')); }
}

test('cutOff: a VS Code or terminal turn left open before this boot is cut off; one written after it, or closed, is not', async () => {
  const cut = await cutRows(({ dir, root }) => {
    writeChat(dir, { id: A, cwd: root, entrypoint: 'claude-vscode', endedAgo: HOUR, stopReason: null });
    writeChat(dir, { id: B, cwd: root, entrypoint: 'claude-vscode', endedAgo: 10 * 60_000, stopReason: null });
    writeChat(dir, { id: C, cwd: root, entrypoint: 'cli', endedAgo: HOUR, stopReason: 'end_turn' });
    writeChat(dir, { id: D, cwd: root, entrypoint: 'cli', endedAgo: HOUR, stopReason: null });
  });
  assert.deepEqual(cut, { [A]: true, [B]: false, [C]: false, [D]: true });
});

// A Restart takes well under a minute from the last transcript line to the boot (this PC: 10 to 57 s).
test('cutOff: a turn whose last line came 30 s before the boot is cut off', async () => {
  const cut = await cutRows(({ dir, root }) => {
    writeChat(dir, { id: A, cwd: root, entrypoint: 'claude-vscode', endedAgo: 30 * 60_000 + 30_000, stopReason: null });
  });
  assert.deepEqual(cut, { [A]: true });
});

test('cutOff: a page chat left "running" but whose turn was later finished elsewhere is not cut off', async () => {
  const cut = await cutRows(({ dir, smDir, root, projectId }) => {
    // A: finished in VS Code after the page's last turn end. B: the page sent a prompt and fell before claude wrote it.
    writeChat(dir, { id: A, cwd: root, entrypoint: 'sdk-cli', endedAgo: 10 * 60_000, stopReason: 'end_turn' });
    writeChat(dir, { id: B, cwd: root, entrypoint: 'sdk-cli', endedAgo: 10 * 60_000, stopReason: 'end_turn' });
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({
      [A]: { projectId, title: 'a', running: true, updatedAt: iso(HOUR) },
      [B]: { projectId, title: 'b', running: true, updatedAt: iso(10 * 60_000 - 2_000) },
    }));
  });
  assert.deepEqual(cut, { [A]: false, [B]: true });
});

test('cutOff: a session file left "busy" by a dead process cuts the turn off, though it was written after the boot', async () => {
  const cut = await cutRows(({ dir, root }) => {
    writeChat(dir, { id: A, cwd: root, entrypoint: 'claude-vscode', endedAgo: 10 * 60_000, stopReason: null });
    writeChat(dir, { id: B, cwd: root, entrypoint: 'claude-vscode', endedAgo: 10 * 60_000, stopReason: null });
    writeSession(dir, { pid: 4343, id: A, cwd: root, status: 'busy' });
    writeSession(dir, { pid: 4344, id: B, cwd: root, status: 'idle' });
  }, { isAlive: (pid) => pid !== 4343 && pid !== 4344 });
  assert.deepEqual(cut, { [A]: true, [B]: false });
});

test('cutOff: a conversation still running, waiting on a question or older than a week is not cut off', async () => {
  const cut = await cutRows(({ dir, root }) => {
    writeChat(dir, { id: A, cwd: root, entrypoint: 'claude-vscode', endedAgo: HOUR, stopReason: null });
    writeSession(dir, { pid: 4242, id: A, cwd: root, status: 'busy' });
    writeChat(dir, { id: B, cwd: root, entrypoint: 'claude-vscode', endedAgo: HOUR, tail: ASK_TAIL });
    writeChat(dir, { id: C, cwd: root, entrypoint: 'cli', endedAgo: 8 * 24 * HOUR, stopReason: null });
  });
  assert.deepEqual(cut, { [A]: false, [B]: false, [C]: false });
});

test('cutOff: a dismissal holds while the last activity is the same, and lapses when the conversation moves on', async () => {
  const cut = await cutRows(({ dir, smDir, root }) => {
    writeChat(dir, { id: A, cwd: root, entrypoint: 'claude-vscode', endedAgo: HOUR, stopReason: null });
    writeChat(dir, { id: B, cwd: root, entrypoint: 'claude-vscode', endedAgo: HOUR, stopReason: null });
    writeFileSync(join(smDir, 'cut-dismissed.json'), JSON.stringify({ [A]: iso(HOUR), [B]: iso(2 * HOUR) }));
  });
  assert.deepEqual(cut, { [A]: false, [B]: true });
});

test('cutOff: a page chat whose turn never ended is cut off unless the hub drives it now; a script is never', async () => {
  const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const setup = ({ dir, smDir, root, projectId }) => {
    writeChat(dir, { id: A, cwd: root, entrypoint: 'sdk-cli', endedAgo: 10 * 60_000, stopReason: null });
    writeChat(dir, { id: B, cwd: root, entrypoint: 'sdk-cli', endedAgo: 10 * 60_000, stopReason: null });
    writeChat(dir, { id: E, cwd: root, entrypoint: 'sdk-ts', endedAgo: HOUR, stopReason: null });
    writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [A]: { projectId, title: 'a', running: true }, [B]: { projectId, title: 'b', running: false } }));
  };
  assert.deepEqual(await cutRows(setup), { [A]: true, [B]: false, [E]: false });
  assert.deepEqual(await cutRows(setup, { driving: new Set([A]) }), { [A]: false, [B]: false, [E]: false });
});

// The person answered "Shall I push?" and the server fell before claude wrote anything: the question is behind them.
test('a cut-off conversation is not waiting for the person: not in its row, its chat or the waiting count', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'));
  try {
    writeChat(dir, { id: A, cwd: root, entrypoint: 'sdk-cli', endedAgo: 10 * 60_000, question: true, stopReason: 'end_turn', card: { title: 'Cart', waiting: ['approve tax rule'] } });
    const page = (running) => writeFileSync(join(smDir, 'page-chats.json'), JSON.stringify({ [A]: { projectId: projectIdOf(root), title: 'a', running, updatedAt: iso(10 * 60_000 - 2_000) } }));
    page(false);
    const before = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI, bootMs: BOOT });
    assert.equal(before.projects[0].conversations[0].waiting, true, 'the setup waits for the person');
    page(true);
    const after = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI, bootMs: BOOT });
    const [p] = after.projects;
    assert.deepEqual([p.conversations[0].cutOff, p.conversations[0].waiting], [true, false]);
    assert.deepEqual(p.chats[0].waiting, { strong: false, weak: false, items: [] });
    assert.equal(after.waitingCount, 0);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('a conversation removed from session-map is nowhere in the state, but its cost still counts', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Cart page', edits: ['src/shop/cart.ts'] });
    writeChat(dir, { id: B, cwd: root, title: 'Invoices', prompts: ['work on `bi01` now'], question: true, card: { title: 'Invoices', waiting: ['approve tax rule'] } });
    const before = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([B]));
    const after = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    const [p] = after.projects;
    assert.deepEqual(p.chats.map((c) => c.sessionId), [A]);
    assert.deepEqual(p.conversations.map((r) => r.sessionId), [A]);
    assert.ok(!JSON.stringify(after.projects).includes(B), 'not in visitors, work cells or anywhere else');
    assert.ok(after.waitingCount < before.waitingCount, 'its waiting no longer counts');
    assert.deepEqual(p.cost, before.projects[0].cost);
    assert.deepEqual(after.totals, before.totals);
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('a project with no chat on the map still says where its 30-day cost went (sb06)', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Old cart', edits: ['src/shop/cart.ts'], endedAgo: 3 * 24 * HOUR });
    writeChat(dir, { id: B, cwd: root, title: 'Gone', endedAgo: 2 * 24 * HOUR });
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([B]));
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.deepEqual(p.chats, [], 'nothing recent is on the map');
    assert.ok(p.cost.d30 > 0);
    assert.deepEqual(p.costWhy, { older: 1, removed: 1 });
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('sb06: an old chat that is still live or on an open branch is on the map, so it is not counted as older', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Live old', endedAgo: 3 * 24 * HOUR });
    writeSession(dir, { pid: 1, id: A, cwd: root });
    writeChat(dir, { id: B, cwd: root, title: 'Gone', endedAgo: 2 * 24 * HOUR });
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.deepEqual(p.chats.map((c) => c.sessionId), [A]);
    assert.deepEqual(p.costWhy, { older: 1, removed: 0 });
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('sb06: a chat exactly 24 h old is hidden (the check is strict), one a minute younger is shown', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Edge', endedAgo: 24 * HOUR });
    let [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.deepEqual(p.chats, []);
    assert.deepEqual(p.costWhy, { older: 1, removed: 0 });
    writeChat(dir, { id: A, cwd: root, title: 'Edge', endedAgo: 24 * HOUR - 60_000 });
    [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.equal(p.chats.length, 1, 'a shown chat means no note');
    assert.deepEqual(p.costWhy, { older: 0, removed: 0 });
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('sb06: a hidden chat whose paid usage is all older than 30 days does not explain the 30-day cost', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Ancient usage', endedAgo: 40 * 24 * HOUR, mtimeAgo: 3 * 24 * HOUR });
    writeChat(dir, { id: B, cwd: root, title: 'Gone', endedAgo: 2 * 24 * HOUR });
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([B]));
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.deepEqual(p.costWhy, { older: 0, removed: 1 });
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('sb06: a removed chat that is also live counts only as removed', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Live and removed', endedAgo: 3 * 24 * HOUR });
    writeSession(dir, { pid: 1, id: A, cwd: root });
    writeFileSync(join(smDir, 'removed.json'), JSON.stringify([A]));
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.deepEqual(p.chats, []);
    assert.deepEqual(p.costWhy, { older: 0, removed: 1 });
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('sb06: a project with a chat on the map has chats, so the page shows no note', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'), { arch: true });
  try {
    writeChat(dir, { id: A, cwd: root, title: 'Recent' });
    writeChat(dir, { id: B, cwd: root, title: 'Old', endedAgo: 3 * 24 * HOUR });
    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    assert.ok(p.chats.length > 0);
    assert.deepEqual(p.costWhy, { older: 1, removed: 0 });
  } finally { cleanup(dir, smDir, join(root, '..')); }
});

test('wa09: a conversation with a weekly and a session hit keeps both flags, in either order', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'));
  try {
    const line = (ago, type, resetsAt, text) => ({ type: 'assistant', timestamp: iso(ago), error: 'rate_limit', isApiErrorMessage: true, quotaLimits: { status: 'rejected', resetsAt: Date.parse(resetsAt) / 1000, rateLimitType: type },
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] } });
    const weekly = (ago) => line(ago, 'seven_day', '2026-09-12T21:00:00Z', "You've hit your weekly limit · resets Sep 12, 6pm");
    const session = (ago) => line(ago, 'five_hour', '2026-09-10T20:00:00Z', "You've hit your session limit · resets 5pm");
    for (const tail of [[weekly(HOUR), session(HOUR / 2)], [session(HOUR), weekly(HOUR / 2)]]) {
      writeChat(dir, { id: A, cwd: root, title: 'Cart page', tail });
      const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
      assert.equal(state.limits.weekly.hit, true);
      assert.equal(state.limits.session.hit, true);
    }
  } finally { cleanup(dir, smDir); }
});

test('wa09: the plan limits come from the limit messages in the histories, as flags for the state', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'));
  try {
    const empty = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    assert.deepEqual(empty.limits, { weekly: { hit: false, resetsAt: null, resetsText: null }, session: { hit: false, resetsAt: null, resetsText: null } });

    const resets = Date.parse('2026-09-12T21:00:00Z') / 1000;
    const limitLine = { type: 'assistant', timestamp: iso(HOUR / 2), error: 'rate_limit', isApiErrorMessage: true, quotaLimits: { status: 'rejected', resetsAt: resets, rateLimitType: 'seven_day' },
      message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your weekly limit · resets Sep 12, 6pm (America/Fortaleza)" }] } };
    writeChat(dir, { id: A, cwd: root, title: 'Cart page', tail: [limitLine] });
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    assert.deepEqual(state.limits.weekly, { hit: true, resetsAt: '2026-09-12T21:00:00.000Z', resetsText: 'Sep 12, 6pm (America/Fortaleza)' });
    assert.equal(state.limits.session.hit, false);

    const later = await collect({ dir, smDir, now: new Date('2026-09-13T00:00:00Z'), isAlive: alive, ai: NO_AI });
    assert.equal(later.limits.weekly.hit, false, 'once the reset time has passed the flag is off');
  } finally { cleanup(dir, smDir); }
});
