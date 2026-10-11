import { api } from './api.js';
import { badgeNode, stateBadge } from './badges.js';
import { emptyState } from './empty.js';

// The versions strip of a project (fd09): the version the code declares (with file and line), the last tag and whether
// they agree, the version running live when an address is configured, Node, the main pieces that carry a warning (and,
// apart, the ones nobody could check), the app's own version and the next number to publish. The pure model on top is
// tested; the view below draws it. Every state comes from the server's versions.json: this file only sorts and shows,
// and anything it does not understand falls to "not verified", never to a check mark.

export const PIECE_REASONS = ['no-version', 'no-source', 'no-network', 'error'];
const WARN_KINDS = ['vulnerable', 'eol', 'behind'];
const BECAUSE = ['feat', 'fix', 'breaking'];
const RELATIONS = ['equal', 'ahead', 'behind'];

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const lineOf = (n) => (Number.isInteger(n) && n > 0 ? n : null);
const list = (x) => (Array.isArray(x) ? x : []);

function codeOf(raw) {
  if (!isObject(raw) || !text(raw.version)) return null;
  const others = list(raw.others).filter((o) => isObject(o) && text(o.version)).map((o) => ({
    source: text(o.source), version: text(o.version), file: text(o.file), line: lineOf(o.line),
  }));
  return { version: text(raw.version), source: text(raw.source), file: text(raw.file), line: lineOf(raw.line), others };
}

function liveOf(raw) {
  if (!isObject(raw)) return null;
  const seal = raw.match === true ? 'confirmed' : raw.match === false ? 'warning' : 'unverified';
  return { url: text(raw.url), version: text(raw.version), seal, checkedAt: text(raw.checkedAt) };
}

function nodeOf(raw) {
  if (!isObject(raw)) return null;
  const verified = raw.verified === true;
  const seal = !verified ? 'unverified' : raw.eol === true ? 'warning' : raw.eol === false ? 'confirmed' : 'unverified';
  return { running: text(raw.running), required: text(raw.required), source: text(raw.source), seal };
}

function selfOf(raw) {
  if (!isObject(raw)) return null;
  const verified = raw.verified === true && text(raw.latest) !== null;
  const newer = verified && raw.newer === true;
  return { current: text(raw.current), latest: verified ? text(raw.latest) : null, newer, seal: !verified ? 'unverified' : newer ? 'warning' : 'confirmed' };
}

const warnRank = (kind) => WARN_KINDS.indexOf(kind);

// The pieces: a piece shows as a finding only when a source answered about it AND the kind of warning is one this
// screen knows. A piece nobody could check is listed apart with its reason; the clean checked ones are only counted.
function piecesOf(raw) {
  const warned = [];
  const unverified = [];
  let ok = 0;
  for (const p of list(raw)) {
    if (!isObject(p) || !text(p.name)) continue;
    const base = { name: text(p.name), version: text(p.version), file: text(p.file), line: lineOf(p.line) };
    const w = isObject(p.warning) ? p.warning : null;
    if (p.verified === true && w && WARN_KINDS.includes(w.kind)) {
      warned.push({ ...base, kind: w.kind, ids: list(w.ids).filter((i) => typeof i === 'string' && i), latest: text(p.latest), seal: 'warning' });
    } else if (p.verified === true && !w) {
      ok += 1;
    } else {
      const given = PIECE_REASONS.includes(p.reason) ? p.reason : null;
      unverified.push({ ...base, reason: given ?? 'no-source', seal: 'unverified' });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  warned.sort((a, b) => warnRank(a.kind) - warnRank(b.kind) || byName(a, b));
  unverified.sort(byName);
  return { warned, unverified, ok };
}

function nextOf(raw, tag) {
  if (!isObject(raw)) return { kind: tag ? 'none' : 'noTag', version: null, because: null, count: 0, alreadyInCode: false };
  const because = BECAUSE.includes(raw.because) ? raw.because : 'fix';
  const plain = raw.nonSemver !== true && text(raw.version) !== null;
  return {
    kind: plain ? 'version' : 'type', version: plain ? text(raw.version) : null, because,
    count: list(raw.commits).length, alreadyInCode: plain && raw.alreadyInCode === true,
  };
}

// v: versions.json or null. Everything the view draws is in the answer; nothing is read from anywhere else.
export function versionsModel(v) {
  const read = isObject(v);
  const src = read ? v : {};
  const tag = text(src.tag);
  const relation = RELATIONS.includes(src.relation) && tag ? src.relation : 'unknown';
  return {
    read,
    code: codeOf(src.code),
    tag,
    relation,
    seal: relation === 'equal' ? 'confirmed' : relation === 'unknown' ? 'unverified' : 'warning',
    live: liveOf(src.live),
    node: nodeOf(src.node),
    pieces: piecesOf(src.pieces),
    self: selfOf(src.selfVersion),
    next: nextOf(src.next, tag),
  };
}

const whenWords = (iso) => (typeof iso === 'string' ? iso.slice(0, 16).replace('T', ' ') : '');

export function createVersionsView(ctx) {
  const { h } = ctx;
  const t = () => ctx.t();
  const state = { versions: undefined, error: null };
  let run = 0;
  let els = null;
  let rootEl = null;

  async function load() {
    const mine = ++run;
    const res = await api.fd(ctx.project().id, 'versions');
    if (mine !== run) return;
    if (!res.ok) {
      state.error = res.error;
      state.versions ??= null;
    } else {
      state.error = null;
      state.versions = res.data ?? null;
    }
    draw();
  }

  // ----- drawing -----

  function whereButton(file, line) {
    if (!file) return null;
    const where = line ? `${file}:${line}` : file;
    return ctx.openFile
      ? h('button', { type: 'button', class: 'fdv-where', title: t()('versions.openFile', { where }), onclick: () => ctx.openFile(file, line) }, h('code', {}, where))
      : h('code', { class: 'fdv-where' }, where);
  }

  const row = (cls, label, ...value) => h('div', { class: `fdv-row ${cls}` }, h('dt', {}, label), h('dd', {}, value));
  const seal = (s) => badgeNode(h, t(), stateBadge(s));

  function codeRow(m) {
    const tt = t();
    if (!m.code) return row('fdv-code', tt('versions.code'), h('span', { class: 'fdv-none' }, tt('versions.code.none')));
    const c = m.code;
    return row('fdv-code', tt('versions.code'),
      h('strong', { class: 'fdv-num num' }, c.version),
      c.file ? whereButton(c.file, c.line) : h('span', { class: 'fdv-note' }, tt('versions.code.fromTag')),
      c.others.length ? h('div', { class: 'fdv-others' },
        h('span', { class: 'fdv-note' }, tt('versions.code.others')),
        c.others.map((o) => h('span', { class: 'fdv-other' }, h('span', { class: 'num' }, o.version), whereButton(o.file, o.line)))) : null);
  }

  function tagRow(m) {
    const tt = t();
    return row('fdv-tag', tt('versions.tag'),
      m.tag ? h('strong', { class: 'fdv-num num' }, m.tag) : h('span', { class: 'fdv-none' }, tt('versions.tag.none')),
      h('span', { class: 'fdv-relation' }, seal(m.seal), ' ', h('span', { class: 'fdv-note' }, tt(`versions.relation.${m.relation}`))));
  }

  function liveRow(m) {
    if (!m.live) return null;
    const tt = t();
    const l = m.live;
    return row('fdv-live', tt('versions.live'),
      l.version ? h('strong', { class: 'fdv-num num' }, l.version) : h('span', { class: 'fdv-none' }, tt('versions.live.none')),
      h('span', { class: 'fdv-seal' }, seal(l.seal), ' ', h('span', { class: 'fdv-note' }, tt(`versions.live.${l.seal}`))),
      l.checkedAt ? h('span', { class: 'fdv-note num' }, tt('versions.live.at', { when: whenWords(l.checkedAt) })) : null);
  }

  function nodeRow(m) {
    if (!m.node) return null;
    const tt = t();
    const n = m.node;
    return row('fdv-node', tt('versions.node'),
      n.running ? h('strong', { class: 'fdv-num num' }, n.running) : null,
      n.required ? h('span', { class: 'fdv-note' }, tt('versions.node.asks'), ' ', h('code', {}, n.required), n.source ? [' ', tt('versions.node.in'), ' ', h('code', {}, n.source)] : null) : null,
      h('span', { class: 'fdv-seal' }, seal(n.seal), ' ', h('span', { class: 'fdv-note' }, tt(`versions.node.${n.seal}`))));
  }

  function selfRow(m) {
    if (!m.self) return null;
    const tt = t();
    const s = m.self;
    return row('fdv-self', tt('versions.self'),
      s.current ? h('strong', { class: 'fdv-num num' }, s.current) : null,
      h('span', { class: 'fdv-seal' }, seal(s.seal), ' ',
        h('span', { class: 'fdv-note' }, s.newer ? [tt('versions.self.newer'), ' ', h('span', { class: 'num' }, s.latest)] : tt(`versions.self.${s.seal}`))));
  }

  function nextRow(m) {
    const tt = t();
    const n = m.next;
    const value = n.kind === 'version'
      ? [h('strong', { class: 'fdv-num num' }, n.version), h('span', { class: 'fdv-note' }, tt(`versions.because.${n.because}`)),
        h('span', { class: 'fdv-note num' }, tt('versions.next.commits', { n: n.count })),
        n.alreadyInCode ? h('span', { class: 'fdv-note' }, tt('versions.next.already')) : null]
      : n.kind === 'type'
        ? [h('strong', { class: 'fdv-kind' }, tt(`versions.because.${n.because}`)), h('span', { class: 'fdv-note' }, tt('versions.next.typeOnly'))]
        : [h('span', { class: 'fdv-none' }, tt(`versions.next.${n.kind}`))];
    return row('fdv-next', tt('versions.next'), value);
  }

  function pieceEl(p) {
    const tt = t();
    return h('li', { class: `fdv-piece kind-${p.kind}`, 'data-name': p.name },
      h('div', { class: 'fdv-piece-head' },
        h('strong', { class: 'fdv-piece-name' }, p.name),
        p.version ? h('span', { class: 'num' }, p.version) : null,
        seal(p.seal),
        h('span', { class: 'fdv-warn' }, tt(`versions.warn.${p.kind}`)),
        whereButton(p.file, p.line)),
      p.ids.length ? h('p', { class: 'fdv-ids' }, tt('versions.warn.ids'), ' ', p.ids.map((id) => h('code', { class: 'fdv-id' }, id))) : null,
      p.latest ? h('p', { class: 'fdv-note' }, tt('versions.warn.latest'), ' ', h('span', { class: 'num' }, p.latest)) : null);
  }

  function warnedEl(m) {
    const tt = t();
    const { warned, unverified, ok } = m.pieces;
    return h('section', { class: 'fdv-section fdv-pieces', 'aria-label': tt('versions.pieces') },
      h('h3', { class: 'fdv-section-title' }, tt('versions.pieces'), h('span', { class: 'fdv-count num' }, String(warned.length))),
      warned.length
        ? h('ul', { class: 'fdv-list' }, warned.map(pieceEl))
        : h('p', { class: 'view-note' }, tt(ok || unverified.length ? 'versions.pieces.none' : 'versions.pieces.empty')),
      ok ? h('p', { class: 'fdv-note num' }, tt('versions.pieces.ok', { n: ok })) : null);
  }

  function unverifiedEl(m) {
    const tt = t();
    const list_ = m.pieces.unverified;
    if (!list_.length) return null;
    return h('details', { class: 'fdv-unverified' },
      h('summary', {}, seal('unverified'), ' ', h('span', { class: 'fdv-count num' }, tt('versions.unverified.count', { n: list_.length }))),
      h('p', { class: 'view-note' }, tt('versions.unverified.lede')),
      h('ul', { class: 'fdv-plain' }, list_.map((p) => h('li', { class: 'fdv-plain-row', 'data-name': p.name },
        h('strong', { class: 'fdv-piece-name' }, p.name),
        p.version ? h('span', { class: 'num' }, p.version) : null,
        h('span', { class: 'fdv-note' }, tt(`versions.reason.${p.reason}`)),
        whereButton(p.file, p.line)))));
  }

  function body() {
    const tt = t();
    if (state.versions === undefined) return [h('p', { class: 'view-note' }, tt('versions.loading'))];
    if (state.error && !state.versions) return [h('p', { class: 'view-note' }, ctx.errorText(state.error))];
    if (state.versions === null) return [emptyState({ h, icon: ctx.icon }, { art: 'clock', title: tt('versions.notRead.title'), text: tt('versions.notRead.text') })];
    const m = versionsModel(state.versions);
    return [
      h('dl', { class: 'fdv-rows' }, codeRow(m), tagRow(m), liveRow(m), nodeRow(m), selfRow(m), nextRow(m)),
      warnedEl(m), unverifiedEl(m),
      h('p', { class: 'fdv-online view-note' }, tt('versions.online.hint')),
    ];
  }

  function draw() {
    if (!els) return;
    els.body.replaceChildren(...body().filter(Boolean));
  }

  function build(root) {
    const tt = t();
    els = { body: h('div', { class: 'fdv-body', 'aria-live': 'polite' }) };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdv-view' },
      h('div', { class: 'view-head' }, h('h2', {}, tt('versions.title'))),
      h('p', { class: 'view-lede' }, tt('versions.lede')),
      els.body));
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
