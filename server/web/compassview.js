import { api } from './api.js';
import { badgeNode, stateBadge } from './badges.js';
import { emptyState } from './empty.js';

// The Route screen (fd rota): the five stages of a project with "you are here", where that answer came from, the next
// three actions each with the reason and an example from the project itself, and (full mode) the areas with their counts.
// Everything shown comes from the server's compass.json; this file only sorts it and draws it. What it does not
// understand falls to "not verified", and a missing file is "not read yet", never a zero. The pure functions on top are
// tested on the --demo files; the view below draws them.
//
// ctx: h, t (translator function), icon(name, cls), project() ({ id }), tech (bool or getter), openChat({ node, text }) (optional;
// without it the help button is not drawn), lang() (optional; otherwise the page language is read from the 'rota.lang' text).

const STAGES = ['idea', 'prototype', 'first-client', 'growth', 'company'];
const FRONT_STATE = { ok: 'pass', warning: 'warning', unverified: 'unverified', na: 'na' };
const FRONTS = ['organization', 'quality', 'security', 'operation', 'legal', 'product', 'marketing', 'finance'];
const BUSINESS = new Set(['legal', 'finance']);
const REASONS = new Set(['owner', 'few-files', 'no-data', 'level-below-n2', 'level-n2', 'level-n3', 'level-n4']);

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const count = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
const value = (x) => (typeof x === 'function' ? x() : x);

// A bilingual text of the library ({ en, 'pt-BR' }) or a plain one: the page language first, then English, never an empty string.
export function pick(x, lang) {
  if (typeof x === 'string') return text(x);
  if (!isObject(x)) return null;
  return text(x[lang]) ?? text(x.en);
}

export function langOf(ctx) {
  const given = typeof ctx.lang === 'function' ? ctx.lang() : ctx.lang;
  if (given === 'pt-BR' || given === 'en') return given;
  return ctx.t('rota.lang') === 'pt-BR' ? 'pt-BR' : 'en';
}

// The words for a server error code; anything without its own text falls to the generic one.
export function errorTextOf(ctx, code) {
  const key = `err.${code}`;
  const word = ctx.t(key);
  return word === key ? ctx.t('err.generic') : word;
}

// ----- pure -----

// compass: compass.json or null. One entry per stage; only the current one says where the answer came from.
export function stageStrip(compass) {
  const stages = list(compass?.stages).filter((s) => typeof s === 'string' && s);
  const now = stages.indexOf(compass?.stage?.key);
  return stages.map((key, i) => {
    const current = i === now;
    return {
      key,
      status: current ? 'current' : now >= 0 && i < now ? 'done' : 'next',
      current,
      origin: current ? (compass.stage.origin === 'owner' ? 'owner' : 'guessed') : null,
      reason: current ? text(compass.stage.reason) : null,
    };
  });
}

export function frontRows(compass) {
  return list(compass?.fronts).filter((f) => isObject(f) && text(f.front)).map((f) => {
    const state = Object.hasOwn(FRONT_STATE, f.state ?? '') ? f.state : 'unverified';
    const [pass, fail, unverified] = [count(f.pass), count(f.fail), count(f.unverified)];
    return { front: f.front, state, mark: FRONT_STATE[state], pass, fail, unverified, total: pass + fail + unverified };
  });
}

// The next actions in the language asked. A card whose texts did not come from the library still shows, with its id as the title.
export function nextCards(compass, lang = 'en') {
  return list(compass?.next3).filter((n) => isObject(n) && text(n.itemId)).map((n) => {
    const body = isObject(n.text) ? n.text : {};
    const askText = isObject(n.ask) ? pick(n.ask.text, lang) : null;
    return {
      itemId: n.itemId,
      front: text(n.front),
      title: pick(body.title, lang) ?? n.itemId,
      what: pick(body.what, lang),
      why: pick(body.why, lang),
      how: pick(body.how, lang),
      doneWhen: pick(body.doneWhen, lang),
      example: pick(body.example, lang),
      ask: askText ? { text: askText } : null,
      role: askText ? text(n.ask.role) : null,
      skills: askText ? list(n.ask.skills).filter((s) => typeof s === 'string' && s) : [],
    };
  });
}

// ----- the view -----

export function createCompassView(ctx) {
  const { h } = ctx;
  const t = (key, vars) => ctx.t(key, vars);
  const state = { compass: undefined, error: null, pick: null };
  let run = 0;
  let els = null;
  let rootEl = null;

  async function load() {
    const mine = ++run;
    const res = await api.fd(ctx.project().id, 'compass');
    if (mine !== run) return;
    if (!res.ok) {
      state.error = res.error;
      state.compass ??= null;
    } else {
      state.error = null;
      state.compass = res.data ?? null;
    }
    draw();
  }

  // ----- the stage strip and its question -----

  const frontName = (front) => (FRONTS.includes(front) ? t(`rota.front.${front}`) : front);
  const seal = (s) => badgeNode(h, t, stateBadge(s));

  function stageEl(s) {
    const mark = s.status === 'done' && ctx.icon ? ctx.icon('check', 'fdg-stage-icon') : null;
    return h('li', { class: `fdg-stage is-${s.status}`, 'data-stage': s.key, 'aria-current': s.current ? 'step' : null },
      h('span', { class: 'fdg-stage-name' }, mark, t(`rota.stage.${s.key}`)),
      s.current ? h('span', { class: 'fdg-stage-here' }, t('rota.here')) : null);
  }

  function originLine(now) {
    if (now.origin === 'owner') return t('rota.origin.owner');
    const code = REASONS.has(now.reason) ? now.reason : 'unknown';
    return t('rota.origin.guessed', { why: t(`rota.reason.${code}`) });
  }

  async function savePick(stage) {
    const p = state.pick;
    if (!p || p.saving) return;
    p.saving = true;
    p.error = null;
    drawPick();
    const res = await api.fdWrite(ctx.project().id, 'profile', { owner: { stage } }, 'PUT');
    if (!res.ok) {
      p.saving = false;
      p.error = errorTextOf(ctx, res.error);
      drawPick();
      return;
    }
    state.pick = null;
    await load();
  }

  function pickEl(strip) {
    const p = state.pick;
    const now = strip.find((s) => s.current);
    const saveBtn = h('button', {
      type: 'button', class: 'btn primary small-btn fdg-save', disabled: p.draft === null || p.saving,
      onclick: () => (p.draft === null ? undefined : savePick(p.draft)),
    }, t(p.saving ? 'rota.saving' : 'rota.pick.save'));
    const sync = () => { saveBtn.disabled = p.draft === null || p.saving; };
    return h('fieldset', { class: 'fdg-pick' },
      h('legend', {}, t('rota.pick.title')),
      h('div', { class: 'fdg-options' }, strip.map((s) => h('label', { class: 'fdg-option' },
        h('input', { type: 'radio', name: 'fdg-stage', value: s.key, checked: p.draft === s.key, onchange: (e) => { p.draft = e.target.value; sync(); } }),
        ' ', t(`rota.stage.${s.key}`)))),
      p.error ? h('p', { class: 'fdg-error', role: 'alert' }, p.error) : null,
      h('div', { class: 'fdg-actions' },
        saveBtn,
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => { state.pick = null; drawPick(); } }, t('rota.pick.cancel')),
        now?.origin === 'owner'
          ? h('button', { type: 'button', class: 'btn small-btn fdg-back', disabled: p.saving, onclick: () => savePick(null) }, t('rota.pick.back'))
          : null));
  }

  function drawPick() {
    if (!els?.pickBox) return;
    const strip = stageStrip(state.compass);
    els.pickBox.replaceChildren(...(state.pick && strip.length ? [pickEl(strip)] : []));
    els.notThisBtn?.setAttribute?.('aria-expanded', state.pick ? 'true' : 'false');
  }

  function stageSection(compass) {
    const strip = stageStrip(compass);
    if (!strip.length) return null;
    const now = strip.find((s) => s.current);
    els.pickBox = h('div', { class: 'fdg-pickbox' });
    const notThis = now ? h('button', {
      type: 'button', class: 'btn small-btn fdg-notthis', 'aria-expanded': 'false',
      onclick: () => { state.pick = state.pick ? null : { draft: null, error: null, saving: false }; drawPick(); },
    }, t('rota.notThis')) : null;
    els.notThisBtn = notThis;
    drawPick();
    return h('section', { class: 'fdg-section fdg-where', 'aria-label': t('rota.stages.label') },
      h('ol', { class: 'fdg-stages' }, strip.map(stageEl)),
      now ? h('p', { class: 'fdg-origin' }, originLine(now), ' ', notThis) : null,
      els.pickBox);
  }

  // ----- the actions -----

  function cardEl(c, nth) {
    const fact = (key, body) => (body ? [h('dt', {}, t(key)), h('dd', {}, body)] : null);
    return h('li', { class: 'fdg-card', 'data-item': c.itemId },
      h('div', { class: 'fdg-card-head' },
        h('h4', { class: 'fdg-card-title' }, c.title),
        c.front ? h('span', { class: 'fdg-chip' }, frontName(c.front)) : null),
      c.what ? h('p', { class: 'fdg-card-what' }, c.what) : null,
      h('dl', { class: 'fdg-facts' }, fact('rota.card.why', c.why), fact('rota.card.how', c.how),
        fact('rota.card.example', c.example), fact('rota.card.done', c.doneWhen)),
      c.ask && ctx.openChat
        ? h('button', {
          type: 'button', class: 'btn small-btn fdg-help', title: t('rota.card.help.hint'), 'data-nth': String(nth + 1),
          onclick: () => ctx.openChat({ node: { kind: 'project' }, text: c.ask.text }),
        }, ctx.icon ? ctx.icon('chat', 'btn-icon') : null, t('rota.card.help'))
        : null);
  }

  function nextSection(cards) {
    return h('section', { class: 'fdg-section fdg-next', 'aria-label': t('rota.next.title') },
      h('h3', { class: 'fdg-section-title' }, t('rota.next.title')),
      cards.length ? h('ol', { class: 'fdg-cards' }, cards.map(cardEl)) : h('p', { class: 'view-note' }, t('rota.next.empty')));
  }

  function frontsSection(rows) {
    if (!rows.length) return null;
    return h('section', { class: 'fdg-section', 'aria-label': t('rota.fronts.title') },
      h('h3', { class: 'fdg-section-title' }, t('rota.fronts.title')),
      h('ul', { class: 'fdg-fronts' }, rows.map((r) => h('li', { class: `fdg-front is-${r.state}`, 'data-front': r.front },
        h('span', { class: 'fdg-front-name' }, frontName(r.front)),
        seal(r.mark),
        r.state === 'na' ? null : h('span', { class: 'fdg-front-counts num' }, t('rota.counts', { pass: r.pass, fail: r.fail, unverified: r.unverified }))))));
  }

  // The fixed notice: shown when the route brings legal or money items, with the package's own notice when it has one.
  function noticeEl(compass, cards, lang) {
    const notices = list(compass.notices).filter(isObject).map((n) => pick(n.text, lang)).filter(Boolean);
    if (!notices.length && !cards.some((c) => BUSINESS.has(c.front))) return null;
    return h('div', { class: 'fdg-notice', role: 'note' }, h('p', {}, t('rota.notice')), notices.map((n) => h('p', { class: 'fdg-notice-more' }, n)));
  }

  function body() {
    if (state.compass === undefined) return [h('p', { class: 'view-note' }, t('rota.loading'))];
    if (state.error && !state.compass) {
      return [h('p', { class: 'view-note fdg-failed', role: 'alert' }, errorTextOf(ctx, state.error)),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => load() }, t('rota.retry'))];
    }
    if (state.compass === null) return [emptyState({ h, icon: ctx.icon }, { art: 'compass', title: t('rota.notRead.title'), text: t('rota.notRead.text') })];
    const lang = langOf(ctx);
    const cards = nextCards(state.compass, lang);
    return [
      stageSection(state.compass),
      nextSection(cards),
      noticeEl(state.compass, cards, lang),
      value(ctx.tech) ? frontsSection(frontRows(state.compass)) : null,
    ];
  }

  function draw() {
    if (!els) return;
    els.body.replaceChildren(...body().filter(Boolean));
  }

  function build(root) {
    els = { body: h('div', { class: 'fdg-body', 'aria-live': 'polite' }) };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdg-view' },
      h('div', { class: 'view-head' }, h('h2', {}, t('rota.title'))),
      h('p', { class: 'view-lede' }, t('rota.lede')),
      els.body));
  }

  return {
    render(root) {
      state.pick = null;
      build(root);
      draw();
      return load();
    },
    // A poll must not wipe an open question under the person's hands.
    refresh(root) {
      if (!els || rootEl !== root) return this.render(root);
      if (state.pick) return undefined;
      return load();
    },
  };
}
