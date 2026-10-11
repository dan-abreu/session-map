// The project's orchestrator on the page (or01, or03, or18): what the root box says of it, and the block in the project's
// panel that opens it and holds the "Organizar sozinho" switch. Pure builders (they take h, icon and t), so node:test loads them.
import { activityOf, orchestratorOf } from './convlist.js';

// row: the project's orchestrator conversation or null; total/working: the chats it opened and how many work now;
// tidy: the switch (off unless the state says on, as in a server that does not send it yet).
export function orchState(project) {
  const row = orchestratorOf(project);
  const kids = activityOf(project, row);
  return { row, total: kids.length, working: kids.filter((r) => r.status === 'busy').length, tidy: project.tidy === true };
}

// The root box: a small mark, with the count when some of its chats work. The box opens the panel with the real controls.
export function orchChip({ h, icon, t }, st) {
  return h('span', { class: `bx-chip is-orch${st.working ? ' is-working' : ''}`, title: t('orch.chipTitle') },
    icon('auto', 'bx-chip-icon'), st.working ? t('now.orchestra', { n: st.working }) : t('orch.name'));
}

const lede = (t, st) => (!st.row ? t('orch.noneText') : st.working ? t.count('orch.working', st.working) : t('orch.idleText'));

// The block of the project's panel: what it is, the button to open (or start) it, and the switch with its reason in words.
// handlers: onOpen(), onTidy(on, input).
export function orchSection({ h, icon, t }, st, { onOpen, onTidy }) {
  return h('section', { class: 'orch-block' },
    h('h3', { class: 'orch-title' }, icon('auto', 'orch-icon'), t('orch.name')),
    h('p', { class: 'orch-lede' }, lede(t, st)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: st.row ? 'btn' : 'btn primary', 'data-orch': 'open', onclick: onOpen }, t(st.row ? 'orch.open' : 'orch.start'))),
    h('label', { class: 'orch-switch' },
      h('input', { type: 'checkbox', checked: st.tidy, 'data-orch': 'tidy', onchange: (e) => onTidy(e.currentTarget.checked, e.currentTarget) }),
      h('span', { class: 'run-option-text' }, h('span', { class: 'run-option-name' }, t('orch.tidy')), h('span', { class: 'run-hint' }, t('orch.tidyHint')))));
}
