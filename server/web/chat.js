import { api } from './api.js';
import { chatLog, pcModeOffer } from './views.js';

const SSE_TYPES = ['user', 'session', 'mode', 'text', 'tool', 'permission', 'turn-end', 'error'];
// "settings" runs the chat in the mode of the person's own Claude settings; the rest are picked in the header.
const MODES = ['settings', 'default', 'acceptEdits', 'auto'];
const SAVED = 'sm.chat';

const browserStorage = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

// The chat that runs through the person's own claude CLI (desenho-2 § 22). One conversation at a time in the sheet.
// ctx: root (the sheet), h, t (translator getter), toast, errorText, onSession (a new conversation got its id),
// onPcMode(mode) (the person asked to use the mode on the whole PC), storage (where the open conversation is kept for
// a reload), relative (a date as "5 min ago").
export function createChat({ root, h, t, toast, errorText, onSession, onClose, onPcMode, storage = browserStorage(), relative = () => '' }) {
  const q = (sel) => root.querySelector(sel);
  const logEl = q('#chatLog');
  const form = q('#chatForm');
  const input = q('#chatInput');
  const sendBtn = q('#chatSend');
  const stopBtn = q('#chatStop');
  const modeEl = q('#chatMode');
  const listEl = q('#chatList');
  const noteEl = q('#chatNote');
  const pcBtn = q('#chatPcMode');
  let context = null;
  let key = null;
  let sessionId = null;
  let source = null;
  let log = undefined;
  let lastEventId = 0;
  let returnFocus = null;
  let settings = null;
  let choice = 'settings';

  // Blocked storage (private window, a preview) only means a reload does not bring the conversation back.
  function remember(entry) {
    try {
      if (entry) storage?.setItem(SAVED, JSON.stringify(entry));
      else storage?.removeItem(SAVED);
    } catch { /* not remembered */ }
  }
  function remembered() {
    try { return JSON.parse(storage?.getItem(SAVED) ?? 'null'); } catch { return null; }
  }
  const rememberOpen = () => remember({ projectId: context.projectId, sessionId, title: context.title, subtitle: context.subtitle ?? '' });

  function detach() {
    source?.close();
    source = null;
  }

  function apply(evt) {
    log = chatLog(log, evt);
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
    if (item.type === 'user') return h('li', { class: 'msg msg-user' }, h('span', { class: 'visually-hidden' }, `${tt('chat.you')}: `), h('p', {}, item.text));
    if (item.type === 'assistant') {
      return h('li', { class: `msg msg-claude${item.streaming ? ' is-streaming' : ''}` }, h('span', { class: 'visually-hidden' }, 'Claude: '), h('p', {}, item.text));
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

  function render() {
    const tt = t();
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
    q('#chatStatus').textContent = status;
  }

  async function send(text) {
    log = chatLog(log, { type: 'local-send', data: { text } });
    listEl.hidden = true;
    render();
    const live = key && !log.ended;
    const start = sessionId ? { sessionId } : context.start;
    const res = live ? await api.chatSend(key, text) : await api.chatStart({ projectId: context.projectId, ...start, mode: choice, text });
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
    if (node?.kind === 'idea' || node?.kind === 'create-arch') scope = { kind: node.kind };
    else if (node?.partId) scope = { partId: node.partId, ...(node.kind === 'item' && node.code ? { code: node.code } : {}) };
    else if (ctx.start?.workCellId) scope = { workCellId: ctx.start.workCellId };
    const res = await api.chatList({ projectId: ctx.projectId, ...scope });
    if (context !== ctx || !res.ok) return;
    settings = res.settings ?? null;
    renderMode();
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
    sessionId = ctx.start.sessionId;
    rememberOpen();
    log = chatLog(log, { type: 'history', data: { messages: res.messages ?? [] } });
    if (res.chatKey) watch(res.chatKey);
    renderMode();
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
  q('[data-close="chat"]').addEventListener('click', () => close());

  function open(ctx) {
    if (root.hidden) returnFocus = document.activeElement;
    detach();
    context = ctx;
    key = null;
    sessionId = null;
    log = undefined;
    lastEventId = 0;
    choice = 'settings';
    listEl.hidden = true;
    listEl.replaceChildren();
    q('#chatTitle').textContent = ctx.title;
    q('#chatContext').textContent = ctx.subtitle ?? '';
    input.placeholder = t()('chat.placeholder');
    input.value = ctx.draft ?? '';
    root.hidden = false;
    renderMode();
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
    // After a reload: the conversation that was open in this project's sheet.
    restore(projectId) {
      const saved = remembered();
      if (saved && saved.projectId === projectId && typeof saved.sessionId === 'string') resume(saved);
    },
    // Left open over another project, the sheet would start its conversation in the old project's folder.
    showProject(projectId) { if (context && context.projectId !== projectId) close(); },
    relabel() { if (!root.hidden) { input.placeholder = t()('chat.placeholder'); renderMode(); render(); } },
  };
}
