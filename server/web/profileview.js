import { api } from './api.js';
import { emptyState } from './empty.js';
import { errorTextOf } from './compassview.js';

// The Profile card (fd perfil): what the program found about the project, each item with where it came from (file and
// line, or how it was worked out), the questions still open, and the owner's answers, which win over what was found.
// An answer is a PUT profile with only the owner's key; the server validates it and answers with the whole profile.
// The pure functions on top are tested on the --demo files; the view below draws them.
//
// ctx: h, t (translator function), icon(name, cls), project() ({ id }), openFile(file, line) (optional).

const STAGES = ['idea', 'prototype', 'first-client', 'growth', 'company'];
const CLOSED = {
  money: ['subscription', 'sale', 'ads', 'marketplace', 'free', 'personal'],
  audience: ['kids', 'health', 'business', 'general'],
  stage: STAGES,
  team: ['solo', 'team'],
  types: ['web', 'api', 'mobile', 'library', 'cli', 'game', 'data'],
  laws: ['LGPD', 'GDPR', 'UK-GDPR', 'CCPA', 'PIPEDA'],
};
const KIND = { country: 'text', money: 'single', audience: 'multi', stage: 'single', team: 'single', laws: 'multi', types: 'multi' };
const KEYS = Object.keys(KIND);
// Kept visible even when unanswered: the way to correct what was detected.
const ALWAYS = new Set(['types', 'team']);
const GROUPS = ['types', 'stacks', 'signals', 'team', 'deploy'];

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
const text = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const strings = (x) => list(x).filter((s) => typeof s === 'string' && s);

function evidenceOf(x) {
  return list(x).filter((e) => isObject(e) && text(e.file)).map((e) => ({ file: e.file, line: Number.isInteger(e.line) && e.line > 0 ? e.line : null }));
}

const optionsOf = (key, given) => (strings(given).length ? strings(given) : (CLOSED[key] ?? null));

// ----- pure -----

// profile: the answer of GET profile ({ detected, owner, questions, ... }) or null. `detected` holds what the program
// found; `owner` what the person said, which wins for the kind of project and the team.
export function profileRows(profile) {
  if (!isObject(profile)) return null;
  const d = isObject(profile.detected) ? profile.detected : {};
  const o = isObject(profile.owner) ? profile.owner : {};
  const detected = [];
  const ownTypes = strings(o.types);
  for (const name of ownTypes.length ? ownTypes : strings(d.types)) detected.push({ group: 'types', name, version: null, authors: null, evidence: [], overridden: ownTypes.length > 0 });
  for (const s of list(d.stacks).filter((x) => isObject(x) && text(x.name))) {
    detected.push({ group: 'stacks', name: s.name, version: text(s.version), authors: null, evidence: evidenceOf([{ file: s.file, line: s.line }]), overridden: false });
  }
  for (const s of list(d.signals).filter((x) => isObject(x) && text(x.kind))) {
    detected.push({ group: 'signals', name: s.kind, version: null, authors: null, evidence: evidenceOf(s.evidence), overridden: false });
  }
  const kind = text(o.team) ?? text(d.team?.kind);
  if (kind) {
    const authors = Number.isInteger(d.team?.authors) && d.team.authors > 0 ? d.team.authors : null;
    detected.push({ group: 'team', name: kind, version: null, authors, evidence: [], overridden: Boolean(text(o.team)) });
  }
  for (const s of list(d.deploy).filter((x) => isObject(x) && text(x.name))) {
    detected.push({ group: 'deploy', name: s.name, version: null, authors: null, evidence: evidenceOf(s.evidence), overridden: false });
  }
  const open = new Set(list(profile.questions).filter((q) => isObject(q)).map((q) => q.key));
  const asked = new Map(list(profile.questions).filter((q) => isObject(q)).map((q) => [q.key, q.options]));
  const answers = KEYS.map((key) => {
    const kindOf = KIND[key];
    const raw = o[key];
    const value = kindOf === 'multi' ? strings(raw) : text(raw);
    return { key, kind: kindOf, value, answered: kindOf === 'multi' ? value.length > 0 : value !== null, pending: open.has(key), options: optionsOf(key, asked.get(key)) };
  });
  return { detected, answers };
}

// The questions the server still has open, with the closed options of each. One this screen cannot show is left out.
export function questionsOf(profile) {
  return list(profile?.questions).filter((q) => isObject(q) && Object.hasOwn(KIND, q.key ?? '')).map((q) => ({
    key: q.key, kind: KIND[q.key], options: KIND[q.key] === 'text' ? null : optionsOf(q.key, q.options),
  }));
}

// ----- the view -----

export function createProfileView(ctx) {
  const { h } = ctx;
  const t = (key, vars) => ctx.t(key, vars);
  const state = { profile: undefined, error: null, editing: new Set(), forms: new Map() };
  let run = 0;
  let els = null;
  let rootEl = null;

  async function load() {
    const mine = ++run;
    const res = await api.fd(ctx.project().id, 'profile');
    if (mine !== run) return;
    if (!res.ok) {
      state.error = res.error;
      state.profile ??= null;
    } else {
      state.error = null;
      state.profile = res.data ?? null;
    }
    draw();
  }

  // ----- words -----

  const optionWord = (key, v) => {
    const room = { money: 'profile.money', audience: 'profile.audience', team: 'profile.team', types: 'profile.type', stage: 'rota.stage' }[key];
    if (!room) return v;
    const word = t(`${room}.${v}`);
    return word === `${room}.${v}` ? v : word;
  };
  const valueText = (a) => (a.kind === 'multi' ? a.value.map((v) => optionWord(a.key, v)).join(', ') : optionWord(a.key, a.value));

  // ----- what was found -----

  function whereEl(row) {
    if (row.evidence.length) {
      return h('span', { class: 'fdg-from' }, row.evidence.map((e) => {
        const where = e.line ? `${e.file}:${e.line}` : e.file;
        return ctx.openFile
          ? h('button', { type: 'button', class: 'fdg-where', title: where, onclick: () => ctx.openFile(e.file, e.line) }, h('code', {}, where))
          : h('code', { class: 'fdg-where' }, where);
      }));
    }
    return h('span', { class: 'fdg-from fdg-note' }, row.overridden ? t('profile.from.owner') : t(`profile.from.${row.group}`));
  }

  function nameOf(row) {
    if (row.group === 'types') return optionWord('types', row.name);
    if (row.group === 'team') return optionWord('team', row.name);
    if (row.group === 'signals') {
      const word = t(`profile.signal.${row.name}`);
      return word === `profile.signal.${row.name}` ? row.name : word;
    }
    return row.name;
  }

  function itemEl(row) {
    return h('li', { class: 'fdg-item', 'data-group': row.group, 'data-name': row.name },
      h('strong', { class: 'fdg-item-name' }, nameOf(row)),
      row.version ? h('span', { class: 'num fdg-note' }, row.version) : null,
      row.authors && !row.overridden ? h('span', { class: 'fdg-note' }, t('profile.team.authors', { n: row.authors })) : null,
      whereEl(row));
  }

  function foundSection(rows) {
    return h('section', { class: 'fdg-section fdg-found', 'aria-label': t('profile.found.title') },
      h('h3', { class: 'fdg-section-title' }, t('profile.found.title')),
      h('p', { class: 'view-note' }, t('profile.found.lede')),
      rows.length
        ? GROUPS.filter((g) => rows.some((r) => r.group === g)).map((g) => h('div', { class: 'fdg-group', 'data-group': g },
          h('h4', { class: 'fdg-group-title' }, t(`profile.group.${g}`)),
          h('ul', { class: 'fdg-list' }, rows.filter((r) => r.group === g).map(itemEl))))
        : h('p', { class: 'view-note' }, t('profile.found.none')));
  }

  // ----- the questions and the answers -----

  function formOf(q, a) {
    let st = state.forms.get(q.key);
    if (!st) {
      st = { draft: q.kind === 'multi' ? [...(a?.value ?? [])] : q.kind === 'text' ? (a?.value ?? '') : (a?.value ?? null), error: null, saving: false };
      state.forms.set(q.key, st);
    }
    return st;
  }

  const validDraft = (q, st) => (q.kind === 'text' ? /^[A-Za-z]{2}$/.test(st.draft) : q.kind === 'multi' ? st.draft.length > 0 : st.draft !== null);
  const sendable = (q, st) => (q.kind === 'text' ? st.draft.toUpperCase() : q.kind === 'multi' ? q.options.filter((o) => st.draft.includes(o)) : st.draft);

  async function save(q, value) {
    const st = state.forms.get(q.key);
    if (!st || st.saving) return;
    st.saving = true;
    st.error = null;
    draw();
    const res = await api.fdWrite(ctx.project().id, 'profile', { owner: { [q.key]: value } }, 'PUT');
    if (!res.ok) {
      st.saving = false;
      st.error = errorTextOf(ctx, res.error);
      draw();
      return;
    }
    state.forms.delete(q.key);
    state.editing.delete(q.key);
    if (isObject(res.data)) {
      state.profile = res.data;
      draw();
    } else {
      await load();
    }
  }

  function choicesEl(q, st, sync) {
    if (q.kind === 'text') {
      return h('input', {
        type: 'text', class: 'fdg-input', maxlength: 2, value: st.draft, autocomplete: 'off', 'aria-label': t(`profile.q.short.${q.key}`),
        oninput: (e) => { st.draft = e.target.value; st.touched = true; sync(); },
      });
    }
    const multi = q.kind === 'multi';
    return h('div', { class: 'fdg-options' }, q.options.map((o) => h('label', { class: 'fdg-option' },
      h('input', {
        type: multi ? 'checkbox' : 'radio', name: `fdg-${q.key}`, value: o,
        checked: multi ? st.draft.includes(o) : st.draft === o,
        onchange: (e) => {
          if (multi) st.draft = e.target.checked ? [...new Set([...st.draft, o])] : st.draft.filter((x) => x !== o);
          else st.draft = e.target.value;
          st.touched = true;
          sync();
        },
      }), ' ', optionWord(q.key, o))));
  }

  function questionEl(q, a, { closable }) {
    const st = formOf(q, a);
    const saveBtn = h('button', {
      type: 'button', class: 'btn primary small-btn fdg-save', disabled: !validDraft(q, st) || st.saving,
      onclick: () => (validDraft(q, st) ? save(q, sendable(q, st)) : undefined),
    }, t(st.saving ? 'profile.saving' : 'profile.save'));
    const sync = () => { saveBtn.disabled = !validDraft(q, st) || st.saving; };
    return h('li', { class: 'fdg-question', 'data-key': q.key },
      h('p', { class: 'fdg-q' }, t(`profile.q.${q.key}`)),
      choicesEl(q, st, sync),
      st.error ? h('p', { class: 'fdg-error', role: 'alert' }, st.error) : null,
      h('div', { class: 'fdg-actions' }, saveBtn,
        closable ? h('button', { type: 'button', class: 'btn small-btn', onclick: () => { state.forms.delete(q.key); state.editing.delete(q.key); draw(); } }, t('profile.cancel')) : null,
        a?.answered ? h('button', { type: 'button', class: 'btn small-btn', disabled: st.saving, onclick: () => save(q, null) }, t('profile.clear')) : null));
  }

  function answerEl(a) {
    return h('li', { class: 'fdg-answer', 'data-key': a.key },
      h('span', { class: 'fdg-answer-label' }, t(`profile.q.short.${a.key}`)),
      a.answered ? h('strong', { class: 'fdg-answer-value' }, valueText(a)) : h('span', { class: 'fdg-note' }, t('profile.unanswered')),
      h('button', { type: 'button', class: 'btn small-btn', onclick: () => { state.editing.add(a.key); draw(); } }, t('profile.change')));
  }

  const qOf = (a) => ({ key: a.key, kind: a.kind, options: a.kind === 'text' ? null : a.options });

  function questionsSection(open, byKey) {
    if (!open.length) return null;
    return h('section', { class: 'fdg-section fdg-questions', 'aria-label': t('profile.questions.title') },
      h('h3', { class: 'fdg-section-title' }, t('profile.questions.title')),
      h('p', { class: 'view-note' }, t('profile.questions.lede')),
      h('ul', { class: 'fdg-list' }, open.map((q) => questionEl(q, byKey[q.key], { closable: false }))));
  }

  function answersSection(answers, openKeys) {
    const shown = answers.filter((a) => !openKeys.has(a.key) && (a.answered || ALWAYS.has(a.key)));
    if (!shown.length) return null;
    return h('section', { class: 'fdg-section fdg-answers', 'aria-label': t('profile.answers.title') },
      h('h3', { class: 'fdg-section-title' }, t('profile.answers.title')),
      h('ul', { class: 'fdg-list' }, shown.map((a) => (state.editing.has(a.key) ? questionEl(qOf(a), a, { closable: true }) : answerEl(a)))));
  }

  function body() {
    if (state.profile === undefined) return [h('p', { class: 'view-note' }, t('profile.loading'))];
    if (state.error && !state.profile) {
      return [h('p', { class: 'view-note fdg-failed', role: 'alert' }, errorTextOf(ctx, state.error)),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => load() }, t('rota.retry'))];
    }
    const rows = profileRows(state.profile);
    if (!rows) return [emptyState({ h, icon: ctx.icon }, { art: 'list', title: t('profile.notRead.title'), text: t('profile.notRead.text') })];
    const open = questionsOf(state.profile);
    const byKey = Object.fromEntries(rows.answers.map((a) => [a.key, a]));
    return [foundSection(rows.detected), questionsSection(open, byKey), answersSection(rows.answers, new Set(open.map((q) => q.key)))];
  }

  function draw() {
    if (!els) return;
    els.body.replaceChildren(...body().filter(Boolean));
  }

  function build(root) {
    els = { body: h('div', { class: 'fdg-body', 'aria-live': 'polite' }) };
    rootEl = root;
    root.replaceChildren(h('div', { class: 'view-wrap fdg-view fdg-profile' },
      h('div', { class: 'view-head' }, h('h2', {}, t('profile.title'))),
      h('p', { class: 'view-lede' }, t('profile.lede')),
      els.body));
  }

  return {
    render(root) {
      state.editing.clear();
      state.forms.clear();
      build(root);
      draw();
      return load();
    },
    // A poll must not wipe a typed answer.
    refresh(root) {
      if (!els || rootEl !== root) return this.render(root);
      if (state.editing.size || [...state.forms.values()].some((f) => f.touched || f.saving || f.error)) return undefined;
      return load();
    },
  };
}
