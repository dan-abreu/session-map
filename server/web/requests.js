// The owner's requests, as the project's registry keeps them (docs/architecture/ideas.md in session-map): each item with
// an "Asked" line is one request, with the owner's words and dates, what it means, how to confirm it, the items it became
// and its status. Pure: node:test loads it, and the Requests tab draws it.

// The order the tab shows them in: what is being done first, then what will be, what waits, what is done, what was dropped.
export const REQUEST_STATES = ['doing', 'planned', 'later', 'done', 'dropped'];

const LABELS = {
  asked: /^(asked|pedido(?: em)?)\s*:\s*/i,
  meaning: /^(what it means|o que significa)\s*:\s*/i,
  confirm: /^(how to confirm it is done|como conferir(?: que está feito)?)\s*:\s*/i,
  went: /^(where it went|onde foi(?: parar)?)\s*:\s*/i,
  status: /^(status|situação)\s*:\s*/i,
};

const STATE_WORDS = [
  ['doing', /^(in progress|being built|built|em andamento|em construção|construído)/i],
  ['planned', /^(accepted|new|planned|aceito|novo|planejado)/i],
  ['later', /^(later|depois)/i],
  ['done', /^(done|feito|pronto)/i],
  ['dropped', /^(discarded|descartado)/i],
];

const CODE_IN_TICKS = /`([a-z]{1,4}(?:-[a-z]{1,8})?\d{1,4})`/gi;
const isPerson = (who) => Boolean(who) && who.trim().toLowerCase() !== 'claude';

// "2026-10-09 16:20 — "words"; 2026-10-10 ~04:50 — words" → [{date, time, words}].
function askedOf(text) {
  return text.split(/;\s*(?=\d{4}-\d{2}-\d{2})/).map((part) => {
    const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(~?\d{1,2}:\d{2}))?\s*[—–-]\s*(.*)$/.exec(part.trim());
    if (!m) return { date: null, time: null, words: part.trim() };
    return { date: m[1], time: m[2] ?? null, words: m[3].trim().replace(/^"(.*)"$/, '$1') };
  });
}

// The words in the first pair of brackets, nested brackets included: "later (thinking aloud)." → "thinking aloud".
function noteOf(text) {
  const open = text.indexOf('(');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i).trim();
  }
  return null;
}

function stateOf(statusText, itemStatus) {
  const hit = STATE_WORDS.find(([, re]) => re.test(statusText ?? ''));
  if (hit) return hit[0];
  if (itemStatus === 'done') return 'done';
  return itemStatus === 'doing' ? 'doing' : 'planned';
}

// project: a project of the state; its parts carry the items. → {list, counts}.
export function requestsOf(project) {
  const parts = project?.arch?.parts ?? [];
  const items = new Map();
  // The work a request points at is an item of the map, never another request: a registry may reuse a map item's code.
  const isRequest = (it) => (it.detail ?? []).some((d) => LABELS.asked.test(d));
  for (const part of parts) for (const g of part.groups ?? []) for (const it of g.items ?? []) if (it.code && !isRequest(it)) items.set(it.code, { ...it, partId: part.id });
  const list = [];
  for (const part of parts) {
    for (const g of part.groups ?? []) {
      for (const it of g.items ?? []) {
        const lines = {};
        for (const d of it.detail ?? []) {
          for (const [key, re] of Object.entries(LABELS)) {
            if (lines[key] === undefined && re.test(d)) lines[key] = d.replace(re, '').trim();
          }
        }
        if (lines.asked === undefined) continue;
        const went = [...new Set([...(lines.went ?? '').matchAll(CODE_IN_TICKS)].map((m) => m[1]))].map((code) => {
          const target = items.get(code);
          return { code, status: target?.status ?? null, title: target?.title ?? null, partId: target?.partId ?? null, who: target?.who ?? null };
        });
        const onMap = went.filter((w) => w.status);
        let state = stateOf(lines.status, it.status);
        // The items move before the registry is written again: work started on them means the request is being done.
        if (state === 'planned' && onMap.some((w) => w.status !== 'todo')) state = 'doing';
        const status = lines.status ?? '';
        list.push({
          code: it.code, title: it.title, partId: part.id, group: g.name, state,
          asked: askedOf(lines.asked), meaning: lines.meaning ?? null, confirm: lines.confirm ?? null,
          went, progress: { done: onMap.filter((w) => w.status === 'done').length, total: onMap.length },
          version: /\b(?:released in|publicad[oa] na)\s+(v\d+(?:\.\d+)*)/i.exec(status)?.[1] ?? null,
          unreleased: /\b(on main|na main|not released|ainda não publicad)/i.test(status),
          note: noteOf(status), statusText: status || null,
          // Open work with the owner's name on it waits for him; an open request with no item yet was never turned into work.
          waiting: onMap.some((w) => w.status !== 'done' && isPerson(w.who)),
          noActivity: (state === 'planned' || state === 'doing') && !went.length,
        });
      }
    }
  }
  const counts = Object.fromEntries(REQUEST_STATES.map((s) => [s, list.filter((r) => r.state === s).length]));
  return { list, counts };
}
