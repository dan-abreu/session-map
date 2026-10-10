// The seals of the foundation, the same everywhere on screen: the three a claim carries (fd04: confirmed by the code,
// the AI's reading, not found) plus "out of date", and the marks of a checked line (fd07 up to date, fd08 health).
// Anything unknown falls to the weakest seal: nothing is ever shown as confirmed by mistake.

const CLAIM = {
  confirmed: { mark: '✅', key: 'badge.confirmed' },
  interpretation: { mark: '🔍', key: 'badge.interpretation' },
  'not-found': { mark: '❓', key: 'badge.notFound' },
};
const STATE = { confirmed: '✅', pass: '✅', warning: '⚠️', fail: '⚠️', unverified: '❓', na: '➖' };

// claim: a claim of claims.json, or its badge word alone; stale: the ids in model.stale.
export function claimBadge(claim, { stale = [] } = {}) {
  const word = typeof claim === 'string' ? claim : claim?.badge;
  const id = Object.hasOwn(CLAIM, word ?? '') ? word : 'not-found';
  const { mark, key } = CLAIM[id];
  return { id, mark, key, hint: `${key}.hint`, stale: Boolean(claim?.id) && [...stale].includes(claim.id) };
}

// state: an up-to-date line (confirmed warning unverified) or a health item (pass fail unverified na).
export function stateBadge(state) {
  const id = Object.hasOwn(STATE, state ?? '') ? state : 'unverified';
  return { id, mark: STATE[id], key: `mark.${id}`, hint: `mark.${id}.hint` };
}

// The mark is decoration for screen readers; the word says it.
export function badgeNode(h, t, badge) {
  const cls = `fd-badge fd-badge--${badge.id}${badge.stale ? ' fd-badge--stale' : ''}`;
  return h('span', { class: cls, title: t(badge.stale ? 'badge.stale.hint' : badge.hint) },
    h('span', { 'aria-hidden': 'true' }, badge.mark), ' ', t(badge.key), badge.stale ? [' · ', t('badge.stale')] : null);
}
