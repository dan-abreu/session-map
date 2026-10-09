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
