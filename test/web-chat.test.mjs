import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../server/web/chat.js';

// Just enough DOM for chat.js: the sheet's fixed parts, found by selector, with listeners and children.
class El {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.textContent = '';
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.clientHeight = 0;
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  replaceChildren(...cs) { this.children = cs; }
  focus() {}
}

function sheet() {
  const parts = new Map(['#chatLog', '#chatForm', '#chatInput', '#chatSend', '#chatStop', '#chatTitle', '#chatContext', '#chatStatus', '[data-close="chat"]'].map((s) => [s, new El()]));
  const root = new El();
  root.hidden = true;
  root.querySelector = (sel) => parts.get(sel);
  return root;
}

globalThis.document ??= { activeElement: null, contains: () => false };

function openChat(onClose = () => {}) {
  const root = sheet();
  const chat = createChat({ root, h: () => new El(), t: () => (key) => key, toast() {}, errorText: (e) => e, onClose });
  chat.open({ projectId: 'acme-shop', title: 'New chat in Checkout', intro: 'intro', start: { unitId: 'checkout' } });
  return chat;
}

test('a chat sheet closes when the page moves to another project', () => {
  let closed = 0;
  const chat = openChat(() => closed++);
  chat.showProject('notes-app');
  assert.equal(chat.isOpen(), false);
  assert.equal(closed, 1);
});

test('a chat sheet stays open while its own project is shown again (language switch, poll)', () => {
  const chat = openChat();
  chat.showProject('acme-shop');
  assert.equal(chat.isOpen(), true);
});
