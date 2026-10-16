// Configurações (page-chat pc19): every setting of the page in one small sheet, opened from the ⋯ of the bar or of a chat.
// It holds the language and the alert settings (a row that opens them), the monthly limit for reinforced work (the same
// value as Home's card) and the permission mode with "use this mode in every Claude on this PC". How the chat runs is the
// Cérebro's (id146): this sheet no longer picks a model or a way.
import { pcModeOffer } from './views.js';

// The modes the settings file of the PC may hold (never bypass), for the sheet opened with no conversation.
const PC_MODES = ['default', 'acceptEdits', 'auto'];

// ctx: dialog (the <dialog>), h, t (translator getter), icon(name, cls), money, toast, errorText, limit ({read(), save(usd)},
// the API Home's card uses), onPcMode(mode) (asks to use a mode in every Claude on this PC), langs (the codes to choose
// from), lang() (the open one), setLang(code), openAlerts() (the alert settings, which have their own sheet).
// A binding is what a chat sheet gives (chat.js settings()): title(), safety, modes, choice(), setChoice(mode), claudeMode().
export function createRunSettings(ctx) {
  const { dialog, h, money, toast, errorText, limit } = ctx;
  const t = () => ctx.t();
  let binding = null;
  let opener = null;
  let limitData = null;
  let pcChoice = 'default';
  let limitBox = null;
  let chatBox = null;

  // ---- the page: its language and its alerts ----

  const LANG_NAMES = { 'pt-BR': 'PT', en: 'EN' };
  function generalPart() {
    if (!ctx.setLang && !ctx.openAlerts) return null;
    const tt = t();
    const current = ctx.lang?.();
    const codes = Object.keys(LANG_NAMES);
    return h('section', { class: 'al-section st-general', 'aria-labelledby': 'stGeneral' },
      h('h3', { id: 'stGeneral' }, tt('settings.general')),
      ctx.setLang ? h('div', { class: 'st-line' },
        h('span', { class: 'st-label', id: 'stLangLabel' }, tt('lang.label')),
        h('div', { class: 'lang', role: 'radiogroup', 'aria-labelledby': 'stLangLabel' }, codes.map((code) => h('button', {
          type: 'button', role: 'radio', 'data-set': `lang-${code}`, lang: code, 'aria-checked': String(code === current),
          onclick: () => { if (code !== current) ctx.setLang(code); },
        }, LANG_NAMES[code])))) : null,
      ctx.openAlerts ? h('button', {
        type: 'button', class: 'st-link', 'data-set': 'alerts', 'aria-haspopup': 'dialog',
        onclick: () => { dialog.close(); ctx.openAlerts(); },
      }, ctx.icon ? ctx.icon('bell', 'st-link-icon') : null, h('span', { class: 'st-link-text' }, h('span', { class: 'al-opt-name' }, tt('notify.button')), h('span', { class: 'al-opt-hint' }, tt('settings.alertsHint'))),
      ctx.icon ? ctx.icon('next', 'st-link-chev') : null) : null);
  }

  // ---- the monthly limit ----

  async function saveLimit(field) {
    const value = Number(String(field.value).replace(',', '.'));
    const res = await limit.save(value);
    if (!res?.ok) return toast(errorText(res?.error ?? 'generic'));
    limitData = { ...limitData, ok: true, limitUSD: res.limitUSD };
    renderLimit();
    return toast(t()('run.limitSaved', { limit: money(res.limitUSD) }));
  }

  function renderLimit() {
    if (!limitBox) return;
    const tt = t();
    const value = limitData?.limitUSD ?? null;
    const field = h('input', { id: 'stLimit', type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'num', value: value === null ? '' : String(value), 'data-set': 'limit' });
    let status = tt('settings.loading');
    if (limitData?.ok) status = value === null ? tt('run.limitNone') : tt('run.limitUsed', { used: money(limitData.spentUSD ?? 0), limit: money(value) });
    else if (limitData) status = tt('settings.limitUnread');
    limitBox.replaceChildren(
      h('label', { class: 'st-label', for: 'stLimit' }, tt('run.limitLabel')),
      h('div', { class: 'st-row' }, field,
        h('button', { type: 'button', class: 'btn small-btn', 'data-set': 'limit-save', onclick: () => saveLimit(field) }, tt('run.limitSave'))),
      h('p', { class: 'al-opt-hint num' }, status),
      h('p', { class: 'al-opt-hint' }, tt('settings.limitSame')));
  }

  // ---- this conversation: its permissions ----

  function modeName(tt, mode) {
    return tt(`chat.modeName.${mode}`);
  }

  // The mode select and "use it in every Claude on this PC": the conversation's own modes, or the PC's with none open.
  function modePart(tt, { modes, value, label, onchange }) {
    const offer = pcModeOffer(value, null);
    const select = h('select', { id: 'stMode', 'data-set': 'mode' },
      modes.map((m) => h('option', { value: m, selected: m === value }, m === 'settings' ? tt('chat.mode.settings', { mode: modeName(tt, binding?.claudeMode() ?? 'default') }) : modeName(tt, m))));
    select.value = value;
    select.addEventListener('change', () => onchange(select.value));
    return h('div', { class: 'st-mode' },
      h('label', { class: 'st-label', for: 'stMode' }, label),
      h('div', { class: 'st-row' }, select,
        h('button', {
          type: 'button', class: 'btn small-btn', 'data-set': 'pcmode', disabled: !offer.mode, title: offer.mode ? tt('pcmode.hint') : tt('pcmode.pickFirst'),
          onclick: () => { if (offer.mode) ctx.onPcMode?.(offer.mode); },
        }, tt('pcmode.button'))));
  }

  // The conversation takes the mode choice at once (it tells the server on its own): the sheet shows it without waiting.
  function renderChat() {
    if (!chatBox) return;
    const tt = t();
    if (!binding) {
      chatBox.replaceChildren(
        h('h3', { id: 'stChat' }, tt('settings.pc')),
        modePart(tt, { modes: PC_MODES, value: pcChoice, label: tt('chat.modeLabel'), onchange: (m) => { pcChoice = m; renderChat(); } }),
        h('p', { class: 'al-opt-hint' }, tt('pcmode.safety')),
        h('p', { class: 'st-note' }, tt('settings.noChat')));
      return;
    }
    chatBox.replaceChildren(...[
      h('h3', { id: 'stChat' }, tt('settings.chat')),
      binding.title() ? h('p', { class: 'al-opt-hint st-for' }, tt('settings.for', { title: binding.title() })) : null,
      modePart(tt, { modes: binding.modes, value: binding.choice(), label: tt('settings.permissions'), onchange: (m) => { binding.setChoice(m); renderChat(); } }),
      h('p', { class: 'al-opt-hint' }, tt(binding.safety)),
    ].filter(Boolean));
  }

  function render() {
    const tt = t();
    limitBox = h('div', { class: 'st-limit' });
    chatBox = h('section', { class: 'al-section', 'aria-labelledby': 'stChat' });
    dialog.replaceChildren(
      h('div', { class: 'st-head' },
        h('h2', { id: 'settingsTitle' }, tt('settings.title')),
        h('button', { type: 'button', class: 'al-close', 'aria-label': tt('panel.close'), title: tt('panel.close'), onclick: () => dialog.close() },
          ctx.icon ? ctx.icon('close', 'al-close-icon') : tt('panel.close'))),
      h('p', { class: 'al-lede' }, tt('settings.lede')),
      generalPart(),
      h('section', { class: 'al-section', 'aria-labelledby': 'stLimitTitle' }, h('h3', { id: 'stLimitTitle' }, tt('settings.limit')), limitBox),
      chatBox);
    renderLimit();
    renderChat();
  }

  // binding: the conversation it is about (null: none); from: what gets the focus back when it closes.
  async function open(next = null, from = null) {
    binding = next && (next.isOpen?.() ?? true) ? next : null;
    opener = from ?? globalThis.document?.activeElement ?? null;
    limitData = null;
    render();
    if (!dialog.open) dialog.showModal();
    let res = null;
    try { res = await limit.read(); } catch { /* said below: could not read */ }
    limitData = res?.ok ? res : { ok: false };
    renderLimit();
  }

  dialog.addEventListener('close', () => {
    if (opener?.isConnected !== false) opener?.focus?.();
    opener = null;
  });

  return {
    open,
    close: () => { if (dialog.open) dialog.close(); },
    isOpen: () => Boolean(dialog.open),
    // The conversation's mode changed somewhere: the sheet follows, the limit field is kept, and
    // a choice the person is making in it is not redrawn under their hands.
    refresh() { if (dialog.open && !chatBox?.contains(globalThis.document?.activeElement)) renderChat(); },
    relabel() { if (dialog.open) { render(); } },
  };
}
