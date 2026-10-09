import { api } from './api.js';
import { foldReply } from './chatfold.js';
import { modelName } from './live.js';
import { createTranscript, dayName, findHits, latestTodos, timeOf, withDays } from './transcript.js';
import { chatLog, chatState, pcModeOffer, runWords } from './views.js';
import { signalCard } from './blocks.js';
import { errorSignal } from './signals.js';

const SSE_TYPES = ['user', 'session', 'mode', 'run', 'text', 'thinking', 'tool', 'permission', 'turn-end', 'error', 'draft'];
// How the conversation runs (server/chat/run.mjs): Automatic is the default of a new one.
const DEFAULT_RUN = { kind: 'auto', selfReinforce: false };
const WAYS = ['maestro', 'ultracode', 'fixed', 'settings'];
const MODELS = ['haiku', 'sonnet', 'opus'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const RUN_KINDS = new Set(['auto', ...WAYS]);
const usd = (v) => `US$ ${v.toFixed(2)}`;
// "settings" runs the chat in the mode of the person's own Claude settings; the rest are picked in the header.
const MODES = ['settings', 'default', 'acceptEdits', 'plan', 'auto'];
const SAVED = 'sm.chat';
// What the composer accepts like Claude Code does (the server checks the same): a few images per message.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGES_MAX = 4;
const IMAGE_BYTES_MAX = 3_700_000;
// A conversation still running in VS Code or a terminal is asked again this often while it is open here.
const MIRROR_MS = 3000;
const SUGGEST_MAX = 8;

// A picked or pasted image file as {media, data} (base64), the way the server passes it to claude.
const readAsBase64 = (file) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ media: file.type, data: String(reader.result).split(',')[1] ?? '' });
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(file);
});

const browserStorage = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

// The chat that runs through the person's own claude CLI (desenho-2 § 22). One conversation at a time in the sheet.
// ctx: root (the sheet), h, t (translator getter), toast, errorText, onSession (a new conversation got its id),
// onPcMode(mode) (the person asked to use the mode on the whole PC), storage (where the open conversation is kept for
// a reload; savedKey null keeps nothing), relative (a date as "5 min ago"), money (a cost in the person's currency). The flow workshop adds onDraft(text) (the AI
// redrew the shared draft), beforeSend() (awaited before a message leaves) and showText(text) (what a reply shows).
// mm22 adds lang() (for times and dates), icon(name, cls), commands() (the "/" list: [{name, description}]), and for tests
// schedule/cancel (the live mirror's timer), readImage(file) and debounceMs.
// The sheet's parts are found by their data-chat role, so the map and the workshop each have a sheet of their own; the
// optional ones (find, tasks, attach, filepick, pending, suggest) are simply left out where a sheet has none.
export function createChat({
  root, h, t, toast, errorText, onSession, onClose, onPcMode, storage = browserStorage(), savedKey = SAVED, relative = () => '',
  money = usd, onDraft, beforeSend, showText = (text) => text, lang = () => 'en', icon = null, commands = () => [],
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id), readImage = readAsBase64, debounceMs = 150,
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
  const findEl = q('find');
  const tasksEl = q('tasks');
  const attachEl = q('attach');
  const fileEl = q('filepick');
  const pendingEl = q('pending');
  const suggestEl = q('suggest');
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
  // mm22: what is drawn (items with their date lines) and the node of each, reused while the item is the same object.
  let shown = [];
  let nodes = [];
  let cache = new WeakMap();
  let byContent = new Map();
  let drawn = new Set();
  let dayCache = new Map();
  let findQuery = '';
  let findAt = 0;
  let jumpKey = '';
  let tasksOpen = false;
  let mirror = null;
  let pending = [];
  let suggest = null;
  let suggestSeq = 0;
  let suggestTimer = null;
  let findInput = null;
  let findCount = null;
  let jumpSel = null;
  let liveBadge = null;

  const time = (ts) => timeOf(lang(), ts);
  const dayLabel = (dayKey) => dayName(t(), lang(), dayKey);
  const shownId = () => sessionId ?? context?.start?.sessionId ?? null;
  const tv = createTranscript({
    h, t, time, day: dayLabel, money, icon,
    imageUrl: (n) => `/api/chat/image/${encodeURIComponent(shownId() ?? '')}/${n}`,
    onCopy: (text) => {
      const done = globalThis.navigator?.clipboard?.writeText?.(text);
      if (!done) return toast(t()('chat.copyFailed'));
      return done.then(() => toast(t()('chat.copied')), () => toast(t()('chat.copyFailed')));
    },
    onHelper: async (agent, box) => {
      box.replaceChildren(h('p', { class: 'helper-note' }, t()('chat.helperLoading')));
      const res = await api.chatHelper(shownId(), agent.id);
      if (!res.ok) return box.replaceChildren(h('p', { class: 'helper-note' }, t()('chat.helperMissing')));
      return box.replaceChildren(h('ol', { class: 'helper-items' }, (res.items ?? []).map((i) => tv.node(i))));
    },
  });

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
    log = chatLog(log, { ...evt, at: new Date().toISOString() });
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

  // The kinds the chat itself draws (a reply with its folded blocks, a permission, an error); every other kind is drawn by
  // the transcript the same way History draws it.
  function itemView(item, isLast) {
    const tt = t();
    if (item.type === 'user' && item.auto) return h('li', { class: 'msg msg-auto' }, h('p', {}, tt('run.autoAnswered')));
    if (item.type === 'assistant') return claudeView(item, isLast);
    if (item.type === 'permission') return permissionView(item);
    if (item.type === 'error') return h('li', { class: 'msg msg-error', role: 'alert' }, errorText(item.error));
    return tv.node(item);
  }

  function claudeView(item, isLast) {
    const tt = t();
    const folded = foldReply(item.text);
    const asks = folded.run?.level === 'ask-reinforce' && isLast && !log.running;
    const text = showText(folded.text);
    return h('li', { class: `msg msg-claude${item.streaming ? ' is-streaming' : ''}` }, h('span', { class: 'visually-hidden' }, 'Claude: '),
      folded.plan ? chip('plan', tt('fold.plan'), h('p', {}, folded.plan)) : null,
      text || item.streaming ? h('div', { class: 'md' }, text ? tv.markdown(text) : h('p', {})) : null,
      folded.card ? chip('card', folded.card.title ? tt('fold.card', { title: folded.card.title }) : tt('fold.cardUntitled'), cardBody(folded.card)) : null,
      asks ? askCard(folded.run) : null,
      item.streaming ? null : tv.replyMeta({ ...item, text }));
  }

  // An edit asks with its before and after, so the answer reads as accepting or rejecting the change, as in Claude Code.
  function permissionView(item) {
    const tt = t();
    const asked = item.state === 'asked' && !log.ended;
    const edit = Boolean(item.diff);
    return h('li', { class: `msg msg-permission state-${item.state}` },
      h('p', { class: 'perm-title' }, edit ? tt('chat.permEdit', { path: item.diff.path }) : tt('chat.permAsk', { tool: item.toolName })),
      edit ? tv.diffView(item.diff) : h('pre', {}, item.input),
      asked
        ? h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', onclick: () => answer(item, true) }, edit ? tt('chat.accept') : tt('chat.allow')),
          h('button', { type: 'button', class: 'btn', onclick: () => answer(item, false) }, edit ? tt('chat.reject') : tt('chat.deny')),
          h('button', { type: 'button', class: 'btn', onclick: () => answer(item, true, true) }, tt('chat.always')),
          h('span', { class: 'perm-timer' }, tt('chat.permTimeout')))
        : h('p', { class: 'perm-state' }, tt(`chat.perm.${item.state}`)));
  }

  // A node is drawn once per item object (the log replaces an item that changes), so an open step stays open while new
  // ones arrive. A reply that may still grow or ask, a permission and an error are drawn fresh.
  function nodeOf(item, isLast) {
    if (item.type === 'day') {
      if (!dayCache.has(item.day)) dayCache.set(item.day, tv.node(item));
      return dayCache.get(item.day);
    }
    const fresh = item.type === 'permission' || item.type === 'error' || item.streaming || (item.type === 'assistant' && isLast);
    if (fresh) return itemView(item, isLast);
    if (cache.has(item)) {
      drawn.add(cache.get(item));
      return cache.get(item);
    }
    // A history read again (the live mirror) brings equal items as new objects: same content, same node.
    const same = JSON.stringify(item);
    // ponytail: one entry per item drawn; starts over past 5,000, which only costs drawing them again.
    if (byContent.size > 5000) byContent = new Map();
    // Two equal items in one conversation still get a node each: a node sits in one place only.
    const reuse = byContent.get(same);
    const node = reuse && !drawn.has(reuse) ? reuse : itemView(item, false);
    drawn.add(node);
    byContent.set(same, node);
    cache.set(item, node);
    return node;
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

  // A conversation cut off in the middle is a sign (wa08): what happened, why, and the one button that picks it up again.
  function cutCard(state) {
    const tt = t();
    if (state.resumable) {
      const card = signalCard({ h, icon, t: tt }, errorSignal(state.reason), { continue: () => { if (!sendBtn.disabled) send(tt('chat.continueText')); } });
      return h('li', { class: 'msg msg-cut' }, card);
    }
    return h('li', { class: 'msg msg-cut', role: 'group', 'aria-label': tt('chat.cut.title') },
      h('p', { class: 'msg-cut-title' }, tt('chat.cut.title')),
      h('p', {}, tt('chat.cut.bodyNew')));
  }

  function statusText(state) {
    const tt = t();
    if (mirror) return tt('chat.mirror');
    if (state.kind === 'working') return tt('chat.thinking');
    if (state.kind === 'permission') return tt('chat.state.permission');
    if (state.kind === 'interrupted') return tt('chat.state.interrupted');
    if (state.kind === 'finished') return state.summary ? tt('chat.state.finished', { summary: state.summary }) : tt('chat.state.finishedPlain');
    if (state.kind === 'paused') return sessionId ? tt('chat.paused') : tt('chat.ended');
    return log?.mode ? tt('chat.modeNow', { mode: modeName(log.mode) }) : '';
  }

  // ---- find inside the conversation, and jump to a day or an hour ----

  function buildFind() {
    if (!findEl) return;
    const tt = t();
    findInput = h('input', { type: 'search', class: 'chat-find-input', autocomplete: 'off', placeholder: tt('chat.find'), 'aria-label': tt('chat.find'), value: findQuery });
    findCount = h('span', { class: 'chat-find-count num', role: 'status' });
    const step = (by) => () => moveFind(by);
    jumpSel = h('select', { class: 'chat-jump', 'aria-label': tt('chat.jump') });
    liveBadge = h('span', { class: 'chat-live', title: tt('chat.mirror'), hidden: true });
    jumpKey = '';
    findInput.addEventListener('input', () => { findQuery = findInput.value.trim(); findAt = 0; applyFind(true); });
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); moveFind(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape' && findInput.value) { e.preventDefault(); e.stopPropagation(); findInput.value = ''; findQuery = ''; applyFind(false); }
    });
    jumpSel.addEventListener('change', () => {
      const at = Number(jumpSel.value);
      if (jumpSel.value !== '' && nodes[at]) scrollToNode(nodes[at], 'start');
      jumpSel.value = '';
    });
    findEl.replaceChildren(
      liveBadge,
      h('div', { class: 'chat-find-box' }, icon ? icon('search', 'chat-find-icon') : null, findInput, findCount,
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': tt('chat.findPrev'), title: tt('chat.findPrev'), onclick: step(-1) }, icon ? icon('chevron', 'btn-icon flip-up') : tt('chat.findPrev')),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': tt('chat.findNext'), title: tt('chat.findNext'), onclick: step(1) }, icon ? icon('chevron', 'btn-icon') : tt('chat.findNext'))),
      jumpSel);
  }

  // Only the conversation scrolls: scrollIntoView would also move the page and the sheet under the person's eyes.
  function scrollToNode(node, where) {
    const gap = node.getBoundingClientRect().top - logEl.getBoundingClientRect().top;
    const offset = where === 'center' ? (logEl.clientHeight - node.getBoundingClientRect().height) / 2 : 8;
    if (logEl.scrollTo) logEl.scrollTo({ top: logEl.scrollTop + gap - offset, behavior: 'smooth' });
    else logEl.scrollTop += gap - offset;
  }

  function moveFind(by) {
    const hits = findHits(shown, findQuery);
    if (!hits.length) return;
    findAt = (findAt + by + hits.length) % hits.length;
    applyFind(true);
  }

  function applyFind(scroll) {
    if (!findCount) return;
    const tt = t();
    const hits = findQuery ? findHits(shown, findQuery) : [];
    if (findAt >= hits.length) findAt = 0;
    const lit = new Set(hits);
    nodes.forEach((node, n) => {
      node.classList?.toggle('is-hit', lit.has(n));
      node.classList?.toggle('is-hit-now', hits[findAt] === n);
    });
    findCount.replaceChildren(findQuery ? (hits.length ? tt('chat.findCount', { n: findAt + 1, total: hits.length }) : tt('chat.findNone')) : '');
    if (scroll && hits.length && nodes[hits[findAt]]) scrollToNode(nodes[hits[findAt]], 'center');
  }

  // The jump list: each day, and the first item of each hour in it.
  function renderJump() {
    if (!jumpSel) return;
    const groups = [];
    let lastHour = null;
    shown.forEach((item, n) => {
      if (item.type === 'day') {
        groups.push({ label: dayLabel(item.day), options: [{ value: n, label: t()('chat.jumpDayStart') }] });
        lastHour = null;
        return;
      }
      const at = item.ts ? new Date(item.ts) : null;
      if (!at || Number.isNaN(at.getTime()) || !groups.length) return;
      const hour = at.getHours();
      if (hour !== lastHour) groups.at(-1).options.push({ value: n, label: time(item.ts) });
      lastHour = hour;
    });
    const signature = groups.map((g) => `${g.label}:${g.options.map((o) => o.value).join(',')}`).join('|');
    if (signature === jumpKey) return;
    jumpKey = signature;
    jumpSel.hidden = !groups.length;
    jumpSel.replaceChildren(h('option', { value: '' }, t()('chat.jump')),
      ...groups.map((g) => h('optgroup', { label: g.label }, g.options.map((o) => h('option', { value: String(o.value) }, o.label)))));
    jumpSel.value = '';
  }

  // ---- the task list Claude keeps, right above the box ----

  function renderTasks() {
    if (!tasksEl) return;
    const todos = latestTodos(log?.items ?? []);
    tasksEl.hidden = !todos;
    if (!todos) return tasksEl.replaceChildren();
    const tt = t();
    const box = h('details', { class: 'chat-tasks-box', open: tasksOpen },
      h('summary', {}, icon ? icon('check', 'step-icon') : null, h('span', { class: 'tasks-count' }, tt('chat.tasks', { done: todos.done, total: todos.list.length })),
        todos.now ? h('span', { class: 'tasks-now' }, todos.now) : null),
      tv.todosView(todos.list));
    box.addEventListener('toggle', () => { tasksOpen = box.open; });
    return tasksEl.replaceChildren(box);
  }

  function render() {
    const tt = t();
    renderWhere();
    const items = log?.items ?? [];
    const state = chatState(log, { sessionId });
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    shown = withDays(items);
    drawn = new Set();
    nodes = shown.map((item) => nodeOf(item, item === items.at(-1)));
    logEl.replaceChildren(...(items.length ? nodes : [h('li', { class: 'msg-intro' }, context?.intro ?? tt('chat.introResume'))]),
      ...(state.kind === 'interrupted' ? [cutCard(state)] : []));
    if (stick || items.at(-1)?.type === 'user') logEl.scrollTop = logEl.scrollHeight;
    if (findEl) findEl.hidden = !items.length;
    if (liveBadge) {
      liveBadge.hidden = !mirror;
      liveBadge.replaceChildren(mirror ? tt('chat.mirrorShort') : '');
    }
    applyFind(false);
    renderJump();
    renderTasks();
    const running = Boolean(log?.running);
    // An ended process is only paused: with its id known, the next message resumes the conversation.
    const stuck = Boolean(log?.ended) && !sessionId;
    stopBtn.hidden = !running;
    sendBtn.disabled = running || stuck;
    input.disabled = stuck;
    const statusEl = q('status');
    statusEl.textContent = statusText(state);
    statusEl.dataset.state = mirror ? 'mirror' : state.kind;
  }

  // ---- pasted and picked images ----

  function renderPending() {
    if (!pendingEl) return;
    const tt = t();
    pendingEl.hidden = !pending.length;
    pendingEl.replaceChildren(...pending.map((img, n) => h('div', { class: 'pending-img' },
      h('img', { src: img.url, alt: tt('chat.image', { n: n + 1 }) }),
      h('button', {
        type: 'button', class: 'pending-remove', 'aria-label': tt('chat.attachRemove'), title: tt('chat.attachRemove'),
        onclick: () => { pending.splice(n, 1); renderPending(); },
      }, icon ? icon('close', 'btn-icon') : tt('chat.attachRemove')))));
  }

  async function addFiles(files) {
    const tt = t();
    for (const file of files) {
      if (!file) continue;
      if (!IMAGE_TYPES.has(file.type)) { toast(tt('chat.attachOnlyImages')); continue; }
      if (pending.length >= IMAGES_MAX) { toast(tt('chat.attachMax', { n: IMAGES_MAX })); break; }
      if (file.size > IMAGE_BYTES_MAX) { toast(tt('chat.attachTooBig')); continue; }
      const img = await readImage(file);
      if (img?.data) pending.push({ media: img.media, data: img.data, url: `data:${img.media};base64,${img.data}` });
    }
    renderPending();
  }

  // ---- "@" for a project file and "/" for a command, as in Claude Code ----

  function tokenAt() {
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const command = /^\/([\w:.-]*)$/.exec(before);
    if (command) return { kind: 'cmd', query: command[1], start: 0, end: pos };
    const mention = /(^|\s)@([^\s@]*)$/.exec(before);
    if (mention) return { kind: 'file', query: mention[2], start: pos - mention[2].length - 1, end: pos };
    return null;
  }

  function closeSuggest() {
    suggest = null;
    clearTimeout(suggestTimer);
    if (!suggestEl) return;
    suggestEl.hidden = true;
    suggestEl.replaceChildren();
    input.setAttribute?.('aria-expanded', 'false');
    input.removeAttribute?.('aria-activedescendant');
  }

  function renderSuggest() {
    if (!suggestEl || !suggest) return;
    suggestEl.hidden = false;
    suggestEl.replaceChildren(...suggest.options.map((o, n) => h('li', {
      id: `${uid}-suggest-${n}`, role: 'option', class: `suggest-row${n === suggest.active ? ' is-active' : ''}`, 'aria-selected': String(n === suggest.active),
      onmousedown: (e) => { e.preventDefault(); choose(n); },
    }, icon ? icon(suggest.kind === 'file' ? 'file' : 'terminal', 'step-icon') : null, h('span', { class: 'suggest-label' }, o.label), o.hint ? h('span', { class: 'suggest-hint' }, o.hint) : null)));
    input.setAttribute?.('aria-expanded', 'true');
    input.setAttribute?.('aria-activedescendant', `${uid}-suggest-${suggest.active}`);
  }

  function showSuggest(token, options) {
    if (!options.length) return closeSuggest();
    suggest = { ...token, options, active: 0 };
    return renderSuggest();
  }

  function choose(n) {
    const option = suggest?.options[n];
    if (!option) return closeSuggest();
    const word = suggest.kind === 'file' ? `@${option.value} ` : `${option.value} `;
    const caret = suggest.start + word.length;
    input.value = input.value.slice(0, suggest.start) + word + input.value.slice(suggest.end);
    input.setSelectionRange?.(caret, caret);
    return closeSuggest();
  }

  function onType() {
    if (!suggestEl) return;
    const token = tokenAt();
    if (!token) return closeSuggest();
    const seq = ++suggestSeq;
    clearTimeout(suggestTimer);
    if (token.kind === 'cmd') {
      const query = token.query.toLowerCase();
      const bare = (c) => c.name.replace(/^\//, '').toLowerCase();
      const found = commands().filter((c) => bare(c).includes(query))
        .sort((a, b) => Number(!bare(a).startsWith(query)) - Number(!bare(b).startsWith(query)) || a.name.localeCompare(b.name));
      return showSuggest(token, found.slice(0, SUGGEST_MAX).map((c) => ({ value: c.name, label: c.name, hint: c.description })));
    }
    suggestTimer = setTimeout(async () => {
      const res = await api.files(context.projectId, { find: token.query });
      if (seq !== suggestSeq || !context) return;
      showSuggest(token, (res.ok ? res.files ?? [] : []).slice(0, SUGGEST_MAX).map((f) => ({ value: f, label: f })));
    }, debounceMs);
    return undefined;
  }

  async function send(text) {
    const images = pending.map(({ media, data }) => ({ media, data }));
    const shownImages = pending.map((img) => img.url);
    pending = [];
    renderPending();
    closeSuggest();
    log = chatLog(log, { type: 'local-send', at: new Date().toISOString(), data: { text, images: shownImages } });
    listEl.hidden = true;
    render();
    await beforeSend?.();
    const live = key && !log.ended;
    const start = sessionId ? { sessionId } : context.start;
    const res = live
      ? await api.chatSend(key, text, images)
      : await api.chatStart({ projectId: context.projectId, ...start, mode: choice, run, text, ...(images.length ? { images } : {}) });
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
          h('span', { class: `lr-date${c.interrupted ? ' is-cut' : ''}` }, c.running ? tt('chat.running') : c.interrupted ? tt('chat.interruptedShort') : relative(c.updatedAt))))));
    listEl.hidden = false;
  }

  const historyData = (res) => ({ messages: res.messages ?? [], items: res.items, costUSD: res.costUSD, interrupted: res.interrupted === true });

  // A conversation still running in VS Code or a terminal: asked again every few seconds with the version the page has,
  // so an unchanged one costs a short answer; it stops when the conversation ends or the sheet shows something else.
  function stopMirror() {
    if (mirror) cancel(mirror.timer);
    mirror = null;
  }
  function startMirror(ctx, version) {
    stopMirror();
    mirror = { ctx, version, timer: schedule(() => tickMirror(ctx), MIRROR_MS) };
  }
  async function tickMirror(ctx) {
    if (mirror?.ctx !== ctx) return;
    const res = await api.chatHistory(ctx.start.sessionId, mirror.version);
    if (mirror?.ctx !== ctx || context !== ctx) return;
    if (res.ok && !res.same) {
      mirror.version = res.version;
      log = chatLog(log, { type: 'history', data: historyData(res) });
      renderRun();
      if (res.live === false) {
        mirror = null;
        render();
        return;
      }
      render();
    }
    mirror.timer = schedule(() => tickMirror(ctx), MIRROR_MS);
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
    log = chatLog(log, { type: 'history', data: historyData(res) });
    if (res.chatKey) watch(res.chatKey);
    else if (res.readOnly && res.live) startMirror(ctx, res.version);
    renderMode();
    renderRun();
    renderPanel();
    render();
  }

  async function stopRun() {
    const res = await api.chatStop(key);
    if (!res.ok) toast(errorText(res.error));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = '';
    send(text);
  });
  // Claude Code's keys: Enter sends, Shift+Enter is a new line, Esc stops a reply, the arrow up on an empty box brings back
  // the last message; with the "@" or "/" list open, the arrows move, Enter or Tab picks and Esc closes it.
  input.addEventListener('keydown', (e) => {
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        suggest.active = (suggest.active + (e.key === 'ArrowDown' ? 1 : -1) + suggest.options.length) % suggest.options.length;
        renderSuggest();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(suggest.active); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSuggest(); return; }
    }
    if (e.key === 'Escape' && log?.running && key) {
      e.preventDefault();
      e.stopPropagation();
      stopRun();
      return;
    }
    if (e.key === 'ArrowUp' && !input.value) {
      const last = log?.items.findLast((i) => i.type === 'user' && !i.auto);
      if (last) { e.preventDefault(); input.value = last.text; }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', onType);
  input.addEventListener('blur', () => setTimeout(closeSuggest, 150));
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
  form.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes?.('Files')) e.preventDefault(); });
  form.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });
  attachEl?.addEventListener('click', () => fileEl?.click());
  fileEl?.addEventListener('change', () => {
    addFiles([...(fileEl.files ?? [])]);
    fileEl.value = '';
  });
  stopBtn.addEventListener('click', stopRun);
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

  function freshDrawing() {
    cache = new WeakMap();
    byContent = new Map();
    dayCache = new Map();
    jumpKey = '';
  }

  function open(ctx) {
    if (root.hidden) returnFocus = document.activeElement;
    detach();
    stopMirror();
    closeSuggest();
    context = ctx;
    key = null;
    sessionId = null;
    log = undefined;
    lastEventId = 0;
    choice = 'settings';
    run = DEFAULT_RUN;
    lastManual = { kind: 'maestro' };
    confirmUltra = false;
    findQuery = '';
    findAt = 0;
    pending = [];
    freshDrawing();
    if (panelEl) panelEl.hidden = true;
    listEl.hidden = true;
    listEl.replaceChildren();
    q('title').textContent = ctx.title;
    q('context').textContent = ctx.subtitle ?? '';
    input.placeholder = t()('chat.placeholder');
    input.value = ctx.draft ?? '';
    root.hidden = false;
    buildFind();
    renderPending();
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
    stopMirror();
    closeSuggest();
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
    relabel() {
      if (root.hidden) return;
      input.placeholder = t()('chat.placeholder');
      freshDrawing();
      buildFind();
      renderPending();
      renderMode();
      renderRun();
      renderPanel();
      render();
    },
  };
}
