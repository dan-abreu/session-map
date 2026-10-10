import { api } from './api.js';
import { emptyState } from './empty.js';

// The findings screen (fd06, fd13, fd14): what the watcher found where documents and code stopped agreeing, each with
// what it is, why it matters and what to do, and the proposal to read before anything is written to the project.
// The pure functions on top are tested; the view below draws them. The client never sends file text: only the word
// (accept, later, never), the id of the proposal and "confirm" (bloco-3.md decision 2).

export const SEVERITIES = ['grave', 'important', 'detail'];
const LIVE = new Set(['open', 'accepted']);
const CONTEXT = 2;
const MAX_LINES = 60;
const MAX_CELLS = 250_000;

const linesOf = (text) => {
  if (typeof text !== 'string' || text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

const listOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.findings) ? data.findings : null);

// Sections of the list, worst first; "later" is its own section; never, applied and undone are not shown.
// filter: { rule, severity }. Empty sections are left out.
export function findingRows(findings, filter = {}) {
  const list = listOf(findings) ?? [];
  const sections = new Map([...SEVERITIES, 'later'].map((id) => [id, []]));
  for (const f of list) {
    if (!f || (filter.rule && f.rule !== filter.rule) || (filter.severity && f.severity !== filter.severity)) continue;
    if (f.state === 'later') sections.get('later').push(f);
    else if (LIVE.has(f.state)) sections.get(SEVERITIES.includes(f.severity) ? f.severity : 'detail').push(f);
  }
  const place = (f) => [f.target?.file ?? '', f.target?.line ?? 0, f.id ?? ''];
  const order = (a, b) => {
    const [fa, la, ia] = place(a);
    const [fb, lb, ib] = place(b);
    return fa.localeCompare(fb) || la - lb || ia.localeCompare(ib);
  };
  return [...sections].filter(([, rows]) => rows.length).map(([id, rows]) => ({ id, rows: rows.sort(order) }));
}

// Plain-words texts of one finding: watch.<rule>.what|why|todo filled with the parameters the watcher left.
// Codes the owner should not have to read (a kind of fact, a type of document, why a pointer broke) become words.
export function findingWords(finding, t) {
  const word = (prefix, value) => {
    const text = t(`${prefix}.${value}`);
    return text === `${prefix}.${value}` ? value : text;
  };
  const params = { ...finding.what?.params, ...finding.why?.params, ...finding.todo?.params };
  for (const [key, prefix] of [['kind', 'findings.kind'], ['type', 'findings.docType'], ['why', 'findings.pointer']]) {
    if (typeof params[key] === 'string') params[key] = word(prefix, params[key]);
  }
  for (const [k, v] of Object.entries(params)) if (Array.isArray(v)) params[k] = v.join(', ');
  const say = (part) => {
    const key = `watch.${finding.rule}.${part}`;
    const text = t(key, params);
    return text === key ? finding.rule : text;
  };
  return { what: say('what'), why: say('why'), todo: say('todo') };
}

// Line diff: common start and end are cut off, the middle is matched line by line; a huge middle is shown as replaced.
function diffOps(before, after) {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before.at(-1 - tail) === after.at(-1 - tail)) tail += 1;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const ops = before.slice(0, head).map((text) => ({ sign: ' ', text }));
  if (a.length * b.length > MAX_CELLS) {
    ops.push(...a.map((text) => ({ sign: '-', text })), ...b.map((text) => ({ sign: '+', text })));
  } else {
    const w = b.length + 1;
    const lcs = new Uint32Array((a.length + 1) * w);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ sign: ' ', text: a[i] }); i += 1; j += 1; }
      else if (i < a.length && (j === b.length || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) { ops.push({ sign: '-', text: a[i] }); i += 1; }
      else { ops.push({ sign: '+', text: b[j] }); j += 1; }
    }
  }
  ops.push(...after.slice(after.length - tail).map((text) => ({ sign: ' ', text })));
  return ops;
}

// Only the changed lines and a little around them, with a gap mark between separate places.
function shown(ops) {
  const keep = ops.map((o) => o.sign !== ' ');
  const near = keep.map((_, i) => keep.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some(Boolean));
  const out = [];
  ops.forEach((o, i) => {
    if (near[i]) out.push(o);
    else if (out.length && !out.at(-1).gap && near.slice(i).some(Boolean)) out.push({ sign: ' ', text: '…', gap: true });
  });
  return out;
}

// What a proposal changes, file by file: kind (create, edit, delete), the owner's reading of its role in a split
// (piece, index, links) and a short list of lines. proposal: { op, diff: [{path, before, after}] } (contract of block 3).
export function diffRows(proposal) {
  const diff = Array.isArray(proposal?.diff) ? proposal.diff : [];
  const split = proposal?.op?.kind === 'doc-split';
  const created = diff.filter((d) => d.before == null && d.after != null).map((d) => d.path);
  return diff.map(({ path, before, after }) => {
    const kind = before == null ? 'create' : after == null ? 'delete' : 'edit';
    const ops = kind === 'create' ? linesOf(after).map((text) => ({ sign: '+', text }))
      : kind === 'delete' ? linesOf(before).map((text) => ({ sign: '-', text }))
        : diffOps(linesOf(before), linesOf(after));
    const added = ops.filter((o) => o.sign === '+').length;
    const removed = ops.filter((o) => o.sign === '-').length;
    const all = kind === 'edit' ? shown(ops) : ops;
    const lines = all.slice(0, MAX_LINES);
    const stem = path.replace(/\.md$/i, '');
    const role = !split ? 'file' : kind === 'create' ? 'piece' : created.some((c) => c.startsWith(`${stem}/`)) ? 'index' : 'links';
    return { path, kind, role, added, removed, lines, cut: all.length - lines.length };
  });
}

// The files a proposal would remove (or every file of an operation marked sensitive): the owner is asked first.
export function sensitiveFiles(proposal) {
  const diff = Array.isArray(proposal?.diff) ? proposal.diff : [];
  return diff.filter((d) => proposal?.op?.sensitive || d.after == null).map((d) => d.path);
}

// An estimate is never shown as zero: the smallest honest amount is one cent.
export const usdWords = (n) => (Number(n) >= 0.01 ? Number(n).toFixed(2) : '0.01');

const REFUSED = new Set(['bad-path', 'secret-file', 'outside-root', 'too-big']);

export function createFindingsView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const state = { findings: undefined, proposals: [], error: null, steps: new Map(), notice: null, busy: new Set(), focus: null };
  let run = 0;
  let els = null;
  let rootEl = null;

  const projectId = () => ctx.project().id;
  const mode = () => ctx.careMode?.() ?? null;
  const canWrite = () => mode() === 'auto' || mode() === 'suggest';
  const proposalsOf = (f) => state.proposals.filter((p) => p.state === 'open' && (p.op?.findingId === f.id || (f.fix?.opId && p.op?.id === f.fix.opId)));

  function say(tone, key, vars) {
    state.notice = { tone, text: t()(key, vars) };
  }

  function refusal(error) {
    const why = REFUSED.has(error) ? error : 'other';
    say('warn', 'findings.status.refused', { why: t()(`findings.refused.${why}`) });
  }

  // The answer of applyOp, in words: nothing is shown as written unless the server says it was.
  function answer(f, res, again) {
    if (!res.ok) { state.notice = { tone: 'warn', text: ctx.errorText(res.error) }; return; }
    const data = res.data ?? {};
    if (data.ok === false && data.status !== 'refused') { state.notice = { tone: 'warn', text: ctx.errorText(data.error) }; return; }
    if (data.status === 'applied') say('ok', 'findings.status.applied');
    else if (data.status === 'proposed') say('ok', 'findings.status.proposed');
    else if (data.status === 'look-only') say('warn', 'findings.status.lookOnly');
    else if (data.status === 'refused') refusal(data.error);
    else if (data.status === 'needs-confirm') {
      state.notice = null;
      state.steps.set(f.id, { kind: 'sensitive', files: [], again });
      state.focus = `${f.id}:go`;
    } else state.notice = null;
  }

  async function load() {
    const mine = ++run;
    const [found, props] = await Promise.all([api.fd(projectId(), 'findings'), api.fd(projectId(), 'proposals')]);
    if (mine !== run) return;
    if (!found.ok) {
      state.error = found.error;
      state.findings ??= null;
    } else {
      state.error = null;
      state.findings = listOf(found.data);
    }
    state.proposals = props.ok && Array.isArray(props.data) ? props.data : [];
    draw();
  }

  async function send(f, body, again) {
    if (state.busy.has(f.id)) return;
    state.busy.add(f.id);
    state.steps.delete(f.id);
    try {
      answer(f, await api.fdWrite(projectId(), `findings/${f.id}`, body), again);
    } finally {
      state.busy.delete(f.id);
    }
    await load();
  }

  async function postOp(f, opId, confirm) {
    if (state.busy.has(f.id)) return;
    state.busy.add(f.id);
    state.steps.delete(f.id);
    try {
      answer(f, await api.fdWrite(projectId(), `op/${opId}/accept`, confirm ? { confirm: true } : {}), { opId });
    } finally {
      state.busy.delete(f.id);
    }
    await load();
  }

  async function estimate(f) {
    state.notice = null;
    state.steps.set(f.id, { kind: 'estimating' });
    draw();
    const res = await api.fd(projectId(), `findings/${f.id}/estimate`);
    const usd = Number(res.data?.usd);
    state.steps.set(f.id, res.ok && Number.isFinite(usd) && usd >= 0 ? { kind: 'estimate', usd } : { kind: 'estimate-error' });
    state.focus = `${f.id}:go`;
    draw();
  }

  function primary(f) {
    const [proposal] = proposalsOf(f);
    if (proposal) {
      const files = sensitiveFiles(proposal);
      if (!files.length) return postOp(f, proposal.op.id, false);
      state.steps.set(f.id, { kind: 'sensitive', files, opId: proposal.op.id });
      state.focus = `${f.id}:go`;
      return draw();
    }
    if (mode() === 'suggest' && f.fix?.kind === 'ai-update') return estimate(f);
    return send(f, { action: 'accept' }, { action: 'accept' });
  }

  function confirm(f, step) {
    if (step.kind === 'estimate') return send(f, { action: 'accept' }, { action: 'accept' });
    if (step.opId) return postOp(f, step.opId, true);
    return send(f, { action: 'accept', confirm: true }, null);
  }

  function cancel(f) {
    state.steps.delete(f.id);
    state.focus = `${f.id}:primary`;
    draw();
  }

  // ----- drawing -----

  function diffFile(row, open) {
    const tt = t();
    const counts = tt('findings.diff.counts', { added: row.added, removed: row.removed });
    return h('details', { class: `fdf-file is-${row.kind}`, open },
      h('summary', {},
        h('code', { class: 'fdf-path' }, row.path),
        h('span', { class: `fdf-chip is-${row.kind}` }, tt(`findings.diff.${row.kind}`)),
        row.role !== 'file' ? h('span', { class: 'fdf-role' }, tt(`findings.diff.role.${row.role}`)) : null,
        h('span', { class: 'fdf-counts num', title: counts, 'aria-label': counts },
          h('span', { class: 'fdf-plus', 'aria-hidden': 'true' }, `+${row.added}`), ' ', h('span', { class: 'fdf-minus', 'aria-hidden': 'true' }, `−${row.removed}`))),
      h('div', { class: 'fdf-diff', role: 'group', 'aria-label': row.path },
        row.lines.map((l) => h('div', { class: `fdf-line ${l.sign === '+' ? 'is-add' : l.sign === '-' ? 'is-del' : l.gap ? 'is-gap' : ''}` },
          h('span', { class: 'fdf-sign', 'aria-hidden': 'true' }, l.sign === '-' ? '−' : l.sign === ' ' ? '' : l.sign),
          l.sign === '+' ? h('span', { class: 'visually-hidden' }, `${tt('chat.diffAdded')} `) : l.sign === '-' ? h('span', { class: 'visually-hidden' }, `${tt('chat.diffRemoved')} `) : null,
          h('span', { class: 'fdf-text' }, l.text))),
        row.cut > 0 ? h('p', { class: 'fdf-more' }, tt('findings.diff.more', { n: row.cut })) : null));
  }

  function proposalEl(proposal) {
    const tt = t();
    const rows = diffRows(proposal);
    const split = proposal.op?.kind === 'doc-split';
    const pieces = rows.filter((r) => r.role === 'piece');
    const index = rows.find((r) => r.role === 'index');
    const links = rows.filter((r) => r.role === 'links');
    return h('div', { class: 'fdf-proposal' },
      h('h4', { class: 'fdf-proposal-title' }, tt('findings.proposal.title')),
      split ? h('div', { class: 'fdf-split' },
        h('p', { class: 'fdf-split-title' }, tt('findings.split.title', { n: pieces.length })),
        index ? h('p', {}, tt('findings.split.index', { path: index.path })) : null,
        links.length ? h('p', {}, tt('findings.split.links', { n: links.length })) : null,
        h('p', { class: 'fdf-split-keep' }, tt('findings.split.keep'))) : null,
      rows.length ? h('div', { class: 'fdf-files' }, rows.map((r, i) => diffFile(r, i < 2 && rows.length < 4))) : h('p', { class: 'view-note' }, tt('findings.proposal.none')));
  }

  function stepEl(f, step) {
    const tt = t();
    const go = (extra) => h('button', { type: 'button', class: 'btn primary small-btn', 'data-key': `${f.id}:go`, onclick: () => confirm(f, step), ...extra }, tt('findings.act.confirm'));
    const stop = h('button', { type: 'button', class: 'btn small-btn', onclick: () => cancel(f) }, tt('findings.act.cancel'));
    if (step.kind === 'estimating') return h('div', { class: 'fdf-step', role: 'status' }, h('p', {}, tt('findings.estimate.wait')));
    if (step.kind === 'estimate-error') return h('div', { class: 'fdf-step is-warn', role: 'status' }, h('p', {}, tt('findings.estimate.error')), h('div', { class: 'fdf-step-actions' }, stop));
    if (step.kind === 'estimate') {
      return h('div', { class: 'fdf-step', role: 'group', 'aria-label': tt('findings.act.ai') },
        h('p', {}, tt('findings.estimate.text', { usd: usdWords(step.usd) })), h('div', { class: 'fdf-step-actions' }, go(), stop));
    }
    return h('div', { class: 'fdf-step is-warn', role: 'alertdialog', 'aria-label': tt('findings.sensitive.title') },
      h('p', { class: 'fdf-step-title' }, tt('findings.sensitive.title')),
      h('p', {}, step.files.length ? tt('findings.sensitive.text', { files: step.files.join(', ') }) : tt('findings.sensitive.unknown')),
      h('div', { class: 'fdf-step-actions' }, go(), stop));
  }

  function itemEl(f, later) {
    const tt = t();
    const words = findingWords(f, tt);
    const step = state.steps.get(f.id);
    const proposals = proposalsOf(f);
    const where = f.target?.file ? (f.target.line ? `${f.target.file}:${f.target.line}` : f.target.file) : null;
    const busy = state.busy.has(f.id);
    const ai = f.fix?.kind === 'ai-update' && !proposals.length;
    return h('li', { class: `fdf-item sev-${SEVERITIES.includes(f.severity) ? f.severity : 'detail'}`, 'data-id': f.id },
      h('div', { class: 'fdf-head' },
        later ? h('span', { class: 'fdf-sev' }, tt(`findings.sev.${SEVERITIES.includes(f.severity) ? f.severity : 'detail'}`)) : null,
        where ? (ctx.openFile
          ? h('button', { type: 'button', class: 'fdf-where', title: tt('findings.openFile', { where }), onclick: () => ctx.openFile(f.target.file, f.target.line) }, h('code', {}, where))
          : h('code', { class: 'fdf-where' }, where)) : null),
      h('p', { class: 'fdf-what' }, words.what),
      h('dl', { class: 'fdf-facts' },
        h('div', {}, h('dt', {}, tt('findings.why')), h('dd', {}, words.why)),
        h('div', {}, h('dt', {}, tt('findings.todo')), h('dd', {}, words.todo))),
      proposals.length ? h('p', { class: 'fdf-waiting' }, tt('findings.waiting')) : null,
      proposals.map(proposalEl),
      step ? stepEl(f, step) : null,
      step ? null : h('div', { class: 'fdf-actions' },
        h('button', {
          type: 'button', class: 'btn primary small-btn', 'data-key': `${f.id}:primary`, disabled: !canWrite() || busy,
          onclick: () => primary(f),
        }, proposals.length ? tt('findings.act.apply') : tt(ai ? 'findings.act.ai' : 'findings.act.accept')),
        later ? null : h('button', { type: 'button', class: 'btn small-btn', disabled: busy, onclick: () => send(f, { action: 'later' }, null) }, tt('findings.act.later')),
        h('button', { type: 'button', class: 'btn small-btn danger-quiet', disabled: busy, onclick: () => send(f, { action: 'never' }, null) }, tt('findings.act.never'))));
  }

  function section(s) {
    const tt = t();
    const label = tt(`findings.sev.${s.id}`);
    return h('section', { class: `fdf-section is-${s.id}`, 'aria-label': label },
      h('h3', { class: 'fdf-section-title' }, label, h('span', { class: 'fdf-count num' }, String(s.rows.length))),
      h('ul', { class: 'fdf-list' }, s.rows.map((f) => itemEl(f, s.id === 'later'))));
  }

  function body() {
    const tt = t();
    if (state.findings === undefined) return [h('p', { class: 'view-note' }, tt('findings.loading'))];
    if (state.error && !state.findings) return [h('p', { class: 'view-note' }, ctx.errorText(state.error))];
    if (state.findings === null) return [emptyState({ h, icon: ctx.icon }, { art: 'clock', title: tt('findings.notRead.title'), text: tt('findings.notRead.text') })];
    const sections = findingRows(state.findings);
    if (!sections.length) return [emptyState({ h, icon: ctx.icon }, { art: 'check', title: tt('findings.empty.title'), text: tt('findings.empty.text') })];
    const note = mode() === 'look' ? 'findings.mode.look' : mode() == null ? 'findings.mode.unset' : null;
    return [note ? h('p', { class: 'fdf-mode view-note' }, tt(note)) : null, ...sections.map(section)];
  }

  function draw() {
    if (!els) return;
    els.notice.replaceChildren(...(state.notice ? [h('p', { class: `fdf-notice is-${state.notice.tone}` }, state.notice.text)] : []));
    els.body.replaceChildren(...body().filter(Boolean));
    if (state.focus) {
      const key = state.focus;
      state.focus = null;
      rootEl?.querySelector?.(`[data-key="${globalThis.CSS?.escape ? globalThis.CSS.escape(key) : key}"]`)?.focus?.();
    }
  }

  function build(root) {
    const tt = t();
    els = {
      notice: h('div', { class: 'fdf-live', role: 'status' }),
      body: h('div', { class: 'fdf-body', 'aria-live': 'polite' }),
    };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdf-view' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('findings.title'))),
      h('p', { class: 'view-lede' }, tt('findings.lede')),
      els.notice, els.body));
  }

  return {
    render(root) {
      build(root);
      draw();
      return load();
    },
    refresh(root) {
      if (!els || rootEl !== root) return this.render(root);
      return load();
    },
  };
}
