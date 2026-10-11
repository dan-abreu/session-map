import { api } from './api.js';
import { COLUMNS, NOTE_MAX, TITLE_MAX, cleanDraft, columnsOf, moveInList } from './handcards.js';

// The cards the owner makes by hand in the Board (mm14): the "New card" form, the cards themselves, dragging them between
// columns, and deleting them. They are kept by the server in session-map's own folder (server/cards.mjs), never in the project.
// ctx: h, t (getter), toast, errorText, confirm(text, label, opts) → Promise<boolean>, project() (the one picked on the page),
// redraw() (draws the Board again; the cards here are already updated).
export function createHandBoard(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  let all = {}; // projectId → cards, in the order the server keeps them
  let dragId = null;
  let draft = null; // the open form: {projectId, title, partId, note}, kept here so a redraw does not lose what was typed
  let writes = 0;
  let version = 0; // goes up with every write, begun or finished: an older answer from the server must not replace newer cards
  let creating = false; // a new card is on its way to the server: a second press of Add must not make a second card

  const ownerOf = (id) => Object.keys(all).find((p) => all[p].some((c) => c.id === id));

  // Asks the server again; true when the cards changed, so the Board needs drawing again. Never while a write or a drag is
  // under way: it would put back an older picture.
  async function load() {
    const seen = version;
    const res = await api.cards();
    const next = res.ok && res.cards && typeof res.cards === 'object' && !Array.isArray(res.cards) ? res.cards : null;
    if (!next || writes > 0 || seen !== version || dragId || JSON.stringify(next) === JSON.stringify(all)) return false;
    all = next;
    return true;
  }

  const inColumn = (projectId, column) => columnsOf(all[projectId] ?? [])[column];
  const dragging = () => dragId !== null;

  async function move(id, column, beforeId = null) {
    const projectId = ownerOf(id);
    if (!projectId) return;
    const next = moveInList(all[projectId], id, column, beforeId);
    if (!next || JSON.stringify(next) === JSON.stringify(all[projectId])) return;
    // Where the card was, to put back just this card if the server refuses (other changes made meanwhile stay).
    const old = all[projectId].find((c) => c.id === id);
    const oldColumn = COLUMNS.includes(old.column) ? old.column : 'todo';
    const siblings = columnsOf(all[projectId])[oldColumn];
    const oldBefore = siblings[siblings.findIndex((c) => c.id === id) + 1]?.id ?? null;
    all = { ...all, [projectId]: next };
    ctx.redraw();
    writes += 1;
    version += 1;
    const res = await api.moveCard(id, { column, before: beforeId });
    writes -= 1;
    version += 1;
    if (res.ok) return;
    const back = all[projectId] && moveInList(all[projectId], id, oldColumn, oldBefore);
    if (back) all = { ...all, [projectId]: back };
    ctx.redraw();
    ctx.toast(ctx.errorText(res.error));
  }

  async function remove(card) {
    const tt = t();
    if (!(await ctx.confirm(tt('hand.deleteConfirm', { title: card.title }), tt('hand.delete'), { focus: 'cancel' }))) return;
    writes += 1;
    version += 1;
    const res = await api.deleteCard(card.id);
    writes -= 1;
    version += 1;
    if (!res.ok) return ctx.toast(ctx.errorText(res.error));
    const projectId = ownerOf(card.id);
    if (projectId) all = { ...all, [projectId]: all[projectId].filter((c) => c.id !== card.id) };
    ctx.redraw();
    return ctx.toast(tt('hand.deleted'));
  }

  // ----- dropping -----

  const mark = (e, on) => e.currentTarget?.classList?.[on ? 'add' : 'remove']('is-over');
  // A card is being dragged: this place takes it.
  function accept(e) {
    if (!dragging()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    mark(e, true);
  }
  function drop(e, column, beforeId) {
    if (!dragging()) return undefined;
    e.preventDefault();
    e.stopPropagation?.();
    mark(e, false);
    const id = dragId;
    dragId = null;
    // Cards stay in their own project: onto a card of another project means "at the end of this column".
    return move(id, column, beforeId && ownerOf(beforeId) !== ownerOf(id) ? null : beforeId);
  }

  // The attributes that make a column take a dropped card (at its end).
  const columnDrop = (column) => ({ ondragover: accept, ondragleave: (e) => mark(e, false), ondrop: (e) => drop(e, column, null) });

  // ----- the cards -----

  function card(project, c) {
    const tt = t();
    const part = project.arch.parts.find((p) => p.id === c.partId);
    return h('li', {
      class: 'card hand-card', draggable: 'true', 'data-id': c.id,
      ondragstart: (e) => {
        dragId = c.id;
        e.dataTransfer?.setData?.('text/plain', c.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        e.currentTarget?.classList?.add('is-dragging');
      },
      ondragend: (e) => { dragId = null; e.currentTarget?.classList?.remove('is-dragging'); },
      ondragover: accept,
      ondragleave: (e) => mark(e, false),
      ondrop: (e) => drop(e, c.column, c.id),
    }, h('div', { class: 'card-btn hand-body' },
      h('span', { class: 'card-kind' }, [part?.name ?? tt('hand.noPart'), tt('hand.tag')].join(' · ')),
      h('span', { class: 'card-title' }, c.title),
      c.note ? h('span', { class: 'hand-note' }, c.note) : null,
      h('span', { class: 'hand-tools' },
        h('select', { class: 'hand-move', name: `hand-move-${c.id}`, 'aria-label': tt('hand.moveTo', { title: c.title }), onchange: (e) => move(c.id, e.target.value) },
          COLUMNS.map((k) => h('option', { value: k, selected: k === c.column }, tt(`board.${k}`)))),
        h('button', { type: 'button', class: 'btn small-btn hand-delete', 'aria-label': tt('hand.deleteAria', { title: c.title }), onclick: () => remove(c) }, tt('hand.delete')))));
  }

  // The hand-made cards of the given projects that sit in a column, ready to put on top of it.
  const columnCards = (projects, column) => projects.flatMap((p) => inColumn(p.id, column).map((c) => card(p, c)));

  // ----- the form -----

  function submit(e) {
    e?.preventDefault?.();
    if (!draft || creating) return undefined;
    const made = cleanDraft(draft);
    if (!made.ok) return ctx.toast(made.error === 'title-required' ? t()('hand.titleRequired') : ctx.errorText(made.error));
    return create(draft.projectId, made.card);
  }

  async function create(projectId, fields) {
    creating = true;
    writes += 1;
    version += 1;
    let res;
    try { res = await api.addCard({ projectId, ...fields }); } finally { creating = false; writes -= 1; version += 1; }
    if (!res.ok) return ctx.toast(ctx.errorText(res.error));
    all = { ...all, [projectId]: [...(all[projectId] ?? []), res.card] };
    draft = null;
    ctx.redraw();
    return ctx.toast(t()('hand.added'));
  }

  const openForm = (chosen) => { draft = { projectId: chosen === '*' ? ctx.project().id : chosen, title: '', partId: '', note: '' }; ctx.redraw(); };
  const closeForm = () => { draft = null; ctx.redraw(); };

  // The button, and under it the form when it is open. chosen: the project id picked on the Board, or '*' for all of them.
  function toolbar(chosen, projects) {
    const tt = t();
    if (!draft) return h('div', { class: 'hand-bar' }, h('button', { type: 'button', id: 'handNew', class: 'btn primary', onclick: () => openForm(chosen) }, tt('hand.new')));
    if (chosen !== '*') draft.projectId = chosen;
    else if (!projects.some((p) => p.id === draft.projectId)) draft.projectId = projects[0]?.id ?? draft.projectId;
    const project = projects.find((p) => p.id === draft.projectId) ?? { arch: { parts: [] } };
    if (draft.partId && !project.arch.parts.some((p) => p.id === draft.partId)) draft.partId = '';
    const field = (label, control) => h('label', { class: 'dv-field' }, h('span', {}, label), control);
    return h('form', { id: 'handForm', class: 'hand-form', onsubmit: submit },
      chosen === '*' ? field(tt('hand.fieldProject'), h('select', { id: 'handProject', name: 'hand-project', onchange: (e) => { draft.projectId = e.target.value; draft.partId = ''; ctx.redraw(); } },
        projects.map((p) => h('option', { value: p.id, selected: p.id === draft.projectId }, p.name)))) : null,
      field(tt('hand.fieldTitle'), h('input', { id: 'handTitle', name: 'hand-title', type: 'text', maxlength: TITLE_MAX, autocomplete: 'off', value: draft.title, oninput: (e) => { draft.title = e.target.value; } })),
      field(tt('hand.fieldPart'), h('select', { id: 'handPart', name: 'hand-part', onchange: (e) => { draft.partId = e.target.value; } },
        h('option', { value: '', selected: !draft.partId }, tt('hand.noPart')),
        project.arch.parts.map((p) => h('option', { value: p.id, selected: p.id === draft.partId }, p.name)))),
      field(tt('hand.fieldNote'), h('textarea', { id: 'handNote', name: 'hand-note', rows: 2, maxlength: NOTE_MAX, value: draft.note, oninput: (e) => { draft.note = e.target.value; } })),
      h('div', { class: 'hand-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, tt('hand.add')),
        h('button', { type: 'button', id: 'handCancel', class: 'btn', onclick: closeForm }, tt('hand.cancel'))));
  }

  return { load, dragging, toolbar, columnCards, columnDrop, count: (projects, column) => projects.reduce((n, p) => n + inColumn(p.id, column).length, 0) };
}
