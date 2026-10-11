// The table of areas: one list that the top bar, the "More" menu, the phone bar, the tour and the tests all read.
// Pure: no DOM. Views are tied to ids elsewhere (areas.js); texts live in i18n-fd/screens-nav.js.

// bar: on the top bar (and the phone's bottom bar); the others wait under "More" (mm47). waitsForPage: left out of the
// bar and of More until the page has a view for it (areas.js ready()), so no menu offers an empty page.
export const AREAS = [
  { id: 'home', scope: 'global', icon: 'home', bar: true },
  { id: 'route', scope: 'project', icon: 'compass', bar: false, waitsForPage: true },
  { id: 'map', scope: 'project', icon: 'map', bar: true },
  { id: 'flow', scope: 'project', icon: 'flow', bar: false },
  { id: 'requests', scope: 'project', icon: 'list', bar: false },
  { id: 'convs', scope: 'project', icon: 'chat', bar: true },
  { id: 'changes', scope: 'project', icon: 'clock', bar: false },
  { id: 'health', scope: 'project', icon: 'check', bar: false },
  { id: 'ideas', scope: 'project', icon: 'idea', bar: false, waitsForPage: true },
  { id: 'costs', scope: 'project', icon: 'coin', bar: false },
  { id: 'library', scope: 'global', icon: 'book', bar: false },
  { id: 'discover', scope: 'global', icon: 'puzzle', bar: false },
];

// The phone's bottom bar: the areas of the top bar and the "More" sheet.
const BOTTOM = AREAS.filter((a) => a.bar).map((a) => a.id);
const FALLBACK = 'map';
// Old view names (saved in sm.view or in links) that became sub-tabs of Conversations.
const ALIASES = { board: { area: 'convs', sub: 'board' }, history: { area: 'convs', sub: 'history' } };

export const modeOf = (tech) => (tech ? 'full' : 'simple');

// One row in both modes (mm47): global/project are the bar (Home · Map · Conversations), more is every other area that has
// a page. Phone: bottom replaces the bar with the same areas, more is the same. ready: areas.js ready(), for the areas
// that wait for a page. tech is the Full switch: on a computer it puts every area that has a page on the bar, so nothing
// waits under More (which stays, for help and Configurações); on a phone the bottom bar is four and More either way.
export function tabsFor({ tech = false, phone = false, ready = {} } = {}) {
  const has = (a) => !a.waitsForPage || ready[a.id] === true;
  const more = AREAS.filter((a) => !a.bar && has(a)).map((a) => a.id);
  if (phone) return { global: [], project: [], more, bottom: [...BOTTOM, 'more'] };
  const shown = (a) => has(a) && (tech || a.bar);
  const pick = (scope) => AREAS.filter((a) => a.scope === scope && shown(a)).map((a) => a.id);
  if (tech) return { global: pick('global'), project: pick('project'), more: [], bottom: [] };
  return { global: pick('global'), project: pick('project'), more, bottom: [] };
}

export function normalizeView(raw) {
  if (typeof raw !== 'string') return { area: FALLBACK, sub: null };
  if (Object.hasOwn(ALIASES, raw)) return { ...ALIASES[raw] };
  return { area: AREAS.some((a) => a.id === raw) ? raw : FALLBACK, sub: null };
}

export const iconsOf = () => Object.fromEntries(AREAS.map((a) => [a.id, a.icon]));
