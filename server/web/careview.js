import { api } from './api.js';
import { bareOpId, hunkRows } from './changes.js';

// The care mode (fd14): the question asked once per project, the picker to change it, the fixes waiting for an Accept and
// the confirmation before anything is erased or published. The server decides what is written; this page only sends
// ids and the owner's yes, never file text.

export const CARE_MODES = ['auto', 'suggest', 'look'];
const SENSITIVE_KINDS = ['delete', 'publish', 'money', 'account'];
const OUTCOMES = ['applied', 'proposed', 'needs-confirm', 'look-only', 'refused'];
const CONTEXT = 3;
const SHOWN_LINES = 200;

// The first-use question. t is optional: with it each option also carries its words. Nothing is preselected for the owner.
export function careQuestion(mode, t) {
  const say = (key) => (t ? t(key) : key);
  return {
    title: say('care.q.title'),
    lede: say('care.q.lede'),
    options: CARE_MODES.map((id) => ({
      id,
      recommended: id === 'auto',
      selected: id === mode,
      label: say(`care.mode.${id}`),
      hint: say(`care.mode.${id}.hint`),
    })),
  };
}

// care: the answer of GET care. Not loaded yet (null) asks nothing; loaded without a mode we know asks once.
export function needsQuestion(care) {
  if (!care || typeof care !== 'object') return false;
  return !CARE_MODES.includes(care.mode);
}

export const needsConfirm = (op) => op?.sensitive === true || SENSITIVE_KINDS.includes(op?.kind) || (op?.files ?? []).some((f) => f.after === null);

// What the confirmation tells: the paths that will be erased and the ones that will be written. Never the text.
export function confirmWords(op) {
  const files = op?.files ?? [];
  return {
    kind: op?.kind ?? null,
    erase: files.filter((f) => f.after === null).map((f) => f.path),
    write: files.filter((f) => f.after !== null).map((f) => f.path),
  };
}

const linesOf = (text) => (text ? text.replace(/\n$/, '').split('\n') : []);

// One piece of a before and after in the shape hunkRows reads. The common top and bottom are cut; what is between is shown
// whole (cut lines, then added lines), with three lines of context around. null when nothing differs.
export function diffHunk(before, after) {
  if (before == null && after == null) return null;
  if (before == null) return { oldStart: 0, newStart: 1, lines: linesOf(after).map((l) => `+${l}`) };
  if (after == null) return { oldStart: 1, newStart: 0, lines: linesOf(before).map((l) => `-${l}`) };
  const a = linesOf(before);
  const b = linesOf(after);
  let top = 0;
  while (top < a.length && top < b.length && a[top] === b[top]) top++;
  if (top === a.length && top === b.length) return null;
  let tail = 0;
  while (tail < a.length - top && tail < b.length - top && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const start = Math.max(0, top - CONTEXT);
  const lines = [
    ...a.slice(start, top).map((l) => ` ${l}`),
    ...a.slice(top, a.length - tail).map((l) => `-${l}`),
    ...b.slice(top, b.length - tail).map((l) => `+${l}`),
    ...a.slice(a.length - tail, a.length - tail + Math.min(CONTEXT, tail)).map((l) => ` ${l}`),
  ];
  return { oldStart: start + 1, newStart: start + 1, lines };
}

const tally = (diff) => {
  let added = 0;
  let removed = 0;
  for (const d of diff ?? []) {
    for (const line of diffHunk(d.before, d.after)?.lines ?? []) {
      if (line[0] === '+') added++;
      else if (line[0] === '-') removed++;
    }
  }
  return { added, removed };
};

// The proposals of GET proposals as the rows of the list: the open ones, newest first.
export function proposalRows(proposals) {
  const list = Array.isArray(proposals) ? proposals : [];
  return list
    .filter((p) => p?.state === 'open' && p.op?.id)
    .sort((x, y) => String(y.createdAt ?? '').localeCompare(String(x.createdAt ?? '')))
    .map((p) => {
      const { added, removed } = tally(p.diff);
      return {
        opId: p.op.id,
        kind: p.op.kind,
        why: p.op.why ?? null,
        paths: (p.diff?.length ? p.diff.map((d) => d.path) : (p.op.files ?? []).map((f) => f.path)),
        added,
        removed,
        erases: (p.op.files ?? []).some((f) => f.after === null),
        needsConfirm: needsConfirm(p.op),
        op: p.op,
        diff: p.diff ?? [],
        canAccept: p.state === 'open',
      };
    });
}

// The answer of an accept (or of any apply) in one of six words. An answer with no status is an error, never a success.
export function outcomeOf(res) {
  const body = res?.data;
  if (!res?.ok) {
    const error = res?.error ?? 'unknown';
    return OUTCOMES.includes(error) ? { kind: error, error: undefined, files: [] } : { kind: 'error', error, files: [] };
  }
  if (!body || typeof body.status !== 'string') return { kind: 'error', error: 'unknown', files: [] };
  if (!OUTCOMES.includes(body.status)) return { kind: 'error', error: body.error ?? body.status, files: [] };
  return { kind: body.status, error: body.error, files: Array.isArray(body.files) ? body.files : [] };
}

// ctx: h, t() (getter of the translator), dialog (a <dialog>), toast(msg), errorText(code), onMode(care) (optional).
export function createCareView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();

  const saveMode = async (projectId, mode) => {
    if (!CARE_MODES.includes(mode)) return { ok: false, error: 'bad-mode' };
    return api.fdWrite(projectId, 'care', { mode }, 'PUT');
  };

  const accept = async (projectId, opId, { confirm = false } = {}) => outcomeOf(await api.fdWrite(projectId, `op/${bareOpId(opId)}/accept`, { confirm }));

  async function load(projectId) {
    const [care, props] = await Promise.all([api.fd(projectId, 'care'), api.fd(projectId, 'proposals')]);
    return { care: care.ok ? care.data : null, proposals: props.ok ? (Array.isArray(props.data) ? props.data : props.data?.proposals ?? []) : null };
  }

  // Opens the dialog and settles with whatever the owner does; Escape and the backdrop count as "no".
  function modal(build, fallback) {
    const dialog = ctx.dialog;
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        resolve(value);
      };
      dialog.replaceChildren(build(done));
      dialog.addEventListener('close', () => done(fallback), { once: true });
      dialog.showModal();
    });
  }

  // ----- the question, asked once -----

  function ask(projectId, current = null) {
    const tt = t();
    return modal((done) => {
      const q = careQuestion(current, tt);
      let chosen = q.options.find((o) => o.selected)?.id ?? null;
      const msg = h('p', { class: 'care-q-error', role: 'alert', hidden: true });
      const go = h('button', { type: 'submit', class: 'btn primary', disabled: !chosen }, tt('care.q.save'));
      const radios = q.options.map((o) => h('label', { class: 'care-opt' },
        h('input', { type: 'radio', name: 'care-mode', value: o.id, checked: o.selected, onchange: () => { chosen = o.id; go.disabled = false; } }),
        h('span', { class: 'care-opt-body' },
          h('span', { class: 'care-opt-name' }, o.label, o.recommended ? h('span', { class: 'care-rec' }, tt('care.q.recommended')) : null),
          h('span', { class: 'care-opt-hint' }, o.hint))));
      ctx.dialog.setAttribute('aria-labelledby', 'careQTitle');
      ctx.dialog.classList.add('care-dialog');
      return h('form', {
        class: 'care-q',
        onsubmit: async (e) => {
          e.preventDefault();
          if (!chosen) return;
          go.disabled = true;
          const res = await saveMode(projectId, chosen);
          if (!res.ok) {
            msg.textContent = ctx.errorText(res.error);
            msg.hidden = false;
            go.disabled = false;
            return;
          }
          ctx.toast?.(tt('care.q.saved', { mode: tt(`care.mode.${chosen}`) }));
          ctx.onMode?.(res.data);
          done(chosen);
        },
      },
      h('h2', { id: 'careQTitle' }, q.title),
      h('p', { class: 'care-q-lede' }, q.lede),
      h('fieldset', { class: 'care-opts' }, h('legend', { class: 'visually-hidden' }, tt('care.mode.label')), radios),
      msg,
      h('p', { class: 'care-q-later' }, tt('care.q.later.hint')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, tt('care.q.later')),
        go));
    }, null);
  }

  // ----- the picker that changes the mode of a project -----

  function picker(projectId, care, onChange) {
    const tt = t();
    const now = CARE_MODES.includes(care?.mode) ? care.mode : null;
    const root = h('div', { class: 'care-picker' });
    const hint = h('p', { class: 'care-picker-hint' }, now ? tt(`care.mode.${now}.hint`) : tt('care.q.later.hint'));
    const buttons = CARE_MODES.map((id) => h('button', {
      type: 'button', 'aria-pressed': String(id === now), title: tt(`care.mode.${id}.hint`),
      onclick: async () => {
        const res = await saveMode(projectId, id);
        if (!res.ok) return ctx.toast?.(ctx.errorText(res.error));
        ctx.onMode?.(res.data);
        onChange?.(res.data);
      },
    }, tt(`care.mode.${id}`)));
    root.replaceChildren(
      h('div', { class: 'seg', role: 'group', 'aria-label': tt('care.picker.change') }, buttons),
      hint);
    return root;
  }

  // ----- the confirmation before an erase or a publish -----

  function confirm(op) {
    const tt = t();
    const words = confirmWords(op);
    const list = (paths) => h('ul', { class: 'care-paths' }, paths.map((p) => h('li', {}, h('code', {}, p))));
    return modal((done) => {
      ctx.dialog.setAttribute('aria-labelledby', 'careCTitle');
      ctx.dialog.classList.add('care-dialog');
      const go = h('button', { type: 'button', class: 'btn danger', onclick: () => done(true) }, tt('care.confirm.go'));
      queueMicrotask(() => go.focus());
      return h('div', { class: 'care-confirm' },
        h('h2', { id: 'careCTitle' }, tt('care.confirm.title')),
        SENSITIVE_KINDS.includes(words.kind) ? h('p', { class: 'dv-warning' }, tt(`care.confirm.kind.${words.kind}`)) : null,
        words.erase.length ? [h('p', {}, tt('care.confirm.erase')), list(words.erase)] : null,
        words.write.length ? [h('p', {}, tt('care.confirm.write')), list(words.write)] : null,
        words.erase.length ? h('p', { class: 'care-kept' }, tt('care.confirm.kept')) : null,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, tt('confirm.cancel')),
          go));
    }, false);
  }

  // ----- the fixes waiting -----

  function outcomeText(out) {
    const tt = t();
    if (out.kind === 'refused') return [tt('care.result.refused'), out.error && tt(`care.refuse.${out.error}`) !== `care.refuse.${out.error}` ? tt(`care.refuse.${out.error}`) : null].filter(Boolean).join(' ');
    if (out.kind === 'error') return tt('care.result.error', { error: ctx.errorText(out.error) });
    return tt(`care.result.${out.kind}`);
  }

  function diffTable(d) {
    const tt = t();
    const hunk = diffHunk(d.before, d.after);
    if (!hunk) return null;
    const rows = hunkRows(hunk);
    return h('div', { class: 'chg-diff care-diff' },
      h('p', { class: 'care-diff-path' }, h('code', {}, d.path), d.before == null ? h('span', { class: 'care-diff-tag' }, tt('care.proposals.created')) : null, d.after == null ? h('span', { class: 'care-diff-tag is-erase' }, tt('care.proposals.erases')) : null),
      h('table', { class: 'chg-hunk' }, h('tbody', {}, rows.slice(0, SHOWN_LINES).map((r) => h('tr', { class: r.sign === '+' ? 'diff-add' : r.sign === '-' ? 'diff-del' : '' },
        h('td', { class: 'hn num', 'aria-hidden': 'true' }, r.old ?? ''),
        h('td', { class: 'hn num', 'aria-hidden': 'true' }, r.new ?? ''),
        h('td', { class: 'hs', 'aria-hidden': 'true' }, r.sign === ' ' ? '' : r.sign === '-' ? '−' : '+'),
        h('td', { class: 'ht' }, r.sign === '+' ? h('span', { class: 'visually-hidden' }, `${tt('chat.diffAdded')} `) : r.sign === '-' ? h('span', { class: 'visually-hidden' }, `${tt('chat.diffRemoved')} `) : null, r.text || ' '))))),
      rows.length > SHOWN_LINES ? h('p', { class: 'view-note' }, tt('care.proposals.more')) : null);
  }

  // Draws the waiting fixes of one project into root. onChange runs after something was accepted.
  async function renderProposals(root, projectId, onChange) {
    const tt = t();
    const { proposals } = await load(projectId);
    const rows = proposalRows(proposals);
    const reload = () => renderProposals(root, projectId, onChange);

    // The page asks first when it already knows the fix is sensitive; if only the server knows, it asks then.
    const accepting = async (row) => {
      if (row.needsConfirm && !(await confirm(row.op))) return;
      let out = await accept(projectId, row.opId, { confirm: row.needsConfirm });
      if (out.kind === 'needs-confirm' && !row.needsConfirm) {
        if (!(await confirm(row.op))) return;
        out = await accept(projectId, row.opId, { confirm: true });
      }
      await finish(out);
    };
    const finish = async (out) => {
      ctx.toast?.(outcomeText(out));
      onChange?.(out);
      return reload();
    };

    root.replaceChildren(h('section', { class: 'care-props', 'aria-labelledby': 'careProps' },
      h('h3', { id: 'careProps' }, tt('care.proposals.title')),
      rows.length
        ? h('ul', { class: 'care-prop-list' }, rows.map((row) => {
          const why = row.why?.msg ? tt(row.why.msg, row.why.params) : null;
          return h('li', { class: 'care-prop' },
            h('div', { class: 'care-prop-head' },
              h('div', { class: 'care-prop-what' },
                h('p', { class: 'care-prop-paths' }, row.paths.map((p) => h('code', {}, p))),
                why && why !== row.why.msg ? h('p', { class: 'care-prop-why' }, why) : null,
                h('p', { class: 'care-prop-meta' },
                  tt.count('care.proposals.files', row.paths.length),
                  ' · ', tt('care.proposals.lines', { added: row.added, removed: row.removed }),
                  row.erases ? [' · ', h('span', { class: 'care-prop-erase' }, tt('care.proposals.erases'))] : null)),
              h('button', { type: 'button', class: 'btn primary small-btn', onclick: () => accepting(row) }, tt('care.proposals.accept'))),
            row.diff.length ? h('details', { class: 'care-prop-diff' }, h('summary', {}, tt('care.proposals.show')), row.diff.map(diffTable)) : null);
        }))
        : h('p', { class: 'view-note' }, tt('care.proposals.empty'))));
    return rows.length;
  }

  return { ask, picker, confirm, renderProposals, saveMode, accept, load };
}
