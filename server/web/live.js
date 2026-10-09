// "Live" (plano-v02, v0.2.2 item 9): what every conversation is doing right now, the way down the map to the box it works
// on, and the panel that lists it all. The pure part on top is what node:test loads; createLivePanel touches the DOM only
// when called. Only step words cross here (never a file's contents or a command's output): the server already cut them.
import { emptyState } from './empty.js';
import { archTree, ancestorsOf } from './tree.js';
import { nodeOfConversation, placeOf, visitorsOf } from './convlist.js';

const newest = (a, b) => String(b.chat.updatedAt ?? '').localeCompare(String(a.chat.updatedAt ?? ''));

const QUIET_MS = 30 * 60_000;

// The agents of a workflow still working: no result yet, and their transcript moved in the last half hour (a workflow that
// was killed leaves agents without a result behind). A server older than the running list sends only the numbers.
function runningOf(w, nowMs) {
  if (!Array.isArray(w.running)) return w.done < w.started ? [] : null;
  const moving = w.running.filter((a) => !a.activeAt || nowMs - Date.parse(a.activeAt) <= QUIET_MS);
  return moving.length ? moving : null;
}

// A conversation's workflows that still have agents running, each with those agents.
export const runningWorkflows = (chat, nowMs) => (chat.workflows ?? []).flatMap((w) => {
  const running = runningOf(w, nowMs);
  return running ? [{ ...w, running }] : [];
});

// The conversations working now in one project, newest first: {project, chat, nodeId, pathIds (project → tip), place,
// steps (newest first), lastStep, workflows (only the ones still running, with their running agents)}. nowMs: the state's time.
// The tip is the part of the file in the latest step when that is not the conversation's own part (mm24); visitors: the
// conversations born elsewhere that work here too, for the map (the Live panel lists each once, at home).
export function workingIn(project, tree, nowMs = Date.now(), { visitors = false } = {}) {
  const points = new Map((project.conversations ?? []).map((r) => [r.sessionId, r.node ?? null]));
  return [...project.chats, ...(visitors ? visitorsOf(project) : [])]
    .filter((c) => c.status === 'busy' && !c.archived)
    .map((chat) => {
      const moved = Boolean(chat.stepPartId) && chat.stepPartId !== chat.partId;
      const row = moved
        ? { partId: chat.stepPartId, itemCode: null, node: null }
        : { partId: chat.partId, itemCode: chat.itemCode ?? null, node: points.get(chat.sessionId) ?? null };
      const nodeId = nodeOfConversation(tree, row);
      const steps = [...(chat.liveSteps ?? [])].reverse();
      return {
        project, chat, nodeId,
        pathIds: [...ancestorsOf(tree, nodeId), nodeId],
        place: placeOf(tree, row),
        steps,
        lastStep: steps[0] ?? null,
        workflows: runningWorkflows(chat, nowMs),
      };
    })
    .sort(newest);
}

// The panel's groups: every project with something working, the open one first.
export function liveWork(state, { projectId }) {
  const groups = state.projects
    .map((project) => ({ project, entries: workingIn(project, archTree(project), Date.parse(state.generatedAt)) }))
    .filter((g) => g.entries.length)
    .sort((a, b) => (b.project.id === projectId) - (a.project.id === projectId));
  return { groups, total: groups.reduce((n, g) => n + g.entries.length, 0) };
}

// nodes: every box on the way to a tip (they glow, and so do the curves between them); tips: tip → its conversations.
export function livePaths(entries) {
  const nodes = new Set();
  const tips = new Map();
  for (const e of entries) {
    for (const id of e.pathIds) nodes.add(id);
    tips.set(e.nodeId, [...(tips.get(e.nodeId) ?? []), e]);
  }
  return { nodes, tips };
}

// Where the captions go: a tip behind a closed box captions the deepest box the map shows on its way. Each caption names
// the newest conversation there, how many more work under it, and whether the box is the tip itself.
export function captionsAt(isOpen, entries) {
  const out = new Map();
  for (const e of entries) {
    let at = e.pathIds.length - 1;
    for (let i = 0; i < e.pathIds.length - 1; i++) {
      if (!isOpen(e.pathIds[i])) { at = i; break; }
    }
    const id = e.pathIds[at];
    const cur = out.get(id);
    if (cur) cur.more += 1;
    else out.set(id, { entry: e, more: 0, exact: id === e.nodeId });
  }
  return out;
}

// 'sonnet' → 'Sonnet', 'claude-opus-5-5' → 'Opus 5.5', 'opus[1m]' → 'Opus 1M'; a name it does not know stays as written.
const MODEL_ID = /^(?:claude-)?([a-z]+)(?:-(\d+)(?:-(\d{1,2}))?)?(?:-\d{8})?(\[1m\])?$/i;
export function modelName(model) {
  if (typeof model !== 'string') return null;
  const m = MODEL_ID.exec(model);
  if (!m || (!m[2] && model.startsWith('claude-'))) return model;
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const version = m[2] ? ` ${m[2]}${m[3] ? `.${m[3]}` : ''}` : '';
  return `${name}${version}${m[4] ? ' 1M' : ''}`;
}

// ---- the panel ----------------------------------------------------------------------------------

const STEP_KINDS = new Set(['edit', 'read', 'run', 'search', 'web', 'agent', 'skill', 'plan', 'ask', 'think', 'tool']);

// The words of one step, in the page's language; a kind this page does not know yet says nothing rather than a raw name.
export const stepWords = (t, step) => (step && STEP_KINDS.has(step.kind) ? t(`live.step.${step.kind}`, { target: step.target }) : '');

// The place of an entry in words: the way down the map, or what kind of point it is when it is not a box.
export const placeWords = (t, place) => (place.special ? t(`convs.place.${place.special}`) : place.path.join(' › '));

// ctx: root (the sheet), button (the toolbar button), h, t (translator getter), icon(name, cls), relative(iso), state(),
// project(), onShow(entry), onOpen(entry). The page decides when it opens and closes; render() keeps both up to date.
export function createLivePanel(ctx) {
  const { root, button, h, icon } = ctx;
  const body = root.querySelector('[data-live="body"]');
  const sub = root.querySelector('[data-live="sub"]');
  const label = button.querySelector('[data-live="label"]');
  const count = button.querySelector('[data-live="count"]');

  function stepsView(entry) {
    const tt = ctx.t();
    if (!entry.steps.length) return h('p', { class: 'lv-nosteps' }, tt('live.noSteps'));
    return h('ol', { class: 'lv-steps', 'aria-label': tt('live.steps') }, entry.steps.map((s, i) => h('li', { class: `lv-step${i === 0 ? ' is-now' : ''}` },
      h('span', { class: 'lv-step-text' }, stepWords(tt, s)),
      s.ts ? h('span', { class: 'lv-step-when num' }, ctx.relative(s.ts)) : null)));
  }

  function agentsView(entry) {
    if (!entry.workflows.length) return null;
    const tt = ctx.t();
    return h('div', { class: 'lv-agents' }, entry.workflows.map((w) => h('div', { class: 'lv-wf' },
      h('p', { class: 'lv-wf-head' }, icon('auto', 'lv-wf-icon'), h('span', { class: 'lv-wf-name' }, w.name),
        h('span', { class: 'lv-wf-n num', title: tt('live.agentsDone', { done: w.done, total: w.started }) }, `${w.done}/${w.started}`)),
      h('span', { class: 'lv-wf-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((w.done / Math.max(1, w.started)) * 100)}%` })),
      w.running.length ? h('ul', { class: 'lv-wf-agents', 'aria-label': tt('live.agentsRunning') }, w.running.map((a) => h('li', {},
        h('span', { class: 'lv-agent-label' }, a.label || tt('live.agentUnnamed')),
        a.model ? h('span', { class: 'lv-agent-model' }, modelName(a.model)) : null))) : null)));
  }

  function card(entry) {
    const tt = ctx.t();
    const { chat } = entry;
    const title = chat.title || tt('chat.untitled');
    const when = entry.lastStep?.ts ?? chat.updatedAt;
    const asks = entry.lastStep?.kind === 'ask';
    return h('li', { class: `lv-card${asks ? ' is-asking' : ''}`, 'data-session': chat.sessionId },
      h('div', { class: 'lv-head' },
        h('span', { class: 'lv-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'lv-title' }, title),
        when ? h('span', { class: 'lv-when num' }, ctx.relative(when)) : null),
      h('p', { class: `lv-path${entry.place.special ? ` is-${entry.place.special}` : ''}` }, placeWords(tt, entry.place)),
      stepsView(entry),
      agentsView(entry),
      h('div', { class: 'lv-actions' },
        h('button', { type: 'button', class: 'btn small-btn', 'data-act': 'show', onclick: () => ctx.onShow(entry) }, icon('map', 'btn-icon'), tt('live.show')),
        h('button', { type: 'button', class: 'btn small-btn primary', 'data-act': 'open', onclick: () => ctx.onOpen(entry) }, icon('chat', 'btn-icon'), tt('live.open'))));
  }

  function render() {
    const s = ctx.state();
    const p = ctx.project();
    if (!s || !p) return;
    const tt = ctx.t();
    const out = liveWork(s, { projectId: p.id });
    label.textContent = tt('live.button');
    count.textContent = String(out.total);
    button.classList.toggle('is-zero', out.total === 0);
    button.setAttribute('aria-label', tt.count('live.buttonAria', out.total));
    if (root.hidden) return;
    sub.textContent = out.total ? tt('live.sub') : '';
    // A poll redraws the list every few seconds: keep the scroll and the button the person is on.
    const focused = body.contains(document.activeElement) ? document.activeElement : null;
    const keep = focused ? { session: focused.closest('[data-session]')?.dataset.session, act: focused.dataset.act } : null;
    const top = body.scrollTop;
    const several = out.groups.length > 1 || out.groups.some((g) => g.project.id !== p.id);
    body.replaceChildren(...(out.total ? out.groups.map((g) => h('section', { class: 'lv-group', 'aria-label': g.project.name },
      several ? h('h3', { class: 'lv-group-name' }, g.project.name, h('span', { class: 'lv-group-n num' }, String(g.entries.length))) : null,
      h('ul', { class: 'lv-cards' }, g.entries.map(card)))) : [emptyState({ h, icon }, { art: 'chat', title: tt('live.emptyTitle'), text: tt('live.empty') })]));
    body.scrollTop = top;
    if (keep?.session) body.querySelector(`[data-session="${CSS.escape(keep.session)}"] [data-act="${keep.act}"]`)?.focus({ preventScroll: true });
  }

  function open() {
    root.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    render();
    requestAnimationFrame(() => (body.querySelector('button') ?? root.querySelector('[data-close="live"]')).focus({ preventScroll: true }));
  }

  function close() {
    if (root.hidden) return;
    const inside = root.contains(document.activeElement);
    root.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (inside) button.focus({ preventScroll: true });
  }

  return { render, open, close, isOpen: () => !root.hidden };
}
