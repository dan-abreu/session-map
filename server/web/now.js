// Every job on the PC, whatever project the page has open (mm09): the project picker's badges (mm10), the tab title and
// the one count of what needs the person (needsYou, mm47). The Now strip that showed them left the page with mm47; the
// inbox shows its groups. Pure, so node:test loads it.
import { archTree } from './tree.js';
import { nodeOfConversation, placeOf, projectHue, workWords, orchestratorOf, activityOf } from './convlist.js';
import { runningWorkflows } from './live.js';
import { workflowHue } from './workflows.js';

const DAY_MS = 86_400_000;
const KIND_ORDER = { waiting: 0, working: 1, finished: 2 };

const asksFor = (w) => Boolean(w.strong || w.weak || w.items.length);
const newest = (a, b) => String(b.chat.updatedAt ?? '').localeCompare(String(a.chat.updatedAt ?? ''));

// A question left in a closed conversation days ago is history, not a job: it waits only while open or for a day.
function kindOf(chat, unseen, nowMs) {
  if (chat.archived) return null;
  const fresh = chat.live || nowMs - Date.parse(chat.updatedAt ?? '') <= DAY_MS;
  if (fresh && (chat.status === 'busy' ? chat.waiting.strong : asksFor(chat.waiting))) return 'waiting';
  if (chat.status === 'busy') return 'working';
  return unseen.has(chat.sessionId) ? 'finished' : null;
}

const NO_UNSEEN = new Set();

// What needs the person (mm47): every conversation of every project waiting for them now, by the rule of kindOf. The one
// count of the page: the amber pill, the head of the waiting list it opens and the inbox's "Needs you" all read it.
// Each entry: {project, chat}.
export function needsYou(state, { nowMs = Date.parse(state.generatedAt) } = {}) {
  const out = [];
  for (const project of state.projects) {
    for (const chat of project.chats) if (kindOf(chat, NO_UNSEEN, nowMs) === 'waiting') out.push({ project, chat });
  }
  return out;
}

// The activity chats each project's orchestrator has working now (or03): {working, projects [{id, name, hue, working}]}.
function orchestraOf(state) {
  const projects = [];
  for (const project of state.projects) {
    const working = activityOf(project, orchestratorOf(project)).filter((r) => r.status === 'busy').length;
    if (working) projects.push({ id: project.id, name: project.name, hue: projectHue(project), working });
  }
  return { working: projects.reduce((n, p) => n + p.working, 0), projects };
}

// Never takes the open project: the strip reads the same with any project selected (mm09).
// Each card: {kind, project, hue, chat, nodeId, place, lastStep, work (born in · working in, mm24), origin, model,
// helpers {done, total} | null, teams [{id, name}] (each team still at work, mm37), since}.
export function nowJobs(state, { unseen = new Set(), nowMs = Date.parse(state.generatedAt) } = {}) {
  const cards = [];
  for (const project of state.projects) {
    let tree = null;
    const rows = new Map((project.conversations ?? []).map((r) => [r.sessionId, r]));
    for (const chat of project.chats) {
      const kind = kindOf(chat, unseen, nowMs);
      if (!kind) continue;
      tree ??= archTree(project);
      const listed = rows.get(chat.sessionId);
      const row = { partId: chat.partId, itemCode: chat.itemCode ?? null, node: listed?.node ?? null };
      const workflows = runningWorkflows(chat, nowMs);
      const lastStep = chat.liveSteps?.at(-1) ?? null;
      cards.push({
        kind, project, hue: projectHue(project), chat,
        nodeId: nodeOfConversation(tree, row),
        place: placeOf(tree, row),
        lastStep,
        work: workWords(chat, project),
        origin: listed?.origin ?? null,
        model: chat.model ?? null,
        teams: workflows.map((w) => ({ id: w.id, name: w.name })),
        helpers: workflows.length ? { done: workflows.reduce((n, w) => n + w.done, 0), total: workflows.reduce((n, w) => n + w.started, 0) } : null,
        since: kind === 'working' ? chat.turnStartedAt ?? lastStep?.ts ?? chat.updatedAt : chat.updatedAt,
      });
    }
  }
  cards.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || newest(a, b));
  const count = (kind) => cards.filter((c) => c.kind === kind).length;
  return { cards, counts: { working: count('working'), waiting: count('waiting'), finished: count('finished') }, orchestra: orchestraOf(state) };
}

// projectId → {working, waiting, finished}: the marks next to each project in the picker.
export function jobBadges(jobs) {
  const out = new Map();
  for (const c of jobs.cards) {
    const b = out.get(c.project.id) ?? { working: 0, waiting: 0, finished: 0 };
    b[c.kind] += 1;
    out.set(c.project.id, b);
  }
  return out;
}

// What needs the person: the number in the tab title, like "(2) session-map".
export const pendingCount = (jobs) => jobs.counts.waiting + jobs.counts.finished;

// statuses: sessionId → status at the last look. A conversation that stopped working since then is "finished and not seen"
// until it is opened; one that works again drops the mark. The first look marks nothing.
export function nextUnseen(statuses, state, unseen) {
  const next = new Map();
  const out = new Set(unseen);
  for (const project of state.projects) {
    for (const c of project.chats) {
      next.set(c.sessionId, c.status);
      if (c.status === 'busy') out.delete(c.sessionId);
      else if (statuses.get(c.sessionId) === 'busy') out.add(c.sessionId);
    }
  }
  return { statuses: next, unseen: out };
}

// The strip folded to one line: "3 working · 2 waiting for you · 1 finished".
export function nowLine(t, counts) {
  const parts = ['working', 'waiting', 'finished'].filter((k) => counts[k] > 0).map((k) => t(`now.${k}`, { n: counts[k] }));
  return parts.length ? parts : [t('now.nothing')];
}

// "Orchestrator: 3 working", with the projects in its tooltip when more than one has an orchestrator at work; null when none does.
export function orchestraLine(t, orchestra) {
  if (!orchestra?.working) return null;
  const where = orchestra.projects.map((p) => `${p.name}: ${p.working}`).join(', ');
  return { text: t('now.orchestra', { n: orchestra.working }), title: t('now.orchestraTitle', { where }) };
}

// One dot per team of helpers at work on the card, each in the team's colour (the same one the map and Live use, mm37).
// ctx: h, t (with t.count). null when no team works.
export function teamDots({ h, t }, teams) {
  if (!teams.length) return null;
  return h('span', { class: 'now-teams', role: 'img', 'aria-label': t.count('now.teamsAria', teams.length) },
    teams.map((team) => h('span', { class: 'now-team-dot', style: `--wf-h:${workflowHue(team.id)}`, title: t('now.teamDotTitle', { team: team.name }) })));
}
