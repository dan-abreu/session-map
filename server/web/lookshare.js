// The "look only" link (server.md sv04). A page opened with it is marked so its style hides the chat and every button;
// the server refuses all of them anyway. The owner makes, copies, renews or turns off the link from the help menu.

export const applyLook = (body, on) => body.classList.toggle('is-look', Boolean(on));

// box: where the owner's controls go (hidden until asked). copy(text): puts the text on the clipboard, true when it did.
export function createLookShare({ box, h, t: tOf, api, toast, copy }) {
  const render = (res) => {
    const t = tOf();
    if (!res.ok) return box.replaceChildren(h('p', { class: 'look-note' }, t('look.failed')));
    const act = (name, label, run, primary = false) => h('button', { type: 'button', class: `btn small-btn${primary ? ' primary' : ''}`, 'data-look': name, onclick: run }, label);
    const change = (call, done) => async () => {
      const out = await call();
      render(out);
      if (out.ok && done) toast(t(done));
    };
    box.replaceChildren(...[
      h('p', { class: 'look-note' }, t('look.lede')),
      res.on ? h('input', { type: 'text', class: 'look-link', readonly: true, value: res.link, 'aria-label': t('look.linkLabel'), onfocus: (e) => e.target.select?.() }) : null,
      h('div', { class: 'look-actions' }, res.on
        ? [
          act('copy', t('look.copy'), async () => { if (await copy(res.link)) toast(t('look.copied')); }, true),
          act('new', t('look.new'), change(() => api.makeLookKey())),
          act('drop', t('look.drop'), change(() => api.dropLookKey(), 'look.dropped')),
        ]
        : act('make', t('look.make'), change(() => api.makeLookKey()), true)),
    ].filter(Boolean));
    return undefined;
  };
  return {
    async open() {
      if (!box.hidden) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      render(await api.lookKey());
    },
  };
}
