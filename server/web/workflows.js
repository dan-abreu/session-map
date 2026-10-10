// Workflows you can trace (mind-map-page mm31): the request that launched a team of helpers, the team with its phases,
// each helper with its state and the place it works in, and on the map a dot per helper at work in the team's colour.
// The pure part on top is what node:test loads; workflowView below only builds elements with the h it is given.
import { ancestorsOf, hash } from './tree.js';

const QUIET_MS = 30 * 60_000;

// One colour per workflow, the same on the map, in Live, in the conversation's panel and in Changes. Eight hues far from
// amber and red, which already mean waiting for you and blocked.
const WF_HUES = [190, 215, 240, 265, 290, 315, 340, 125];
const baseHue = (id) => Math.floor(hash(`wf:${id}`) * WF_HUES.length);
let hueOf = new Map();
export const workflowHue = (id) => hueOf.get(id) ?? WF_HUES[baseHue(id)];

// ids, newest first: each team takes its own colour, or the next free one when a newer team already has it.
export function teamHues(ids) {
  const used = new Set();
  const out = new Map();
  for (const id of ids) {
    let i = baseHue(id);
    for (let step = 0; step < WF_HUES.length && used.has(i); step++) i = (i + 1) % WF_HUES.length;
    used.add(i);
    out.set(id, WF_HUES[i]);
  }
  return out;
}

// The page calls this on every new state, so the teams it shows together are drawn apart everywhere.
export function useTeamHues(state) {
  const teams = state.projects.flatMap((p) => (p.chats ?? []).flatMap((c) => c.workflows ?? []));
  teams.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || String(a.id).localeCompare(String(b.id)));
  hueOf = teamHues([...new Set(teams.map((w) => w.id))]);
}

// running: at work now; stopped: no answer and nothing written for half an hour (a killed run leaves these behind).
export function agentTone(a, nowMs) {
  if (a.state === 'done' || a.state === 'failed') return a.state;
  return a.activeAt && nowMs - Date.parse(a.activeAt) > QUIET_MS ? 'stopped' : 'running';
}

export function workflowTone(w, nowMs) {
  if (w.status === 'completed') return 'done';
  if (w.status && w.status !== 'running') return 'failed';
  return (w.agents ?? []).some((a) => agentTone(a, nowMs) === 'running') ? 'running' : 'stopped';
}

// The phase at work (the first with a helper running), else the last that had helpers: {index (from 1), count, title}.
export function phaseNow(w) {
  const phases = w.phases ?? [];
  if (!phases.length) return null;
  let i = phases.findIndex((p) => p.running > 0);
  if (i < 0) i = phases.map((p) => p.total > 0).lastIndexOf(true);
  if (i < 0) i = 0;
  return { index: i + 1, count: phases.length, title: phases[i].title };
}

// Every helper at work whose place is in this project, wherever its conversation lives: box id → [dot]. A file with no box
// on this map puts the dot on the project. Each conversation counts once, at home (visitors repeat it).
export function agentDots(state, project, tree, nowMs) {
  const boxes = new Set();
  const walk = (n) => { boxes.add(n.id); n.children.forEach(walk); };
  walk(tree);
  const out = new Map();
  for (const home of state.projects) {
    for (const chat of home.chats ?? []) {
      for (const w of chat.workflows ?? []) {
        for (const a of w.agents ?? []) {
          if (a.place?.projectId !== project.id || agentTone(a, nowMs) !== 'running') continue;
          const id = a.place.partId && boxes.has(`pt:${a.place.partId}`) ? `pt:${a.place.partId}` : tree.id;
          const dot = {
            agentId: a.id, label: a.label, model: a.model, step: a.step ?? null, path: a.place.path,
            workflowId: w.id, workflowName: w.name, hue: workflowHue(w.id), chatTitle: chat.title, sessionId: chat.sessionId, projectId: home.id,
          };
          out.set(id, [...(out.get(id) ?? []), dot]);
        }
      }
    }
  }
  return out;
}

// The dots of a box hidden under a closed one go to the deepest box the map shows on its way.
export function dotsAt(isOpen, dots, tree) {
  const out = new Map();
  for (const [id, list] of dots) {
    const path = [...ancestorsOf(tree, id), id];
    let at = path.length - 1;
    for (let i = 0; i < path.length - 1; i++) {
      if (!isOpen(path[i])) { at = i; break; }
    }
    const shown = path[at];
    out.set(shown, [...(out.get(shown) ?? []), ...list]);
  }
  return out;
}

// ---- the tree: request → team → helpers → where they work ------------------------------------------

const ORDER = { running: 0, stopped: 1, failed: 2, done: 3 };
const DONE_SHOWN = 3;

// ctx: h, t (translator), icon(name, cls), relative(iso), ctx.modelName(model), ctx.stepWords(step), ctx.placeWords({projectId, partId,
// path}) → 'project › part', nowMs, onItem(item) (the map item the request names), onFile(file) (a file the team made).
// opts.compact: only the helpers at work and the counts (Live); otherwise every helper with its files and commits.
// opts.onDetails: a button to the whole trace (the conversation's panel), for the compact tree.
export function workflowView(ctx, w, { compact = false, onDetails = null } = {}) {
  const { h, t, icon } = ctx;
  const tone = workflowTone(w, ctx.nowMs);
  const phase = phaseNow(w);
  const total = Math.max(w.total ?? 0, w.started ?? 0, 1);
  const agents = [...(w.agents ?? [])].map((a) => ({ a, tone: agentTone(a, ctx.nowMs) })).sort((x, y) => ORDER[x.tone] - ORDER[y.tone]);
  const atWork = agents.filter((x) => x.tone === 'running' || x.tone === 'stopped');
  const finished = agents.filter((x) => x.tone === 'done' || x.tone === 'failed');

  const request = w.request
    ? h('div', { class: 'wf-ask' },
      h('p', { class: 'wf-ask-head' }, icon('chat', 'wf-ask-icon'), h('span', { class: 'wf-ask-label' }, t('wf.request')), w.request.ts ? h('span', { class: 'wf-ask-when num' }, ctx.relative(w.request.ts)) : null),
      h('p', { class: 'wf-ask-text' }, w.request.text),
      w.request.item ? h('button', { type: 'button', class: 'wf-item', onclick: () => ctx.onItem?.(w.request.item) }, icon('map', 'wf-item-icon'), t('wf.item', { place: ctx.placeWords({ projectId: w.request.item.projectId, partId: w.request.item.partId }), code: w.request.item.code })) : null)
    : h('p', { class: 'wf-ask is-none' }, t('wf.requestNone'));

  const phases = w.phases?.length ? h('ol', { class: 'wf-phases', 'aria-label': t('wf.phases') }, w.phases.map((p, i) => {
    const state = p.running > 0 ? 'is-now' : p.total > 0 && p.done + p.failed >= p.total ? 'is-done' : '';
    return h('li', { class: `wf-phase ${state}`, title: t('wf.phaseTitle', { title: p.title, done: p.done, total: p.total }) },
      h('span', { class: 'wf-phase-n num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'wf-phase-name' }, p.title),
      p.total ? h('span', { class: 'wf-phase-count num' }, `${p.done}/${p.total}`) : null);
  })) : null;

  const commitView = (c) => h('li', { class: 'wf-commit' }, icon('commit', 'wf-commit-icon'), h('span', { class: 'wf-commit-subject' }, c.subject),
    h('span', { class: `wf-release${c.tag ? ' is-released' : ''}` }, c.tag ? t('wf.releasedIn', { tag: c.tag }) : t('wf.saved')));
  const fileView = (f) => h('li', {}, h('button', { type: 'button', class: 'wf-file', onclick: () => ctx.onFile?.(f) },
    icon('file', 'wf-file-icon'), h('span', { class: 'wf-file-path' }, f.path), h('span', { class: 'wf-file-where' }, ctx.placeWords(f))));

  function agentView({ a, tone: aTone }) {
    const step = aTone === 'running' && a.step ? ctx.stepWords(a.step) : '';
    return h('li', { class: `wf-agent at-${aTone}` },
      h('div', { class: 'wf-agent-head' },
        h('span', { class: `wf-state st-${aTone}` }, h('span', { class: 'wf-state-dot', 'aria-hidden': 'true' }), t(`wf.agent.${aTone}`)),
        h('span', { class: 'wf-agent-label' }, a.label || t('live.agentUnnamed')),
        a.model ? h('span', { class: 'wf-agent-model' }, ctx.modelName(a.model)) : null),
      a.place ? h('p', { class: 'wf-agent-place' }, icon('map', 'wf-place-icon'), h('span', {}, [ctx.placeWords(a.place), a.place.path].filter(Boolean).join(' › '))) : null,
      step ? h('p', { class: 'wf-agent-step' }, step) : null,
      !compact && a.files?.length ? h('details', { class: 'wf-files' }, h('summary', {}, t.count('wf.files', a.fileCount ?? a.files.length)),
        h('ul', { class: 'plain' }, a.files.map(fileView)), a.fileCount > a.files.length ? h('p', { class: 'muted small' }, t('wf.filesMore', { n: a.fileCount - a.files.length })) : null) : null,
      !compact && a.commits?.length ? h('ul', { class: 'plain wf-commits', 'aria-label': t('wf.commits') }, a.commits.map(commitView)) : null);
  }

  const shownDone = compact ? [] : finished.slice(0, DONE_SHOWN);
  // Live counts only the helpers that finished well; the ones that failed have their own line.
  const restDone = compact ? finished.filter((x) => x.tone === 'done') : finished.slice(DONE_SHOWN);
  const where = (w.places ?? []).length ? h('p', { class: 'wf-where' }, icon('connect', 'wf-where-icon'),
    h('span', {}, t('wf.where', { places: ctx.list(w.places.map((p) => `${p.name} (${t.count('wf.filesShort', p.files)})`)) }))) : null;

  return h('section', { class: `wf tone-${tone}`, style: `--wf-h:${workflowHue(w.id)}`, 'data-workflow': w.id, 'aria-label': t('wf.aria', { name: w.name }) },
    request,
    h('div', { class: 'wf-team' },
      h('div', { class: 'wf-head' },
        h('span', { class: 'wf-swatch', 'aria-hidden': 'true' }),
        h('span', { class: 'wf-name' }, w.name),
        h('span', { class: `wf-tone st-${tone}` }, t(`wf.tone.${tone}`)),
        h('span', { class: 'wf-n num', title: t('live.agentsDone', { done: w.done, total }) }, `${w.done}/${total}`)),
      h('span', { class: 'wf-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((w.done / total) * 100)}%` })),
      phase ? h('p', { class: 'wf-phase-now' }, t('wf.phaseNow', { index: phase.index, count: phase.count, title: phase.title })) : null,
      phases,
      atWork.length || shownDone.length ? h('ul', { class: 'wf-agents', 'aria-label': t('wf.agents') }, [...atWork, ...shownDone].map(agentView)) : null,
      restDone.length ? (compact
        ? h('p', { class: 'wf-rest muted small' }, t.count('wf.finished', restDone.length))
        : h('details', { class: 'wf-more' }, h('summary', {}, t.count('wf.finished', restDone.length)), h('ul', { class: 'wf-agents' }, restDone.map(agentView)))) : null,
      w.failed ? h('p', { class: 'wf-failed' }, t.count('wf.failedCount', w.failed)) : null,
      where,
      onDetails ? h('button', { type: 'button', class: 'btn small-btn wf-details', onclick: onDetails }, t('wf.details')) : null));
}
