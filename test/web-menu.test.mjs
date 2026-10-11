// The small menus around the map (mm47, mm48): "Novo", "Vista" and the person's menu share one behaviour. A tiny
// document is enough: build, fire the handlers, look at hidden, aria-expanded and the focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenu } from '../server/web/menu.js';

class El {
  constructor(tag, attrs = {}) {
    this.tag = tag; this.attrs = { ...attrs }; this.children = []; this.parent = null; this.handlers = {};
    this.hidden = Boolean(attrs.hidden); this.disabled = Boolean(attrs.disabled);
  }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return this; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(ev, fn) { (this.handlers[ev] ??= []).push(fn); }
  fire(ev, extra = {}) {
    const e = { type: ev, target: this, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...extra };
    for (let n = this; n && !e.stopped; n = n.parent) for (const fn of n.handlers[ev] ?? []) fn(e);
    return e;
  }
  focus() { globalThis.document.activeElement = this; }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest(sel) {
    for (let x = this; x; x = x.parent) {
      if (sel === '[hidden]' && x.hidden) return x;
      if (sel === '[data-close]' && 'data-close' in x.attrs) return x;
    }
    return null;
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) {
    if (sel !== '[role^="menuitem"]') throw new Error(`unexpected selector ${sel}`);
    return this.all().filter((n) => String(n.attrs.role ?? '').startsWith('menuitem'));
  }
}

function setup() {
  const listeners = {};
  globalThis.document = {
    activeElement: null,
    addEventListener: (ev, fn) => { (listeners[ev] ??= new Set()).add(fn); },
    removeEventListener: (ev, fn) => listeners[ev]?.delete(fn),
  };
  const page = new El('body');
  const button = new El('button');
  const pop = new El('div', { hidden: true });
  const a = new El('button', { role: 'menuitem', 'data-close': '' });
  const off = new El('button', { role: 'menuitem', disabled: true });
  const b = new El('button', { role: 'menuitemcheckbox' });
  const sub = new El('div', { hidden: true });
  const inSub = new El('button', { role: 'menuitem' });
  sub.append(inSub);
  const c = new El('button', { role: 'menuitem' });
  pop.append(a, off, b, sub, c);
  const elsewhere = new El('div');
  const picker = new El('div');
  page.append(button, pop, elsewhere, picker);
  const events = [];
  const menu = createMenu({ button, pop, doc: globalThis.document, inside: (el) => picker.contains(el), onOpen: () => events.push('open'), onClose: () => events.push('close') });
  const outside = (target) => { for (const fn of listeners.pointerdown ?? []) fn({ target }); };
  return { menu, button, pop, a, off, b, sub, inSub, c, elsewhere, picker, events, outside, listeners };
}
const focused = () => globalThis.document.activeElement;

test('a click on the button opens the menu on its first item, a second click closes it', () => {
  const s = setup();
  s.button.fire('click');
  assert.equal(s.pop.hidden, false);
  assert.equal(s.button.attrs['aria-expanded'], 'true');
  assert.equal(focused(), s.a);
  assert.equal(s.menu.isOpen(), true);
  s.button.fire('click');
  assert.equal(s.pop.hidden, true);
  assert.equal(s.button.attrs['aria-expanded'], 'false');
  assert.deepEqual(s.events, ['open', 'close']);
});

test('the arrows walk the items it can use, skip the disabled and hidden ones, and wrap', () => {
  const s = setup();
  s.button.fire('click');
  s.a.fire('keydown', { key: 'ArrowDown' });
  assert.equal(focused(), s.b, 'the disabled item is skipped');
  s.b.fire('keydown', { key: 'ArrowDown' });
  assert.equal(focused(), s.c, 'the item of the closed submenu is skipped');
  s.c.fire('keydown', { key: 'ArrowDown' });
  assert.equal(focused(), s.a, 'wraps to the top');
  s.a.fire('keydown', { key: 'ArrowUp' });
  assert.equal(focused(), s.c, 'and to the bottom');
  s.c.fire('keydown', { key: 'Home' });
  assert.equal(focused(), s.a);
  s.a.fire('keydown', { key: 'End' });
  assert.equal(focused(), s.c);
  s.sub.hidden = false;
  s.b.focus();
  s.b.fire('keydown', { key: 'ArrowDown' });
  assert.equal(focused(), s.inSub, 'an open submenu joins the walk');
});

test('Esc closes the menu, gives the focus back to its button and goes no further', () => {
  const s = setup();
  s.button.fire('click');
  const e = s.b.fire('keydown', { key: 'Escape' });
  assert.equal(s.pop.hidden, true);
  assert.equal(focused(), s.button);
  assert.equal(e.stopped, true, 'the page does not also close the chat behind it');
});

test('ArrowDown on the closed button opens it; Tab leaves it closed', () => {
  const s = setup();
  s.button.fire('keydown', { key: 'ArrowDown' });
  assert.equal(s.pop.hidden, false);
  assert.equal(focused(), s.a);
  s.a.fire('keydown', { key: 'Tab' });
  assert.equal(s.pop.hidden, true);
});

test('a press outside closes it, except on what the menu counts as its own (the period picker)', () => {
  const s = setup();
  s.button.fire('click');
  s.outside(s.picker);
  assert.equal(s.pop.hidden, false, 'the period picker opened from the menu');
  s.outside(s.a);
  assert.equal(s.pop.hidden, false, 'inside the menu');
  s.outside(s.elsewhere);
  assert.equal(s.pop.hidden, true);
  assert.equal(s.listeners.pointerdown.size, 0, 'the page stops listening once closed');
});

test('an item marked data-close closes the menu after its click; a switch keeps it open', () => {
  const s = setup();
  s.button.fire('click');
  s.b.fire('click');
  assert.equal(s.pop.hidden, false);
  s.a.fire('click');
  assert.equal(s.pop.hidden, true);
});

test('an item the page does not draw (a phone-only one on a computer) is left out of the walk', () => {
  const s = setup();
  s.b.getClientRects = () => [];
  s.button.fire('click');
  s.a.fire('keydown', { key: 'ArrowDown' });
  assert.equal(focused(), s.c);
});

test('an item marked data-close gives the focus back to the menu button, so the next Tab goes on from there', () => {
  const s = setup();
  s.button.fire('click');
  s.a.focus();
  s.a.fire('click');
  assert.equal(s.pop.hidden, true);
  assert.equal(focused(), s.button, 'not lost to the page');
});

test('an item marked data-close that moves the focus itself (it opens a dialog) keeps it there', () => {
  const s = setup();
  const dialog = new El('div');
  s.a.addEventListener('click', () => dialog.focus());
  s.button.fire('click');
  s.a.focus();
  s.a.fire('click');
  assert.equal(s.pop.hidden, true);
  assert.equal(focused(), dialog);
});
