import { paintCount, paintCaption, pulseOn, newFiles, PULSE_MS } from './mindmap.js';

// The same map on a phone (desenho-3 § 2): an indented list whose rows open and close. ctx as in mindmap.js. view.left (id77),
// as in mindmap.js plus label: the project's repository, a folded section under the project; its rows speak to view.left.ctx.
export function createOutline(root, ctx) {
  const list = document.createElement('ul');
  list.className = 'ol-tree';
  root.append(list);
  let repoOpen = false; // kept across redraws: the whole list is rebuilt each time
  let seenNew = null;
  let rootId = null;
  const fresh = new Map(); // id → until when its row blinks: a redraw in the meantime keeps blinking

  // side: the files side's own sets when the row belongs to it, else the architecture's.
  function row(node, depth, view, side = null) {
    const c = side ? side.ctx : ctx;
    const open = (side ?? view).open.has(node.id);
    const has = node.children.length > 0;
    const caption = view.captions?.get(node.id) ?? null;
    const li = document.createElement('li');
    li.className = `ol-item k-${node.kind}`;
    li.dataset.id = node.id;
    const line = document.createElement('div');
    line.className = 'ol-row';
    line.style.setProperty('--depth', String(depth));
    const cls = line.classList;
    cls.toggle('is-selected', view.selected === node.id);
    cls.toggle('is-live', (side ?? view).live.has(node.id));
    cls.toggle('is-tip', Boolean(caption?.exact));
    cls.toggle('is-lit', Boolean(!side && view.lit?.has(node.id)));
    // The files side is not part of what a period lights; a part picked lights its files in a light of its own (mm40).
    cls.toggle('is-part', Boolean(side?.lit?.has(node.id)));
    cls.toggle('is-dim', Boolean(!side && view.lit) && !view.lit.has(node.id));
    cls.toggle('is-pulse', (fresh.get(node.id) ?? 0) > Date.now());
    for (const [name, on] of Object.entries(c.classes?.(node) ?? {})) cls.toggle(name, on);
    cls.toggle('is-match', Boolean(view.match?.has(node.id)));
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ol-toggle';
    if (has) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', c.toggleLabel(node, open));
      toggle.innerHTML = '<svg aria-hidden="true"><use href="#i-next"/></svg>';
      toggle.addEventListener('click', () => c.onToggle(node));
    } else {
      toggle.disabled = true;
      toggle.setAttribute('aria-hidden', 'true');
      toggle.tabIndex = -1;
    }
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'ol-box';
    box.setAttribute('aria-current', view.selected === node.id ? 'true' : 'false');
    box.append(...c.content(node));
    box.addEventListener('click', () => c.onPick(node));
    line.append(toggle, box);
    const count = c.count?.(node);
    if (count) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ol-count';
      paintCount(btn, count, {});
      btn.addEventListener('click', () => c.onCount?.(node));
      line.append(btn);
    }
    li.append(line);
    if (caption) {
      const el = document.createElement('div');
      el.className = 'ol-caption';
      el.style.setProperty('--depth', String(depth));
      paintCaption(el, caption, {});
      li.append(el);
    }
    if (has && open) {
      const kids = document.createElement('ul');
      kids.className = 'ol-kids';
      kids.append(...node.children.map((kid) => row(kid, depth + 1, view, side)));
      li.append(kids);
    }
    return li;
  }

  // The repository under the project: folded until the person opens it, the same rows as the map's left side.
  function repoSection(view) {
    const side = view.left;
    if (!side?.tree.children.length) return null;
    const summary = document.createElement('summary');
    summary.className = 'ol-repo-title';
    summary.textContent = side.label ?? '';
    const kids = document.createElement('ul');
    kids.className = 'ol-kids';
    kids.append(...side.tree.children.map((c) => row(c, 0, view, side)));
    const details = document.createElement('details');
    details.className = 'ol-repo';
    details.open = repoOpen;
    details.addEventListener('toggle', () => { repoOpen = details.open; });
    details.append(summary, kids);
    const li = document.createElement('li');
    li.className = 'ol-item ol-repo-item';
    li.append(details);
    return li;
  }

  // ponytail: the whole list is rebuilt on each render; fine for the few hundred rows a map holds.
  function render(tree, view) {
    const focused = document.activeElement?.closest?.('.ol-item')?.dataset.id;
    const isToggle = document.activeElement?.classList.contains('ol-toggle');
    if (rootId !== tree.id) seenNew = null;
    rootId = tree.id;
    const arrived = newFiles(view.left?.tree ?? null, seenNew);
    seenNew = arrived.seen;
    for (const id of arrived.fresh) fresh.set(id, Date.now() + PULSE_MS);
    list.replaceChildren(row(tree, 0, view), ...[repoSection(view)].filter(Boolean));
    if (focused) list.querySelector(`[data-id="${CSS.escape(focused)}"] > .ol-row > ${isToggle ? '.ol-toggle' : '.ol-box'}`)?.focus({ preventScroll: true });
  }

  function reveal(id) {
    list.querySelector(`[data-id="${CSS.escape(id)}"] > .ol-row`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function focus(id) {
    list.querySelector(`[data-id="${CSS.escape(id)}"] > .ol-row > .ol-box`)?.focus({ preventScroll: true });
  }

  function pulse(id) {
    const line = list.querySelector(`[data-id="${CSS.escape(id)}"] > .ol-row`);
    if (line) pulseOn(line);
  }

  return { render, reveal, focus, pulse, fit() { root.scrollTop = 0; } };
}
