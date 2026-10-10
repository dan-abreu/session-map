import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { digestOf } from './ai/digest.mjs';
import { aiPlacements, aiStatus, lifeOf, placeChanged } from './ai/life.mjs';
import { isAiRunnerCwd } from './ai/runner.mjs';
import { attachToParts, itemByCodes, linkParts, ownersOf, partByCodes, partOfFiles, partsTouched, waitingItems } from './arch/attach.mjs';
import { readArch } from './arch/detect.mjs';
import { withLocalParts } from './arch/local.mjs';
import { norm } from './arch/parse.mjs';
import { sizesOf } from './arch/sizes.mjs';
import { appendEvents, readEvents } from './brain/events.mjs';
import { parentOf, readLineage } from './brain/lineage.mjs';
import { backfillMerges, detectTransitions, workCellsOf } from './brain/workcells.mjs';
import { loadConfig } from './config.mjs';
import { costOf, dailyCost, loadPrices, windowed } from './cost.mjs';
import { attachChanges } from './changes-state.mjs';
import { footprintOf, touchesOf } from './footprint.mjs';
import { hangWorkflows } from './workflows.mjs';
import { log } from './log.mjs';
import { parseCard } from './parse/card.mjs';
import { waitingFor } from './parse/waiting.mjs';
import { normalizePath, projectIdOf, repoFiles } from './paths.mjs';
import { listLiveSessions, listTranscripts, readHelperUsage, readHelperWork, readTranscript, readWorkflows } from './sources/claude.mjs';
import { countRepo } from './sources/count.mjs';
import { autoFetch } from './sources/fetch.mjs';
import { activityOf, mainBranch, projectRoot } from './sources/git.mjs';
import { readPlacements } from './placements.mjs';
import { readOpenSpec } from './sources/openspec.mjs';
import { readRoadmap } from './sources/roadmap.mjs';
import { listSkills } from './sources/skills.mjs';
import { readJsonFile } from './store.mjs';

const DAY = 86_400_000;
const RECENT_MS = DAY;
// 31 days: the monthly budget needs a whole calendar month of rows.
const WINDOW_MS = 31 * DAY;
const TEXT_MAX = 280;
const ACTIVITY_MAX = 300;
const ACTIVITY_FILES_MAX = 50;
const PUSH_MATCH_MS = 5 * 60_000;
const NOBODY = { name: '', email: '' };
// The owner's moves shown to the AI as examples of how they place work.
const EXAMPLES_MAX = 20;
// ponytail: the list gets the newest 300 of a project; page through the server if a month ever holds more.
const CONVERSATIONS_MAX = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-request data the page must not see (cwd, pid) but the actions need; same key as server/actions.mjs.
const INTERNALS = Symbol.for('session-map.internals');

const summaries = new Map();
const roots = new Map();
const gitMemo = new Map();

const cut = (s) => String(s ?? '').slice(0, TEXT_MAX);
const modelOf = (usage) => [...(usage ?? [])].reverse().find((u) => u.model && u.model !== 'unknown')?.model ?? null;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const hashOf = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex');
const plain = (s) => norm(String(s));

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 10_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && (err.killed || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')) log('warn', 'git-too-slow', { command: args[0], code: err.code ?? err.signal });
      resolve(err ? '' : stdout);
    });
  });
}

// ---- reading ---------------------------------------------------------------

function helperWork(sessionDir) {
  const work = readHelperWork(sessionDir);
  return { helperCommits: work.commits, helperEdits: work.editedFiles, helperLast: work.last };
}

// liveIds: a live conversation's workflow agents move on while its own transcript sits still, so their journals and the
// files they edit are read again on every pass (each agent's transcript only when it changed).
function readItems(dir, smDir, nowMs, liveIds) {
  const items = [];
  for (const ref of listTranscripts(dir, { sinceMs: nowMs - WINDOW_MS })) {
    try {
      const key = `${ref.mtimeMs}:${ref.size}`;
      let hit = summaries.get(ref.path);
      const sessionDir = join(dirname(ref.path), ref.sessionId);
      if (hit?.key !== key) {
        const summary = readTranscript(ref.path);
        if (!summary) continue;
        hit = { key, summary, helperUsage: readHelperUsage(sessionDir), workflows: readWorkflows(sessionDir), ...helperWork(sessionDir) };
        summaries.set(ref.path, hit);
      } else if (liveIds.has(ref.sessionId)) {
        Object.assign(hit, { workflows: readWorkflows(sessionDir), ...helperWork(sessionDir) });
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
  if (!roots.has(key)) roots.set(key, (await projectRoot(cwd)) ?? cwd);
  return roots.get(key);
}

const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// placements: the owner's moves (server/placements.mjs); a project folder that is gone no longer pulls its conversations.
async function groupByRoot(items, placements) {
  const groups = new Map();
  for (const item of items) {
    const moved = placements[item.summary.sessionId]?.root;
    const root = moved && isDir(moved) ? moved : await rootOf(item.summary.cwd);
    const key = normalizePath(root);
    if (!groups.has(key)) groups.set(key, { root, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

// The repo's top-level folders tell a code path written from the root ("apps/site") from one written inside an app.
function topLevelOf(root) {
  try {
    return new Set(readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()));
  } catch {
    return undefined;
  }
}

// git work is the slow part: redone only when a ref moves or the parts' code paths change.
async function gitSide(smDir, root, projectId, main, arch, placeFiles, nowIso) {
  const key = `${smDir}|${projectId}`;
  const memo = gitMemo.get(key) ?? { signature: null, workCells: [], activity: [], backfilled: false, fetchedAt: null };
  gitMemo.set(key, memo);
  if (!main) return memo;
  const refs = await git(root, ['for-each-ref', '--format=%(refname) %(objectname)']);
  const signature = hashOf([refs, arch.parts.map((p) => [p.id, p.file, p.codePaths])]);
  if (signature === memo.signature) return memo;
  const since = new Date(Date.parse(nowIso) - WINDOW_MS).toISOString();
  // events.jsonl outlives restarts: once it holds the project, the history was already backfilled.
  const backfill = !memo.backfilled && readEvents(smDir, projectId).length === 0;
  const workCells = await workCellsOf(root, (files) => placeFiles(files.map((f) => f.path)), { main, previous: memo.workCells });
  appendEvents(smDir, projectId, detectTransitions(memo.workCells, workCells, nowIso));
  if (backfill) appendEvents(smDir, projectId, await backfillMerges(root, main, { since }));
  memo.backfilled = true;
  memo.activity = await activityOf(root, { since });
  memo.workCells = workCells;
  memo.signature = signature;
  return memo;
}

// ---- placing chats -----------------------------------------------------------

// The owner's own move first (mm21), then an item code the conversation cites, then the part the page opened it on, then
// the files it edited, then what the AI answered earlier (desenho-3 § 2). A project chat belongs to the whole project.
// page: what page-chats.json keeps of a conversation the page started in this project.
function placeInPart(item, arch, placeFiles, root, aiAnswers, page, placement) {
  const s = item.summary;
  if (!arch.parts.length) return { partId: null, partSource: 'none' };
  if (placement && 'partId' in placement && (placement.partId === null || arch.parts.some((p) => p.id === placement.partId))) {
    return { partId: placement.partId, partSource: 'owner' };
  }
  if (page?.node?.kind === 'project') return { partId: null, partSource: 'project' };
  const byCode = partByCodes(s.mentionedCodes, arch);
  if (byCode) return { partId: byCode, partSource: 'code' };
  const byPage = page?.partId;
  if (typeof byPage === 'string' && arch.parts.some((p) => p.id === byPage)) return { partId: byPage, partSource: 'page' };
  const byFiles = placeFiles(repoFiles([...s.editedFiles ?? [], ...item.helperEdits ?? []], root, s.cwd)).partId;
  if (byFiles) return { partId: byFiles, partSource: 'files' };
  const byAi = aiAnswers[s.sessionId]?.partId;
  if (byAi && arch.parts.some((p) => p.id === byAi)) return { partId: byAi, partSource: 'ai' };
  return { partId: null, partSource: 'none' };
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

// ---- the real footprint (mm24) ------------------------------------------------------

const touchMemo = new Map();

// Where a conversation's files fall, by repository: its own edits, its helpers' and workflow agents', what its last steps
// looked at, and the file of its newest step (an agent's, when an agent wrote last). Redone when any of those change.
function touchOf(item, root, skip) {
  const s = item.summary;
  const lastFile = item.helperLast && item.helperLast.at > item.ref.mtimeMs ? item.helperLast.file : s.lastFile;
  const sig = [item.ref.mtimeMs, item.ref.size, root, item.helperEdits.length, lastFile].join('|');
  const hit = touchMemo.get(s.sessionId);
  if (hit?.sig === sig) return hit;
  const touch = touchesOf({ root, cwd: s.cwd, edited: [...s.editedFiles, ...item.helperEdits], seen: s.mentionedPaths, skip });
  const [stepAt] = lastFile ? touchesOf({ root, cwd: s.cwd, edited: [lastFile], skip }) : [];
  const out = { sig, touch, step: stepAt ? { key: stepAt[0], rel: stepAt[1].edited[0] } : null };
  touchMemo.set(s.sessionId, out);
  return out;
}

// A conversation listed in the project it was born in, seen from another one it works in: no cost (it stays at home) and
// no page point of the home map; partId is where most of its work there went.
function visitorOf(row, chat, place, born, stepPartId) {
  return {
    ...row,
    partId: place.parts[0]?.partId ?? null, partSource: 'files', itemCode: null, node: null, costUSD: null, onMap: false,
    bornIn: { projectId: born.id, name: born.name }, stepPartId,
    liveSteps: chat?.liveSteps ?? [], workflows: chat?.workflows ?? [],
  };
}

// Hangs each conversation's footprint on its row and chat, and lists it in every other project it edits (or reads while it
// works) as a visitor. built: [{project, key, ownersOf}].
function hangFootprints(built, touches) {
  const homes = new Map(built.map((b) => [b.key, { projectId: b.project.id, name: b.project.name, ownersOf: b.ownersOf }]));
  const byId = new Map(built.map((b) => [b.project.id, b]));
  for (const b of built) {
    const chatById = new Map(b.project.chats.map((c) => [c.sessionId, c]));
    for (const row of b.project.conversations) {
      const t = touches.get(row.sessionId);
      const footprint = t && footprintOf(t.touch, homes);
      if (!footprint) continue;
      const chat = chatById.get(row.sessionId);
      const stepIn = (target) => (t.step && t.step.key === target.key ? target.ownersOf([t.step.rel])[0] : null);
      row.footprint = footprint;
      if (chat) {
        chat.footprint = footprint;
        chat.stepPartId = stepIn(b);
      }
      for (const place of footprint.places) {
        const target = byId.get(place.projectId);
        if (target === b || !(place.edited || (row.status === 'busy' && place.seen))) continue;
        target.project.visitors.push(visitorOf(row, chat, place, b.project, stepIn(target)));
      }
    }
  }
  for (const b of built) b.project.visitors.sort((x, y) => String(y.updatedAt ?? '').localeCompare(String(x.updatedAt ?? '')));
}

// ---- one project -----------------------------------------------------------------

// The page words each clash itself from the fields; text is for the terminal view.
export function clashItems(workCells, projectId) {
  const items = [];
  const byId = new Map(workCells.map((w) => [w.id, w]));
  for (const w of workCells) {
    for (const otherId of w.clashWith) {
      const o = byId.get(otherId);
      if (!o || w.id > o.id) continue;
      const theirs = new Set(o.files.map((f) => f.path));
      const files = w.files.map((f) => f.path).filter((f) => theirs.has(f)).slice(0, 3);
      const sameOwner = w.owner.email === o.owner.email;
      const text = sameOwner
        ? `Your branches ${w.branch} and ${o.branch} touch the same file: ${files.join(', ')}`
        : `${w.owner.name} (${w.branch}) and ${o.owner.name} (${o.branch}) touch the same file: ${files.join(', ')}`;
      items.push({ kind: 'clash', text, projectId, sessionId: null, workCellIds: [w.id, o.id], branches: [w.branch, o.branch], owners: [w.owner.name, o.owner.name], files, sameOwner });
    }
  }
  return items;
}

// Events of the old cell tree (renamed, grouped...) stay on disk from older versions; only branch births and fusions count.
function activityItems(raw, events, touched, workCells, items) {
  const commitsOf = (i) => [...i.summary.commits, ...i.helperCommits].map((c) => ({ ...c, sessionId: i.summary.sessionId }));
  const byHash = items.flatMap(commitsOf).filter((c) => c.hash);
  // `git commit -q` prints no hash: the subject is the only trace left in the transcript.
  const bySubject = new Map(items.flatMap(commitsOf).filter((c) => !c.hash).map((c) => [c.subject, c.sessionId]));
  const pushSessions = items.flatMap((i) => i.summary.pushes.map((p) => ({ ...p, sessionId: i.summary.sessionId })));
  const cellById = new Map(workCells.map((w) => [w.id, w]));
  const fromGit = raw.map((a) => {
    const item = { ...a, partIds: a.files ? touched(a.files) : [] };
    if (a.files) item.files = a.files.slice(0, ACTIVITY_FILES_MAX);
    const sessionId = a.kind === 'push'
      ? pushSessions.find((p) => p.branch === a.branch && Math.abs(Date.parse(p.ts) - Date.parse(a.ts)) <= PUSH_MATCH_MS)?.sessionId
      : byHash.find((c) => a.hash?.startsWith(c.hash))?.sessionId ?? bySubject.get(a.subject);
    if (sessionId) item.sessionId = sessionId;
    if (cellById.has(a.branch)) item.workCellId = a.branch;
    return item;
  });
  const fromEvents = events.filter((e) => e.workCellId && (e.kind === 'born' || e.kind === 'fused')).map((e) => {
    const cell = cellById.get(e.workCellId);
    return { kind: e.kind, ts: e.ts, branch: cell?.branch ?? e.workCellId, author: cell?.owner ?? NOBODY, partIds: cell?.partId ? [cell.partId] : [], workCellId: e.workCellId };
  });
  return [...fromGit, ...fromEvents].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, ACTIVITY_MAX);
}

// fromPage: the chat opens with the page's context block, so it is the page's even when page-chats.json lost it.
function originOf(sessionId, entrypoint, pageChats, fromPage = false) {
  if (pageChats[sessionId] || (fromPage && entrypoint.startsWith('sdk'))) return 'map';
  if (entrypoint === 'claude-vscode') return 'vscode';
  if (entrypoint === 'claude-desktop') return 'desktop';
  if (/^(remote|mobile)/.test(entrypoint)) return 'remote';
  // The Agent SDK: page chats are known above, so these are scripts and workflow agents.
  if (entrypoint.startsWith('sdk')) return 'sdk';
  return 'terminal';
}

// The list of conversations (plano-v02 § v0.2.2 item 0): every conversation of the window, shown on the map or not, plus the
// page's own older than the window, which stay resumable. Light rows: the map's chats carry the full detail.
function conversationRows({ placed, chats, arch, pageChats, projectId, liveById, archived, titleOf }) {
  const onMap = new Map(chats.map((c) => [c.sessionId, c]));
  const knownPart = (id) => (typeof id === 'string' && arch.parts.some((p) => p.id === id) ? id : null);
  const nodeOf = (page) => (page?.node && typeof page.node.kind === 'string' ? page.node : null);
  const fromTranscripts = placed.map((x) => {
    const s = x.item.summary;
    const live = liveById.get(s.sessionId);
    const chat = onMap.get(s.sessionId);
    const page = pageChats[s.sessionId];
    return {
      sessionId: s.sessionId,
      title: cut(titleOf(s) || page?.title),
      origin: originOf(s.sessionId, live?.entrypoint || s.entrypoint || '', pageChats, s.fromPage),
      partId: x.partId,
      partSource: x.partSource,
      itemCode: itemByCodes(s.mentionedCodes, arch, x.partId) ?? nodeOf(page)?.code ?? null,
      node: nodeOf(page),
      status: live ? live.status : 'closed',
      waiting: Boolean(chat && !chat.archived && (chat.waiting.strong || chat.waiting.weak || chat.waiting.items.length)),
      lastStep: s.liveSteps?.at(-1) ?? null,
      costUSD: x.costUSD,
      startedAt: s.startedAt,
      updatedAt: x.updatedAt,
      archived: archived.has(s.sessionId),
      live: Boolean(live),
      chattable: !live,
      onMap: Boolean(chat),
    };
  });
  const seen = new Set(fromTranscripts.map((r) => r.sessionId));
  const fromPage = Object.entries(pageChats)
    .filter(([id, c]) => UUID_RE.test(id) && !seen.has(id) && c?.projectId === projectId)
    .map(([sessionId, c]) => ({
      sessionId,
      title: cut(c.title),
      origin: 'map',
      partId: knownPart(c.partId),
      partSource: knownPart(c.partId) ? 'page' : 'none',
      itemCode: nodeOf(c)?.code ?? null,
      node: nodeOf(c),
      status: 'closed',
      waiting: false,
      lastStep: null,
      costUSD: null,
      startedAt: c.startedAt ?? null,
      updatedAt: c.updatedAt ?? c.startedAt ?? null,
      archived: archived.has(sessionId),
      live: false,
      chattable: true,
      onMap: false,
    }));
  return [...fromTranscripts, ...fromPage]
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || a.sessionId.localeCompare(b.sessionId))
    .slice(0, CONVERSATIONS_MAX);
}

// The link of the VS Code tunnel on this PC, for the phone; the page puts it in a href, so only https passes.
const tunnelOf = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

async function buildProject(ctx, { root, items }) {
  const { dir, smDir, now, nowIso, liveById, archived, prices, userConfig, life } = ctx;
  const projectId = projectIdOf(root);
  const config = loadConfig(root, smDir);
  const main = await mainBranch(root);
  const arch = withLocalParts(await readArch(root, config, { mainBranch: main }), smDir, projectId);
  const topLevel = topLevelOf(root);
  const placeFiles = (files) => partOfFiles(files, arch, { topLevel });
  const memo = await gitSide(smDir, root, projectId, main, arch, placeFiles, nowIso);
  const sizes = sizesOf(await countRepo(root), arch, { topLevel });
  autoFetch(root, config.autoFetchMinutes).then((at) => { memo.fetchedAt = at; });
  const lineage = readLineage(smDir);
  const openspec = readOpenSpec(root);
  const roadmap = config.roadmap ? readRoadmap(join(root, config.roadmap), { decisions: config.decisions }) : null;
  const aiOn = life.queue.enabled && config.ai?.enabled !== false;
  const aiAnswers = aiPlacements(life, smDir, projectId);
  const pageChats = readJsonFile(join(smDir, 'page-chats.json'), {}) ?? {};
  const { placements } = ctx;
  const titleOf = (s) => placements[s.sessionId]?.title || s.title;
  const pageOf = (sessionId) => (pageChats[sessionId]?.projectId === projectId ? pageChats[sessionId] : null);

  const openBranches = new Set(memo.workCells.filter((w) => w.status !== 'merged').map((w) => w.branch));
  const placed = items.map((item) => {
    const s = item.summary;
    const updatedAt = s.endedAt ?? new Date(item.ref.mtimeMs).toISOString();
    return {
      item, updatedAt,
      ...placeInPart(item, arch, placeFiles, root, aiAnswers, pageOf(s.sessionId), placements[s.sessionId]),
      ...placeInWorkCell(s, item.card, memo.workCells),
      costUSD: round6(costOf([...s.usage, ...item.helperUsage], prices).usd),
      shown: liveById.has(s.sessionId) || now.getTime() - item.ref.mtimeMs < RECENT_MS || openBranches.has(s.gitBranch),
    };
  });
  const forLineage = (partId) => placed.filter((x) => x.partId === partId).map((x) => ({ sessionId: x.item.summary.sessionId, startedAt: x.item.summary.startedAt, editedFiles: x.item.summary.editedFiles }));

  const chats = placed.filter((x) => x.shown).map((x) => {
    const s = x.item.summary;
    const live = liveById.get(s.sessionId) ?? null;
    const waiting = waitingFor(s, live, x.item.card);
    return {
      sessionId: s.sessionId,
      title: cut(titleOf(s)),
      partId: x.partId,
      partSource: x.partSource,
      itemCode: itemByCodes(s.mentionedCodes, arch, x.partId),
      workCellId: x.workCellId,
      workCellSource: x.workCellSource,
      parentId: parentOf(s.sessionId, lineage, forLineage(x.partId)),
      status: live ? live.status : 'closed',
      entrypoint: live?.entrypoint ?? '',
      model: modelOf(s.usage),
      turnStartedAt: s.turnStartedAt ?? null,
      live: Boolean(live),
      bridgeUrl: live?.bridgeSessionId ? `https://claude.ai/code/${live.bridgeSessionId}` : null,
      lastPrompt: cut(s.lastPrompt),
      lastAssistantText: cut(s.lastAssistantText),
      waiting: { strong: waiting.strong, weak: waiting.weak, items: waiting.items.map(cut) },
      card: x.item.card,
      costUSD: x.costUSD,
      workflows: x.item.workflows,
      liveSteps: s.liveSteps ?? [],
      startedAt: s.startedAt,
      updatedAt: x.updatedAt,
      archived: archived.has(s.sessionId),
      chattable: !live,
    };
  });
  // Every conversation of the window, not only the shown ones: the list opens older ones in a terminal too.
  for (const x of placed) {
    const { sessionId, cwd } = x.item.summary;
    ctx.internals.set(sessionId, { projectId, root, cwd, pid: liveById.get(sessionId)?.pid ?? null });
  }
  const conversations = conversationRows({ placed, chats, arch, pageChats, projectId, liveById, archived, titleOf });

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
  const activity = activityItems(memo.activity, events, (files) => partsTouched(files, arch, { topLevel }), workCells, items);

  if (aiOn && arch.parts.length) {
    const cellOf = (x) => workCells.find((w) => w.id === x.workCellId) ?? null;
    const jobs = placed
      .filter((x) => x.shown && !archived.has(x.item.summary.sessionId) && (x.partSource === 'none' || x.partSource === 'ai'))
      .map((x) => ({ sessionId: x.item.summary.sessionId, digest: digestOf(x.item.summary, cellOf(x)) }));
    const examples = placed
      .filter((x) => x.partSource === 'owner' && x.partId)
      .slice(0, EXAMPLES_MAX)
      .map((x) => ({ title: cut(titleOf(x.item.summary)), partId: x.partId }));
    placeChanged(life, { smDir, projectId, arch, examples }, jobs);
  }

  const chatFiles = new Map(placed.filter((x) => x.shown).map((x) => [x.item.summary.sessionId, repoFiles(x.item.summary.editedFiles ?? [], root, x.item.summary.cwd)]));
  const milestones = roadmap?.milestones.map((m) => ({ ...m, workCellId: placed.find((x) => x.workCellId && x.item.card?.milestone === m.id)?.workCellId ?? null })) ?? null;
  const allRows = items.flatMap((i) => [...i.summary.usage, ...i.helperUsage]);
  const cost = windowed(allRows, now, prices);
  const name = basename(root.replace(/[\\/]+$/, '')) || root;
  return {
    project: {
      id: projectId, name, root, mainBranch: main, fetchedAt: memo.fetchedAt, tunnelUrl: tunnelOf(userConfig.tunnelUrl),
      arch: { ...attachToParts(arch, chats, workCells), links: linkParts(arch, chats.map((c) => ({ ...c, files: chatFiles.get(c.sessionId) })), workCells, { topLevel }), sizes },
      workCells,
      // The words of a registry of requests kept translated in session-map's folder, by language and code (id76).
      requestWords: readJsonFile(join(smDir, 'projects', projectId, 'requests-words.json'), null),
      ai: aiOn ? aiStatus(life, projectId) : null,
      activity, chats, conversations, visitors: [], roadmap: milestones,
      decisions: [
        ...(roadmap?.decisions ?? []).map((d) => ({ ...d, projectId })),
        ...clashItems(workCells.filter((w) => w.status !== 'merged'), projectId),
        ...waitingItems(arch, projectId),
      ],
      skills: listSkills(root, dir),
      cost: { today: round6(cost.today), d7: round6(cost.d7), d30: round6(cost.d30) },
      costByDay: dailyCost(allRows, prices),
    },
    rows: allRows,
    commits: memo.activity,
    key: normalizePath(root),
    ownersOf: (files) => ownersOf(files, arch, { topLevel }),
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
    placements: readPlacements(smDir),
  };
  const groups = await groupByRoot(readItems(dir, smDir, now.getTime(), ctx.liveById), ctx.placements);
  const touches = new Map();
  for (const g of groups) for (const item of g.items) touches.set(item.summary.sessionId, touchOf(item, g.root, [dir, smDir]));
  // A repository a conversation edits shows as a project of its own, though no conversation started there.
  const known = new Set(groups.map((g) => normalizePath(g.root)));
  for (const { touch } of touches.values()) {
    for (const [key, t] of touch) {
      if (!t.edited.length || known.has(key) || !isDir(t.root)) continue;
      known.add(key);
      groups.push({ root: t.root, items: [] });
    }
  }
  // One broken project must not blank the page for the others.
  const built = (await Promise.all(groups.map((g) => buildProject(ctx, g).catch((err) => {
    log('warn', 'project-failed', { projectId: projectIdOf(g.root), error: err.message });
    return null;
  })))).filter(Boolean);
  try {
    await hangWorkflows(built, groups, { skip: [dir, smDir], nowMs: now.getTime() });
  } catch (err) {
    log('warn', 'workflows-failed', { error: err.message });
  }
  hangFootprints(built, touches);
  let changes = new Map();
  try {
    changes = await attachChanges({ dir, smDir, now, windowMs: WINDOW_MS, liveById: ctx.liveById }, built, groups);
  } catch (err) {
    log('warn', 'changes-failed', { error: err.message });
  }
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
  Object.defineProperty(state, INTERNALS, { value: { chats: ctx.internals, changes }, enumerable: false });
  return state;
}

export { settleAi } from './ai/life.mjs';
