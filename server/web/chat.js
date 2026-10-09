import { api } from './api.js';
import { chatLog } from './views.js';

const SSE_TYPES = ['session', 'text', 'tool', 'permission', 'turn-end', 'error'];

// The chat that runs through the person's own claude CLI (desenho-2 § 22). One conversation at a time in the sheet.
// ctx: root (the sheet), h, t (translator getter), toast, errorText, onSession (a new conversation got its id).
export function createChat({ root, h, t, toast, errorText, onSession, onClose }) {
  const q = (sel) => root.querySelector(sel);
  const logEl = q('#chatLog');
  const form = q('#chatForm');
  const input = q('#chatInput');
  const sendBtn = q('#chatSend');
  const stopBtn = q('#chatStop');
  let context = null;
  let key = null;
  let source = null;
  let log = undefined;
  let lastEventId = 0;
  let returnFocus = null;

  function detach() {
    source?.close();
    source = null;
  }

  function apply(evt) {
    log = chatLog(log, evt);
    if (evt.type === 'session' && evt.data.state === 'started') onSession?.(evt.data.sessionId);
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

  function render() {
    const tt = t();
    const items = log?.items ?? [];
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    logEl.replaceChildren(...(items.length ? items.map(itemView) : [h('li', { class: 'msg-intro' }, context?.intro ?? tt('chat.introResume'))]));
    if (stick || items.at(-1)?.type === 'user') logEl.scrollTop = logEl.scrollHeight;
    const running = Boolean(log?.running);
    stopBtn.hidden = !running;
    sendBtn.disabled = running || Boolean(log?.ended);
    input.disabled = Boolean(log?.ended);
    q('#chatStatus').textContent = log?.ended ? tt('chat.ended') : running ? tt('chat.thinking') : '';
  }

  async function send(text) {
    log = chatLog(log, { type: 'local-send', data: { text } });
    render();
    const res = key ? await api.chatSend(key, text) : await api.chatStart({ projectId: context.projectId, ...context.start, text });
    if (!res.ok && !(res.error === 'busy' && res.chatKey)) {
      log = chatLog(log, { type: 'error', data: { error: res.error } });
      return render();
    }
    if (!key) {
      key = res.chatKey;
      listen();
    }
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
  q('[data-close="chat"]').addEventListener('click', () => close());

  function open(ctx) {
    if (root.hidden) returnFocus = document.activeElement;
    detach();
    context = ctx;
    key = null;
    log = undefined;
    lastEventId = 0;
    q('#chatTitle').textContent = ctx.title;
    q('#chatContext').textContent = ctx.subtitle ?? '';
    input.placeholder = t()('chat.placeholder');
    root.hidden = false;
    render();
    input.focus();
  }

  function close() {
    if (root.hidden) return;
    // The conversation keeps running on the PC; closing only stops watching it here.
    detach();
    root.hidden = true;
    onClose?.();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  return {
    open,
    close,
    isOpen: () => !root.hidden,
    relabel() { if (!root.hidden) { input.placeholder = t()('chat.placeholder'); render(); } },
  };
}
