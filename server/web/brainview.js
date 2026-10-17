// The Cérebro tab (id124, or39, id156): who does each job in the program. Only what exists and runs is drawn: the
// program's own functions, the agents that do the work, and the AIs that can take a job, each with the choice the
// person made. A row is one line of text; its selectors open on a click, so nothing is drawn that nobody is changing.
// Everything shown comes from the server's model (brainpanel.mjs); a change is saved whole and the scripts decide, never
// a prompt. The model selector lists every model of the chosen AI as its maker lists it (id168), with the real name.
export function createBrainView(ctx) {
  const { h, t, api, toast } = ctx;
  let model = null;
  let loaded = false;
  let rootEl = null;
  let proposal = null;
  // The rows and folds the person opened: they stay open when the page is drawn again after a save.
  const open = new Set();

  const isPt = () => (typeof ctx.lang === 'function' ? ctx.lang() === 'pt-BR' : true);
  const label = (row) => (isPt() ? row.labelPt : row.label);
  const does = (row) => (isPt() ? row.doesPt : row.does);
  const num = (v, digits = 2) => v.toLocaleString(isPt() ? 'pt-BR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const money = (v) => (Number.isFinite(v) ? `US$ ${num(v)}` : '—');
  const text = (key, vars) => {
    const v = t(key, vars);
    return typeof v === 'string' && v !== key ? v : '';
  };

  const AI_NAME = { claude: 'Claude', deepseek: 'DeepSeek', gemini: 'Gemini', openai: 'OpenAI', openrouter: 'OpenRouter' };
  const aiName = (p) => (p === 'auto' ? t('brain.auto') : AI_NAME[p] ?? p);
  // The real name of a model (the server says it: "Opus 5.5", "DeepSeek V4 Pro"), else the list's, else the id as it is.
  const listOf = (provider) => model?.modelList?.[provider] ?? [];
  const nameOfModel = (provider, id) => listOf(provider).find((m) => m.id === id)?.name ?? id;
  const levelName = (l) => text(`brain.lvl.${l}`) || l;
  // "Claude · Opus 5.5 · high"; when the model's name already starts with the AI's ("DeepSeek V4 Pro") the AI is not said twice.
  const pickOf = (f) => {
    const ai = aiName(f.provider);
    const name = f.modelName ?? nameOfModel(f.provider, f.model);
    const head = name && String(name).toLowerCase().startsWith(String(ai).toLowerCase()) ? [name] : [ai, name];
    return [...head, levelName(f.effort)].filter(Boolean).join(' · ');
  };
  // The one short word that says what a choice is: the policy's default, the person's own, or what the AI can do.
  const tagOf = (f) => ({ 'handoff-edits': text('brain.tag.edits'), 'handoff-answers': text('brain.tag.answers'), policy: text('brain.tag.default'), choice: text('brain.tag.mine') })[f.why] ?? '';

  // The tab's own styles, injected once: only what the shared sheet has no class for, in the app's variables.
  function ensureStyle() {
    if (document.getElementById('brain-view-style')) return;
    const el = document.createElement('style');
    el.id = 'brain-view-style';
    el.textContent = [
      '.br-view{max-width:880px;margin:0 auto;padding:8px 16px 56px}',
      '.br-title{font-size:var(--fs-2xl,22px);margin:4px 0 4px}',
      '.br-view ::selection{background:var(--active-fill)}',
      '.br-view select,.br-view textarea,.br-view input{accent-color:var(--active);caret-color:var(--active)}',
      '.br-view .br-sec{margin:46px 0 4px;font-size:15px;font-weight:650}',
      '.br-hint{color:var(--ink-2);font-size:12.5px;margin:0 0 10px;max-width:68ch}',
      '.br-list{border-top:1px solid var(--line)}',
      '.br-row{border-bottom:1px solid var(--line)}',
      '.br-row>summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:6px 14px;padding:12px 4px;border-radius:6px}',
      '.br-row>summary::-webkit-details-marker{display:none}',
      '.br-row>summary:hover{background:var(--bg-2)}',
      '.br-row>summary:focus-visible{outline:2px solid var(--focus,var(--active));outline-offset:1px}',
      '.br-row>summary::after{content:"";flex:none;width:6px;height:6px;margin-left:2px;border-right:1.5px solid var(--ink-2);border-bottom:1.5px solid var(--ink-2);transform:rotate(45deg) translateY(-2px);transition:transform .16s cubic-bezier(.22,1,.36,1)}',
      '.br-row[open]>summary::after{transform:rotate(-135deg) translateY(-1px)}',
      '.br-name{flex:1 1 auto;font-weight:600;font-size:14px}',
      '.br-kinds{margin-left:8px;color:var(--ink-2);font-weight:400;font-size:12px}',
      '.br-right{display:flex;align-items:baseline;gap:12px;min-width:0}',
      '.br-pick{color:var(--ink);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}',
      '.br-tag{flex:none;width:92px;color:var(--ink-2);font-size:11.5px}',
      '.br-body{padding:2px 4px 18px}',
      '.br-does{margin:0 0 8px;color:var(--ink-2);font-size:12.5px;max-width:68ch}',
      '.br-ctrls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-top:10px}',
      '.br-ctrls .dv-field{min-width:130px}',
      '.br-ctrls select{width:100%}',
      '.br-ctrls .br-modelfield{min-width:220px;flex:1 1 280px;max-width:420px}',
      '.br-modelnote{margin:8px 0 0;line-height:1.45;max-width:68ch}',
      '.br-lvl{display:flex;gap:6px;align-items:end;flex-wrap:wrap}',
      '.br-method{margin:6px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;max-width:68ch}',
      '.br-method li{margin:2px 0}',
      '.br-muted{color:var(--ink-2);font-size:12.5px}',
      '.br-more{margin-top:26px;border-top:1px solid var(--line)}',
      '.br-more>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:12px 4px;font-size:13.5px;font-weight:600;border-radius:6px}',
      '.br-more>summary::-webkit-details-marker{display:none}',
      '.br-more>summary::after{content:"";margin-left:auto;flex:none;width:6px;height:6px;border-right:1.5px solid var(--ink-2);border-bottom:1.5px solid var(--ink-2);transform:rotate(45deg) translateY(-2px);transition:transform .16s cubic-bezier(.22,1,.36,1)}',
      '.br-more[open]>summary::after{transform:rotate(-135deg) translateY(-1px)}',
      '.br-more>summary:hover{background:var(--bg-2)}',
      '.br-more>summary:focus-visible{outline:2px solid var(--focus,var(--active));outline-offset:1px}',
      '.br-more[open]>summary{margin-bottom:6px}',
      '.br-ais{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}',
      '.br-ais th{text-align:left;font-weight:600;font-size:11.5px;color:var(--ink-2);padding:8px 8px 6px 4px;border-bottom:1px solid var(--line)}',
      '.br-ais td{padding:10px 8px 10px 4px;border-bottom:1px solid var(--line);vertical-align:top}',
      '.br-ais td small{display:block;color:var(--ink-2);font-size:11.5px}',
      '.br-ais .br-ai-name{font-weight:600}',
      '.br-protect{margin:12px 0 0;color:var(--ink-2);font-size:12.5px;max-width:68ch}',
      '.br-notes{margin:6px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;max-width:68ch}',
      '.br-notes li{margin:3px 0}',
      '.br-sub{margin:26px 0 0;font-size:13px;font-weight:650}',
      '.br-ask-input{width:100%;max-width:620px;border:1px solid var(--line);border-radius:var(--r-md,8px);background:var(--bg-2);color:var(--ink);padding:8px 10px;font:inherit;font-size:var(--fs-sm,13px)}',
      '.br-ask-list{list-style:none;margin:8px 0;padding:0;gap:6px}',
      '.br-ask-list li{background:var(--bg-2);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12.5px}',
      '.br-checked.is-bad{border-color:var(--waiting);color:var(--waiting-ink)}',
      '@media (max-width:640px){',
      '.br-view{padding:8px 12px 48px}',
      '.br-row>summary{flex-wrap:wrap}',
      '.br-name{order:1;flex:1 1 0}',
      '.br-row>summary::after{order:2}',
      '.br-right{order:3;flex:1 1 100%}',
      '.br-pick{text-align:left}',
      '.br-tag{width:auto}',
      '.br-ais thead{position:absolute;left:-9999px}',
      '.br-ais tr{display:block;padding:8px 0;border-bottom:1px solid var(--line)}',
      '.br-ais td{display:flex;justify-content:space-between;gap:12px;border:none;padding:3px 4px}',
      '.br-ais td::before{content:attr(data-label);color:var(--ink-2);font-size:11.5px}',
      '.br-ais td:first-child{display:block;padding-bottom:4px}',
      '.br-ais td:first-child::before{content:none}',
      '}',
      '@media (prefers-reduced-motion:reduce){.br-row>summary::after,.br-more>summary::after{transition:none}}',
    ].join('\n');
    document.head.appendChild(el);
  }

  async function load() {
    const res = await api.brain();
    if (res.ok) model = res;
    loaded = true;
    return res;
  }

  async function saveFn(id, field, value) {
    const res = await api.setBrain({ functions: { [id]: { [field]: value } } });
    if (res.ok) {
      model = res;
      toast(t('brain.saved'));
      // The change may move a row (a new motor brings its own model catalog): draw again and keep the focus on the
      // selector the person just used.
      if (rootEl) {
        await render(rootEl);
        rootEl.querySelector(`[data-brain="${id}:${field}"]`)?.focus();
      }
    } else toast(res.error ? t('brain.saveFailed', { why: res.error }) : t('brain.saveFailed', { why: '—' }));
  }

  function selector(id, field, fieldLabel, value, options, autoLabel = t('brain.auto'), nameOf = (v) => v) {
    const domId = `br-${id}-${field}`;
    return h('div', { class: 'dv-field' },
      h('label', { for: domId }, fieldLabel),
      h('select', { id: domId, 'data-brain': `${id}:${field}`, onchange: (e) => saveFn(id, field, e.target.value) },
        options.map((v) => h('option', { value: v, selected: v === value }, v === 'auto' ? autoLabel : nameOf(v)))));
  }

  // The models a row may take: the whole list of its AI; a row run by Claude's helpers takes only the ones the helper tool
  // accepts. A server that sends no list (an older one) still gets the ids it always sent.
  function modelEntriesOf(f) {
    const provider = f.provider;
    if (!provider || provider === 'auto') return [];
    const list = model?.modelList?.[provider];
    if (!Array.isArray(list)) return (model?.modelCatalog?.[provider] ?? []).map((id) => ({ id, name: id, group: 'current', verified: true }));
    return provider === 'claude' && f.agent ? list.filter((m) => m.agent) : list;
  }

  const ctxText = (n) => {
    if (n < 1e6) return `${Math.round(n / 1000)}K`;
    const m = Math.round(n / 1e5) / 10;
    return `${Number.isInteger(m) ? m : num(m, 1)}M`;
  };
  // What the maker and the program know about one model, in one line: the maker's words, the context, the price, the exact
  // id the call sends, and an honest word for a model the program has not measured.
  function factsOf(m) {
    const parts = [];
    const note = isPt() ? m.notePt : m.noteEn;
    if (note) parts.push(note);
    if (m.context) parts.push(t('brain.ctx', { n: ctxText(m.context) }));
    parts.push(Number.isFinite(m.priceIn) && Number.isFinite(m.priceOut) ? t('brain.price', { a: num(m.priceIn), b: num(m.priceOut) }) : t('brain.noPrice'));
    if (m.resolved) parts.push(t('brain.callId', { id: m.resolved }));
    return parts.join(' · ');
  }

  // The groups the picker shows: the maker's own order inside each. OpenRouter groups by the maker of each model, since it
  // lists hundreds.
  function groupsOf(provider, entries) {
    const label = (m) => {
      if (provider === 'openrouter' && m.group === 'other') return m.maker ?? '';
      if (provider === 'claude') return m.group === 'current' ? t('brain.group.current') : t('brain.group.older');
      return m.group === 'current' ? t('brain.group.checked') : t('brain.group.listed');
    };
    const out = [];
    for (const m of entries) {
      const name = label(m);
      let g = out.find((x) => x.label === name);
      if (!g) out.push(g = { label: name, items: [] });
      g.items.push(m);
    }
    return out;
  }

  // The model selector of a row: every model of the AI with its real name, and under it what is known about the chosen one.
  function modelField(f) {
    const entries = modelEntriesOf(f);
    const domId = `br-${f.id}-model`;
    const current = f.model ?? 'auto';
    const chosen = entries.find((m) => m.id === current) ?? null;
    const option = (m) => h('option', { value: m.id, selected: m.id === current, title: factsOf(m) }, m.gone ? `${m.name} (${t('brain.goneTag')})` : m.name);
    const groups = groupsOf(f.provider, entries);
    const body = groups.length > 1 ? groups.map((g) => h('optgroup', { label: g.label }, g.items.map(option))) : entries.map(option);
    const stray = current !== 'auto' && !chosen && f.provider && f.provider !== 'auto' ? [h('option', { value: current, selected: true }, f.modelName ?? current)] : [];
    return h('div', { class: 'dv-field br-modelfield' },
      h('label', { for: domId }, t('brain.model')),
      h('select', { id: domId, 'data-brain': `${f.id}:model`, onchange: (e) => saveFn(f.id, 'model', e.target.value) },
        h('option', { value: 'auto', selected: current === 'auto' }, t('brain.autoModel')), body, stray));
  }

  // Under the controls: what is known about the chosen model, the way the maker lists it, and an honest word when the program
  // has not measured it or the maker no longer lists it.
  function modelNote(f) {
    const chosen = modelEntriesOf(f).find((m) => m.id === (f.model ?? 'auto')) ?? null;
    if (!chosen) return null;
    const notes = [factsOf(chosen)];
    if (chosen.verified === false) notes.push(t('brain.unverified'));
    if (chosen.gone) notes.push(t('brain.gone'));
    if (f.agent && f.provider === 'claude') notes.push(t('brain.agentOnly'));
    return h('p', { class: 'br-muted br-modelnote', 'data-brain-note': f.id }, notes.join(' '));
  }

  // The controls of one row: the AI, the model and the level, shown only when its row is opened.
  function controlsOf(f) {
    const providers = model.engineOptions ?? ['auto', 'claude'];
    // The level list is the engine's own vocabulary, minus the top (Ultracode), which is its own button.
    const levelOptions = [...new Set(['auto', ...((Array.isArray(f.levelOptions) ? f.levelOptions : ['low', 'medium', 'high']).filter((l) => l !== 'max'))])];
    const controls = h('div', { class: 'br-ctrls' },
      selector(f.id, 'provider', t('brain.motor'), f.provider, Array.isArray(f.providers) ? f.providers : providers, t('brain.auto'), aiName),
      modelField(f),
      h('span', { class: 'br-lvl' },
        selector(f.id, 'effort', t('brain.level'), f.effort, levelOptions, t('brain.autoEffort'), levelName),
        f.topLevel
          ? h('button', {
              type: 'button', class: `btn small-btn${f.effort === f.topLevel ? ' is-on' : ''}`,
              title: f.topLevel === 'ultracode' ? t('brain.ultracodeTitle') : t('brain.maxTitle'),
              onclick: () => saveFn(f.id, 'effort', f.effort === f.topLevel ? 'auto' : f.topLevel),
            }, f.topLevel === 'ultracode' ? t('brain.ultracode') : t('brain.maxBtn'))
          : null));
    return h('div', {}, controls, modelNote(f));
  }

  // One line of the page: the name, the choice as plain text and what that choice is; it opens to change it.
  function rowOf(id, name, kinds, pick, tag, body) {
    return h('details', {
      class: 'br-row', 'data-brain-row': id, open: open.has(id),
      ontoggle: (e) => { if (e.currentTarget.open) open.add(id); else open.delete(id); },
    },
    h('summary', {},
      h('span', { class: 'br-name' }, name, kinds ? h('span', { class: 'br-kinds' }, kinds) : null),
      h('span', { class: 'br-right' }, h('span', { class: 'br-pick' }, pick), h('span', { class: 'br-tag' }, tag || ''))),
    h('div', { class: 'br-body' }, body));
  }

  // What the choice means beyond its words: only the sentences that say something (a handoff, a note of the row).
  function explainOf(f) {
    const why = text(`brain.why.${f.why}`);
    const note = (f.note || f.notePt) ? (isPt() ? f.notePt : f.note) : '';
    const chat = f.id === 'chat' ? t('brain.chatNote') : '';
    return [why.length > 24 ? why : '', chat, note].filter(Boolean).map((s) => h('p', { class: 'br-does' }, s));
  }

  // The program's own functions: what decides, talks and works in the background. A row with no call of its own is not drawn.
  function programSection() {
    const order = ['chat', 'brain', 'opinion', 'background', 'book'];
    const rows = order.map((id) => model.functions.find((f) => f.id === id)).filter((f) => f && f.provider != null);
    return h('section', {},
      h('h2', { class: 'br-sec' }, t('brain.mainTitle')),
      h('p', { class: 'br-hint' }, t('brain.mainHint')),
      h('div', { class: 'br-list' }, rows.map((f) => rowOf(f.id, label(f), null, pickOf(f), tagOf(f),
        [h('p', { class: 'br-does' }, does(f)), ...explainOf(f), controlsOf(f)])))
    );
  }

  // The agents, one row each: the choice is the one the engine reads for the kinds the agent takes (the architect and the
  // guardian share one: high risk). The one rule for all agents is folded at the end, empty unless chosen.
  function agentsSection() {
    const roles = model.agents ?? [];
    const general = model.functions.find((f) => f.id === 'agents');
    const carried = new Map(); // a row id -> the first agent that carries its controls
    const rows = roles.map((a) => {
      const row = a.row;
      const first = row ? carried.get(row.id) : null;
      if (row && !first) carried.set(row.id, a);
      const name = isPt() ? a.labelPt : a.label;
      const method = h('ol', { class: 'br-method' }, (isPt() ? a.methodPt : a.method).map((s) => h('li', {}, s)));
      const delivers = h('p', { class: 'br-does' }, `${t('brain.roleExit')}: ${isPt() ? a.deliverPt : a.deliver}`);
      const body = [
        h('p', { class: 'br-does' }, `${t('brain.roleMethod')}:`), method, delivers,
        ...(row && !first ? [...explainOf(row), controlsOf(row)] : []),
      ];
      const pick = !row ? '' : first ? t('brain.sameAs', { name: isPt() ? first.labelPt : first.label }) : pickOf(row);
      return rowOf(`role-${a.id}`, name, a.kinds.map((k) => `[${k}]`).join(' '), pick, row && !first ? tagOf(row) : '', body);
    });
    // Unchosen, the general rule says auto everywhere: the policy's value it would otherwise show is no choice at all.
    const unset = general && general.why !== 'choice';
    const rule = general
      ? h('details', {
          class: 'br-more', open: open.has('general'),
          ontoggle: (e) => { if (e.currentTarget.open) open.add('general'); else open.delete('general'); },
        },
        h('summary', {}, t('brain.generalTitle')),
        h('p', { class: 'br-does' }, t('brain.generalHint')),
        controlsOf({ ...general, providers: ['auto', 'claude'], ...(unset ? { provider: 'auto', model: 'auto', effort: 'auto' } : {}) }))
      : null;
    return h('section', {},
      h('h2', { class: 'br-sec' }, t('brain.helpersTitle')),
      h('p', { class: 'br-hint' }, t('brain.helpersHint')),
      h('div', { class: 'br-list' }, rows),
      rule);
  }

  // The AIs that can take a job: only the ones with a key (and Claude), with what is known and measured about each, the
  // balance only where the provider publishes one, and whether each edits files today (what was a section of its own).
  function aisSection() {
    const engines = model.agentEngines ?? {};
    const have = model.matrix.filter((m) => m.hasKey);
    const without = model.matrix.filter((m) => !m.hasKey).map((m) => m.name);
    const range = (m, k) => {
      const v = m.models.map((x) => x[k]).filter(Number.isFinite);
      return v.length ? (Math.min(...v) === Math.max(...v) ? num(v[0]) : `${num(Math.min(...v))}–${num(Math.max(...v))}`) : '—';
    };
    const editsOf = (id) => {
      const e = engines[id]?.edits;
      return e === 'api' || e == null ? text('brain.edits.no') : e === 'worktree' ? text('brain.edits.copy') : e === 'claude-base' ? text('brain.edits.base') : text('brain.edits.yes');
    };
    const cell = (labelKey, ...kids) => h('td', { 'data-label': t(labelKey) }, ...kids);
    return h('section', {},
      h('h2', { class: 'br-sec' }, t('brain.aisTitle')),
      h('table', { class: 'br-ais' },
        h('thead', {}, h('tr', {}, ['brain.col.ai', 'brain.col.price', 'brain.col.score', 'brain.col.edits'].map((k) => h('th', { scope: 'col' }, t(k))))),
        h('tbody', {}, have.map((m) => h('tr', { 'data-brain-family': m.id },
          cell('brain.col.ai', h('span', { class: 'br-ai-name' }, m.name),
            listOf(m.id).length ? h('small', {}, t('brain.models.n', { n: listOf(m.id).length })) : null,
            Number.isFinite(m.balanceUSD) ? h('small', {}, t('brain.balanceOf', { v: money(m.balanceUSD) })) : null),
          cell('brain.col.price', `US$ ${range(m, 'in')} / ${range(m, 'out')}`),
          cell('brain.col.score', m.measured ? [`${Math.round(m.measured.accuracy * 100)}%`, h('small', {}, t('brain.measuredN', { n: m.measured.n, cost: money(m.measured.costPerCorrectUSD) }))] : h('span', { class: 'br-muted' }, '—')),
          cell('brain.col.edits', editsOf(m.id)))))),
      without.length ? h('p', { class: 'br-protect' }, t('brain.noKeyAis', { names: without.join(', ') })) : null,
      model.rules?.length ? [h('h3', { class: 'br-sub' }, t('brain.protectTitle')), h('ul', { class: 'br-notes' }, model.rules.map((r) => h('li', {}, isPt() ? r.pt : r.en)))] : null);
  }

  // Where each model list came from and when, and the button that reads them now (id168). The lists are read once a day by
  // themselves; the button is for the day a maker has just launched a model.
  async function refreshLists(button) {
    button.disabled = true;
    button.textContent = t('brain.lists.busy');
    const res = await api.refreshModels();
    if (res.ok) {
      model = res;
      toast(t('brain.lists.done'));
    } else toast(t('brain.saveFailed', { why: res.error ?? '—' }));
    if (rootEl) await render(rootEl);
  }

  function listsFold() {
    const info = model.modelsInfo ?? {};
    const ids = [...new Set(['claude', ...(model.engineOptions ?? []).filter((p) => p !== 'auto')])];
    const when = (iso) => new Date(iso).toLocaleString(isPt() ? 'pt-BR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' });
    const line = (id) => {
      const v = info[id] ?? {};
      const bits = [t('brain.lists.line', { name: aiName(id), n: v.source === 'built-in' || !v.count ? listOf(id).length : v.count, src: t(`brain.lists.src.${v.source ?? 'built-in'}`) })];
      if (v.checkedAt && v.source !== 'built-in') bits.push(t('brain.lists.when', { when: when(v.checkedAt) }));
      if (v.ok === false) bits.push(t('brain.lists.failed', { why: v.error ?? '—' }));
      return h('li', {}, bits.join(' · '));
    };
    return foldOf('lists', t('brain.lists.title'),
      h('p', { class: 'br-hint' }, t('brain.lists.hint')),
      h('ul', { class: 'dv-list br-ask-list' }, ids.map(line)),
      h('div', { class: 'dv-tools' }, h('button', { type: 'button', class: 'btn small-btn', 'data-brain-refresh': '1', onclick: (e) => refreshLists(e.currentTarget) }, t('brain.lists.refresh'))));
  }

  // The person asks the brain's own engine to configure the routing (or40): the proposal is validated by the server
  // and nothing changes until the person applies it.
  async function askConfigure() {
    const box = rootEl?.querySelector('#brAsk');
    const said = String(box?.value ?? '').trim();
    if (!said) return;
    box.value = '';
    proposal = { busy: true };
    updateProposal();
    const res = await api.brainConfig({ text: said });
    proposal = res;
    updateProposal();
  }

  function updateProposal() {
    const el = rootEl?.querySelector('#brProposal');
    if (el) el.replaceChildren(proposalArea());
  }

  function proposalArea() {
    if (!proposal) return null;
    if (proposal.busy) return h('p', { class: 'dv-status' }, t('brain.askBusy'));
    if (!proposal.ok) return h('p', { class: 'dv-status is-error' }, t('brain.askFail', { why: proposal.error ?? '—' }));
    const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
    const rejected = Array.isArray(proposal.rejected) ? proposal.rejected : [];
    return h('div', {},
      proposal.why ? h('p', { class: 'dv-status' }, proposal.why) : null,
      changes.length
        ? h('ul', { class: 'dv-list br-ask-list' }, changes.map((c) => h('li', {}, `${c.function}: ${c.provider ?? '—'} / ${c.model ?? '—'} / ${c.effort ?? '—'}`)))
        : h('p', { class: 'dv-status' }, t('brain.askNone')),
      rejected.length ? h('p', { class: 'dv-status is-error' }, t('brain.askRejected', { n: rejected.length })) : null,
      changes.length ? h('div', { class: 'dv-tools' }, h('button', {
        type: 'button', class: 'btn primary',
        onclick: async () => {
          const patch = Object.fromEntries(changes.map((c) => [c.function, { provider: c.provider, model: c.model, effort: c.effort }]));
          const res = await api.setBrain({ functions: patch });
          if (res.ok) {
            model = res; proposal = null;
            if (rootEl) await render(rootEl);
            toast(t('brain.saved'));
          } else toast(t('brain.saveFailed', { why: res.error ?? '—' }));
        },
      }, t('brain.askApply'))) : null,
      Number.isFinite(proposal.costUSD) ? h('p', { class: 'dv-status' }, t('brain.askCost', { cost: money(proposal.costUSD), ai: proposal.provider ?? '' })) : null);
  }

  // A fold at the foot of the page: for what is used now and then, not every time.
  function foldOf(id, title, ...kids) {
    return h('details', {
      class: 'br-more', open: open.has(id),
      ontoggle: (e) => { if (e.currentTarget.open) open.add(id); else open.delete(id); },
    }, h('summary', {}, title), ...kids);
  }

  function configureFold() {
    return foldOf('ask', t('brain.askTitle'),
      h('p', { class: 'br-hint' }, t('brain.askHint')),
      h('div', { class: 'dv-tools' },
        h('textarea', { id: 'brAsk', class: 'br-ask-input', rows: 2, placeholder: t('brain.askPlaceholder') }),
        h('button', { type: 'button', class: 'btn small-btn', onclick: () => askConfigure() }, t('brain.askButton'))),
      h('div', { id: 'brProposal', 'data-br-proposal': '1' }, proposalArea()));
  }

  // The levels the real calls validated (or41): each entry with its check, cost and error code, never a key.
  function checkedFold() {
    const lv = model.levels ?? { updatedAt: null, entries: [] };
    if (!lv.entries.length) return null;
    const ok = lv.entries.filter((e) => e.ok).length;
    const when = lv.updatedAt ? ` · ${new Date(lv.updatedAt).toLocaleDateString(isPt() ? 'pt-BR' : 'en-US')}` : '';
    const rows = lv.entries.map((e) => h('li', { class: `br-checked${e.ok ? '' : ' is-bad'}` },
      `${aiName(e.provider)} · ${nameOfModel(e.provider, e.model)} · ${levelName(e.level)} — ${e.ok ? `${t('brain.checked.ok')}, ${money(e.costUSD)}` : `${t('brain.checked.bad')} ${e.error ?? ''}`}`));
    return foldOf('levels', t('brain.checked.sum', { n: lv.entries.length, ok, bad: lv.entries.length - ok }) + when,
      h('p', { class: 'br-hint' }, t('brain.checked.hint')),
      h('ul', { class: 'dv-list br-ask-list' }, rows));
  }

  async function render(root) {
    ensureStyle();
    rootEl = root;
    if (!loaded) await load();
    if (!model) {
      root.replaceChildren(h('div', { class: 'dv-wrap' }, h('p', { class: 'dv-warning' }, t('brain.loadFail'))));
      return;
    }
    root.replaceChildren(h('div', { class: 'dv-wrap br-view' },
      h('h1', { class: 'br-title' }, t('brain.title')),
      h('p', { class: 'dv-lede' }, t('brain.sub')),
      programSection(),
      agentsSection(),
      aisSection(),
      listsFold(),
      configureFold(),
      checkedFold()));
  }

  return { render, refresh() {} };
}
