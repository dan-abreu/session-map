// The state the "look only" link gets (server.md sv04): what draws the map and nothing else. Built by an allow-list of
// fields, so a field added to the state later stays with the owner until it is named here. Chat words, links into a
// conversation, folders on disk, card notes and money never leave; they come as empty values of the same shape, so the
// page draws as it does for the owner.

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const list = (xs) => (Array.isArray(xs) ? xs : []);
const NO_COST = Object.freeze({ today: 0, d7: 0, d30: 0 });

const CHAT_KEYS = ['sessionId', 'title', 'partId', 'partSource', 'itemCode', 'workCellId', 'workCellSource', 'parentId', 'status', 'model',
  'turnStartedAt', 'live', 'stepPartId', 'startedAt', 'updatedAt', 'archived'];
const ROW_KEYS = ['sessionId', 'title', 'origin', 'partId', 'partSource', 'itemCode', 'node', 'status', 'waiting', 'startedAt', 'updatedAt',
  'archived', 'live', 'onMap', 'cutOff'];
const CELL_KEYS = ['id', 'branch', 'remote', 'partId', 'touches', 'ahead', 'commits', 'chatIds', 'status', 'bornAt', 'mergedAt', 'clashWith'];
const ACTIVITY_KEYS = ['kind', 'ts', 'partIds', 'sessionId', 'workCellId', 'branch'];

const lookChat = (c) => ({
  ...pick(c, CHAT_KEYS),
  entrypoint: '', bridgeUrl: null, lastPrompt: '', lastAssistantText: '',
  waiting: { strong: Boolean(c.waiting?.strong), weak: Boolean(c.waiting?.weak), items: [] },
  card: null, costUSD: 0, advice: null, workflows: [], liveSteps: [], chattable: false,
});
const lookRow = (r) => ({ ...pick(r, ROW_KEYS), lastStep: null, costUSD: 0, chattable: false });
const lookCell = (w) => ({ ...pick(w, CELL_KEYS), nucleus: { doing: null, todo: [] }, openspec: null, estimateUSD: null, costUSD: 0 });

function lookProject(p) {
  return {
    ...pick(p, ['id', 'name', 'mainBranch', 'fetchedAt', 'arch', 'requestWords', 'background', 'roadmap']),
    workCells: list(p.workCells).map(lookCell),
    activity: list(p.activity).map((a) => pick(a, ACTIVITY_KEYS)),
    chats: list(p.chats).map(lookChat),
    conversations: list(p.conversations).map(lookRow),
    visitors: [], decisions: [], skills: [], plugins: [], foundation: null, ai: null,
    cost: NO_COST, costByDay: [], costByModel: {}, costWhy: { older: 0, removed: 0 },
  };
}

// Made once per state, like the owner's answer, so its tag stays the same while the state does.
const made = new WeakMap();
export function lookState(s) {
  let out = made.get(s);
  if (!out) {
    out = {
      ...pick(s, ['generatedAt', 'waitingCount', 'currency', 'refreshing']),
      totals: NO_COST, budget: null, limits: null,
      projects: list(s.projects).map(lookProject),
    };
    made.set(s, out);
  }
  return out;
}
