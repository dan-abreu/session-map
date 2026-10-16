import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEDGER_FILE, addOthersSpend, attachBudgets, budgetOf, budgetSetting, claudeMonthUSD, cleanRoot, continueProjectMonth, monthOf,
  othersByProject, pauseRefusal, projectBudgetLine, readLedger, setProjectBudget,
} from '../server/budget.mjs';
import { snapshotOf, transitionsOf } from '../server/alerts/watch.mjs';
import { alertText, groupAlerts } from '../server/web/alerts.js';
import { LANGS, translator } from '../server/web/i18n.js';
import { createAskRoutes } from '../server/ai/askroute.mjs';
import { forgetLife } from '../server/ai/life.mjs';
import { projectSections } from '../server/chat/project.mjs';
import { tailFor } from '../server/chat/hub.mjs';
import { normalizePath } from '../server/paths.mjs';

// A monthly budget per project (orchestration or07): the spend of a calendar month (Claude's rows + the outside AIs'
// ledger), the 80% and 100% levels, the month rollover, the alert, and what the conductor reads.

const OCT = new Date(2026, 9, 20, 12).getTime();
const NOV = new Date(2026, 10, 2, 9).getTime();
const tmp = () => mkdtempSync(join(tmpdir(), 'sm-budget-'));
const ROOT = process.platform === 'win32' ? 'C:\\dev\\shop' : '/dev/shop';
const KEY = normalizePath(ROOT);

test('the month is the local calendar month, and Claude\'s part is the costByDay of that month only', () => {
  assert.equal(monthOf(OCT), '2026-10');
  assert.equal(monthOf(NOV), '2026-11');
  const byDay = { '2026-09-30': 9, '2026-10-01': 1.25, '2026-10-31': 2.5, '2026-11-01': 4 };
  assert.equal(claudeMonthUSD(byDay, '2026-10'), 3.75);
  assert.equal(claudeMonthUSD(byDay, '2026-11'), 4);
  assert.equal(claudeMonthUSD(undefined, '2026-11'), 0);
});

test('levels: under 80% ok, 80% warns, 100% is over and paused; 0 is over at once; no budget never pauses; continue lifts it', () => {
  const at = (used, limitUSD = 10, extra = {}) => budgetOf({ limitUSD, claudeUSD: used, othersUSD: 0, month: '2026-10', ...extra });
  assert.deepEqual([at(7.9).level, at(7.9).paused, at(7.9).pct], ['ok', false, 79]);
  assert.deepEqual([at(8).level, at(8).paused, at(8).pct], ['warn', false, 80]);
  assert.deepEqual([at(10).level, at(10).paused, at(10).pct], ['over', true, 100]);
  assert.deepEqual([at(0, 0).level, at(0, 0).paused, at(0, 0).pct], ['over', true, 100], 'a budget of 0 lets nothing new start');
  const none = budgetOf({ limitUSD: null, claudeUSD: 50, month: '2026-10' });
  assert.deepEqual([none.limitUSD, none.level, none.paused, none.pct, none.usedUSD], [null, 'ok', false, null, 50]);
  const kept = at(12, 10, { continueMonth: '2026-10' });
  assert.deepEqual([kept.level, kept.continued, kept.paused], ['over', true, false]);
  const both = budgetOf({ limitUSD: 10, claudeUSD: 6, othersUSD: 2.5, month: '2026-10' });
  assert.deepEqual([both.usedUSD, both.claudeUSD, both.othersUSD, both.level], [8.5, 6, 2.5, 'warn'], 'the outside AIs count too');
});

test('the outside AIs\' ledger: a call is filed under its root and month, the deepest project folder takes it, three months are kept', () => {
  const smDir = tmp();
  try {
    const nested = `${ROOT}${process.platform === 'win32' ? '\\' : '/'}tools`;
    assert.equal(addOthersSpend(smDir, ROOT, 0.5, OCT), true);
    assert.equal(addOthersSpend(smDir, ROOT, 0.25, OCT), true);
    assert.equal(addOthersSpend(smDir, nested, 1, OCT), true);
    assert.equal(addOthersSpend(smDir, `${nested}${process.platform === 'win32' ? '\\' : '/'}src`, 2, OCT), true);
    assert.equal(addOthersSpend(smDir, ROOT, 0, OCT), false, 'a free call writes nothing');
    assert.equal(addOthersSpend(smDir, 'relative/path', 1, OCT), false, 'only a full path is filed');
    assert.equal(cleanRoot('C:\u0000bad'), null);
    const months = readLedger(smDir);
    assert.equal(months['2026-10'][KEY], 0.75);
    const shop = KEY;
    const tools = normalizePath(nested);
    const other = normalizePath(process.platform === 'win32' ? 'C:\\dev\\other' : '/dev/other');
    const split = othersByProject(months['2026-10'], [shop, tools, other]);
    assert.deepEqual([split.get(shop), split.get(tools), split.get(other)], [0.75, 3, 0]);
    // The shop's own folder never goes to a project whose name merely starts the same.
    assert.equal(othersByProject({ [`${KEY}-old`]: 5 }, [KEY]).get(KEY), 0);
    for (const m of [0, 1, 2, 3]) addOthersSpend(smDir, ROOT, 1, new Date(2027, m, 5).getTime());
    assert.deepEqual(Object.keys(readLedger(smDir)), ['2027-02', '2027-03', '2027-04']);
    assert.ok(readFileSync(join(smDir, LEDGER_FILE), 'utf8').includes('"months"'));
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('attachBudgets: each project gets its month, and a new month starts from zero with an old "continue" no longer counting', () => {
  const project = () => ({ id: 'shop-1', root: ROOT, costByDay: { '2026-10-03': 9, '2026-11-01': 0.5 } });
  const config = { projects: { [KEY]: { budgetMonthlyUSD: 10, budgetContinueMonth: '2026-10', tidy: true } } };
  const ledger = { '2026-10': { [KEY]: 2 }, '2026-11': { [KEY]: 0.25 } };
  const oct = [{ project: project(), key: KEY }];
  attachBudgets(oct, config, ledger, OCT);
  assert.deepEqual(oct[0].project.budget, {
    month: '2026-10', limitUSD: 10, usedUSD: 11, claudeUSD: 9, othersUSD: 2, pct: 110, level: 'over', continued: true, paused: false,
  });
  const nov = [{ project: project(), key: KEY }];
  attachBudgets(nov, config, ledger, NOV);
  assert.deepEqual([nov[0].project.budget.usedUSD, nov[0].project.budget.level, nov[0].project.budget.continued], [0.75, 'ok', false]);
  // Over again in the new month: paused, since October's "continue" is over.
  attachBudgets(nov, { projects: { [KEY]: { budgetMonthlyUSD: 0.5, budgetContinueMonth: '2026-10' } } }, ledger, NOV);
  assert.deepEqual([nov[0].project.budget.level, nov[0].project.budget.paused], ['over', true]);
  const plain = [{ project: project(), key: KEY }];
  attachBudgets(plain, {}, {}, OCT);
  assert.deepEqual([plain[0].project.budget.limitUSD, plain[0].project.budget.paused, plain[0].project.budget.usedUSD], [null, false, 9]);
});

test('the setting lives with the project\'s other keys in config.json; bad values and an unreadable file change nothing', () => {
  const smDir = tmp();
  const file = join(smDir, 'config.json');
  try {
    writeFileSync(file, JSON.stringify({ currency: { code: 'BRL', rate: 5 }, projects: { [KEY]: { tidy: true } } }));
    assert.deepEqual(setProjectBudget(smDir, ROOT, 25), { ok: true, limitUSD: 25 });
    assert.deepEqual(continueProjectMonth(smDir, ROOT, '2026-10'), { ok: true, continueMonth: '2026-10' });
    let config = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(config.projects[KEY], { tidy: true, budgetMonthlyUSD: 25, budgetContinueMonth: '2026-10' });
    assert.deepEqual(config.currency, { code: 'BRL', rate: 5 });
    assert.deepEqual(budgetSetting(config, ROOT), { limitUSD: 25, continueMonth: '2026-10' });
    for (const bad of [-1, 'ten', Number.NaN, Infinity, undefined]) assert.deepEqual(setProjectBudget(smDir, ROOT, bad), { ok: false, error: 'bad-budget' });
    assert.deepEqual(setProjectBudget(smDir, ROOT, null), { ok: true, limitUSD: null });
    config = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(config.projects[KEY], { tidy: true, budgetContinueMonth: '2026-10' });
    assert.deepEqual(budgetSetting(config, ROOT).limitUSD, null);
    writeFileSync(file, '{ not json');
    assert.deepEqual(setProjectBudget(smDir, ROOT, 5), { ok: false, error: 'config-unreadable' });
    assert.equal(readFileSync(file, 'utf8'), '{ not json');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

test('the conductor\'s line: the spend, a warning past 80%, and at 100% "start nothing new, ask the person"', () => {
  const b = (used, extra = {}) => budgetOf({ limitUSD: 10, claudeUSD: used, month: '2026-10', ...extra });
  assert.equal(projectBudgetLine(budgetOf({ limitUSD: null, claudeUSD: 3, month: '2026-10' })), '');
  assert.equal(projectBudgetLine(null), '');
  assert.equal(projectBudgetLine(b(2)), '- This project used US$ 2.00 of its US$ 10.00 monthly budget (20%).');
  assert.match(projectBudgetLine(b(8.5)), /past 80%, prefer the cheaper workers/);
  assert.match(projectBudgetLine(b(10.2)), /it is paused\. Start nothing new.*ask the person.*"ask-reinforce"/);
  assert.match(projectBudgetLine(b(12, { continueMonth: '2026-10' })), /the person said to continue this month/);
  assert.match(pauseRefusal(b(10.2)), /^budget: this project used US\$ 10\.20 of its US\$ 10\.00 .*Nothing running was stopped\.$/);
  // The project chat's first message and the conductor's tail carry it.
  const project = { name: 'shop', arch: null, chats: [], decisions: [], activity: [], budget: b(9) };
  assert.ok(projectSections(project, null)[0].includes('US$ 9.00 of its US$ 10.00'));
  assert.ok(!projectSections({ ...project, budget: undefined }, null)[0].includes('monthly budget'));
  const smDir = tmp();
  try {
    const line = projectBudgetLine(b(9));
    assert.ok(tailFor({ kind: 'autonomous' }, smDir, () => null, line).endsWith(line));
    assert.equal(tailFor({ kind: 'talk' }, smDir, () => null, line), '', 'only Autonomous reads it');
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});

const stateWith = (budget, extra = {}) => ({ projects: [{ id: 'shop-1', name: 'shop', chats: [], conversations: [], decisions: [], budget: { month: '2026-10', limitUSD: 10, usedUSD: 0, pct: 0, ...budget }, ...extra }] });

test('one alert when a project crosses 80%, one more at 100%, none on the first look, in a new month or once continued', () => {
  const look = (budget) => snapshotOf(stateWith(budget));
  const ok = look({ level: 'ok', pct: 50, usedUSD: 5 });
  const warn = look({ level: 'warn', pct: 85, usedUSD: 8.5 });
  const over = look({ level: 'over', pct: 102, usedUSD: 10.2 });
  assert.deepEqual(transitionsOf(null, warn), [], 'the first look is only a baseline');
  assert.deepEqual(transitionsOf(ok, warn), [{ kind: 'budget', reason: 'budgetWarn', projectId: 'shop-1', projectName: 'shop', sessionId: null, pct: 85, usedUSD: 8.5, limitUSD: 10 }]);
  assert.deepEqual(transitionsOf(warn, warn), []);
  assert.deepEqual(transitionsOf(warn, over).map((e) => e.reason), ['budgetOver']);
  assert.deepEqual(transitionsOf(ok, over).map((e) => e.reason), ['budgetOver'], 'straight past 100%: the pause is what counts');
  assert.deepEqual(transitionsOf(over, look({ level: 'over', pct: 120, usedUSD: 12, continued: true })), [], 'continuing says nothing more');
  assert.deepEqual(transitionsOf(over, look({ level: 'ok', month: '2026-11', pct: 1, usedUSD: 0.1 })), [], 'a new month starts quiet');
  assert.deepEqual(transitionsOf(snapshotOf({ projects: [{ id: 'shop-1', name: 'shop' }] }), warn).map((e) => e.reason), ['budgetWarn'], 'a budget set below the spend tells once');
  assert.deepEqual(transitionsOf(look({ level: 'ok', limitUSD: null }), snapshotOf(stateWith({ level: 'ok', limitUSD: null }))), []);
});

test('the budget alert explains itself in both languages: what, why with the numbers, what to do, and its button', () => {
  for (const lang of Object.keys(LANGS)) {
    const t = translator(lang);
    for (const [reason, pct] of [['budgetWarn', 85], ['budgetOver', 102]]) {
      const words = alertText(t, groupAlerts([{ kind: 'budget', reason, projectId: 'shop-1', projectName: 'shop', sessionId: null, pct, usedUSD: 10.2, limitUSD: 10 }])[0]);
      for (const field of ['what', 'why', 'todo', 'action']) assert.ok(words[field] && !words[field].includes('{'), `${lang} ${reason} ${field}: ${words[field]}`);
      assert.match(words.why, new RegExp(`${pct}%`));
      assert.match(words.why, /10[.,]20/);
      assert.equal(words.action, t('alert.openBudget'));
    }
    const many = alertText(t, groupAlerts([1, 2].map((id) => ({ id, kind: 'budget', reason: 'budgetWarn', projectId: 'p', projectName: 'p', sessionId: null })))[0]);
    assert.ok(!many.what.includes('alert.many'), `${lang} has a word for several`);
  }
});

test('an outside call counts in the project of the page chat that asked, or of the folder a terminal chat runs in', async () => {
  const smDir = tmp();
  const token = 'a'.repeat(64);
  const KEY_CHAT = 'b'.repeat(32);
  const ask = async (args) => {
    args.onCall({ provider: 'openai', model: 'gpt-6.1-sol', ms: 5, costUSD: 0.4, ok: true });
    return { ok: true, answers: [{ provider: 'openai', model: 'gpt-6.1-sol', text: 'fine', costUSD: 0.4, ms: 5 }], skipped: [] };
  };
  const otherRoot = process.platform === 'win32' ? 'C:\\dev\\other' : '/dev/other';
  const routes = createAskRoutes({ smDir, token, ask, now: () => OCT, rootOf: (key) => (key === KEY_CHAT ? ROOT : null) });
  const post = (body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: 'POST', headers: { host: '127.0.0.1:4001', 'x-session-map-token': token, 'content-type': 'application/json' } });
    return routes.handle(req, new URL('http://127.0.0.1:4001/api/ai/ask'), '127.0.0.1');
  };
  try {
    const base = { kind: 'review', sensitivity: 'public', prompt: 'x' };
    assert.equal((await post({ ...base, sessionId: KEY_CHAT, cwd: otherRoot })).status, 200);
    assert.equal((await post({ ...base, cwd: otherRoot })).status, 200);
    assert.equal((await post(base)).status, 200, 'with neither, it is not filed under any project');
    assert.equal((await post({ ...base, cwd: 'not/absolute' })).status, 400);
    const month = readLedger(smDir)['2026-10'];
    assert.deepEqual(month, { [KEY]: 0.4, [normalizePath(otherRoot)]: 0.4 }, 'the page chat\'s own project wins over the folder');
  } finally {
    forgetLife(smDir);
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('POST /api/settings/project-budget sets, removes and continues a project\'s budget, behind the token', async () => {
  const { createApp } = await import('../server/main.mjs');
  const { loadToken } = await import('../server/auth.mjs');
  const { request } = await import('node:http');
  const dir = tmp();
  const smDir = tmp();
  const root = join(dir, 'shop');
  const app = createApp({ dir, smDir, chat: null, stateTtlMs: 0, collectFn: () => ({ generatedAt: new Date().toISOString(), waitingCount: 0, projects: [{ id: 'shop-1', name: 'shop', root }] }) });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const { port } = app.address();
  const token = loadToken(smDir);
  const post = (body, auth = true) => new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'x-session-map': '1', 'content-type': 'application/json', ...(auth ? { cookie: `sm_token=${token}` } : {}) };
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/settings/project-budget', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text.startsWith('{') ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  const setting = () => budgetSetting(JSON.parse(readFileSync(join(smDir, 'config.json'), 'utf8')), root);
  try {
    assert.equal((await post({ projectId: 'shop-1', usd: 10 }, false)).status, 401);
    assert.equal((await post({ projectId: 'nope', usd: 10 })).status, 404);
    assert.equal((await post({ projectId: 'shop-1', usd: -5 })).status, 400);
    assert.equal((await post({ projectId: 'shop-1' })).status, 400, 'neither a value nor continue');
    assert.equal((await post({ projectId: 'shop-1', usd: 5, continue: true })).status, 400, 'one thing at a time');
    assert.deepEqual((await post({ projectId: 'shop-1', usd: 12.5 })).json, { ok: true, limitUSD: 12.5 });
    const cont = await post({ projectId: 'shop-1', continue: true });
    assert.deepEqual(cont.json, { ok: true, continueMonth: monthOf(Date.now()) });
    assert.deepEqual(setting(), { limitUSD: 12.5, continueMonth: monthOf(Date.now()) });
    assert.deepEqual((await post({ projectId: 'shop-1', usd: null })).json, { ok: true, limitUSD: null });
    assert.equal(setting().limitUSD, null);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    rmSync(dir, { recursive: true, force: true });
    rmSync(smDir, { recursive: true, force: true });
  }
});

test('tiny outside calls still add up in the ledger', () => {
  const smDir = tmp();
  try {
    for (let i = 0; i < 10; i++) addOthersSpend(smDir, ROOT, 1e-7, OCT);
    assert.ok(Math.abs(readLedger(smDir)['2026-10'][KEY] - 1e-6) < 1e-12);
  } finally { rmSync(smDir, { recursive: true, force: true }); }
});
