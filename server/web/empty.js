import { iconsOf } from './nav.js';
// The empty screen every list shares (mm08): a small drawing, one title, one sentence that says what to do, and the
// button that gets out of it when there is one. ctx: h, icon(name, cls) (may be missing). art: a sprite icon name.
export function emptyState(ctx, { art, title, text, action = null, compact = false }) {
  const { h, icon } = ctx;
  return h('div', { class: compact ? 'empty-state is-compact' : 'empty-state' },
    h('div', { class: 'empty-art', 'aria-hidden': 'true' }, h('span', { class: 'empty-card' }), icon ? icon(art, 'empty-icon') : null),
    h('h3', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    action ? h('button', { type: 'button', class: 'btn primary empty-action', onclick: action.run }, action.label) : null);
}

// An area whose view is not registered yet (areas.js): say what it will hold and that it arrives in the next version.
// ctx also needs t. The drawing is the area's own icon from the table in nav.js.
export function buildingState(ctx, { area }) {
  const { t } = ctx;
  return emptyState(ctx, { art: iconsOf()[area] ?? 'clock', title: t(`tab.${area}`), text: `${t(`soon.${area}.what`)} ${t('nav.soon')}` });
}
