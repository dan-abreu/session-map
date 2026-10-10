// The table of areas: one list that the top bar, the "More" menu, the phone bar, the tour and the tests all read.
// Pure: no DOM. Views are tied to ids elsewhere (areas.js); texts live in i18n-fd/screens-nav.js.

export const AREAS = [
  { id: 'home', scope: 'global', icon: 'home', simple: true },
  { id: 'route', scope: 'project', icon: 'compass', simple: true },
  { id: 'map', scope: 'project', icon: 'map', simple: true },
  { id: 'flow', scope: 'project', icon: 'flow', simple: false },
  { id: 'requests', scope: 'project', icon: 'list', simple: false },
  { id: 'convs', scope: 'project', icon: 'chat', simple: true },
  { id: 'changes', scope: 'project', icon: 'clock', simple: false },
  { id: 'health', scope: 'project', icon: 'check', simple: false },
  { id: 'ideas', scope: 'project', icon: 'idea', simple: true },
  { id: 'costs', scope: 'project', icon: 'coin', simple: false },
  { id: 'library', scope: 'global', icon: 'book', simple: false },
  { id: 'discover', scope: 'global', icon: 'puzzle', simple: false },
];

// The phone's bottom bar: four areas and the "More" sheet, in both modes.
const BOTTOM = ['home', 'route', 'map', 'convs'];
const FALLBACK = 'map';
// Old view names (saved in sm.view or in links) that became sub-tabs of Conversations.
const ALIASES = { board: { area: 'convs', sub: 'board' }, history: { area: 'convs', sub: 'history' } };

export const modeOf = (tech) => (tech ? 'full' : 'simple');

// Desktop: global/project are the bar, more is what the mode hides. Phone: bottom replaces the bar and more is every
// other area, so no area is out of reach in any mode.
export function tabsFor({ tech = false, phone = false } = {}) {
  if (phone) {
    return { global: [], project: [], more: AREAS.filter((a) => !BOTTOM.includes(a.id)).map((a) => a.id), bottom: [...BOTTOM, 'more'] };
  }
  const shown = (a) => tech || a.simple;
  const pick = (scope) => AREAS.filter((a) => a.scope === scope && shown(a)).map((a) => a.id);
  return { global: pick('global'), project: pick('project'), more: AREAS.filter((a) => !shown(a)).map((a) => a.id), bottom: [] };
}

export function normalizeView(raw) {
  if (typeof raw !== 'string') return { area: FALLBACK, sub: null };
  if (Object.hasOwn(ALIASES, raw)) return { ...ALIASES[raw] };
  return { area: AREAS.some((a) => a.id === raw) ? raw : FALLBACK, sub: null };
}

export const iconsOf = () => Object.fromEntries(AREAS.map((a) => [a.id, a.icon]));
