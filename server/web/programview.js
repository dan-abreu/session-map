// The Flow tab's "The program" level (id130, mm57): draws the interface tree served by the engine (GET /api/census/ui) —
// the 13 areas with their screens, sections and buttons, each text resolved in the person's language by the translator.
// The census comes from the code, never from an AI's memory; this file only draws what it receives.
export function createProgramView({ h, t, api }) {
  let data = null;
  let debts = null;
  // The Flow's ctx.t is a getter: the translator itself is returned by t(), called with the key.
  const tt = () => t();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // The page's own design tokens (the same vars the rest of the program uses), injected once: the pane never
  // invents colors of its own.
  const STYLE_ID = 'pg-program-styles';
  function ensureStyles() {
    if (!document.getElementById(STYLE_ID)) {
      const el = document.createElement('style');
      el.id = STYLE_ID;
      el.textContent = [
        '#flowProgram{padding:14px 18px;overflow:auto;height:100%}',
        '.pg-lede{color:var(--ink-2);margin:0 0 14px;font-size:12.5px;max-width:70ch}',
        '.pg-area{margin:0 0 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2)}',
        '.pg-area>summary{list-style:none;cursor:pointer;padding:9px 13px;display:flex;gap:10px;align-items:baseline}',
        '.pg-area>summary::-webkit-details-marker{display:none}',
        '.pg-area b{font-size:14px}',
        '.pg-count{color:var(--ink-2);font-size:11px}',
        '.pg-kids{padding:0 13px 10px;border-top:1px dashed var(--line)}',
        '.pg-tree{border-left:2px solid var(--line);margin:2px 0 2px 6px;padding-left:10px}',
        '.pg-tree>summary{list-style:none;cursor:pointer;padding:2px 0;font-size:12.5px}',
        '.pg-tree>summary::-webkit-details-marker{display:none}',
        '.pg-sum{color:var(--ink)}',
        '.pg-tree[open]>.pg-sum{font-weight:600}',
        '.pg-kids .pg-kids{padding-left:4px}',
        '.pg-leaf{padding:1px 0 1px 12px;font-size:12.5px;color:var(--ink)}',
        '.pg-leaf.pg-label{color:var(--ink-2);font-size:12px}',
        '.pg-leaf.pg-button{color:var(--active)}',
        '.pg-leaf.pg-dialog{color:var(--waiting)}',
      ].join('\n');
      document.head.appendChild(el);
    }
  }

  const iconOf = (type) => (type === 'button' ? '▸' : type === 'summary' ? '▾' : type === 'dialog' ? '▣' : '');
  const nodeOf = (n, depth) => {
    const label = n.key ? tt()(n.label) : (n.label ?? '—');
    if (n.children?.length) {
      return h('details', { class: 'pg-tree', open: depth < 1 },
        h('summary', { class: 'pg-sum' }, n.type === 'heading' ? `${'§'.repeat(n.level ?? 1)} ` : '', label),
        h('div', { class: 'pg-kids' }, n.children.map((c) => nodeOf(c, depth + 1))));
    }
    return h('div', { class: `pg-leaf pg-${n.type ?? 'label'}` }, iconOf(n.type), ' ', label);
  };

  function draw(root) {
    if (!data) {
      root.replaceChildren(h('p', { class: 'pg-lede' }, tt()('program.loading')));
      return;
    }
    root.replaceChildren(
      h('p', { class: 'pg-lede' }, tt()('program.lede')),
      ...data.areas.map((a) => h('details', { class: 'pg-area', open: a.id === 'home' },
        h('summary', { class: 'pg-area-sum' }, h('b', {}, tt()(a.label) || a.id), h('span', { class: 'pg-count' }, ` ${a.items} ${tt()('program.items')}`)),
        h('div', { class: 'pg-kids' },
          a.nodes.length ? a.nodes.map((n) => nodeOf(n, 0)) : h('div', { class: 'pg-leaf pg-label' }, tt()('program.building'))))),
      h('details', { class: 'pg-area pg-debts' },
        h('summary', { class: 'pg-area-sum' }, h('b', {}, tt()('program.debts')), h('span', { class: 'pg-count' }, ` ${debts?.length ?? 0}`)),
        h('div', { class: 'pg-kids' },
          (debts?.length
            ? debts.map((d) => h('div', { class: 'pg-leaf pg-label' }, `${esc(d.file)}:${d.line} — ${esc(d.text)}`))
            : h('div', { class: 'pg-leaf pg-label' }, tt()('program.debts.none'))))));
  }

  async function render(root) {
    if (!root) return;
    ensureStyles();
    if (!data) {
      try {
        const res = await (api?.getJSON ?? fetch)('/api/census/ui');
        const body = res.ok === undefined ? res : (await res.json());
        if (body?.areas) data = body;
      } catch { /* the loading line stays */ }
    }
    if (!debts) {
      try {
        const res = await (api?.getJSON ?? fetch)('/api/census/debt');
        const body = res.ok === undefined ? res : (await res.json());
        if (body) debts = body.debts ?? [];
      } catch { /* the section shows nothing */ }
    }
    draw(root);
  }

  return { render, refresh: (root) => draw(root) };
}
