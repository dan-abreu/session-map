import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { digestOf } from './ai/digest.mjs';
import { aiNucleusFile, aiStatus, lifeOf, perceiveChanged, refreshNuclei, startBootstrap, unitsFile } from './ai/life.mjs';
import { nucleusInputOf } from './ai/nucleus.mjs';
import { normalizeUnit } from './ai/perceive.mjs';
import { isAiRunnerCwd } from './ai/runner.mjs';
import { UNSORTED, brainDir, classify, loadUnits, plain, readJsonFile, readOverrides, unitsTouchedBy } from './brain/cells.mjs';
import { appendEvents, readEvents } from './brain/events.mjs';
import { linkUnits, parentOf, readLineage, specRefsOf } from './brain/lineage.mjs';
import { emptyNucleus, mergeNucleus, readNucleus, seedNucleus, withAiNucleus, writeNucleus } from './brain/nucleus.mjs';
import { backfillMerges, detectTransitions, workCellsOf } from './brain/workcells.mjs';
import { loadConfig } from './config.mjs';
import { costOf, loadPrices, windowed } from './cost.mjs';
import { log } from './log.mjs';
import { parseCard } from './parse/card.mjs';
import { waitingFor } from './parse/waiting.mjs';
import { normalizePath, projectIdOf } from './paths.mjs';
import { listLiveSessions, listTranscripts, readHelperCommits, readHelperUsage, readTranscript, readWorkflows } from './sources/claude.mjs';
import { autoFetch } from './sources/fetch.mjs';
import { activityOf, gitRoot, mainBranch } from './sources/git.mjs';
import { readOpenSpec } from './sources/openspec.mjs';
import { readRoadmap } from './sources/roadmap.mjs';
import { listSkills } from './sources/skills.mjs';

const DAY = 86_400_000;
const RECENT_MS = DAY;
// 31 days: the monthly budget needs a whole calendar month of rows.
const WINDOW_MS = 31 * DAY;
const TEXT_MAX = 280;
const ACTIVITY_MAX = 300;
const ACTIVITY_FILES_MAX = 50;
const PUSH_MATCH_MS = 5 * 60_000;
const NOBODY = { name: '', email: '' };

// Per-request data the page must not see (cwd, pid) but the actions need; same key as server/actions.mjs.
const INTERNALS = Symbol.for('session-map.internals');

const summaries = new Map();
const roots = new Map();
const gitMemo = new Map();

const cut = (s) => String(s ?? '').slice(0, TEXT_MAX);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const hashOf = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex');

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && (err.killed || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) log('warn', 'git-too-slow', { command: args[0], code: err.code ?? err.signal });
      resolve(err ? '' : stdout);
    });
  });
}

// ---- reading ---------------------------------------------------------------

function readItems(dir, smDir, nowMs) {
  const items = [];
  for (const ref of listTranscripts(dir, { sinceMs: nowMs - WINDOW_MS })) {
    try {
      const key = `${ref.mtimeMs}:${ref.size}`;
      let hit = summaries.get(ref.path);
      if (hit?.key !== key) {
        const summary = readTranscript(ref.path);
        if (!summary) continue;
        const sessionDir = join(dirname(ref.path), ref.sessionId);
        hit = { key, summary, helperUsage: readHelperUsage(sessionDir), helperCommits: readHelperCommits(sessionDir), workflows: readWorkflows(sessionDir) };
        summaries.set(ref.path, hit);
      }
      if (!hit.summary.cwd || isAiRunnerCwd(hit.summary.cwd, smDir)) continue;
      const card = hit.summary.lastCardText ? parseCard(hit.summary.lastCardText) : null;
      items.push({ ref, ...hit, card });
    } catch (err) {
      log('warn', 'transcript-failed', { sessionId: ref.sessionId, error: err.message });
    }
  }
  return items;
}

async function rootOf(cwd) {
  const key = normalizePath(cwd);
  if (!roots.has(key)) roots.set(key, (await gitRoot(cwd)) ?? cwd);
  return roots.get(key);
}

async function groupByRoot(items) {
  const groups = new Map();
  for (const item of items) {
    const root = await rootOf(item.summary.cwd);
    const key = normalizePath(root);
    if (!groups.has(key)) groups.set(key, { root, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

// git work is the slow part: redone only when a ref moves or the units change.
async function gitSide(smDir, root, projectId, main, units, nowIso) {
  const key = `${smDir}|${projectId}`;
  const memo = gitMemo.get(key) ?? { signature: null, workCells: [], activity: [], backfilled: false, fetchedAt: null };
  gitMemo.set(key, memo);
  if (!main) return memo;
  const refs = await git(root, ['for-each-ref', '--format=%(refname) %(objectname)']);
  const signature = hashOf([refs, units.map((u) => [u.id, u.paths])]);
  if (signature === memo.signature) return memo;
  const since = new Date(Date.parse(nowIso) - WINDOW_MS).toISOString();
  // events.jsonl outlives restarts: once it holds the project, the history was already backfilled.
  const backfill = !memo.backfilled && readEvents(smDir, projectId).length === 0;
  const workCells = await workCellsOf(root, units, { main, previous: memo.workCells });
  appendEvents(smDir, projectId, detectTransitions(memo.workCells, workCells, nowIso));
  if (backfill) appendEvents(smDir, projectId, await backfillMerges(root, main, { since }));
  memo.backfilled = true;
  memo.activity = await activityOf(root, { since });
  memo.workCells = workCells;
  memo.signature = signature;
  return memo;
}

// ---- placing chats -----------------------------------------------------------

function placeInUnit(item, units, overrides, root) {
  const r = classify(item.summary, item.card, units, overrides, { root });
  if (r.unitSource === 'override' || r.unitSource === 'card') return r;
  const perceived = units.find((u) => u.chatIds.includes(item.summary.sessionId));
  return perceived ? { unitId: perceived.id, unitSource: 'ai' } : r;
}

const under = (path, base) => {
  const p = normalizePath(path);
  const b = normalizePath(base);
  return p === b || p.startsWith(`${b}/`);
};

function placeInWorkCell(summary, card, workCells) {
  if (card?.front) {
    const wanted = plain(card.front);
    const hit = workCells.find((w) => plain(w.id) === wanted || plain(w.branch) === wanted);
    if (hit) return { workCellId: hit.id, workCellSource: 'card' };
  }
  const withPath = workCells.filter((w) => w.path);
  let guess = null;
  for (const w of withPath) {
    const n = summary.mentionedPaths.filter((p) => under(p, w.path)).length;
    if (n > 0 && (!guess || n > guess.n)) guess = { id: w.id, n };
  }
  if (guess) return { workCellId: guess.id, workCellSource: 'guess' };
  const byCwd = withPath.find((w) => under(summary.cwd, w.path));
  if (byCwd) return { workCellId: byCwd.id, workCellSource: 'cwd' };
  const byBranch = summary.gitBranch && workCells.find((w) => w.branch === summary.gitBranch);
  if (byBranch) return { workCellId: byBranch.id, workCellSource: 'branch' };
  return { workCellId: null, workCellSource: 'cwd' };
}

// ---- nucleus -------------------------------------------------------------------

// Cards newer than the nucleus file are merged in once; edits made on the page after that stay.
// Without a card or a page edit, the AI's nucleus (written in the background) stands in.
function nucleusOf(smDir, projectId, unit, cardItems, hints, ai) {
  try {
    const file = join(brainDir(smDir, projectId), `${unit.id}.md`);
    let stored = readNucleus(smDir, projectId, unit.id);
    const since = stored && existsSync(file) ? statSync(file).mtimeMs : -Infinity;
    const fresh = cardItems.filter((c) => Date.parse(c.updatedAt) > since).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    const seed = seedNucleus(unit, hints);
    for (const c of fresh) stored = mergeNucleus(stored ?? seed, c.card, c);
    if (fresh.length) writeNucleus(smDir, projectId, unit.id, stored);
    return withAiNucleus(stored, seed, ai);
  } catch (err) {
    log('warn', 'nucleus-failed', { projectId, unitId: unit.id, error: err.message });
    return emptyNucleus();
  }
}

// Size counts the unit's own work plus everything grouped under it.
function rollUp(units, own) {
  const children = new Map();
  for (const u of units) if (u.parentId) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id]);
  const total = (id, seen = new Set()) => {
    if (seen.has(id)) return { chats: 0, commits: 0, decisions: 0 };
    seen.add(id);
    const sum = { ...own.get(id) };
    for (const child of children.get(id) ?? []) {
      const t = total(child, seen);
      for (const k of Object.keys(sum)) sum[k] += t[k];
    }
    return sum;
  };
  return new Map(units.map((u) => [u.id, total(u.id)]));
}

// ---- one project -----------------------------------------------------------------

function clashesOf(workCells, projectId) {
  const items = [];
  const byId = new Map(workCells.map((w) => [w.id, w]));
  for (const w of workCells) {
    for (const otherId of w.clashWith) {
      const o = byId.get(otherId);
      if (!o || w.id > o.id) continue;
      const theirs = new Set(o.files.map((f) => f.path));
      const shared = w.files.map((f) => f.path).filter((f) => theirs.has(f));
      items.push({ kind: 'clash', text: `${w.owner.name} (${w.branch}) × ${o.owner.name} (${o.branch}): ${shared.slice(0, 3).join(', ')}`, projectId, sessionId: null });
    }
  }
  return items;
}

function activityItems(raw, events, units, workCells, items) {
  const commitsOf = (i) => [...i.summary.commits, ...i.helperCommits].map((c) => ({ ...c, sessionId: i.summary.sessionId }));
  const byHash = items.flatMap(commitsOf).filter((c) => c.hash);
  // `git commit -q` prints no hash: the subject is the only trace left in the transcript.
  const bySubject = new Map(items.flatMap(commitsOf).filter((c) => !c.hash).map((c) => [c.subject, c.sessionId]));
  const pushSessions = items.flatMap((i) => i.summary.pushes.map((p) => ({ ...p, sessionId: i.summary.sessionId })));
  const cellById = new Map(workCells.map((w) => [w.id, w]));
  const fromGit = raw.map((a) => {
    const item = { ...a, unitIds: a.files ? unitsTouchedBy(a.files, units) : [] };
    if (a.files) item.files = a.files.slice(0, ACTIVITY_FILES_MAX);
    const sessionId = a.kind === 'push'
      ? pushSessions.find((p) => p.branch === a.branch && Math.abs(Date.parse(p.ts) - Date.parse(a.ts)) <= PUSH_MATCH_MS)?.sessionId
      : byHash.find((c) => a.hash?.startsWith(c.hash))?.sessionId ?? bySubject.get(a.subject);
    if (sessionId) item.sessionId = sessionId;
    if (cellById.has(a.branch)) item.workCellId = a.branch;
    return item;
  });
  const fromEvents = events.map((e) => {
    if (e.workCellId) {
      const cell = cellById.get(e.workCellId);
      return { kind: e.kind, ts: e.ts, branch: cell?.branch ?? e.workCellId, author: cell?.owner ?? NOBODY, unitIds: cell ? [cell.unitId] : [], workCellId: e.workCellId };
    }
    return { kind: e.kind, ts: e.ts, branch: e.branch ?? '', author: e.author ?? NOBODY, unitIds: e.unitIds ?? [], subject: e.subject };
  });
  return [...fromGit, ...fromEvents].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, ACTIVITY_MAX);
}

// The link of the VS Code tunnel on this PC, for the phone; the page puts it in a href, so only https passes.
const tunnelOf = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

async function buildProject(ctx, { root, items }) {
  const { dir, smDir, now, nowIso, liveById, archived, prices, userConfig, life } = ctx;
  const projectId = projectIdOf(root);
  const config = loadConfig(root, smDir);
  const main = await mainBranch(root);
  const isNew = !existsSync(unitsFile(smDir, projectId));
  const gitLog = isNew && main ? (await git(root, ['log', '--name-only', '--format=', '-n', '500'])).split(/\r?\n/).filter(Boolean) : [];
  const units = loadUnits(smDir, root, { gitLog }).map(normalizeUnit);
  const memo = await gitSide(smDir, root, projectId, main, units, nowIso);
  autoFetch(root, config.autoFetchMinutes).then((at) => { memo.fetchedAt = at; });
  const overrides = readOverrides(smDir, projectId);
  const lineage = readLineage(smDir);
  const openspec = readOpenSpec(root);
  const roadmap = config.roadmap ? readRoadmap(join(root, config.roadmap), { decisions: config.decisions }) : null;

  const openBranches = new Set(memo.workCells.filter((w) => w.status !== 'merged').map((w) => w.branch));
  const placed = items.map((item) => {
    const s = item.summary;
    const updatedAt = s.endedAt ?? new Date(item.ref.mtimeMs).toISOString();
    return {
      item, updatedAt,
      ...placeInUnit(item, units, overrides, root),
      ...placeInWorkCell(s, item.card, memo.workCells),
      costUSD: round6(costOf([...s.usage, ...item.helperUsage], prices).usd),
      shown: liveById.has(s.sessionId) || now.getTime() - item.ref.mtimeMs < RECENT_MS || openBranches.has(s.gitBranch),
    };
  });
  const forLineage = (unitId) => placed.filter((x) => x.unitId === unitId).map((x) => ({ sessionId: x.item.summary.sessionId, startedAt: x.item.summary.startedAt, editedFiles: x.item.summary.editedFiles }));

  const chats = placed.filter((x) => x.shown).map((x) => {
    const s = x.item.summary;
    const live = liveById.get(s.sessionId) ?? null;
    const waiting = waitingFor(s, live, x.item.card);
    return {
      sessionId: s.sessionId,
      title: cut(s.title),
      unitId: x.unitId,
      unitSource: x.unitSource,
      workCellId: x.workCellId,
      workCellSource: x.workCellSource,
      parentId: parentOf(s.sessionId, lineage, forLineage(x.unitId)),
      status: live ? live.status : 'closed',
      entrypoint: live?.entrypoint ?? '',
      live: Boolean(live),
      bridgeUrl: live?.bridgeSessionId ? `https://claude.ai/code/${live.bridgeSessionId}` : null,
      lastPrompt: cut(s.lastPrompt),
      lastAssistantText: cut(s.lastAssistantText),
      waiting: { strong: waiting.strong, weak: waiting.weak, items: waiting.items.map(cut) },
      card: x.item.card,
      costUSD: x.costUSD,
      workflows: x.item.workflows,
      startedAt: s.startedAt,
      updatedAt: x.updatedAt,
      archived: archived.has(s.sessionId),
      chattable: !live,
    };
  });
  for (const chat of chats) ctx.internals.set(chat.sessionId, { projectId, root, cwd: placed.find((x) => x.item.summary.sessionId === chat.sessionId).item.summary.cwd, pid: liveById.get(chat.sessionId)?.pid ?? null });

  const workCells = memo.workCells.map((w) => {
    const mine = placed.filter((x) => x.shown && x.workCellId === w.id).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const latest = (field) => mine.find((x) => x.item.card?.[field] !== undefined)?.item.card[field];
    const spec = openspec.find((o) => plain(w.branch).includes(plain(o.change)));
    return {
      ...w,
      chatIds: mine.map((x) => x.item.summary.sessionId),
      costUSD: round6(mine.reduce((sum, x) => sum + x.costUSD, 0)),
      estimateUSD: latest('estimateUSD') ?? null,
      nucleus: { doing: latest('doing') ?? null, todo: latest('todo') ?? [] },
      openspec: spec ?? null,
    };
  });

  const events = readEvents(smDir, projectId).filter((e) => now.getTime() - Date.parse(e.ts) <= WINDOW_MS);
  const activity = activityItems(memo.activity, events, units, workCells, items);
  const hints = { openspec, milestones: roadmap?.milestones ?? [] };
  const own = new Map();
  const nuclei = new Map();
  const aiNuclei = readJsonFile(aiNucleusFile(smDir, projectId), {}) ?? {};
  for (const u of units) {
    const cardItems = placed.filter((x) => x.unitId === u.id && x.item.card).map((x) => ({
      card: x.item.card, sessionId: x.item.summary.sessionId, updatedAt: x.updatedAt, title: x.item.summary.title,
      lastAssistantText: x.item.summary.lastAssistantText, lastPrompt: x.item.summary.lastPrompt,
    }));
    const nucleus = nucleusOf(smDir, projectId, u, cardItems, hints, aiNuclei[u.id] ?? null);
    nuclei.set(u.id, nucleus);
    own.set(u.id, {
      chats: placed.filter((x) => x.unitId === u.id).length,
      commits: activity.filter((a) => (a.kind === 'commit' || a.kind === 'merge') && a.unitIds.includes(u.id)).length,
      decisions: nucleus.decided.length,
    });
  }
  const work = rollUp(units, own);

  const isWaiting = (c) => !c.archived && (c.waiting.strong || c.waiting.weak || c.waiting.items.length > 0);
  const outUnits = units.map((u) => {
    const mine = chats.filter((c) => c.unitId === u.id);
    const cells = workCells.filter((w) => w.unitId === u.id && w.status !== 'merged');
    const firstChat = placed.filter((x) => x.unitId === u.id).map((x) => x.item.summary.startedAt).filter(Boolean).sort()[0];
    return {
      id: u.id, level: u.level, parentId: u.parentId, name: u.name, purpose: u.purpose, tags: u.tags,
      origin: u.origin, pinned: u.pinned, paths: u.paths,
      nucleus: nuclei.get(u.id),
      chatIds: mine.map((c) => c.sessionId),
      workCellIds: cells.map((w) => w.id),
      work: work.get(u.id),
      status: mine.some(isWaiting) ? 'waiting' : mine.some((c) => c.status === 'busy') || cells.some((w) => w.status === 'active') ? 'active' : 'idle',
      bornAt: u.bornAt ?? firstChat ?? nowIso,
    };
  });

  const linkChats = placed.map(({ item: { summary: s }, unitId }) => ({
    sessionId: s.sessionId, title: s.title, unitId, startedAt: s.startedAt, editedFiles: s.editedFiles, cwd: s.cwd, parentId: parentOf(s.sessionId, lineage, forLineage(unitId)),
  }));
  const unitLinks = linkUnits(linkChats, units, workCells, specRefsOf(root, units), { root });

  const aiOn = life.queue.enabled && config.ai?.enabled !== false;
  if (aiOn) {
    const workCellOf = (item) => workCells.find((w) => w.id === placed.find((x) => x.item === item)?.workCellId) ?? null;
    // Placed again from units.json as it is when asked: the bootstrap changes it after this collect started.
    const nucleusInputs = () => {
      const current = readJsonFile(unitsFile(smDir, projectId), []).map(normalizeUnit);
      const hasFile = (u) => existsSync(join(brainDir(smDir, projectId), `${u.id}.md`));
      const where = new Map(items.map((item) => [item, placeInUnit(item, current, overrides, root).unitId]));
      return current.filter((u) => u.id !== UNSORTED && !hasFile(u)).flatMap((u) => {
        const chats = items.filter((item) => where.get(item) === u.id).map((item) => ({
          updatedAt: item.summary.endedAt ?? new Date(item.ref.mtimeMs).toISOString(),
          digest: digestOf(item.summary, workCellOf(item)),
          last: item.summary.lastAssistantText,
        }));
        const branches = workCells.filter((w) => w.unitId === u.id && w.status !== 'merged');
        return chats.length || branches.length ? [nucleusInputOf(u, chats, branches)] : [];
      });
    };
    const p = { smDir, projectId, workCellOf, nucleusInputs };
    if (isNew) startBootstrap(life, p, items);
    const boot = life.boot.get(projectId);
    if (!boot || boot.done >= boot.total) {
      perceiveChanged(life, p, placed.filter((x) => x.shown && !archived.has(x.item.summary.sessionId) && x.unitSource !== 'override' && x.unitSource !== 'card').map((x) => x.item));
      if (!isNew) refreshNuclei(life, p);
    }
  }

  const milestones = roadmap?.milestones.map((m) => ({ ...m, workCellId: placed.find((x) => x.workCellId && x.item.card?.milestone === m.id)?.workCellId ?? null })) ?? null;
  const allRows = items.flatMap((i) => [...i.summary.usage, ...i.helperUsage]);
  const cost = windowed(allRows, now, prices);
  const name = basename(root.replace(/[\\/]+$/, '')) || root;
  return {
    project: {
      id: projectId, name, root, mainBranch: main, fetchedAt: memo.fetchedAt, tunnelUrl: tunnelOf(userConfig.tunnelUrl),
      units: outUnits, unitLinks, workCells,
      ai: aiOn ? aiStatus(life, projectId) : null,
      activity, chats, roadmap: milestones,
      decisions: [...(roadmap?.decisions ?? []).map((d) => ({ ...d, projectId })), ...clashesOf(workCells.filter((w) => w.status !== 'merged'), projectId)],
      skills: listSkills(root, dir),
      cost: { today: round6(cost.today), d7: round6(cost.d7), d30: round6(cost.d30) },
    },
    rows: allRows,
  };
}

// ---- the state -------------------------------------------------------------------

function currencyOf(c) {
  return c && typeof c.code === 'string' && Number.isFinite(c.rate) && c.rate > 0 ? { code: c.code, rate: c.rate } : { code: 'USD', rate: 1 };
}

// ai: {bin, run} replaces the claude binary and the call (tests); isAlive replaces the pid check.
export async function collect({ dir, smDir, now = new Date(), isAlive, ai } = {}) {
  const nowIso = now.toISOString();
  const userConfig = readJsonFile(join(smDir, 'config.json'), {}) ?? {};
  const live = listLiveSessions(dir, isAlive ? { isAlive } : {}).filter((s) => s.alive);
  const archivedList = readJsonFile(join(smDir, 'archived.json'), []);
  const ctx = {
    dir, smDir, now, nowIso,
    liveById: new Map(live.map((s) => [s.sessionId, s])),
    archived: new Set(Array.isArray(archivedList) ? archivedList : []),
    prices: loadPrices(userConfig.prices ?? {}),
    userConfig,
    life: lifeOf(smDir, userConfig, ai),
    internals: new Map(),
  };
  const groups = await groupByRoot(readItems(dir, smDir, now.getTime()));
  // One broken project must not blank the page for the others.
  const built = (await Promise.all(groups.map((g) => buildProject(ctx, g).catch((err) => {
    log('warn', 'project-failed', { projectId: projectIdOf(g.root), error: err.message });
    return null;
  })))).filter(Boolean);
  const projects = built.map((b) => b.project);

  const sum = (key) => round6(projects.reduce((s, p) => s + p.cost[key], 0));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthRows = built.flatMap((b) => b.rows).filter((r) => Date.parse(r.ts) >= monthStart);
  const monthlyUSD = userConfig.budget?.monthlyUSD;
  const waitingCount = projects.reduce((n, p) => n + p.decisions.length + p.chats
    .filter((c) => !c.archived)
    .reduce((m, c) => m + (c.waiting.strong ? 1 : 0) + (c.waiting.weak ? 1 : 0) + c.waiting.items.length, 0), 0);

  const state = {
    generatedAt: nowIso,
    waitingCount,
    currency: currencyOf(userConfig.currency),
    totals: { today: sum('today'), d7: sum('d7'), d30: sum('d30') },
    budget: Number.isFinite(monthlyUSD) && monthlyUSD > 0 ? { monthlyUSD, used: round6(costOf(monthRows, ctx.prices).usd) } : null,
    projects,
  };
  Object.defineProperty(state, INTERNALS, { value: { chats: ctx.internals }, enumerable: false });
  return state;
}

export { settleAi } from './ai/life.mjs';
