import { api } from './api.js';
import { foldReply } from './chatfold.js';
import { modelName } from './live.js';
import { chatLog, pcModeOffer, runWords } from './views.js';

const SSE_TYPES = ['user', 'session', 'mode', 'run', 'text', 'tool', 'permission', 'turn-end', 'error', 'draft'];
// How the conversation runs (server/chat/run.mjs): Automatic is the default of a new one.
const DEFAULT_RUN = { kind: 'auto', selfReinforce: false };
const WAYS = ['maestro', 'ultracode', 'fixed', 'settings'];
const MODELS = ['haiku', 'sonnet', 'opus'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const RUN_KINDS = new Set(['auto', ...WAYS]);
const usd = (v) => `US$ ${v.toFixed(2)}`;
// "settings" runs the chat in the mode of the person's own Claude settings; the rest are picked in the header.
const MODES = ['settings', 'default', 'acceptEdits', 'auto'];
const SAVED = 'sm.chat';

const browserStorage = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

// The chat that runs through the person's own claude CLI (desenho-2 § 22). One conversation at a time in the sheet.
// ctx: root (the sheet), h, t (translator getter), toast, errorText, onSession (a new conversation got its id),
// onPcMode(mode) (the person asked to use the mode on the whole PC), storage (where the open conversation is kept for
// a reload; savedKey null keeps nothing), relative (a date as "5 min ago"), money (a cost in the person's currency). The flow workshop adds onDraft(text) (the AI
// redrew the shared draft), beforeSend() (awaited before a message leaves) and showText(text) (what a reply shows).
// The sheet's parts are found by their data-chat role, so the map and the workshop each have a sheet of their own.
export function createChat({
  root, h, t, toast, errorText, onSession, onClose, onPcMode, storage = browserStorage(), savedKey = SAVED, relative = () => '',
  money = usd, onDraft, beforeSend, showText = (text) => text,
}) {
  const q = (role) => root.querySelector(`[data-chat="${role}"]`);
  const logEl = q('log');
  const form = q('form');
  const input = q('input');
  const sendBtn = q('send');
  const stopBtn = q('stop');
  const modeEl = q('mode');
  const listEl = q('list');
  const noteEl = q('note');
  const pcBtn = q('pcmode');
  const whereEl = q('where');
  const runEl = q('run');
  const panelEl = q('runpanel');
  // Two sheets (the map's and the workshop's) share this code: ids inside the panel carry the sheet's own.
  const uid = root.id || 'chat';
  let context = null;
  let key = null;
  let sessionId = null;
  let source = null;
  let log = undefined;
  let lastEventId = 0;
  let returnFocus = null;
  let settings = null;
  let choice = 'settings';
  let run = DEFAULT_RUN;
  let lastManual = { kind: 'maestro' };
  let lastFixed = { model: 'sonnet', effort: 'medium' };
  let confirmUltra = false;
  let mine = null;
  let reinforce = null;

  // Blocked storage (private window, a preview) only means a reload does not bring the conversation back.
  function remember(entry) {
    try {
      if (!savedKey) return;
      if (entry) storage?.setItem(savedKey, JSON.stringify(entry));
      else storage?.removeItem(savedKey);
    } catch { /* not remembered */ }
  }
  function remembered() {
    try { return savedKey ? JSON.parse(storage?.getItem(savedKey) ?? 'null') : null; } catch { return null; }
  }
  const rememberOpen = () => remember({ projectId: context.projectId, sessionId, title: context.title, subtitle: context.subtitle ?? '' });

  function detach() {
    source?.close();
    source = null;
  }

  function apply(evt) {
    if (evt.type === 'draft') return onDraft?.(evt.data.text);
    log = chatLog(log, evt);
    if (['run', 'turn-end', 'session'].includes(evt.type)) renderRun();
    if (evt.type === 'session' && evt.data.state === 'started') {
      const isNew = sessionId !== evt.data.sessionId;
      sessionId = evt.data.sessionId;
      rememberOpen();
      if (isNew) onSession?.(sessionId);
    }
    render();
  }

  function listen() {
    detach();
    source = api.chatEvents(key);
    for (const type of SSE_TYPES) {
      source.addEventListener(type, (e) => {
        // The transport's own 'error' (a dropped connection) carries no data; EventSource reconnects by itself.
        if (!('data' in e) || e.data === undefined) return;
        const id = Number(e.lastEventId) || 0;
        if (id && id <= lastEventId) return;
        lastEventId = id || lastEventId;
        let data;
        try { data = JSON.parse(e.data); } catch { return; }
        apply({ type, data });
      });
    }
  }

  // A new process numbers its events from 1 again.
  function watch(chatKey) {
    key = chatKey;
    lastEventId = 0;
    listen();
  }

  async function answer(item, allow, always = false) {
    const res = await api.chatPermission(key, item.requestId, allow, always);
    if (!res.ok) toast(errorText(res.error));
  }

  function itemView(item) {
    const tt = t();
    if (item.type === 'user' && item.auto) return h('li', { class: 'msg msg-auto' }, h('p', {}, tt('run.autoAnswered')));
    if (item.type === 'user') return h('li', { class: 'msg msg-user' }, h('span', { class: 'visually-hidden' }, `${tt('chat.you')}: `), h('p', {}, item.text));
    if (item.type === 'assistant') {
      const folded = foldReply(item.text);
      const asks = folded.run?.level === 'ask-reinforce' && item === log.items.at(-1) && !log.running;
      return h('li', { class: `msg msg-claude${item.streaming ? ' is-streaming' : ''}` }, h('span', { class: 'visually-hidden' }, 'Claude: '),
        folded.plan ? chip('plan', tt('fold.plan'), h('p', {}, folded.plan)) : null,
        folded.text || item.streaming ? h('p', {}, showText(folded.text)) : null,
        folded.card ? chip('card', folded.card.title ? tt('fold.card', { title: folded.card.title }) : tt('fold.cardUntitled'), cardBody(folded.card)) : null,
        asks ? askCard(folded.run) : null);
    }
    if (item.type === 'tool') {
      return h('li', { class: `msg msg-tool${item.isError ? ' is-error' : ''}` },
        h('details', {},
          h('summary', {}, h('span', { class: 'tool-name' }, item.name), item.result === null ? h('span', { class: 'tool-state' }, tt('chat.toolRunning')) : null),
          h('pre', {}, item.input),
          item.result !== null ? h('pre', { class: 'tool-result' }, item.result) : null));
    }
    if (item.type === 'permission') {
      const asked = item.state === 'asked' && !log.ended;
      return h('li', { class: `msg msg-permission state-${item.state}` },
        h('p', { class: 'perm-title' }, tt('chat.permAsk', { tool: item.toolName })),
        h('pre', {}, item.input),
        asked
          ? h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn primary', onclick: () => answer(item, true) }, tt('chat.allow')),
            h('button', { type: 'button', class: 'btn', onclick: () => answer(item, false) }, tt('chat.deny')),
            h('button', { type: 'button', class: 'btn', onclick: () => answer(item, true, true) }, tt('chat.always')),
            h('span', { class: 'perm-timer' }, tt('chat.permTimeout')))
          : h('p', { class: 'perm-state' }, tt(`chat.perm.${item.state}`)));
    }
    return h('li', { class: 'msg msg-error', role: 'alert' }, errorText(item.error));
  }

  // A block folded out of a reply: one line that opens to show what it said.
  function chip(kind, label, body) {
    return h('details', { class: `fold-chip fold-${kind}` }, h('summary', {}, label), h('div', { class: 'fold-body' }, body));
  }

  function cardBody(card) {
    const tt = t();
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    const rows = [
      typeof card.doing === 'string' ? [tt('chat.doing'), [card.doing]] : null,
      list(card.todo).length ? [tt('chat.todo'), list(card.todo)] : null,
      list(card.waiting).length ? [tt('chat.waitingFor'), list(card.waiting)] : null,
      list(card.decided).length ? [tt('fold.decided'), list(card.decided)] : null,
    ].filter(Boolean);
    if (!rows.length) return h('p', {}, tt('fold.cardEmpty'));
    return h('dl', { class: 'fold-card' }, rows.map(([name, values]) => [h('dt', {}, name), values.map((v) => h('dd', {}, v))]));
  }

  // Automatic asks before the reinforced way of working: the reason, the estimate and the two answers.
  function askCard(block) {
    const tt = t();
    const answer = (key) => () => { if (!sendBtn.disabled) send(tt(key)); };
    return h('div', { class: 'run-ask', role: 'group', 'aria-label': tt('run.ask.title') },
      h('p', { class: 'run-ask-title' }, tt('run.ask.title')),
      h('p', {}, Number.isFinite(block.estimateUSD)
        ? tt('run.ask.body', { why: block.why ?? tt('run.level.noReason'), cost: money(block.estimateUSD) })
        : tt('run.ask.bodyNoCost', { why: block.why ?? tt('run.level.noReason') })),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', 'data-run': 'ask-yes', onclick: answer('run.ask.yesText') }, tt('run.ask.yes')),
        h('button', { type: 'button', class: 'btn', 'data-run': 'ask-no', onclick: answer('run.ask.noText') }, tt('run.ask.no'))));
  }

  // ---- how the conversation runs: the header line and the Automatic / Manual panel ----

  function renderRun() {
    if (!runEl) return;
    const tt = t();
    const words = runWords(tt, { choice: run, info: log?.run ?? null, mine });
    const cost = log?.costUSD ?? null;
    const open = Boolean(panelEl && !panelEl.hidden);
    runEl.replaceChildren(
      h('button', {
        type: 'button', class: `run-toggle tone-${words.tone}`, 'data-run': 'toggle', 'aria-expanded': String(open),
        'aria-controls': panelEl?.id || null, title: tt('run.change'), onclick: togglePanel,
      },
      h('span', { class: 'run-way' }, words.way),
      h('span', { class: 'run-model' }, [words.model, words.effort].filter(Boolean).join(' · ')),
      cost !== null ? h('span', { class: 'run-cost num', title: tt('run.costTitle') }, money(cost)) : null,
      h('span', { class: 'run-caret', 'aria-hidden': 'true' })),
      h('p', { class: 'run-why' }, words.why));
  }

  function togglePanel() {
    if (!panelEl) return;
    panelEl.hidden = !panelEl.hidden;
    confirmUltra = false;
    renderRun();
    renderPanel();
  }

  async function pick(next) {
    run = next;
    confirmUltra = false;
    if (next.kind !== 'auto') lastManual = next;
    if (next.kind === 'fixed') lastFixed = { model: next.model, effort: next.effort };
    renderRun();
    renderPanel();
    // Not started yet, or paused: the choice goes with the next message.
    if (!key || !log || log.ended) return;
    const res = await api.chatRun(key, next);
    if (!res.ok && res.error !== 'ended') toast(errorText(res.error));
  }

  function chooseWay(way) {
    if (way === 'ultracode') {
      confirmUltra = true;
      return renderPanel();
    }
    return pick(way === 'fixed' ? { kind: 'fixed', ...lastFixed } : { kind: way });
  }

  async function saveLimit(input) {
    const value = Number(String(input.value).replace(',', '.'));
    const res = await api.setReinforcedLimit(value);
    if (!res.ok) return toast(errorText(res.error));
    reinforce = { ...reinforce, limitUSD: res.limitUSD };
    renderPanel();
    return toast(t()('run.limitSaved', { limit: money(res.limitUSD) }));
  }

  function option({ name, value, checked, onchange, title, hint, tag }) {
    return h('label', { class: 'run-option' },
      h('input', { type: 'radio', name, value, checked, 'data-run': tag, onchange }),
      h('span', { class: 'run-option-text' }, h('span', { class: 'run-option-name' }, title), h('span', { class: 'run-hint' }, hint)));
  }

  function autoPart(tt) {
    const limitId = `${uid}-run-limit`;
    const limit = reinforce?.limitUSD ?? null;
    const field = h('input', { id: limitId, type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'num', value: limit === null ? '' : String(limit), 'data-run': 'limit' });
    return [
      h('p', { class: 'run-lede' }, tt('run.hint.auto')),
      h('label', { class: 'run-check' },
        h('input', { type: 'checkbox', checked: run.selfReinforce, 'data-run': 'self', onchange: () => pick({ kind: 'auto', selfReinforce: !run.selfReinforce }) }),
        h('span', { class: 'run-option-text' }, h('span', { class: 'run-option-name' }, tt('run.self')), h('span', { class: 'run-hint' }, tt('run.selfHint')))),
      h('div', { class: 'run-limit' },
        h('label', { for: limitId }, tt('run.limitLabel')),
        h('div', { class: 'run-limit-row' },
          field,
          h('button', { type: 'button', class: 'btn small-btn', 'data-run': 'limit-save', onclick: () => saveLimit(field) }, tt('run.limitSave'))),
        h('p', { class: 'run-hint' }, limit === null ? tt('run.limitNone') : tt('run.limitUsed', { used: money(reinforce?.spentUSD ?? 0), limit: money(limit) }))),
    ];
  }

  // What a way needs right under it: the cost warning of Ultracode, the model and level of a fixed run.
  function ultraWarning(tt) {
    return h('div', { class: 'run-warn', role: 'alert' },
      h('p', { class: 'run-warn-title' }, tt('run.ultra.title')),
      h('p', {}, tt('run.ultra.warn')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', 'data-run': 'ultra-yes', onclick: () => pick({ kind: 'ultracode' }) }, tt('run.ultra.yes')),
        h('button', { type: 'button', class: 'btn', 'data-run': 'ultra-no', onclick: () => { confirmUltra = false; renderPanel(); } }, tt('run.ultra.no'))));
  }

  function fixedChoices(tt) {
    return h('div', { class: 'run-fixed' },
      h('fieldset', { class: 'run-models' }, h('legend', {}, tt('run.modelLabel')),
        MODELS.map((m) => option({
          name: `${uid}-run-model`, value: m, checked: run.model === m, tag: `model-${m}`, onchange: () => pick({ ...run, model: m }),
          title: modelName(m), hint: tt(`run.modelHint.${m}`),
        }))),
      h('div', { class: 'run-effort' },
        h('p', { class: 'run-effort-label', id: `${uid}-run-effort` }, tt('run.effortLabel')),
        h('div', { class: 'seg', role: 'group', 'aria-labelledby': `${uid}-run-effort` },
          EFFORTS.map((e) => h('button', { type: 'button', 'data-run': `effort-${e}`, 'aria-pressed': String(run.effort === e), onclick: () => pick({ ...run, effort: e }) }, tt(`run.effort.${e}`)))),
        h('p', { class: 'run-hint' }, tt(`run.effortHint.${run.effort}`))));
  }

  function manualPart(tt) {
    const name = `${uid}-run-way`;
    const mineVars = { model: mine?.model ? modelName(mine.model) : tt('run.modelDefault'), effort: mine?.effort ? tt(`run.effort.${mine.effort}`) : tt('run.effortDefault') };
    return [h('fieldset', { class: 'run-ways' }, h('legend', {}, tt('run.wayLabel')),
      WAYS.map((way) => [
        option({
          name, value: way, checked: run.kind === way, tag: `way-${way}`, onchange: () => chooseWay(way),
          title: tt(`run.way.${way}`), hint: tt(`run.hint.${way}`, way === 'settings' ? mineVars : undefined),
        }),
        way === 'ultracode' && confirmUltra ? ultraWarning(tt) : null,
        way === 'fixed' && run.kind === 'fixed' ? fixedChoices(tt) : null,
      ]))];
  }

  function renderPanel() {
    if (!panelEl || panelEl.hidden) return;
    const tt = t();
    const manual = run.kind !== 'auto';
    panelEl.replaceChildren(
      h('div', { class: 'seg run-path', role: 'group', 'aria-label': tt('run.pathLabel') },
        h('button', { type: 'button', 'data-run': 'path-auto', 'aria-pressed': String(!manual), onclick: () => { if (manual) pick({ kind: 'auto', selfReinforce: false }); } }, tt('run.path.auto')),
        h('button', { type: 'button', 'data-run': 'path-manual', 'aria-pressed': String(manual), onclick: () => { if (!manual) pick(lastManual); } }, tt('run.path.manual'))),
      ...(manual ? manualPart(tt) : autoPart(tt)));
  }

  const modeName = (mode) => t()(`chat.modeName.${mode}`);

  function renderMode() {
    const tt = t();
    modeEl.replaceChildren(...MODES.map((m) => h('option', { value: m }, m === 'settings' ? tt('chat.mode.settings', { mode: modeName(settings?.mode ?? 'default') }) : modeName(m))));
    modeEl.value = choice;
    const offer = pcModeOffer(choice, null);
    pcBtn.disabled = !offer.mode;
    pcBtn.title = offer.mode ? tt('pcmode.hint') : tt('pcmode.pickFirst');
    noteEl.hidden = !settings?.downgraded;
    noteEl.textContent = settings?.downgraded ? tt('chat.downgraded') : '';
  }

  // A conversation that lives elsewhere (VS Code, a terminal): where it is, what can be done there, and whether it may be
  // written here. ctx.where() is asked again on each render, so it follows the language.
  function renderWhere() {
    const where = context?.where?.() ?? null;
    form.hidden = Boolean(where && !where.canWrite);
    // Nothing is run from here while it is open elsewhere, so the permission row has nothing to say.
    const modeRow = modeEl.closest?.('.chat-mode');
    if (modeRow) modeRow.hidden = form.hidden;
    if (!whereEl) return;
    whereEl.hidden = !where;
    whereEl.replaceChildren(...(where ? [
      h('p', {}, where.note),
      where.actions.length ? h('div', { class: 'actions' }, where.actions.map((a) => h('button', { type: 'button', class: 'btn small-btn', onclick: a.onclick }, a.label))) : null,
    ].filter(Boolean) : []));
  }

  function render() {
    const tt = t();
    renderWhere();
    const items = log?.items ?? [];
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    logEl.replaceChildren(...(items.length ? items.map(itemView) : [h('li', { class: 'msg-intro' }, context?.intro ?? tt('chat.introResume'))]));
    if (stick || items.at(-1)?.type === 'user') logEl.scrollTop = logEl.scrollHeight;
    const running = Boolean(log?.running);
    // An ended process is only paused: with its id known, the next message resumes the conversation.
    const stuck = Boolean(log?.ended) && !sessionId;
    stopBtn.hidden = !running;
    sendBtn.disabled = running || stuck;
    input.disabled = stuck;
    let status = '';
    if (running) status = tt('chat.thinking');
    else if (log?.ended) status = sessionId ? tt('chat.paused') : tt('chat.ended');
    else if (log?.mode) status = tt('chat.modeNow', { mode: modeName(log.mode) });
    q('status').textContent = status;
  }

  async function send(text) {
    log = chatLog(log, { type: 'local-send', data: { text } });
    listEl.hidden = true;
    render();
    await beforeSend?.();
    const live = key && !log.ended;
    const start = sessionId ? { sessionId } : context.start;
    const res = live ? await api.chatSend(key, text) : await api.chatStart({ projectId: context.projectId, ...start, mode: choice, run, text });
    if (!res.ok && !(res.error === 'busy' && res.chatKey)) {
      log = chatLog(log, { type: 'error', data: { error: res.error } });
      return render();
    }
    if (!live) watch(res.chatKey);
    return undefined;
  }

  // The conversations the page opened on this point of the map (or branch), and what the person's Claude settings say.
  async function loadList(ctx) {
    const node = ctx.start?.node;
    let scope = {};
    if (node?.kind === 'idea' || node?.kind === 'create-arch' || node?.kind === 'flow') scope = { kind: node.kind };
    else if (node?.partId) scope = { partId: node.partId, ...(node.kind === 'item' && node.code ? { code: node.code } : {}) };
    else if (ctx.start?.workCellId) scope = { workCellId: ctx.start.workCellId };
    const res = await api.chatList({ projectId: ctx.projectId, ...scope });
    if (context !== ctx || !res.ok) return;
    settings = res.settings ?? null;
    mine = res.mine ?? null;
    reinforce = res.reinforce ?? null;
    renderMode();
    renderRun();
    renderPanel();
    const chats = res.chats ?? [];
    if (!chats.length || key || log?.items.length) return;
    const tt = t();
    listEl.replaceChildren(
      h('li', { class: 'chat-list-head' }, tt('chat.openHere')),
      ...chats.map((c) => h('li', {},
        h('button', { type: 'button', class: 'link-row', onclick: () => resume({ projectId: ctx.projectId, sessionId: c.sessionId, title: c.title || ctx.title, subtitle: ctx.subtitle }) },
          h('span', { class: 'lr-title' }, c.title || tt('chat.untitled')),
          h('span', { class: 'lr-date' }, c.running ? tt('chat.running') : relative(c.updatedAt))))));
    listEl.hidden = false;
  }

  // A conversation the page opened before: its history, and its running process if there still is one.
  async function loadHistory(ctx) {
    const res = await api.chatHistory(ctx.start.sessionId);
    if (context !== ctx || !res.ok) return;
    settings = res.settings ?? settings;
    choice = MODES.includes(res.mode) ? res.mode : 'settings';
    // What the conversation ran with before; one from elsewhere (or older than these choices) keeps its own Claude.
    run = RUN_KINDS.has(res.run?.kind) ? res.run : { kind: 'settings' };
    if (run.kind !== 'auto') lastManual = run;
    mine = res.mine ?? mine;
    reinforce = res.reinforce ?? reinforce;
    sessionId = ctx.start.sessionId;
    rememberOpen();
    log = chatLog(log, { type: 'history', data: { messages: res.messages ?? [], costUSD: res.costUSD } });
    if (res.chatKey) watch(res.chatKey);
    renderMode();
    renderRun();
    renderPanel();
    render();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = '';
    send(text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  stopBtn.addEventListener('click', async () => {
    const res = await api.chatStop(key);
    if (!res.ok) toast(errorText(res.error));
  });
  // The choice is per conversation: a running one switches now, otherwise it goes with the next message.
  modeEl.addEventListener('change', async () => {
    choice = MODES.includes(modeEl.value) ? modeEl.value : 'settings';
    renderMode();
    if (!key || log?.ended) return;
    const res = await api.chatMode(key, choice);
    if (!res.ok) toast(errorText(res.error));
  });
  pcBtn.addEventListener('click', () => { if (!pcBtn.disabled) onPcMode?.(choice); });
  q('close').addEventListener('click', () => close());

  function open(ctx) {
    if (root.hidden) returnFocus = document.activeElement;
    detach();
    context = ctx;
    key = null;
    sessionId = null;
    log = undefined;
    lastEventId = 0;
    choice = 'settings';
    run = DEFAULT_RUN;
    lastManual = { kind: 'maestro' };
    confirmUltra = false;
    if (panelEl) panelEl.hidden = true;
    listEl.hidden = true;
    listEl.replaceChildren();
    q('title').textContent = ctx.title;
    q('context').textContent = ctx.subtitle ?? '';
    input.placeholder = t()('chat.placeholder');
    input.value = ctx.draft ?? '';
    root.hidden = false;
    renderMode();
    renderRun();
    render();
    input.focus();
    if (ctx.start?.sessionId) loadHistory(ctx);
    else loadList(ctx);
  }

  function resume(entry) {
    open({ projectId: entry.projectId, title: entry.title, subtitle: entry.subtitle || t()('chat.resuming'), intro: t()('chat.introResume'), start: { sessionId: entry.sessionId } });
  }

  function close() {
    if (root.hidden) return;
    // The conversation keeps running on the PC; closing only stops watching it here.
    detach();
    remember(null);
    root.hidden = true;
    onClose?.();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  return {
    open,
    close,
    isOpen: () => !root.hidden,
    // The conversation the sheet shows, once it has an id.
    current: () => (root.hidden ? null : sessionId ?? context?.start?.sessionId ?? null),
    // After a reload: the conversation that was open in this project's sheet.
    restore(projectId) {
      const saved = remembered();
      if (saved && saved.projectId === projectId && typeof saved.sessionId === 'string') resume(saved);
    },
    // Left open over another project, the sheet would start its conversation in the old project's folder.
    showProject(projectId) { if (context && context.projectId !== projectId) close(); },
    relabel() { if (!root.hidden) { input.placeholder = t()('chat.placeholder'); renderMode(); renderRun(); renderPanel(); render(); } },
  };
}
