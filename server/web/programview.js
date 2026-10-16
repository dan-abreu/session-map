// The Flow tab's "The program" level (id130, id160): the page drawn from the census the engine serves
// (GET /api/census/ui), as a floor plan (a room per area, walked into with a click) or as a list of cards.
// The census comes from the code, never from an AI's memory; this file only draws what it gets.
import { planOf } from './programplan.js';
import { PROGRAM_STYLE } from './programstyle.js';

// The census turned into what a room shows, in the person's language. A search keeps the rooms, sections and pieces
// that say the word; a room or a section whose own name says it keeps everything it holds.
export function roomsOf(data, tr, query = '') {
  const q = query.trim().toLowerCase();
  const has = (text) => text.toLowerCase().includes(q);
  return (data?.areas ?? []).map((area) => {
    const name = tr(area.label);
    const sections = area.sections.map((s) => {
      const title = s.key ? tr(s.key) : null;
      const items = s.items.map((i) => ({ type: i.type, text: tr(i.key) }));
      const whole = !q || has(name) || (title !== null && has(title));
      return { title, file: s.file, items: whole ? items : items.filter((i) => has(i.text)), whole };
    }).filter((s) => s.whole || s.items.length);
    const buttons = (items) => items.filter((i) => i.type === 'button' || i.type === 'dialog' || i.type === 'summary');
    return {
      id: area.id,
      name,
      files: area.files,
      counts: area.counts,
      sections: sections.map((s) => ({
        title: s.title,
        file: s.file,
        parts: buttons(s.items),
        texts: s.items.filter((i) => i.type === 'text'),
        messages: s.items.filter((i) => i.type === 'message'),
      })),
    };
  }).filter((room) => !q || room.sections.length > 0);
}

const baseName = (file) => String(file ?? '').split('/').pop();
const GLYPH = { button: '▸', dialog: '▣', summary: '▾' };
const VIEWS = ['plan', 'list'];

export function createProgramView({ h, t, api }) {
  let data = null;
  let debts = null;
  let failed = false;
  let query = '';
  let view = 'plan';
  let focus = null;
  let rootEl = null;
  const expanded = new Set();
  // The Flow's ctx.t is a getter: the translator itself is returned by t(), called with the key.
  const tt = () => t();

  const STYLE_ID = 'pg-program-styles';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = PROGRAM_STYLE;
    document.head.appendChild(el);
  }

  const stat = (n, key) => h('span', { class: 'pg-stat' }, h('b', {}, String(n)), tt().count(`program.stat.${key}`, n));
  const counted = (key, n) => `${n} ${tt().count(`program.stat.${key}`, n)}`;
  const piecesOf = (c) => c.buttons + c.dialogs + c.blocks;

  // ---- the floor plan: every room at a glance, a block for each button, a line for each text --------------------

  function legendOf() {
    const item = (cls, key) => h('span', {}, h('i', { class: `pp-sw ${cls}` }), tt()(`program.legend.${key}`));
    return h('div', { class: 'pp-legend' }, item('pp-btn', 'button'), item('pp-win', 'window'), item('pp-line', 'text'), item('pp-msg', 'message'), item('pp-unn', 'unnamed'));
  }

  function panelOf(p) {
    const blocks = p.blocks.map((b) => h('i', { class: `${b.type === 'button' ? 'pp-btn' : 'pp-win'}${b.hit ? ' pp-hit' : ''}`, style: `width:${b.width}px`, title: b.text }));
    const widths = ['92%', '70%', '84%', '56%'];
    return h('span', { class: 'pp-panel' },
      h('span', { class: 'pp-title', title: p.title ?? p.file }, p.title ?? baseName(p.file)),
      blocks.length ? h('span', { class: 'pp-blocks' }, blocks) : null,
      p.lines ? h('span', { class: 'pp-lines', title: counted('texts', p.texts) }, Array.from({ length: p.lines }, (_, i) => h('i', { class: 'pp-line', style: `width:${widths[i]}` }))) : null,
      p.messages ? h('i', { class: 'pp-msg', title: tt().count('program.messages', p.messages) }) : null);
  }

  function planRoomOf(room) {
    const c = room.counts;
    const unnamed = room.unnamed
      ? h('span', { class: 'pp-panel', title: tt().count('program.unnamed', room.unnamedAll) },
        h('span', { class: 'pp-blocks' }, Array.from({ length: room.unnamed }, () => h('i', { class: 'pp-unn', style: 'width:22px' }))))
      : null;
    return h('button', { type: 'button', class: `pp-room pp-s${room.span}`, 'data-area': room.id, 'aria-label': tt()('program.open', { name: room.name }), onclick: () => { focus = room.id; draw(); rootEl.scrollTop = 0; } },
      h('span', { class: 'pp-head' }, h('b', {}, room.name), h('small', {}, `${counted('sections', c.sections)} · ${counted('buttons', piecesOf(c))}`)),
      room.building
        ? h('span', { class: 'pp-note' }, tt()('program.building'))
        : h('span', { class: 'pp-floor' }, room.panels.map(panelOf), unnamed));
  }

  function planOfRooms(rooms) {
    return h('div', { class: `pp-plan${query.trim() ? ' pp-q' : ''}` }, planOf(rooms, query).map(planRoomOf));
  }

  // ---- walking into a room: every section at full size, every word readable -------------------------------------

  function detailOf(room) {
    const q = query.trim().toLowerCase();
    const says = (text) => q !== '' && text.toLowerCase().includes(q);
    const c = room.counts;
    return h('div', {},
      h('div', { class: 'pp-top' },
        h('button', { type: 'button', class: 'btn', onclick: () => { focus = null; draw(); rootEl.scrollTop = 0; } }, tt()('program.back')),
        h('h3', {}, room.name),
        h('span', { class: 'pg-meta' },
          h('span', {}, counted('sections', c.sections)), h('span', {}, counted('buttons', piecesOf(c))), h('span', {}, counted('texts', c.texts + c.messages)),
          h('span', { title: room.files.join('\n') }, tt().count('program.files', room.files.length)))),
      room.id === 'shared' ? h('p', { class: 'pg-note' }, tt()('program.sharedNote')) : null,
      h('div', { class: 'pp-detail' }, room.sections.map((s) => h('section', { class: 'pp-d' },
        s.title ? h('h4', {}, s.title) : h('h4', { class: 'pp-file', title: s.file }, baseName(s.file)),
        s.parts.length ? h('div', { class: 'pp-keys' }, s.parts.map((p) => h('span', { class: `pp-key pp-${p.type}${says(p.text) ? ' pp-hit' : ''}`, title: p.text }, GLYPH[p.type] ? `${GLYPH[p.type]} ` : '', p.text))) : null,
        s.texts.length + s.messages.length
          ? h('ul', { class: 'pp-said' }, [...s.texts, ...s.messages].map((i) => h('li', { class: `pp-${i.type}` }, i.text)))
          : null))));
  }

  // ---- the list: one card per area -------------------------------------------------------------------------------

  const chip = (item) => h('span', { class: `pg-chip pg-${item.type}`, title: item.text }, GLYPH[item.type] ? `${GLYPH[item.type]} ` : '', item.text);

  function textsOf(section) {
    const list = [...section.texts, ...section.messages];
    if (!list.length) return null;
    const label = section.texts.length
      ? tt().count('program.texts', section.texts.length) + (section.messages.length ? ` · ${tt().count('program.messages', section.messages.length)}` : '')
      : tt().count('program.messages', section.messages.length);
    return h('details', { class: 'pg-texts', open: query.trim() !== '' },
      h('summary', {}, label),
      h('ul', {}, list.map((i) => h('li', { class: `pg-${i.type}` }, i.text))));
  }

  const sectionOf = (s) => h('div', { class: 'pg-sec' },
    s.title ? h('h4', {}, s.title) : h('h4', { class: 'pg-file', title: s.file }, baseName(s.file)),
    s.parts.length ? h('div', { class: 'pg-chips' }, s.parts.map(chip)) : null,
    textsOf(s));

  function cardOf(room) {
    const c = room.counts;
    const all = expanded.has(room.id);
    const toggle = () => { if (expanded.has(room.id)) expanded.delete(room.id); else expanded.add(room.id); draw(); };
    const sharedNote = room.id === 'shared' ? h('p', { class: 'pg-note', style: 'margin:3px 0 0' }, tt()('program.sharedNote')) : null;
    return h('section', { class: `pg-room${all ? ' pg-all' : ''}`, 'data-area': room.id },
      h('header', {},
        h('h3', {}, room.name),
        h('div', { class: 'pg-meta' },
          h('span', {}, counted('sections', c.sections)),
          h('span', {}, counted('buttons', piecesOf(c))),
          h('span', {}, counted('texts', c.texts + c.messages)),
          h('span', { title: room.files.join('\n') }, tt().count('program.files', room.files.length))),
        sharedNote),
      room.sections.length
        ? h('div', { class: 'pg-body' }, room.sections.map(sectionOf))
        : h('p', { class: 'pg-note', style: 'padding:0 13px 10px' }, tt()('program.building')),
      room.sections.length > 3 || room.sections.reduce((n, x) => n + x.parts.length, 0) > 12
        ? h('button', { type: 'button', class: 'pg-more', onclick: toggle }, tt()(all ? 'program.less' : 'program.more'))
        : null);
  }

  function debtsOf() {
    return h('details', { class: 'pg-debts' },
      h('summary', {}, h('b', {}, tt()('program.debts')), ` · ${debts?.length ?? 0}`),
      debts?.length
        ? debts.map((d) => h('div', { class: 'pg-leaf' }, `${d.file}:${d.line} — ${d.text}`))
        : h('div', { class: 'pg-leaf' }, tt()('program.debts.none')));
  }

  // ---- the level ---------------------------------------------------------------------------------------------------

  function bodyOf(rooms) {
    if (!rooms.length) return h('p', { class: 'pg-empty' }, tt()('program.noMatch'));
    if (view === 'list') return h('div', { class: 'pg-grid' }, rooms.map(cardOf));
    if (focus) {
      const room = rooms.find((r) => r.id === focus);
      if (room) return detailOf(room);
      focus = null;
    }
    return planOfRooms(rooms);
  }

  function draw() {
    const root = rootEl;
    if (!root) return;
    if (failed && !data) {
      root.replaceChildren(
        h('p', { class: 'pg-empty' }, tt()('program.error')),
        h('button', { type: 'button', class: 'btn', onclick: () => { failed = false; render(root); } }, tt()('program.retry')));
      return;
    }
    if (!data) {
      root.replaceChildren(h('p', { class: 'pg-lede' }, tt()('program.loading')));
      return;
    }
    const rooms = roomsOf(data, tt(), query);
    const c = data.counts ?? {};
    const input = h('input', {
      type: 'search', class: 'pg-search', value: query, placeholder: tt()('program.search'), 'aria-label': tt()('program.search'),
      oninput: (e) => { query = e.target.value; const at = e.target.selectionStart; draw(); const again = root.querySelector('.pg-search'); again?.focus(); again?.setSelectionRange(at, at); },
    });
    const views = h('div', { class: 'seg', role: 'group', 'aria-label': tt()('program.view.aria') },
      VIEWS.map((v) => h('button', { type: 'button', 'aria-pressed': String(view === v), onclick: () => { view = v; focus = null; draw(); } }, tt()(`program.view.${v}`))));
    const planning = view === 'plan' && !focus;
    root.replaceChildren(...[
      h('p', { class: 'pg-lede' }, tt()(view === 'plan' ? 'program.plan.lede' : 'program.lede')),
      h('div', { class: 'pg-bar' },
        h('div', { class: 'pg-stats' }, stat(c.areas ?? rooms.length, 'areas'), stat(c.sections ?? 0, 'sections'), stat((c.buttons ?? 0) + (c.dialogs ?? 0) + (c.blocks ?? 0), 'buttons'), stat((c.texts ?? 0) + (c.messages ?? 0), 'texts')),
        views,
        input),
      c.unnamed ? h('p', { class: 'pg-note' }, tt().count('program.unnamed', c.unnamed)) : null,
      planning ? legendOf() : null,
      bodyOf(rooms),
      query.trim() === '' && !focus ? debtsOf() : null,
    ].filter(Boolean));
  }

  async function render(root) {
    if (!root) return;
    rootEl = root;
    ensureStyles();
    draw();
    // Read again each time the level opens: the census is cheap and the code may have changed; the last one stays on
    // screen meanwhile, and stays if this read fails.
    const [census, ledger] = await Promise.all([api.census().catch(() => null), api.censusDebt().catch(() => null)]);
    if (census?.areas) { data = census; failed = false; } else if (!data) failed = true;
    if (ledger?.ok) debts = ledger.debts ?? [];
    draw();
  }

  return { render, refresh: (root) => { rootEl = root; draw(); } };
}
