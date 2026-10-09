import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, settleAi } from '../server/collect.mjs';
import { appendEvents, readEvents } from '../server/brain/events.mjs';
import { AiQueue } from '../server/ai/runner.mjs';
import { projectIdOf } from '../server/paths.mjs';

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

function repo(root) {
  mkdirSync(join(root, 'src', 'shop'), { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'src', 'shop', 'cart.ts'), 'a\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

// One conversation file: 2 USD of claude-fake-1 per assistant line (200k input at 5/M + 40k output at 25/M).
function writeChat(dir, { id, cwd, branch = 'main', title, prompts = ['add the cart'], edits = [], card, endedAgo = HOUR, question = false, mtimeAgo = endedAgo }) {
  const ts = iso(endedAgo);
  const base = { sessionId: id, cwd, gitBranch: branch, timestamp: ts };
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

function seedUnitsFile(smDir, root, units) {
  const file = join(smDir, 'brain', projectIdOf(root), 'units.json');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(units));
}

const alive = () => true;
// No claude binary: the AI is off, as on a machine without Claude Code.
const NO_AI = { bin: null };

test('appendEvents keeps AI events that share kind and time but touch different units', () => {
  const smDir = tmp();
  try {
    const ts = '2026-09-10T10:00:00.000Z';
    appendEvents(smDir, 'p-abc123', [
      { kind: 'grouped', ts, branch: null, unitIds: ['t1', 'a', 'b'] },
      { kind: 'grouped', ts, branch: null, unitIds: ['t2', 'c', 'd'] },
    ]);
    assert.equal(readEvents(smDir, 'p-abc123').length, 2);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('AiQueue: an uncapped ask (bootstrap) passes the hourly cap and does not use it up', async () => {
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
  } finally { rmSync(smDir, { recursive: true, force: true }); }
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('collect builds projects, chats, classification, costs and the waiting count from transcripts', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'acme-shop'));
  try {
    seedUnitsFile(smDir, root, [
      { id: 'shop', name: 'Shop', paths: ['src/shop'] },
      { id: 'billing', name: 'Billing', paths: ['src/billing'] },
      { id: 'unsorted', name: 'Unsorted', paths: [] },
    ]);
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ budget: { monthlyUSD: 100 }, currency: { code: 'BRL', rate: 5 } }));
    writeChat(dir, { id: A, cwd: root, title: 'Cart page', edits: ['src/shop/cart.ts', 'src/shop/list.ts'] });
    writeChat(dir, { id: B, cwd: root, title: 'Invoices', card: { title: 'Invoices', area: 'billing', waiting: ['approve tax rule'], decided: ['PDF on the server'] }, question: true });
    writeChat(dir, { id: C, cwd: root, title: 'Old idea', endedAgo: 5 * 24 * HOUR });
    writeChat(dir, { id: D, cwd: join(smDir, 'ai-runner'), title: 'map ai call' });
    writeSession(dir, { pid: 4242, id: A, cwd: root, status: 'busy', bridge: 'session_abc' });

    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI });
    assert.equal(state.projects.length, 1, 'the ai-runner conversation is hidden');
    const [p] = state.projects;
    assert.equal(p.id, projectIdOf(root));
    assert.equal(p.name, 'acme-shop');
    assert.equal(p.mainBranch, 'main');
    const ids = p.chats.map((c) => c.sessionId).sort();
    assert.deepEqual(ids, [A, B], 'live + touched in the last 24 h; the 5-day-old one is left out');

    const a = p.chats.find((c) => c.sessionId === A);
    assert.equal(a.unitId, 'shop');
    assert.equal(a.unitSource, 'files');
    assert.equal(a.status, 'busy');
    assert.equal(a.live, true);
    assert.equal(a.chattable, false);
    assert.equal(a.bridgeUrl, 'https://claude.ai/code/session_abc');
    assert.equal(a.lastAssistantText.length, 280);
    assert.equal(a.costUSD, 2);

    const b = p.chats.find((c) => c.sessionId === B);
    assert.equal(b.unitId, 'billing');
    assert.equal(b.unitSource, 'card');
    assert.equal(b.status, 'closed');
    assert.equal(b.chattable, true);
    assert.deepEqual(b.waiting, { strong: false, weak: true, items: ['approve tax rule'] });
    assert.equal(state.waitingCount, 2);

    const shop = p.units.find((u) => u.id === 'shop');
    assert.deepEqual(shop.chatIds, [A]);
    assert.equal(shop.status, 'active');
    const billing = p.units.find((u) => u.id === 'billing');
    assert.equal(billing.status, 'waiting');
    assert.deepEqual(billing.nucleus.decided, ['PDF on the server'], 'the card is merged into the nucleus');
    assert.equal(billing.work.decisions, 1);

    assert.deepEqual(p.cost, { today: 4, d7: 6, d30: 6 });
    assert.deepEqual(state.totals, { today: 4, d7: 6, d30: 6 });
    assert.deepEqual(state.currency, { code: 'BRL', rate: 5 });
    assert.deepEqual(state.budget, { monthlyUSD: 100, used: 6 });
    assert.equal(p.ai, null, 'no claude: rules only');
    assert.ok(p.activity.some((i) => i.kind === 'commit' && i.subject === 'init'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
    rmSync(join(root, '..'), { recursive: true, force: true });
  }
});

test('collect ties chats to work cells by branch and fills the cell from them', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'shop'));
  try {
    git(root, ['checkout', '-q', '-b', 'feature/cart']);
    writeFileSync(join(root, 'src', 'shop', 'cart.ts'), 'b\n');
    git(root, ['commit', '-q', '-am', 'cart totals']);
    git(root, ['checkout', '-q', 'main']);
    seedUnitsFile(smDir, root, [{ id: 'shop', name: 'Shop', paths: ['src/shop'] }, { id: 'unsorted', name: 'Unsorted', paths: [] }]);
    writeChat(dir, { id: A, cwd: root, branch: 'feature/cart', title: 'Cart totals', card: { title: 'x', doing: 'summing lines', estimateUSD: 10 } });
    // Older than 24 h but on an open work cell: still shown.
    writeChat(dir, { id: B, cwd: root, branch: 'feature/cart', title: 'Cart start', endedAgo: 3 * 24 * HOUR });

    const [p] = (await collect({ dir, smDir, now: NOW, isAlive: alive, ai: NO_AI })).projects;
    const cell = p.workCells.find((w) => w.id === 'feature/cart');
    assert.ok(cell);
    assert.deepEqual([...cell.chatIds].sort(), [A, B]);
    assert.equal(cell.costUSD, 4);
    assert.equal(cell.estimateUSD, 10);
    assert.equal(cell.nucleus.doing, 'summing lines');
    const a = p.chats.find((c) => c.sessionId === A);
    assert.equal(a.workCellId, 'feature/cart');
    assert.equal(a.workCellSource, 'branch');
    const events = readEvents(smDir, p.id);
    assert.ok(events.some((e) => e.kind === 'born' && e.workCellId === 'feature/cart'));
    assert.ok(p.activity.some((i) => i.kind === 'born' && i.workCellId === 'feature/cart'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
    rmSync(join(root, '..'), { recursive: true, force: true });
  }
});

test('a project without units.json bootstraps once: perceives recent chats outside the cap, then consolidates', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'garden'));
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: true, maxCallsPerHour: 1, bootstrapLimit: 2 } }));
    writeChat(dir, { id: A, cwd: root, title: 'Watering plan', prompts: ['plan the watering'] });
    writeChat(dir, { id: B, cwd: root, title: 'Seed list', prompts: ['list the seeds'], endedAgo: 2 * HOUR });
    writeChat(dir, { id: C, cwd: root, title: 'Too old for bootstrap', prompts: ['old'], endedAgo: 3 * HOUR });
    const prompts = [];
    const run = async (prompt) => {
      prompts.push(prompt);
      if (prompt.startsWith('You keep the map')) return { ok: true, value: { changes: [] }, costUSD: 0.002 };
      return { ok: true, value: { unitId: null, name: 'Garden care', purpose: 'Keep plants alive', tags: ['garden'] }, costUSD: 0.002 };
    };
    const ai = { bin: 'fake-claude', run };

    const first = await collect({ dir, smDir, now: NOW, isAlive: alive, ai });
    const p1 = first.projects[0];
    assert.equal(p1.ai.enabled, true);
    assert.deepEqual(p1.ai.bootstrap.total, 2);
    await settleAi(smDir);
    const perceptions = prompts.filter((t) => !t.startsWith('You keep the map')).length;
    assert.equal(perceptions, 2, 'bootstrap ignores the cap of 1 per hour');
    assert.equal(prompts.length, 3, 'and consolidates at the end');

    const second = await collect({ dir, smDir, now: NOW, isAlive: alive, ai });
    await settleAi(smDir);
    const p2 = second.projects[0];
    assert.equal(p2.ai.bootstrap.done, 2);
    const garden = p2.units.find((u) => u.name === 'Garden care');
    assert.ok(garden, 'the unit the AI created is in the state');
    assert.equal(garden.origin, 'ai');
    const a = p2.chats.find((c) => c.sessionId === A);
    assert.equal(a.unitId, garden.id);
    assert.equal(a.unitSource, 'ai');
    // C was left out of the bootstrap; outside it the cap of 1 per hour applies, so the bootstrap is not repeated.
    assert.ok(prompts.length <= 4);
    assert.equal(prompts.filter((t) => t.includes('Watering plan')).length, 1, 'never perceived twice');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
    rmSync(join(root, '..'), { recursive: true, force: true });
  }
});

test('with ai.enabled false collect stays on the rules and never calls claude', async () => {
  const dir = tmp();
  const smDir = tmp();
  const root = repo(join(tmp(), 'quiet'));
  try {
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: { enabled: false } }));
    writeChat(dir, { id: A, cwd: root, title: 'x', edits: ['src/shop/cart.ts'] });
    let calls = 0;
    const state = await collect({ dir, smDir, now: NOW, isAlive: alive, ai: { bin: 'fake', run: async () => { calls++; return { ok: false }; } } });
    await settleAi(smDir);
    assert.equal(calls, 0);
    assert.equal(state.projects[0].ai, null);
    assert.ok(existsSync(join(smDir, 'brain', projectIdOf(root), 'units.json')), 'seeded from the hints');
    assert.equal(state.projects[0].chats[0].unitSource, 'files');
    assert.ok(JSON.parse(readFileSync(join(smDir, 'brain', projectIdOf(root), 'units.json'), 'utf8')).some((u) => u.id === 'src-shop'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
    rmSync(join(root, '..'), { recursive: true, force: true });
  }
});
