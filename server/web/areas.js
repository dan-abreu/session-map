// The registry (fd10, D2): the one place that ties an area of the table (nav.js) to the view that draws it. Each block
// hands over createXView(ctx); this file hangs it here, one line per area. An area with no view yet shows "being built"
// in its place, so it never disappears from the page.
import { AREAS } from './nav.js';
import { buildingState } from './empty.js';
import { createHomeView } from './homeview.js';
import { createBrainView } from './brainview.js';
import { createLogsView } from './logsview.js';
import { createHealthArea, createIdeasArea, createLibraryArea, createRouteArea } from './foundationareas.js';

// Views made here from their own ctx (ctx[id]); the page's older views (map, flow, convs...) arrive ready in ctx.own.
// Route, Health, Ideas and Library (blocks B3 to B6) are hung here by foundationareas.js (fd22): the Foundation's screens.
const MADE = {
  home: (c) => createHomeView(c),
  brain: (c) => createBrainView(c),
  logs: (c) => createLogsView(c),
  health: (c) => createHealthArea(c),
  route: (c) => createRouteArea(c),
  ideas: (c) => createIdeasArea(c),
  library: (c) => createLibraryArea(c),
};

export const sectionOf = (id) => `view-${id}`;

// ctx: h, icon, t (getter of the translator), own ({ id: { render(root, sub), refresh(root, sub) } }), and one ctx per
// view of MADE (ctx.home...). A view of MADE without its ctx counts as not there.
export function createAreas(ctx) {
  const views = new Map();
  for (const { id } of AREAS) {
    const view = ctx.own?.[id] ?? (MADE[id] && ctx[id] ? MADE[id](ctx[id]) : null);
    if (view) views.set(id, view);
  }

  function building(id) {
    const t = ctx.t();
    return ctx.h('div', { class: 'view-wrap' }, buildingState({ h: ctx.h, icon: ctx.icon, t }, { area: id }));
  }

  return {
    ready: () => Object.fromEntries(AREAS.map((a) => [a.id, views.has(a.id)])),
    view: (id) => views.get(id) ?? null,
    // first: the area was just opened (or the language changed); otherwise the state was polled and only what changed moves.
    draw(id, root, { first = false, sub = null } = {}) {
      const view = views.get(id);
      if (view) return first ? view.render?.(root, sub) : view.refresh?.(root, sub);
      if (root && (first || !root.firstChild)) root.replaceChildren(building(id));
      return undefined;
    },
  };
}
