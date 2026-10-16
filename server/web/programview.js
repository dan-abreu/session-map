// The Flow tab's "The program" level (id130, mm57): the page drawn room by room from the census the engine serves
// (GET /api/census/ui). Every area is a room with its sections; a section lists its buttons as chips and keeps its
// texts one click away. The census comes from the code, never from an AI's memory; this file only draws what it gets.

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

export function createProgramView({ h, t, api }) {
  let data = null;
  let debts = null;
  let failed = false;
  let query = '';
  const expanded = new Set();
  // The Flow's ctx.t is a getter: the translator itself is returned by t(), called with the key.
  const tt = () => t();

  // The page's own design tokens (the same vars the rest of the program uses), injected once: the pane never
  // invents colors of its own.
  const STYLE_ID = 'pg-program-styles';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = [
      '#flowProgram{padding:14px 18px 28px;overflow:auto;height:100%}',
      '.pg-lede{color:var(--ink-2);margin:0 0 12px;font-size:12.5px;max-width:74ch}',
      '.pg-bar{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:0 0 6px}',
      '.pg-stats{display:flex;flex-wrap:wrap;gap:8px}',
      '.pg-stat{border:1px solid var(--line);border-radius:10px;background:var(--bg-2);padding:5px 12px;display:flex;gap:6px;align-items:baseline;font-size:12px;color:var(--ink-2)}',
      '.pg-stat b{font-size:17px;color:var(--ink)}',
      '.pg-search{flex:1 1 240px;max-width:420px;min-height:34px;border:1px solid var(--line);border-radius:8px;background:var(--bg-2);color:var(--ink);padding:0 11px;font:inherit;font-size:13px}',
      '.pg-note{color:var(--ink-2);font-size:11.5px;margin:0 0 14px}',
      '.pg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr));gap:12px;align-items:start}',
      '.pg-room{border:1px solid var(--line);border-radius:12px;background:var(--bg-2);overflow:hidden}',
      '.pg-room>header{padding:10px 13px 8px}',
      '.pg-room h3{margin:0;font-size:14.5px}',
      '.pg-meta{display:flex;flex-wrap:wrap;gap:3px 10px;color:var(--ink-2);font-size:11px;margin-top:3px}',
      '.pg-meta span[title]{cursor:help}',
      '.pg-body{max-height:340px;overflow:auto;border-top:1px solid var(--line)}',
      '.pg-room.pg-all .pg-body{max-height:none}',
      '.pg-sec{padding:8px 13px 9px;border-top:1px dashed var(--line)}',
      '.pg-sec:first-child{border-top:0}',
      '.pg-sec h4{margin:0 0 5px;font-size:12.5px;font-weight:600}',
      '.pg-sec h4.pg-file{font-weight:400;color:var(--ink-2);font-family:ui-monospace,monospace;font-size:11px}',
      '.pg-chips{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 4px}',
      '.pg-chip{border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-size:11.5px;background:var(--bg);color:var(--ink);line-height:1.5;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pg-chip.pg-button{color:var(--active);border-color:currentColor}',
      '.pg-chip.pg-dialog,.pg-chip.pg-summary{color:var(--waiting);border-color:currentColor}',
      '.pg-texts{margin:2px 0 0}',
      '.pg-texts>summary{cursor:pointer;color:var(--ink-2);font-size:11.5px;list-style:none}',
      '.pg-texts>summary::-webkit-details-marker{display:none}',
      '.pg-texts>summary::before{content:"▸ ";}',
      '.pg-texts[open]>summary::before{content:"▾ ";}',
      '.pg-texts ul{margin:4px 0 2px;padding:0 0 0 14px;font-size:12px;color:var(--ink)}',
      '.pg-texts li{margin:1px 0}',
      '.pg-texts li.pg-message{color:var(--ink-2);font-style:italic}',
      '.pg-more{display:block;width:100%;border:0;border-top:1px solid var(--line);background:transparent;color:var(--ink-2);font:inherit;font-size:11.5px;padding:6px 0;cursor:pointer}',
      '.pg-more:hover{color:var(--ink)}',
      '.pg-empty{color:var(--ink-2);font-size:13px;padding:18px 0}',
      '.pg-debts{margin-top:14px;border:1px solid var(--line);border-radius:12px;background:var(--bg-2)}',
      '.pg-debts>summary{cursor:pointer;padding:9px 13px;font-size:13px}',
      '.pg-debts .pg-leaf{padding:1px 13px;font-size:12px;color:var(--ink-2)}',
      '.pg-debts .pg-leaf:last-child{padding-bottom:10px}',
    ].join('\n');
    document.head.appendChild(el);
  }

  const stat = (n, key) => h('span', { class: 'pg-stat' }, h('b', {}, String(n)), tt().count(`program.stat.${key}`, n));

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

  function roomOf(room) {
    const c = room.counts;
    const all = expanded.has(room.id);
    const toggle = () => { if (expanded.has(room.id)) expanded.delete(room.id); else expanded.add(room.id); draw(); };
    const sharedNote = room.id === 'shared' ? h('p', { class: 'pg-note', style: 'margin:3px 0 0' }, tt()('program.sharedNote')) : null;
    return h('section', { class: `pg-room${all ? ' pg-all' : ''}`, 'data-area': room.id },
      h('header', {},
        h('h3', {}, room.name),
        h('div', { class: 'pg-meta' },
          h('span', {}, `${c.sections} ${tt().count('program.stat.sections', c.sections)}`),
          h('span', {}, `${c.buttons + c.dialogs + c.blocks} ${tt().count('program.stat.buttons', c.buttons + c.dialogs + c.blocks)}`),
          h('span', {}, `${c.texts + c.messages} ${tt().count('program.stat.texts', c.texts + c.messages)}`),
          h('span', { title: room.files.join('\n') }, tt().count('program.files', room.files.length))),
        sharedNote),
      room.sections.length
        ? h('div', { class: 'pg-body' }, room.sections.map(sectionOf))
        : h('p', { class: 'pg-note', style: 'padding:0 13px 10px' }, tt()('program.building')),
      room.sections.length > 3 || room.sections.reduce((n, x) => n + x.parts.length, 0) > 12
        ? h('button', { type: 'button', class: 'pg-more', onclick: toggle }, tt()(all ? 'program.less' : 'program.more'))
        : null);
  }

  let rootEl = null;
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
    root.replaceChildren(...[
      h('p', { class: 'pg-lede' }, tt()('program.lede')),
      h('div', { class: 'pg-bar' },
        h('div', { class: 'pg-stats' }, stat(c.areas ?? rooms.length, 'areas'), stat(c.sections ?? 0, 'sections'), stat((c.buttons ?? 0) + (c.dialogs ?? 0) + (c.blocks ?? 0), 'buttons'), stat((c.texts ?? 0) + (c.messages ?? 0), 'texts')),
        input),
      c.unnamed ? h('p', { class: 'pg-note' }, tt().count('program.unnamed', c.unnamed)) : null,
      rooms.length ? h('div', { class: 'pg-grid' }, rooms.map(roomOf)) : h('p', { class: 'pg-empty' }, tt()('program.noMatch')),
      query.trim() === '' ? debtsOf() : null,
    ].filter(Boolean));
  }

  function debtsOf() {
    return h('details', { class: 'pg-debts' },
      h('summary', {}, h('b', {}, tt()('program.debts')), ` · ${debts?.length ?? 0}`),
      debts?.length
        ? debts.map((d) => h('div', { class: 'pg-leaf' }, `${d.file}:${d.line} — ${d.text}`))
        : h('div', { class: 'pg-leaf' }, tt()('program.debts.none')));
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
