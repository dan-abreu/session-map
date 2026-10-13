// The project's orchestrator on the page (or01, or03, or18): what the root box says of it, and the block in the project's
// panel that opens it and holds the "Organizar sozinho" switch. Pure builders (they take h, icon and t), so node:test loads them.
import { activityOf, orchestratorOf } from './convlist.js';

// row: the project's orchestrator conversation or null; total/working: the chats it opened and how many work now;
// tidy: the switch (off unless the state says on, as in a server that does not send it yet); next: the priority line
// (or08), what waits to start, highest first.
export function orchState(project) {
  const row = orchestratorOf(project);
  const kids = activityOf(project, row);
  const next = (Array.isArray(project.orchQueue) ? project.orchQueue : []).filter((p) => p && typeof p.code === 'string');
  return { row, total: kids.length, working: kids.filter((r) => r.status === 'busy').length, tidy: project.tidy === true, next };
}

// The four priorities, highest first, and what the person may choose for a waiting piece (or08).
export const PRIORITIES = ['urgent', 'important', 'normal', 'polish'];
const NEXT_SHOWN = 5;
const WHYS = new Set(['place', 'day', 'near-budget', 'near-weekly', 'polish', 'paused']);

// "A seguir": the pieces waiting to start, each with its priority, its item, why it waits and a choice to change it.
// onPriority(code, value, select): value is one of PRIORITIES, or 'drop' to take it out of the line.
export function nextList({ h, t }, next, { onPriority }) {
  if (!next.length) return null;
  const rowOf = (piece) => {
    const prio = PRIORITIES.includes(piece.priority) ? piece.priority : 'normal';
    const name = piece.title || piece.code;
    return h('li', { class: `orch-next-row is-${prio}`, 'data-code': piece.code },
      h('span', { class: `orch-prio is-${prio}` }, t(`orch.prio.${prio}`)),
      h('span', { class: 'orch-next-text' },
        h('span', { class: 'orch-next-name' }, name),
        WHYS.has(piece.why) ? h('span', { class: 'run-hint' }, t(`orch.why.${piece.why}`)) : null),
      h('select', {
        class: 'orch-next-pick', 'aria-label': t('orch.prio.label', { name }), 'data-orch': 'priority',
        onchange: (e) => onPriority(piece.code, e.currentTarget.value, e.currentTarget),
      }, ...[...PRIORITIES, 'drop'].map((v) => h('option', { value: v, selected: v === prio }, t(`orch.prio.${v}`)))));
  };
  const more = next.length - NEXT_SHOWN;
  return h('div', { class: 'orch-next' },
    h('h4', { class: 'orch-next-title' }, t('orch.next.title')),
    h('ol', { class: 'plain orch-next-rows' }, next.slice(0, NEXT_SHOWN).map(rowOf)),
    more > 0 ? h('p', { class: 'run-hint' }, t.count('orch.next.more', more)) : null);
}

// The root box: a small mark, with the count when some of its chats work. The box opens the panel with the real controls.
export function orchChip({ h, icon, t }, st) {
  return h('span', { class: `bx-chip is-orch${st.working ? ' is-working' : ''}`, title: t('orch.chipTitle') },
    icon('auto', 'bx-chip-icon'), st.working ? t('now.orchestra', { n: st.working }) : t('orch.name'));
}

const lede = (t, st) => (!st.row ? t('orch.noneText') : st.working ? t.count('orch.working', st.working) : t('orch.idleText'));

// The block of the project's panel: what it is, the button to open (or start) it, and the switch with its reason in words.
// handlers: onOpen(), onTidy(on, input), onPriority(code, value, select).
export function orchSection({ h, icon, t }, st, { onOpen, onTidy, onPriority = () => {} }) {
  return h('section', { class: 'orch-block' },
    h('h3', { class: 'orch-title' }, icon('auto', 'orch-icon'), t('orch.name')),
    h('p', { class: 'orch-lede' }, lede(t, st)),
    nextList({ h, t }, st.next ?? [], { onPriority }),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: st.row ? 'btn' : 'btn primary', 'data-orch': 'open', onclick: onOpen }, t(st.row ? 'orch.open' : 'orch.start'))),
    h('label', { class: 'orch-switch' },
      h('input', { type: 'checkbox', checked: st.tidy, 'data-orch': 'tidy', onchange: (e) => onTidy(e.currentTarget.checked, e.currentTarget) }),
      h('span', { class: 'run-option-text' }, h('span', { class: 'run-option-name' }, t('orch.tidy')), h('span', { class: 'run-hint' }, t('orch.tidyHint')))));
}
