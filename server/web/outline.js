import { paintCount, pulseOn } from './mindmap.js';

// The same map on a phone (desenho-3 § 2): an indented list whose rows open and close. ctx as in mindmap.js.
export function createOutline(root, ctx) {
  const list = document.createElement('ul');
  list.className = 'ol-tree';
  root.append(list);

  function row(node, depth, view) {
    const open = view.open.has(node.id);
    const has = node.children.length > 0;
    const li = document.createElement('li');
    li.className = `ol-item k-${node.kind}`;
    li.dataset.id = node.id;
    const line = document.createElement('div');
    line.className = 'ol-row';
    line.style.setProperty('--depth', String(depth));
    const cls = line.classList;
    cls.toggle('is-selected', view.selected === node.id);
    cls.toggle('is-live', view.live.has(node.id));
    cls.toggle('is-lit', Boolean(view.lit?.has(node.id)));
    cls.toggle('is-dim', Boolean(view.lit) && !view.lit.has(node.id));
    cls.toggle('is-match', Boolean(view.match?.has(node.id)));
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ol-toggle';
    if (has) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', ctx.toggleLabel(node, open));
      toggle.innerHTML = '<svg aria-hidden="true"><use href="#i-next"/></svg>';
      toggle.addEventListener('click', () => ctx.onToggle(node));
    } else {
      toggle.disabled = true;
      toggle.setAttribute('aria-hidden', 'true');
      toggle.tabIndex = -1;
    }
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'ol-box';
    box.setAttribute('aria-current', view.selected === node.id ? 'true' : 'false');
    box.append(...ctx.content(node));
    box.addEventListener('click', () => ctx.onPick(node));
    line.append(toggle, box);
    const count = ctx.count?.(node);
    if (count) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ol-count';
      paintCount(btn, count, {});
      btn.addEventListener('click', () => ctx.onCount?.(node));
      line.append(btn);
    }
    li.append(line);
    if (has && open) {
      const kids = document.createElement('ul');
      kids.className = 'ol-kids';
      kids.append(...node.children.map((c) => row(c, depth + 1, view)));
      li.append(kids);
    }
    return li;
  }

  // ponytail: the whole list is rebuilt on each render; fine for the few hundred rows a map holds.
  function render(tree, view) {
    const focused = document.activeElement?.closest?.('.ol-item')?.dataset.id;
    const isToggle = document.activeElement?.classList.contains('ol-toggle');
    list.replaceChildren(row(tree, 0, view));
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
