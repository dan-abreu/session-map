import { api } from './api.js';
import { foldReply, quickReplies } from './chatfold.js';
import { modelName } from './live.js';
import { createTranscript, dayName, findHits, latestTodos, timeOf, withDays } from './transcript.js';
import { brainLine, chatLog, chatState, checkLine, composerSize, runWords, stepCounts, stepRuns } from './views.js';
import { signalCard } from './blocks.js';
import { errorSignal } from './signals.js';

const SSE_TYPES = ['user', 'session', 'mode', 'run', 'text', 'thinking', 'tool', 'permission', 'turn-end', 'error', 'draft'];
// What the header shows (the way it runs, the mode, the session), as opposed to the turns the transcript also holds.
const HEADER_EVENTS = new Set(['session', 'mode', 'run']);
// How the conversation runs (server/chat/run.mjs): Autonomous is the default of a new one (pc16). The menu by Send has
// three ways (pc19): Autonomous, Automatic and Manual (one model at one level); the advanced ways (Maestro, Ultracode, the
// person's own Claude) are picked in Configurações (runsettings.js).
const DEFAULT_RUN = { kind: 'autonomous' };
const WAYS = ['maestro', 'ultracode', 'fixed', 'settings'];
const PATHS = ['autonomous', 'auto', 'manual'];
const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const RUN_KINDS = new Set(['autonomous', 'auto', ...WAYS]);
// Why session-map wrote a message itself, besides the one answer to a reinforcing ask (hub.mjs, orchestra.mjs).
const AUTO_KINDS = new Set(['inbox', 'tidy', 'orchestrator', 'opening']);
const pathOf = (run) => (run.kind === 'fixed' ? 'manual' : PATHS.includes(run.kind) ? run.kind : 'advanced');
// A count in words ("Fez 1 passo", "Fez 12 passos"); a translator without plurals gets the key's two forms.
const count = (tt, key, n) => (tt.count ? tt.count(key, n) : tt(`${key}.${n === 1 ? 'one' : 'other'}`, { n }));
// A reply that ends asking waits for the person: the header's dot turns amber.
const endsAsking = (text) => /\?[*_\s]*$/.test(String(text ?? ''));
const usd = (v) => `US$ ${v.toFixed(2)}`;
// "settings" runs the chat in the mode of the person's own Claude settings; the rest are picked in the header.
const MODES = ['settings', 'default', 'acceptEdits', 'plan', 'auto'];
const SAVED = 'sm.chat';
// What the composer accepts like Claude Code does (the server checks the same): a few images per message.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGES_MAX = 10;
const IMAGE_BYTES_MAX = 3_700_000;
// A conversation still running in VS Code or a terminal is asked again this often while it is open here.
const MIRROR_MS = 3000;
// How close to the top of the log the older page is asked for (pc15), so it is there before the person reaches the top.
const OLDER_EDGE_PX = 200;
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
// storage (where the open conversation is kept for a reload; savedKey null keeps nothing), relative (a date as "5 min
// ago"), money (a cost in the person's currency). The flow workshop adds onDraft(text) (the AI
// redrew the shared draft), beforeSend() (awaited before a message leaves) and showText(text) (what a reply shows).
// mm22 adds lang() (for times and dates), icon(name, cls), commands() (the "/" list: [{name, description}]), and for tests
// schedule/cancel (the live mirror's timer), readImage(file) and debounceMs. frame(fn): when the events that arrived are
// drawn (the next animation frame; at once where there is none).
// The header's ⋯ (pc18) holds everything that is not the conversation itself: about() → a function that shows the
// information about the box in place (null when there is none to show), find, more(sessionId) → [{id, label, icon?, run()}]
// (rename or move, archive, open in a terminal, delete) once the conversation has an id, and New conversation.
// pc19: openSettings(binding, opener) opens Configurações for this conversation (the sheet's settings() is the binding),
// onRunChange() follows a change of the way it runs, safety: the words under its permissions.
// waitingOf(sessionId) → true or false by the pill's own rule (now.js needsYou) when the page's state knows the
// conversation, null when it does not: the header's dot waits only then, so it never shows amber where the pill does not.
// The sheet's parts are found by their data-chat role, so the map and the workshop each have a sheet of their own; the
// optional ones (find, tasks, attach, filepick, pending, suggest, menu, more, moremenu, dot, live) are simply left out
// where a sheet has none.
export function createChat({
  root, h, t, toast, errorText, onSession, onClose, storage = browserStorage(), savedKey = SAVED, relative = () => '',
  money = usd, onDraft, beforeSend, showText = (text) => text, lang = () => 'en', icon = null, commands = () => [], more = null,
  about = null, openSettings = null, onRunChange = null, safety = 'chat.safety', waitingOf = null,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id), readImage = readAsBase64, debounceMs = 150,
  frame = globalThis.requestAnimationFrame ? (fn) => globalThis.requestAnimationFrame(fn) : (fn) => fn(),
}) {
  const q = (role) => root.querySelector(`[data-chat="${role}"]`) ?? null;
  const logEl = q('log');
  const form = q('form');
  const input = q('input');
  const sendBtn = q('send');
  const stopBtn = q('stop');
  const listEl = q('list');
  const noteEl = q('note');
  const whereEl = q('where');
  const runEl = q('run');
  const panelEl = q('runpanel');
  const findEl = q('find');
  const tasksEl = q('tasks');
  const attachEl = q('attach');
  const fileEl = q('filepick');
  const pendingEl = q('pending');
  const suggestEl = q('suggest');
  // The header's state dot, and the one working line with Stop above the box (pc18).
  const dotEl = q('dot');
  const liveEl = q('live');
  // The compact button by Send opens this menu (the three ways, the model and level, the cost), as Claude's model button does.
  const menuEl = q('menu') ?? panelEl;
  const moreEl = q('more');
  const bookBtn = q('bookbtn');
  bookBtn?.addEventListener('click', () => (bookEl && !bookEl.hidden ? closeBook() : openBook()));
  const moreMenuEl = q('moremenu');
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
  let lastFixed = { model: 'sonnet', effort: 'medium' };
  let mine = null;
  // mm22: what is drawn (items with their date lines) and the node of each, reused while the item is the same object.
  let shown = [];
  let nodes = [];
  let cache = new WeakMap();
  let byContent = new Map();
  let drawn = new Set();
  let dayCache = new Map();
  let findQuery = '';
  let findAt = 0;
  let findOpen = false;
  let jumpKey = '';
  let tasksOpen = false;
  // pc18: each folded stretch of steps, kept by its first tool (so it stays open while new steps arrive), and where each
  // item sits when it is folded inside one (find and "Go to" open or point at the stretch).
  let stepGroups = new Map();
  const openSteps = new Set();
  let holderOf = new Map();
  let mirror = null;
  // pc15: where the history the log holds sits among all the conversation's items (histStart: the first one shown,
  // histEnd: after the last one the server sent); older: the ask for the page before histStart, while it runs.
  let histStart = 0;
  let histEnd = 0;
  let older = null;
  let pending = [];
  let suggest = null;
  let suggestSeq = 0;
  let suggestTimer = null;
  let findInput = null;
  let findCount = null;
  let jumpSel = null;
  let drawing = false;
  // A message arrived since the last drawing: the next one follows it down, whatever came after it in the same frame.
  let toNewest = false;

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
    if (evt.type === 'user') toNewest = true;
    if (['run', 'turn-end', 'session'].includes(evt.type)) {
      renderRun();
      renderPanel();
    }
    if (evt.type === 'session' && evt.data.state === 'started') {
      const isNew = sessionId !== evt.data.sessionId;
      sessionId = evt.data.sessionId;
      rememberOpen();
      if (isNew) onSession?.(sessionId);
    }
    renderSoon();
  }

  // A reopened chat replays its events in a burst and a reply streams in many pieces: one drawing per frame, not per event (pc13).
  function renderSoon() {
    if (drawing) return;
    drawing = true;
    frame(() => {
      drawing = false;
      render();
    });
  }

  function listen() {
    detach();
    source = api.chatEvents(key);
    for (const type of SSE_TYPES) {
      source.addEventListener(type, (e) => {
        // The transport's own 'error' (a dropped connection) carries no data; EventSource reconnects by itself.
        if (!('data' in e) || e.data === undefined) return;
        const id = Number(e.lastEventId) || 0;
        // Before the history's end only the header's state still counts: the turns are in the history (pc13).
        if (id && id <= lastEventId && !HEADER_EVENTS.has(type)) return;
        lastEventId = Math.max(lastEventId, id);
        let data;
        try { data = JSON.parse(e.data); } catch { return; }
        apply({ type, data });
      });
    }
  }

  // A new process numbers its events from 1 again. from: the last event whose turn the history already shows.
  function watch(chatKey, from = 0) {
    key = chatKey;
    lastEventId = from;
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
    if (item.type === 'user' && item.auto) return autoNote(item, tt);
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
    const quick = isLast && !item.streaming && !log.running && !asks && !form.hidden ? quickReplies(folded.text) : [];
    return h('li', { class: `msg msg-claude${item.streaming ? ' is-streaming' : ''}` }, h('span', { class: 'visually-hidden' }, 'Claude: '),
      folded.plan ? chip('plan', tt('fold.plan'), h('p', {}, folded.plan)) : null,
      text || item.streaming ? h('div', { class: 'md' }, text ? tv.markdown(text) : h('p', {})) : null,
      folded.card ? chip('card', folded.card.title ? tt('fold.card', { title: folded.card.title }) : tt('fold.cardUntitled'), cardBody(folded.card)) : null,
      asks ? askCard(folded.run) : null,
      item.streaming ? null : tv.replyMeta({ ...item, text, model: item.model ?? (isLast ? log.run?.model : null) ?? null, effort: item.effort ?? (isLast ? log.run?.effort : null) ?? null }),
      isLast && !item.streaming && !log.running && log.check ? h('p', { class: 'turn-check num', 'data-run': 'check' }, checkLine(tt, log.check, money)) : null,
      quick.length ? quickView(quick) : null);
  }

  // Quick replies (pc18): the options the last reply really ends on, one button each; a click sends that option's words.
  function quickView(options) {
    const tt = t();
    const reply = (o) => () => { if (!sendBtn.disabled) send(o.text); };
    return h('div', { class: 'quick-replies', role: 'group', 'aria-label': tt('chat.quick.label') },
      h('div', { class: `quick-row${options.length > 2 ? ' is-many' : ''}` }, options.map((o) => h('button', {
        type: 'button', class: 'quick-btn', 'data-quick': o.key, title: tt('chat.quick.send', { text: o.text }), onclick: reply(o),
      }, h('span', { class: 'quick-label' }, o.label), h('span', { class: 'quick-key', 'aria-hidden': 'true' }, o.key)))),
      h('p', { class: 'quick-or' }, tt('chat.quick.or')));
  }

  // A turn's steps (pc18): one line, "Fez 12 passos · leu 6 arquivos, mudou 3", that opens to the rows themselves.
  function stepGroup({ start, end }) {
    const tt = t();
    const rows = shown.slice(start, end);
    const first = rows.find((i) => i.type === 'tool');
    const id = first.id ?? first.ts ?? `at-${start}`;
    let group = stepGroups.get(id);
    if (!group) {
      const details = h('details', { class: 'steps-fold' });
      details.addEventListener('toggle', () => { if (details.open) openSteps.add(id); else openSteps.delete(id); });
      group = { details, summary: h('summary', {}), list: h('ol', { class: 'steps-list', 'aria-label': tt('chat.stepsLabel') }) };
      group.li = h('li', { class: 'msg msg-steps' }, details);
      details.replaceChildren(group.summary, group.list);
      stepGroups.set(id, group);
    }
    const running = end === shown.length && Boolean(log?.running);
    const c = stepCounts(rows);
    const files = [c.read ? count(tt, 'chat.steps.read', c.read) : null, c.changed ? count(tt, 'chat.steps.changed', c.changed) : null].filter(Boolean).join(', ');
    group.li.classList.toggle('is-running', running);
    // A browser writes "null" for a null child of replaceChildren: only what is there goes in.
    group.summary.replaceChildren(...[
      icon ? icon('list', 'step-icon') : null,
      h('b', { class: 'steps-count' }, count(tt, running ? 'chat.steps.doing' : 'chat.steps.done', c.steps)),
      files ? h('span', { class: 'steps-files' }, `· ${files}`) : null,
      icon ? icon('next', 'steps-chev') : null,
    ].filter(Boolean));
    group.list.replaceChildren(...nodes.slice(start, end));
    group.details.open = openSteps.has(id);
    for (let n = start; n < end; n++) holderOf.set(n, group);
    return group.li;
  }

  // An edit asks with its before and after, so the answer reads as accepting or rejecting the change, as in Claude Code.
  function permissionView(item) {
    const tt = t();
    const asked = item.state === 'asked' && !log.ended;
    const edit = Boolean(item.diff);
    // Left for the person by the Autonomous way: it was never asked, so it reads as a note, not a question.
    const title = item.state === 'deferred' ? tt('chat.permDeferred', { tool: item.toolName })
      : edit ? tt('chat.permEdit', { path: item.diff.path }) : tt('chat.permAsk', { tool: item.toolName });
    return h('li', { class: `msg msg-permission state-${item.state}` },
      h('p', { class: 'perm-title' }, title),
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

  // ---- how the conversation runs: the compact button by Send and its menu (pc19: three ways, the quiet line, the link) ----

  // One button for the life of the sheet: redrawn in place, so a click or a key leaves the focus on it.
  const toggleEl = runEl ? h('button', {
    type: 'button', class: 'run-toggle', 'data-run': 'toggle', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    'aria-controls': menuEl?.id || null, onclick: () => setMenu(!menuOpen()),
  }) : null;
  runEl?.replaceChildren(toggleEl);
  const menuOpen = () => Boolean(menuEl && !menuEl.hidden);

  // A message session-map sent on its own, in words: the answer to a reinforcing ask, or what the orchestrator's work put in
  // the chat (notes from its chats, a tidy pass, its orders, the first opening); those can be opened to read the text.
  function autoNote(item, tt) {
    if (!AUTO_KINDS.has(item.auto)) return h('li', { class: 'msg msg-auto' }, h('p', {}, tt('run.autoAnswered')));
    return h('li', { class: 'msg msg-auto' }, h('details', { class: 'msg-auto-note' }, h('summary', {}, tt(`run.auto.${item.auto}`)), h('p', { class: 'msg-auto-text' }, item.text)));
  }

  // The button says only the way ("Autônomo"); Manual adds its model, the one thing it chose.
  function renderRun() {
    if (toggleEl) {
      const tt = t();
      const words = runWords(tt, { choice: run, info: log?.run ?? null, mine });
      toggleEl.setAttribute('class', `run-toggle tone-${words.tone}`);
      toggleEl.setAttribute('aria-expanded', String(menuOpen()));
      toggleEl.setAttribute('title', tt('run.change'));
      toggleEl.replaceChildren(...[
        h('span', { class: 'run-way' }, run.kind === 'fixed' ? tt('run.path.manual') : words.way),
        run.kind === 'fixed' ? h('span', { class: 'run-model' }, words.model) : null,
        h('span', { class: 'run-caret', 'aria-hidden': 'true' }),
      ].filter(Boolean));
    }
    onRunChange?.();
  }

  // Esc and a press outside close it, as a menu does; Esc gives the focus back to the button.
  function setMenu(open, { focusBack = false } = {}) {
    if (!menuEl) return;
    menuEl.hidden = !open;
    renderRun();
    renderPanel();
    if (!open && focusBack) toggleEl?.focus();
  }

  async function pick(next) {
    run = next;
    if (next.kind === 'fixed') lastFixed = { model: next.model, effort: next.effort };
    renderRun();
    renderPanel();
    // Not started yet, or paused: the choice goes with the next message.
    if (!key || !log || log.ended) return;
    const res = await api.chatRun(key, next);
    if (!res.ok && res.error !== 'ended') toast(errorText(res.error));
  }

  // Manual, chosen: the model and the level right under it, as two short rows of choices.
  function fixedChoices(tt) {
    const seg = (id, label, values, name, hint) => h('div', { class: 'run-pick' },
      h('p', { class: 'run-pick-label', id: `${uid}-run-${id}` }, label),
      h('div', { class: 'seg run-seg', role: 'group', 'aria-labelledby': `${uid}-run-${id}` },
        values.map((v) => h('button', {
          type: 'button', 'data-run': `${id}-${v}`, 'aria-pressed': String(run[id] === v), title: hint(v), onclick: () => pick({ ...run, [id]: v }),
        }, name(v)))));
    return h('div', { class: 'run-fixed' },
      seg('model', tt('run.modelLabel'), MODELS, modelName, (m) => tt(`run.modelHint.${m}`)),
      seg('effort', tt('run.effortLabel'), EFFORTS, (e) => tt(`run.effort.${e}`), (e) => tt(`run.effortHint.${e}`)),
      h('p', { class: 'run-hint' }, tt(`run.effortHint.${run.effort}`)));
  }

  // How a way starts when chosen: Manual comes back to the model and level chosen last.
  const firstRun = (p) => (p === 'autonomous' ? { kind: 'autonomous' } : p === 'auto' ? { kind: 'auto', selfReinforce: false } : { kind: 'fixed', ...lastFixed });

  // The three ways, one plain sentence each, as one radio group (one tab stop: the chosen way, or the first); Manual opens
  // its model and level right under it, outside the group. Then one quiet line, "Opus · alto · US$ 68 nesta conversa",
  // and the way to the rest: "Limite do mês e permissões…".
  function renderPanel() {
    if (!panelEl || !menuOpen()) return;
    const tt = t();
    const path = pathOf(run);
    const stop = PATHS.includes(path) ? path : PATHS[0];
    const words = runWords(tt, { choice: run, info: log?.run ?? null, mine });
    const cost = log?.costUSD ?? null;
    panelEl.replaceChildren(...[
      h('div', { class: 'run-paths', role: 'radiogroup', 'aria-label': tt('run.pathLabel') },
        PATHS.map((p) => h('button', {
          type: 'button', role: 'radio', class: 'run-path-btn', 'data-run': `path-${p}`, 'aria-checked': String(path === p), tabindex: p === stop ? '0' : '-1',
          onclick: () => { if (path !== p) pick(firstRun(p)); },
        }, h('span', { class: 'run-option-name' }, tt(`run.path.${p}`)), h('span', { class: 'run-hint' }, tt(`run.pathHint.${p}`))))),
      path === 'manual' ? fixedChoices(tt) : null,
      path === 'advanced' ? h('p', { class: 'run-advanced-now' }, tt('run.advancedNow', { way: words.way })) : null,
      h('div', { class: 'run-foot' },
        words.tone === 'reinforced' || words.tone === 'ask' ? h('p', { class: `run-why tone-${words.tone}` }, words.why) : null,
        h('p', { class: 'run-line num', 'data-run': 'line' }, [brainLine(tt, words, log?.run?.brain) ?? [words.model, words.effort].filter(Boolean).join(' · '), cost !== null ? tt('run.lineCost', { cost: money(cost) }) : null].filter(Boolean).join(' · ')),
        openSettings ? h('button', {
          type: 'button', class: 'run-settings', 'data-run': 'settings', 'aria-haspopup': 'dialog',
          onclick: () => { setMenu(false); openSettings(binding, toggleEl); },
        }, h('span', {}, tt('run.settingsLink')), icon ? icon('next', 'run-settings-icon') : null) : null),
    ].filter(Boolean));
  }

  const modeName = (mode) => t()(`chat.modeName.${mode}`);

  // One line when empty, growing with the text up to about 40% of the panel, then it scrolls (mm08).
  function fitInput() {
    input.style.height = 'auto';
    const { height, scroll } = composerSize({ scrollHeight: input.scrollHeight + 2, paneHeight: root.clientHeight, minHeight: 38 });
    input.style.height = `${height}px`;
    input.classList.toggle('is-scrolling', scroll);
  }

  // The permission mode is chosen in Configurações (pc19); the sheet keeps the note that a bypass setting runs as auto.
  function renderMode() {
    if (!noteEl) return;
    noteEl.hidden = !settings?.downgraded;
    noteEl.textContent = settings?.downgraded ? t()('chat.downgraded') : '';
  }

  // The choice is per conversation: a running one switches now, otherwise it goes with the next message.
  async function setChoice(mode) {
    choice = MODES.includes(mode) ? mode : 'settings';
    renderMode();
    if (!key || log?.ended) return;
    const res = await api.chatMode(key, choice);
    if (!res.ok) toast(errorText(res.error));
  }

  // What Configurações reads and changes of this conversation (runsettings.js): the same object for the run menu's link and
  // for the person's menu.
  const binding = {
    title: () => context?.title ?? '',
    safety,
    modes: MODES,
    run: () => run,
    pick: (next) => pick(next),
    choice: () => choice,
    setChoice: (mode) => setChoice(mode),
    claudeMode: () => settings?.mode ?? 'default',
    mine: () => mine,
    isOpen: () => !root.hidden,
  };

  // A conversation that lives elsewhere (VS Code, a terminal): where it is, what can be done there, and whether it may be
  // written here. ctx.where() is asked again on each render, so it follows the language.
  function renderWhere() {
    const where = context?.where?.() ?? null;
    // Nothing is run from here while it is open elsewhere: the box goes, and with it the button of how it runs.
    form.hidden = Boolean(where && !where.canWrite);
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

  // The state in words: the header's dot says it (its tooltip and what a screen reader hears).
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

  // The colour of the header's dot: working green, waiting for the person amber (a permission, or a finished one the pill
  // counts; a reply that ends asking only for a fresh conversation the page has not listed yet), cut or failed red, quiet
  // otherwise; none before the conversation has anything in it.
  function dotState(state, items) {
    if (mirror || state.kind === 'working') return 'working';
    if (state.kind === 'permission') return 'waiting';
    if (state.kind === 'interrupted' || state.kind === 'error') return 'clash';
    if (state.kind === 'finished') {
      const id = sessionId ?? context?.start?.sessionId ?? null;
      const known = id && waitingOf ? waitingOf(id) : null;
      if (typeof known === 'boolean') return known ? 'waiting' : 'quiet';
      return endsAsking(foldReply(items.findLast((i) => i.type === 'assistant')?.text).text) ? 'waiting' : 'quiet';
    }
    return items.length ? 'quiet' : 'none';
  }

  // One header line (pc18): the dot, the title, the part as a chip (the whole path in its tooltip), ⋯ and close.
  function renderHead(state, items) {
    const partEl = q('context');
    if (partEl) {
      const path = context?.subtitle ?? '';
      const part = String(path).split(' › ').at(-1).trim();
      partEl.textContent = part && part !== context?.title ? part : '';
      partEl.setAttribute('title', path);
      partEl.hidden = !partEl.textContent;
    }
    if (!dotEl) return;
    const tone = dotState(state, items);
    const words = statusText(state);
    dotEl.hidden = tone === 'none';
    dotEl.dataset.state = tone;
    dotEl.setAttribute('aria-label', words);
    dotEl.setAttribute('title', words);
  }

  // What Claude is doing right now, for the working line: the step under way, else thinking or writing the reply.
  function currentStep(items) {
    const tt = t();
    const last = items.at(-1);
    const tool = items.findLast((i) => i.type === 'tool' && i.result === null);
    if (tool?.step?.kind) return tt(`live.step.${tool.step.kind}`, { target: tool.step.target });
    if (tool) return tt('live.step.tool', { target: tool.name });
    if (last?.type === 'thinking') return tt('chat.live.thinking');
    if (last?.type === 'assistant' && last.streaming) return tt('chat.live.writing');
    return tt('chat.live.starting');
  }

  // The one working line above the box (pc18): "Trabalhando · lendo app.js [Parar]", amber while a permission waits, and
  // "Ao vivo" while a conversation from elsewhere is mirrored. Gone when nothing runs.
  function renderLive(state, items) {
    const statusEl = q('status');
    const running = Boolean(log?.running);
    statusEl.dataset.state = mirror ? 'mirror' : state.kind;
    if (liveEl) {
      liveEl.hidden = !running && !mirror;
      liveEl.dataset.state = mirror ? 'mirror' : state.kind;
    }
    const tt = t();
    if (mirror) return statusEl.replaceChildren(h('b', {}, tt('chat.mirrorShort')), h('span', { class: 'chat-live-step' }, `· ${tt('chat.mirror')}`));
    if (!running) return statusEl.replaceChildren();
    if (state.kind === 'permission') return statusEl.replaceChildren(h('b', {}, tt('chat.state.permission')));
    return statusEl.replaceChildren(h('b', {}, tt('chat.live.working')), h('span', { class: 'chat-live-step' }, `· ${currentStep(items)}`));
  }

  // ---- find inside the conversation, and jump to a day or an hour (in the ⋯ and on Ctrl F since pc18) ----

  function buildFind() {
    if (!findEl) return;
    const tt = t();
    findInput = h('input', { type: 'search', class: 'chat-find-input', autocomplete: 'off', placeholder: tt('chat.find'), 'aria-label': tt('chat.find'), value: findQuery });
    findCount = h('span', { class: 'chat-find-count num', role: 'status' });
    const step = (by) => () => moveFind(by);
    jumpSel = h('select', { class: 'chat-jump', 'aria-label': tt('chat.jump') });
    jumpKey = '';
    findInput.addEventListener('input', () => { findQuery = findInput.value.trim(); findAt = 0; applyFind(true); });
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); moveFind(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });
    jumpSel.addEventListener('change', () => {
      const at = Number(jumpSel.value);
      if (jumpSel.value !== '' && nodes[at]) scrollToNode(shownNode(at), 'start');
      jumpSel.value = '';
    });
    findEl.replaceChildren(
      h('div', { class: 'chat-find-box' }, icon ? icon('search', 'chat-find-icon') : null, findInput, findCount,
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': tt('chat.findPrev'), title: tt('chat.findPrev'), onclick: step(-1) }, icon ? icon('chevron', 'btn-icon flip-up') : tt('chat.findPrev')),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': tt('chat.findNext'), title: tt('chat.findNext'), onclick: step(1) }, icon ? icon('chevron', 'btn-icon') : tt('chat.findNext'))),
      jumpSel,
      h('button', { type: 'button', class: 'icon-btn small chat-find-close', 'data-find': 'close', 'aria-label': tt('chat.findClose'), title: tt('chat.findClose'), onclick: () => closeFind() }, icon ? icon('close', 'btn-icon') : tt('chat.findClose')));
  }

  function openFind() {
    if (!findEl || !log?.items?.length) return;
    findOpen = true;
    findEl.hidden = false;
    findInput?.focus();
    findInput?.select?.();
  }

  function closeFind() {
    findOpen = false;
    findQuery = '';
    if (findInput) findInput.value = '';
    applyFind(false);
    if (findEl) findEl.hidden = true;
    // Back to the box where the person can write; a conversation only read here has none, so to the ⋯ that opened find.
    if (!form.hidden && !input.disabled) input.focus();
    else (moreEl && !moreEl.hidden ? moreEl : logEl).focus();
  }

  // An item folded inside a stretch of steps is reached through it: the stretch opens for a find hit, and "Go to" lands on it.
  const shownNode = (n) => {
    const group = holderOf.get(n);
    return group && !group.details.open ? group.li : nodes[n];
  };

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
    if (!scroll || !hits.length || !nodes[hits[findAt]]) return;
    const group = holderOf.get(hits[findAt]);
    if (group) group.details.open = true;
    scrollToNode(nodes[hits[findAt]], 'center');
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

  // A new chat about a box offers a few ready first messages under the intro. A click writes one in the box instead of
  // sending it: the person still sees what goes and presses Send, since some of them start paid work.
  function startersOf(ctx) {
    if (!ctx?.starters?.length || ctx.start?.sessionId) return [];
    const pick = (text) => {
      input.value = text;
      fitInput();
      input.focus();
    };
    return [h('li', { class: 'msg-starters' }, ctx.starters.map((text) => h('button', { type: 'button', class: 'btn small-btn', onclick: () => pick(text) }, text)))];
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

  // The log's rows: each item's node, a stretch of steps folded into its one line (pc18).
  function logRows() {
    holderOf = new Map();
    const runs = new Map(stepRuns(shown).map((r) => [r.start, r]));
    const rows = [];
    for (let n = 0; n < shown.length; n++) {
      const stretch = runs.get(n);
      if (!stretch) { rows.push(nodes[n]); continue; }
      rows.push(stepGroup(stretch));
      n = stretch.end - 1;
    }
    return rows;
  }

  function render() {
    const tt = t();
    renderWhere();
    const items = log?.items ?? [];
    const state = chatState(log, { sessionId });
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    // The working line first: it takes room from the log, and the log then scrolls to its newest row.
    renderLive(state, items);
    shown = withDays(items);
    drawn = new Set();
    nodes = shown.map((item) => nodeOf(item, item === items.at(-1)));
    logEl.replaceChildren(...(items.length ? logRows() : [h('li', { class: 'msg-intro' }, context?.intro ?? tt('chat.introResume')), ...startersOf(context)]),
      ...(state.kind === 'interrupted' ? [cutCard(state)] : []));
    // An empty conversation reads from its intro down; one with messages follows the newest.
    if (!items.length) logEl.scrollTop = 0;
    else if (stick || toNewest || items.at(-1)?.type === 'user') logEl.scrollTop = logEl.scrollHeight;
    toNewest = false;
    if (findEl) findEl.hidden = !findOpen || !items.length;
    applyFind(false);
    renderJump();
    renderTasks();
    const running = Boolean(log?.running);
    // An ended process is only paused: with its id known, the next message resumes the conversation.
    const stuck = Boolean(log?.ended) && !sessionId;
    stopBtn.hidden = !running;
    sendBtn.disabled = running || stuck;
    input.disabled = stuck;
    // The ⋯ shows once it has something to offer (a conversation the page started a moment ago has no id yet).
    if (moreEl) moreEl.hidden = !moreActions().length;
    // The book has its own button in the header, so it is one click away and not hidden in the ⋯.
    if (bookBtn) bookBtn.hidden = !(shownId() && findEl);
    renderHead(state, items);
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
    fitInput();
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
    if (menuOpen()) setMenu(false);
    log = chatLog(log, { type: 'local-send', at: new Date().toISOString(), data: { text, images: shownImages } });
    listEl.hidden = true;
    render();
    await beforeSend?.();
    const live = key && !log.ended;
    const start = sessionId ? { sessionId } : context.start;
    // A new project chat is named by its first message, as the list names it, instead of staying "New project chat".
    if (!live && !sessionId && context.retitle) {
      context.title = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      q('title').textContent = context.title;
    }
    // The project's orchestrator not started yet is opened through its own route, so there is only ever one.
    const opens = !live && !sessionId && context.orchestrator;
    const res = live
      ? await api.chatSend(key, text, images)
      : await (opens ? api.orchestratorOpen({ projectId: context.projectId, text, ...(images.length ? { images } : {}) }) : api.chatStart({ projectId: context.projectId, ...start, mode: choice, run, text, ...(images.length ? { images } : {}) }));
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
    if (['idea', 'create-arch', 'flow', 'project', 'orchestrator'].includes(node?.kind)) scope = { kind: node.kind };
    else if (node?.partId) scope = { partId: node.partId, ...(node.kind === 'item' && node.code ? { code: node.code } : {}) };
    else if (ctx.start?.workCellId) scope = { workCellId: ctx.start.workCellId };
    const res = await api.chatList({ projectId: ctx.projectId, ...scope });
    if (context !== ctx || !res.ok) return;
    settings = res.settings ?? null;
    mine = res.mine ?? null;
    renderMode();
    renderRun();
    renderPanel();
    const chats = res.chats ?? [];
    if (!chats.length || key || log?.items.length) return;
    const tt = t();
    listEl.replaceChildren(
      h('li', { class: 'chat-list-head' }, ctx.listTitle ?? tt('chat.openHere')),
      ...chats.map((c) => h('li', {},
        h('button', { type: 'button', class: 'link-row', onclick: () => resume({ projectId: ctx.projectId, sessionId: c.sessionId, title: c.title || ctx.title, subtitle: ctx.subtitle, newChat: ctx.newChat, listTitle: ctx.listTitle, placeholder: ctx.placeholder }) },
          h('span', { class: 'lr-title' }, c.title || tt('chat.untitled')),
          h('span', { class: `lr-date${c.interrupted ? ' is-cut' : ''}` }, c.running ? tt('chat.running') : c.interrupted ? tt('chat.interruptedShort') : relative(c.updatedAt)),
          Number.isFinite(c.costUSD) ? h('span', { class: 'lr-cost num' }, money(c.costUSD)) : null))));
    listEl.hidden = false;
  }

  const historyData = (res) => ({ messages: res.messages ?? [], items: res.items, costUSD: res.costUSD, interrupted: res.interrupted === true, running: res.running === true });

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
    // A tab nobody sees asks nothing: each ask costs the server a look at the transcript. It asks again once seen.
    if (document.hidden) {
      mirror.timer = schedule(() => tickMirror(ctx), MIRROR_MS);
      return;
    }
    const res = await api.chatHistory(ctx.start.sessionId, mirror.version, { from: histEnd });
    if (mirror?.ctx !== ctx || context !== ctx) return;
    if (res.ok && !res.same) {
      mirror.version = res.version;
      // Only what follows the items it has, from a little before (those may still change); an older server sends all.
      const start = Number(res.start) || 0;
      const data = historyData(res);
      if (Array.isArray(res.items)) data.items = [...(log?.items ?? []).slice(0, Math.max(0, start - histStart)), ...res.items];
      log = chatLog(log, { type: 'history', data });
      histStart = Math.min(histStart, start);
      histEnd = start + (res.items?.length ?? 0);
      renderRun();
      renderPanel();
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
    // Closed meanwhile: a hidden log reads as scrolled to the top, so drawing it would page through the whole conversation.
    if (context !== ctx || root.hidden || !res.ok) return;
    settings = res.settings ?? settings;
    choice = MODES.includes(res.mode) ? res.mode : 'settings';
    // What the conversation ran with before; one from elsewhere (or older than these choices) keeps its own Claude.
    run = RUN_KINDS.has(res.run?.kind) ? res.run : { kind: 'settings' };
    if (run.kind === 'fixed') lastFixed = { model: run.model, effort: run.effort };
    mine = res.mine ?? mine;
    sessionId = ctx.start.sessionId;
    rememberOpen();
    log = chatLog(log, { type: 'history', data: historyData(res) });
    histStart = Number(res.start) || 0;
    histEnd = histStart + (res.items?.length ?? 0);
    if (res.chatKey) watch(res.chatKey, Number(res.fromEventId) || 0);
    else if (res.readOnly && res.live) startMirror(ctx, res.version);
    renderMode();
    renderRun();
    renderPanel();
    render();
    nearTop();
  }

  // The page of history before the shown one, once the person scrolls near the top (pc15). What they were reading
  // stays where it was: the log scrolls down by exactly what came in above it.
  function nearTop() {
    if (histStart > 0 && !older && sessionId && context && !root.hidden && logEl.scrollTop < OLDER_EDGE_PX) older = loadOlder(context);
  }
  async function loadOlder(ctx) {
    const res = await api.chatHistory(sessionId, undefined, { before: histStart });
    if (context !== ctx) return;
    older = null;
    if (root.hidden || !res.ok || !Array.isArray(res.items)) return;
    const start = Number(res.start) || 0;
    if (start >= histStart) return;
    // Read as the log reads any history, then put before what it holds.
    const { items } = chatLog(undefined, { type: 'history', data: { items: res.items.slice(0, histStart - start) } });
    const height = logEl.scrollHeight;
    const top = logEl.scrollTop;
    log = { ...log, items: [...items, ...(log?.items ?? [])] };
    histStart = start;
    render();
    logEl.scrollTop = top + (logEl.scrollHeight - height);
    nearTop();
  }

  async function stopRun() {
    const res = await api.chatStop(key);
    if (!res.ok) toast(errorText(res.error));
  }

  logEl.addEventListener('scroll', nearTop, { passive: true });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = '';
    fitInput();
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
      if (last) { e.preventDefault(); input.value = last.text; fitInput(); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', onType);
  input.addEventListener('input', fitInput);
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
  q('close').addEventListener('click', () => close());
  // Ctrl F (⌘ F) inside the sheet finds in the conversation instead of the whole page (pc18).
  root.addEventListener?.('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || String(e.key).toLowerCase() !== 'f' || !findEl || !log?.items?.length) return;
    e.preventDefault();
    openFind();
  });

  const escMenu = (e) => {
    if (e.key !== 'Escape' || !menuOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(false, { focusBack: true });
  };
  menuEl?.addEventListener('keydown', escMenu);
  runEl?.addEventListener('keydown', escMenu);
  // The three ways are one choice: the arrows walk them, as in a list of radio buttons.
  // A radio group: the arrows choose the next way as they move, and the focus follows it into the redrawn panel.
  const radios = () => [...(panelEl.querySelectorAll?.('[role="radio"]') ?? [])];
  panelEl?.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const at = radios().indexOf(document.activeElement);
    if (!step || at < 0) return;
    e.preventDefault();
    const to = (at + step + PATHS.length) % PATHS.length;
    if (pathOf(run) !== PATHS[to]) pick(firstRun(PATHS[to]));
    radios()[to]?.focus();
  });

// ---- the book panel (pc28): the chapters of this conversation, each opened on its own ----
  // Only the list is read at first; a chapter's text is fetched when it is opened. Nothing here goes to the AI.
  let bookEl = null;
  let bookBig = false;

  function closeBook() {
    if (bookEl) bookEl.hidden = true;
    (moreEl && !moreEl.hidden ? moreEl : logEl).focus();
  }

  // A chapter's saved text, laid out as a page: the request, the AI's words, and its tool steps folded away.
  function bookPage(raw, tt) {
    const CUT = '[… meio do capítulo cortado …]';
    const parts = String(raw ?? '').replace(CUT, '\n\n§CUT§\n\n').split(/\n\n+/).map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim());
    const out = [];
    let steps = [];
    const flush = () => {
      if (!steps.length) return;
      out.push(h('details', { class: 'chat-book-steps' }, h('summary', {}, tt('chat.bookSteps', { n: steps.length })), h('pre', {}, steps.join('\n'))));
      steps = [];
    };
    let afterRequest = false;
    for (const p of parts) {
      if (/^# Cap\. \d+$/.test(p)) continue;
      if (p === '## Pedido') { out.push(h('div', { class: 'chat-book-label' }, tt('chat.bookRequest'))); afterRequest = true; continue; }
      if (afterRequest) { afterRequest = false; out.push(h('blockquote', { class: 'chat-book-ask' }, p)); continue; }
      if (p === '§CUT§') { flush(); out.push(h('p', { class: 'chat-book-cut muted' }, CUT)); continue; }
      if (/^→ /.test(p) || /^\s+← /.test(p)) { steps.push(p.trim()); continue; }
      flush();
      out.push(h('p', { class: 'chat-book-p' }, p));
    }
    flush();
    return out;
  }

  // The book's general summary (resumo.md), open on top: "## " lines are headings, "- " lines a list, the rest paragraphs.
  // All of it as text, never as HTML.
  function bookSummary(raw, tt) {
    const out = [];
    let items = [];
    const flush = () => { if (items.length) out.push(h('ul', {}, ...items.map((i) => h('li', {}, i)))); items = []; };
    for (const line of String(raw ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (/^- /.test(line)) { items.push(line.slice(2)); continue; }
      flush();
      const head = line.match(/^#{1,6}\s+(.*)$/);
      out.push(head ? h('h4', { class: 'chat-book-label' }, head[1]) : h('p', { class: 'chat-book-p' }, line));
    }
    flush();
    return h('details', { class: 'chat-book-summary', open: true }, h('summary', {}, h('strong', {}, tt('chat.bookSummary'))), ...out);
  }

  async function openBook() {
    const id = shownId();
    if (!id || !findEl) return;
    const tt = t();
    if (!bookEl) {
      bookEl = h('section', { class: 'chat-book', 'aria-label': tt('chat.book') });
      findEl.after(bookEl);
    }
    bookEl.hidden = false;
    bookEl.classList.toggle('big', bookBig);
    const body = h('div', { class: 'chat-book-body' }, h('p', { class: 'muted' }, tt('chat.bookLoading')));
    const sizeBtn = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': tt(bookBig ? 'chat.bookSmaller' : 'chat.bookBigger'), title: tt(bookBig ? 'chat.bookSmaller' : 'chat.bookBigger'),
      onclick: () => { bookBig = !bookBig; openBook(); } }, bookBig ? '▁' : '▢');
    const closeBtn = h('button', { type: 'button', class: 'icon-btn small', 'aria-label': tt('chat.bookClose'), title: tt('chat.bookClose'), onclick: closeBook }, '✕');
    bookEl.replaceChildren(h('header', { class: 'chat-book-head' }, h('strong', {}, tt('chat.book')), sizeBtn, closeBtn), body);
    let book;
    try { book = await api.chatBook(id); } catch { book = null; }
    const summary = book?.summary ? [bookSummary(book.summary, tt)] : [];
    if (!book?.chapters?.length) { body.replaceChildren(...summary, h('p', { class: 'muted' }, tt('chat.bookEmpty'))); return; }
    const label = (c) => (c.title || tt('chat.bookUntitled', { n: c.n })) + (c.closed ? '' : ` (${tt('chat.bookOpen')})`);
    const caps = book.chapters.map((c) => {
      const page = h('div', { class: 'chat-book-page' });
      const det = h('details', { class: 'chat-book-cap', id: `book-cap-${c.n}` },
        h('summary', {}, h('span', { class: 'num' }, `${c.n}. `), h('span', { class: 'chat-book-ctitle' }, label(c)),
          c.summary ? h('span', { class: 'chat-book-sum muted' }, c.summary) : null), page);
      let loaded = false;
      det.addEventListener('toggle', async () => {
        if (!det.open || loaded) return;
        loaded = true;
        page.replaceChildren(h('p', { class: 'muted' }, tt('chat.bookLoading')));
        const res = await api.chatBookChapter(id, c.n).catch(() => null);
        if (res?.text) page.replaceChildren(...bookPage(res.text, tt));
        else { page.replaceChildren(h('p', { class: 'muted' }, c.closed ? tt('chat.bookFail') : tt('chat.bookNotYet'))); loaded = false; }
      });
      return det;
    });
    const index = h('nav', { class: 'chat-book-index', 'aria-label': tt('chat.bookIndex') },
      h('div', { class: 'chat-book-label' }, tt('chat.bookIndex')),
      h('ol', {}, ...book.chapters.map((c, i) => h('li', {}, h('a', { href: `#book-cap-${c.n}`,
        onclick: (e) => { e.preventDefault(); caps[i].open = true; caps[i].scrollIntoView({ block: 'nearest' }); } }, label(c))))));
    body.replaceChildren(...(book.title ? [h('h3', { class: 'chat-book-title' }, book.title)] : []), ...summary, index, ...caps);
  }

  // ---- the header's ⋯ menu (pc18): everything that is not the conversation itself, in three groups ----

  // About this part and find; what can be done with the conversation (rename or move, archive, open where it lives,
  // delete); and a new conversation. → [[{id, label, icon, keys?, run()}]], the empty groups left out.
  function moreActions() {
    const tt = t();
    const id = shownId();
    const has = Boolean(log?.items?.length);
    const showAbout = about?.() ?? null;
    return [
      [
        showAbout ? { id: 'about', label: tt('chat.about'), icon: 'book', run: showAbout } : null,
        id && findEl ? { id: 'book', label: tt('chat.book'), icon: 'book', run: openBook } : null,
        has && findEl ? { id: 'find', label: tt('chat.find'), icon: 'search', keys: 'Ctrl F', run: openFind } : null,
      ],
      id && more ? more(id) : [],
      [context?.newChat && (id || has) ? { id: 'new', label: tt('chat.moreNew'), icon: 'plus', run: () => context.newChat() } : null],
    ].map((group) => group.filter(Boolean)).filter((group) => group.length);
  }

  function setMore(open, { focusBack = false } = {}) {
    if (!moreEl || !moreMenuEl) return;
    const groups = open ? moreActions() : [];
    moreMenuEl.hidden = !groups.length;
    moreEl.setAttribute('aria-expanded', String(groups.length > 0));
    moreMenuEl.replaceChildren(...groups.flatMap((group, n) => [
      ...(n ? [h('hr', { class: 'pm-sep' })] : []),
      ...group.map((a) => h('button', {
        type: 'button', role: 'menuitem', class: 'pm-row', 'data-more': a.id ?? null, onclick: () => { setMore(false); a.run(); },
      }, a.icon && icon ? icon(a.icon, 'pm-icon') : h('span', { 'aria-hidden': 'true' }), h('span', { class: 'pm-label' }, a.label),
      a.keys ? h('kbd', { class: 'pm-keys' }, a.keys) : null)),
    ]));
    if (groups.length) moreMenuEl.children[0]?.focus();
    else if (focusBack) moreEl.focus();
  }
  moreEl?.addEventListener('click', () => setMore(moreMenuEl.hidden));
  moreMenuEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMore(false, { focusBack: true });
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...moreMenuEl.children].filter((c) => (c.getAttribute?.('role') ?? c.attrs?.role) === 'menuitem');
    const at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });

  // A press anywhere outside an open menu closes it; the menu's own button is left to its click.
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen() && !menuEl.contains(e.target) && !runEl?.contains(e.target)) setMenu(false);
    if (moreMenuEl && !moreMenuEl.hidden && !moreMenuEl.contains(e.target) && !moreEl.contains(e.target)) setMore(false);
  }, true);

  function freshDrawing() {
    cache = new WeakMap();
    byContent = new Map();
    dayCache = new Map();
    stepGroups = new Map();
    jumpKey = '';
  }

  // ctx: projectId, title, subtitle, intro, start ({sessionId} or {node}), and optionally placeholder (the box's own words
  // for the empty input), starters (ready first messages), newChat() ("New conversation" in the ⋯), listTitle, retitle (a
  // new conversation takes its first message as title) and draft.
  function open(ctx) {
    if (root.hidden) returnFocus = document.activeElement;
    detach();
    stopMirror();
    closeSuggest();
    context = ctx;
    key = null;
    sessionId = null;
    log = undefined;
    histStart = 0;
    histEnd = 0;
    older = null;
    lastEventId = 0;
    choice = 'settings';
    run = DEFAULT_RUN;
    findQuery = '';
    findAt = 0;
    findOpen = false;
    openSteps.clear();
    pending = [];
    freshDrawing();
    if (menuEl) menuEl.hidden = true;
    setMore(false);
    listEl.hidden = true;
    listEl.replaceChildren();
    q('title').textContent = ctx.title;
    input.placeholder = ctx.placeholder ?? t()('chat.placeholder');
    input.value = ctx.draft ?? '';
    root.hidden = false;
    fitInput();
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
    open({
      projectId: entry.projectId, title: entry.title, subtitle: entry.subtitle || t()('chat.resuming'), intro: t()('chat.introResume'), start: { sessionId: entry.sessionId },
      ...(entry.newChat ? { newChat: entry.newChat, listTitle: entry.listTitle } : {}),
      ...(entry.placeholder ? { placeholder: entry.placeholder } : {}),
    });
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
    // What Configurações reads and changes of this conversation (pc19).
    settings: () => binding,
    // The page's state changed (a poll): the dot reads waitingOf again.
    refreshDot: () => { if (!root.hidden && log) renderHead(chatState(log, { sessionId }), log.items ?? []); },
    // The conversation the sheet shows, once it has an id.
    current: () => (root.hidden ? null : sessionId ?? context?.start?.sessionId ?? null),
    // After a reload: the conversation that was open in this project's sheet.
    restore(projectId) {
      const saved = remembered();
      if (saved && saved.projectId === projectId && typeof saved.sessionId === 'string') resume(saved);
    },
    // Left open over another project, the sheet would start its conversation in the old project's folder.
    // mapProjectId: a conversation born in one project opened from the map of another (mm24) stays open on that map.
    showProject(projectId) { if (context && (context.mapProjectId ?? context.projectId) !== projectId) close(); },
    relabel() {
      if (root.hidden) return;
      input.placeholder = context?.placeholder ?? t()('chat.placeholder');
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
