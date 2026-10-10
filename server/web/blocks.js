// The shapes the panels share (wa06, mm07): a sign that explains itself, and a block of one kind of information.
// ctx: h, icon(name, cls) (may be missing), t (the translator of the moment). The words come from signals.js and kinds.js.
import { signalWords } from './signals.js';
import { KIND_LOOK, kindWords } from './kinds.js';

const mark = (ctx, name, cls) => (ctx.icon ? ctx.icon(name, cls) : null);

// A sign: what it is as the title, then why and what to do, and the buttons that do it. handlers: {actionId: fn}; a button
// whose handler is missing is left out, so a screen that cannot do something never offers it; a handler may be {label, run}
// to word its button for the moment ("Show again"). extra: facts under the words.
export function signalCard(ctx, sig, handlers, extra = []) {
  const { h, t } = ctx;
  const words = signalWords(t, sig);
  const buttons = words.actions.filter((a) => handlers[a.id]);
  const runOf = (a) => handlers[a.id].run ?? handlers[a.id];
  const labelOf = (a) => handlers[a.id].label ?? a.label;
  return h('section', { class: `sig sig-${words.tone}`, role: 'group', 'aria-label': words.what },
    h('div', { class: 'sig-head' }, mark(ctx, words.icon, 'sig-icon'), h('h3', { class: 'sig-what' }, words.what)),
    h('dl', { class: 'sig-words' },
      h('dt', {}, t('sig.label.why')), h('dd', {}, words.why),
      h('dt', {}, t('sig.label.todo')), h('dd', {}, words.todo)),
    ...extra,
    buttons.length ? h('div', { class: 'actions sig-actions' }, buttons.map((a) => h('button', {
      type: 'button', class: `btn${a.primary ? ' primary' : ''}`, 'data-sig-act': a.id, onclick: runOf(a),
    }, labelOf(a)))) : null);
}

// A block of one kind of information: its icon and colour, a plain title and where its data comes from. Null with no
// content, unless empty is given (then it says so).
export function kindBlock(ctx, kind, { title, vars, empty, from } = {}, ...content) {
  const { h, t } = ctx;
  const body = content.flat().filter(Boolean);
  if (!body.length && !empty) return null;
  const words = kindWords(t, kind, vars);
  return h('section', { class: `block kind kind-${kind}` },
    h('h3', { class: 'kind-title' }, mark(ctx, KIND_LOOK[kind].icon, 'kind-icon'), title ?? words.title),
    h('p', { class: 'kind-from' }, from ?? words.from),
    ...(body.length ? body : [h('p', { class: 'muted' }, empty)]));
}

// The small mark of a kind (icon in its colour), for lists and rows that only need to say "this is a conversation".
export const kindMark = (ctx, kind) => ctx.h('span', { class: `kind-mark kind-${kind}`, 'aria-hidden': 'true' }, mark(ctx, KIND_LOOK[kind].icon, 'kind-icon'));

const TAB_KIND = { tasks: 'tasks', chats: 'chats', changes: 'changes', files: 'files' };

// The strip at the top of a box's sheet (mm07): one tab per kind of information, as one tablist with one tab stop (the
// arrows move inside). labels: words a tab takes on this sheet instead of its own ({chats: 'Project chats'}).
export function pointStrip(ctx, tabs, active, onPick, labels = {}) {
  const { h, t } = ctx;
  const markOf = (tab) => (TAB_KIND[tab] ? kindMark(ctx, TAB_KIND[tab])
    : h('span', { class: 'kind-mark kind-neutral', 'aria-hidden': 'true' }, mark(ctx, 'compass', 'kind-icon')));
  return h('div', { class: 'seg ptabs', role: 'tablist', 'aria-label': t('ptab.label') }, tabs.map((tab) => h('button', {
    type: 'button', role: 'tab', id: `ptab-${tab}`, 'data-ptab': tab, class: TAB_KIND[tab] ? `kind-${TAB_KIND[tab]}` : '',
    'aria-selected': String(tab === active), tabindex: tab === active ? '0' : '-1', 'aria-controls': 'pointDetails',
    onclick: () => onPick(tab),
  }, markOf(tab), labels[tab] ?? t(`ptab.${tab}`))));
}
