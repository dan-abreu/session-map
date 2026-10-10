// The five kinds of information a part or an item holds (mm07): each has one colour, one icon, a plain title and a line
// saying where it comes from, and every screen draws it the same way. Pure: node:test loads it.

export const INFO_KINDS = ['tasks', 'chats', 'branches', 'changes', 'files'];

// icon: a symbol of the sprite in index.html; the colour is the --k-<kind> trio in style.css.
export const KIND_LOOK = {
  tasks: { icon: 'check' }, chats: { icon: 'chat' }, branches: { icon: 'branch' }, changes: { icon: 'clock' }, files: { icon: 'file' },
};

// The tabs of a point's details. Lines of work sit with the conversations: both say who is working on it.
export const POINT_TABS = ['summary', 'tasks', 'chats', 'changes', 'files'];
export const TAB_OF = { tasks: 'tasks', chats: 'chats', branches: 'chats', changes: 'changes', files: 'files' };

export const kindWords = (t, kind, vars = {}) => ({ title: t(`kind.${kind}.title`), from: t(`kind.${kind}.from`, vars) });

// The chat about the box is not a tab: it sits under the information, always at hand. Asked for by name (a link with
// tab=chat, "New chat", a conversation from the list), the sheet opens with the information folded and the chat first.
export const CHAT_TAB = 'chat';

// has: {tasks?, chats?, changes?, files?} → the tabs worth showing: the Summary always, the rest only with something in them.
export const pointTabs = (has) => POINT_TABS.filter((tab) => tab === 'summary' || has[tab]);

// The root box holds the whole project: its own chats are always there, since that tab starts a new one.
export const projectTabs = (has) => ['summary', 'chats', 'changes', 'files'].filter((tab) => tab === 'summary' || tab === 'chats' || has[tab]);

// The tab a box opens on: its information (the Summary), unless another tab is asked for by name.
export const openingTab = (tab) => (POINT_TABS.includes(tab) ? tab : 'summary');

// The one line the Summary shows for a kind: counts in plain words, "·" between them.
export function kindDigest(t, kind, c) {
  const part = (n, key) => (n ? t.count(`kind.digest.${key}`, n) : null);
  const parts = {
    tasks: () => [part(c.open, 'tasks.open'), part(c.blocks, 'tasks.blocks')],
    chats: () => [part(c.n, 'chats.n'), part(c.waiting, 'chats.waiting')],
    branches: () => [part(c.n, 'branches.n'), part(c.clashing, 'branches.clashing')],
    changes: () => [part(c.n, 'changes.n')],
    files: () => [part(c.n, 'files.n')],
  }[kind]().filter(Boolean);
  return parts.length ? parts.join(' · ') : t(`kind.digest.${kind}.none`);
}
