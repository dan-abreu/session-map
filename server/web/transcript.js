// One conversation drawn the way Claude Code shows it (mind-map-page mm22), for every origin: the page's own chats, the ones
// running in VS Code or a terminal, and the archive. The pure helpers on top are what node:test loads; createTranscript
// draws with the h() it is given, so the same items read the same in the chat sheet and in History.
import { modelName } from './live.js';
import { renderMarkdown } from './md.js';

const DIFF_CELLS_MAX = 250_000;
const STEP_ICON = { edit: 'rename', read: 'file', run: 'terminal', search: 'search', web: 'globe', agent: 'connect', skill: 'idea', plan: 'check', tool: 'box' };
const STEP_KINDS = new Set(Object.keys(STEP_ICON));

// "14:05" in the page's language; '' for a time that does not parse.
export function timeOf(lang, ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(d);
}

// The words of a date line: Today, Yesterday, or the weekday and date (with the year when it is not this year's).
export function dayName(tt, lang, dayKey, now = new Date()) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const back = Math.round((today - date) / 864e5);
  if (back === 0) return tt('chat.today');
  if (back === 1) return tt('chat.yesterday');
  return new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', ...(y !== today.getFullYear() ? { year: 'numeric' } : {}) }).format(date);
}

const localDay = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// A date line before the first item of each day; an item without a time stays in the day it is in.
export function withDays(items, dayOf = localDay) {
  const out = [];
  let current = null;
  for (const item of items) {
    const day = item.ts ? dayOf(item.ts) : null;
    if (day && day !== current) {
      out.push({ type: 'day', day, ts: item.ts });
      current = day;
    }
    out.push(item);
  }
  return out;
}

const wordsOf = (item) => [
  item.text, item.input, item.result, item.step?.target, item.agent?.description,
  ...(item.questions ?? []).flatMap((q) => [q.question, q.header, ...q.options.map((o) => o.label)]),
  ...Object.values(item.answers ?? {}),
].filter((v) => typeof v === 'string').join('\n').toLowerCase();

// The positions of the items that hold the words.
export function findHits(items, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return items.flatMap((item, n) => (item.type !== 'day' && wordsOf(item).includes(q) ? [n] : []));
}

// The task list Claude keeps (its todo tool): the last one written, how many are done and what is being done now.
export function latestTodos(items) {
  const last = items.findLast((i) => i.type === 'tool' && Array.isArray(i.todos));
  if (!last) return null;
  const now = last.todos.find((x) => x.status === 'in_progress');
  return { list: last.todos, done: last.todos.filter((x) => x.status === 'completed').length, now: now?.active ?? null };
}

const linesOf = (text) => (text ? String(text).replace(/\r\n?/g, '\n').split('\n') : []);

// Before and after, line by line: kept, removed and added. Too big to compare, it shows all out and then all in.
export function lineDiff(before, after) {
  const a = linesOf(before);
  const b = linesOf(after);
  if (a.length * b.length > DIFF_CELLS_MAX) return [...a.map((text) => ({ kind: 'del', text })), ...b.map((text) => ({ kind: 'add', text }))];
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { rows.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (j >= b.length || (i < a.length && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) rows.push({ kind: 'del', text: a[i++] });
    else rows.push({ kind: 'add', text: b[j++] });
  }
  return rows;
}

// ctx: h, t (translator getter), time(iso) and day(yyyy-mm-dd) in words, money(usd), imageUrl(n), icon(name, cls)?,
// onCopy(text)?, onHelper(agent, box)? (fills a helper's own conversation into box, drawn with this same transcript).
export function createTranscript({ h, t, time, day, money, imageUrl, icon = null, onCopy = null, onHelper = null }) {
  const pic = (name) => (icon ? icon(name, 'step-icon') : null);

  function copyButton(text, label) {
    if (!onCopy) return null;
    return h('button', { type: 'button', class: 'copy-btn', title: label, 'aria-label': label, onclick: () => onCopy(text) }, pic('copy'), icon ? null : label);
  }

  const md = (text) => {
    const tt = t();
    return renderMarkdown(h, text, {
      done: tt('chat.taskDone'), open: tt('chat.taskOpen'),
      code: (lang, body) => h('div', { class: 'md-code-head' }, h('span', {}, lang || tt('chat.code')), copyButton(body, tt('chat.copyCode'))),
    });
  };

  const meta = (item, extra = []) => {
    const parts = [item.ts ? h('time', { datetime: item.ts }, time(item.ts)) : null, ...extra].filter(Boolean);
    return parts.length ? h('div', { class: 'msg-meta' }, parts) : null;
  };

  // Images the transcript numbered (served by the page's server), or ones the person just pasted (data: URLs, local only).
  const images = (list, local = []) => (list?.length || local.length ? h('div', { class: 'msg-images' },
    (list ?? []).map((img) => h('a', { href: imageUrl(img.n), target: '_blank', rel: 'noopener' },
      h('img', { src: imageUrl(img.n), alt: t()('chat.image', { n: img.n + 1 }), loading: 'lazy' }))),
    local.map((url, n) => h('img', { src: url, alt: t()('chat.image', { n: n + 1 }) }))) : null);

  function userView(item) {
    const tt = t();
    return h('li', { class: 'msg msg-user' }, h('span', { class: 'visually-hidden' }, `${tt('chat.you')}: `),
      item.text ? h('div', { class: 'md' }, md(item.text)) : null, images(item.images, item.localImages), meta(item));
  }

  // The line under a reply: its time, what it cost and a copy button.
  function replyMeta(item) {
    const tt = t();
    const cost = Number.isFinite(item.replyCostUSD) ? h('span', { class: 'num', title: tt('chat.replyCostTitle') }, tt('chat.replyCost', { cost: money(item.replyCostUSD) })) : null;
    return meta(item, [cost, copyButton(item.text, tt('chat.copyReply'))]);
  }

  function claudeView(item) {
    return h('li', { class: 'msg msg-claude' }, h('span', { class: 'visually-hidden' }, 'Claude: '), h('div', { class: 'md' }, md(item.text)), replyMeta(item));
  }

  function thinkingView(item) {
    const tt = t();
    const label = Number.isFinite(item.ms) ? tt('chat.thought', { s: Math.max(1, Math.round(item.ms / 1000)) }) : tt('chat.thoughtPlain');
    if (!item.text?.trim()) return h('li', { class: 'msg msg-thinking' }, h('p', { class: 'thinking-line' }, label));
    return h('li', { class: 'msg msg-thinking' }, h('details', {}, h('summary', {}, label), h('div', { class: 'thinking-body' }, item.text)));
  }

  function diffView(diff) {
    const tt = t();
    return h('div', { class: 'diff', role: 'group', 'aria-label': tt('chat.diffLabel', { path: diff.path }) },
      h('p', { class: 'diff-path' }, pic('file'), diff.path),
      diff.hunks.map((hunk) => h('pre', { class: 'diff-hunk' }, lineDiff(hunk.before, hunk.after).map((row) => h('span', { class: `diff-row diff-${row.kind}` },
        h('span', { class: 'diff-sign', 'aria-hidden': 'true' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '),
        h('span', { class: 'visually-hidden' }, row.kind === 'add' ? tt('chat.diffAdded') : row.kind === 'del' ? tt('chat.diffRemoved') : ''),
        `${row.text}\n`)))));
  }

  function todosView(todos) {
    const tt = t();
    return h('ul', { class: 'todo-list' }, todos.map((x) => h('li', { class: `todo is-${x.status}` },
      h('span', { class: 'md-box', role: 'img', 'aria-label': tt(`chat.todo.${x.status === 'completed' ? 'done' : x.status === 'in_progress' ? 'now' : 'open'}`) }),
      x.status === 'in_progress' ? x.active : x.text)));
  }

  function stepLabel(item) {
    const tt = t();
    const step = item.step && STEP_KINDS.has(item.step.kind) ? item.step : { kind: 'tool', target: item.name };
    if (item.agent) {
      const bits = [item.agent.kind, item.agent.model ? modelName(item.agent.model) : null, Number.isFinite(item.agent.steps) ? tt('chat.helperSteps', { n: item.agent.steps }) : null].filter(Boolean);
      return [tt('chat.helper', { what: item.agent.description || step.target }), bits.length ? h('span', { class: 'step-sub' }, bits.join(' · ')) : null];
    }
    return [item.result === null ? tt(`live.step.${step.kind}`, { target: step.target }) : tt(`step.done.${step.kind}`, { target: step.target })];
  }

  function toolView(item) {
    const tt = t();
    const running = item.result === null;
    const box = item.agent?.id && onHelper ? h('div', { class: 'helper-log' }) : null;
    const details = h('details', {},
      h('summary', {}, pic(STEP_ICON[item.step?.kind] ?? 'box'), h('span', { class: 'step-words' }, stepLabel(item)),
        running ? h('span', { class: 'tool-state' }, tt('chat.toolRunning')) : null,
        item.isError ? h('span', { class: 'tool-state is-error' }, tt('chat.toolFailed')) : null,
        item.ts ? h('time', { class: 'step-time', datetime: item.ts }, time(item.ts)) : null),
      h('div', { class: 'tool-body' },
        item.diff ? diffView(item.diff) : null,
        item.todos ? todosView(item.todos) : null,
        item.agent?.prompt ? [h('p', { class: 'tool-label' }, tt('chat.helperAsked')), h('div', { class: 'md tool-input' }, md(item.agent.prompt))]
          : item.input && item.input !== '{}' ? [h('p', { class: 'tool-label' }, tt('chat.toolInput')), h('pre', { class: 'tool-input' }, item.input)] : null,
        box ? [h('p', { class: 'tool-label' }, tt('chat.helperLog')), box] : null,
        item.result ? [h('p', { class: 'tool-label' }, tt(item.agent ? 'chat.helperAnswer' : 'chat.toolResult')),
          item.agent ? h('div', { class: 'md tool-result' }, md(item.result)) : h('pre', { class: 'tool-result' }, item.result)] : null,
        item.cut ? h('p', { class: 'tool-cut' }, tt('chat.toolCut')) : null,
        images(item.images)));
    if (box) {
      let loaded = false;
      details.addEventListener('toggle', (e) => {
        if (loaded || !e.target.open) return;
        loaded = true;
        onHelper(item.agent, box);
      });
    }
    return h('li', { class: `msg msg-tool${item.isError ? ' is-error' : ''}${running ? ' is-running' : ''}${item.agent ? ' is-helper' : ''}` }, details);
  }

  function questionView(item) {
    const tt = t();
    return h('li', { class: 'msg msg-question', role: 'group', 'aria-label': tt('chat.questionLabel') },
      item.questions.map((q) => {
        const given = item.answers?.[q.question];
        const picked = typeof given === 'string' ? given.split(/,\s*/) : [];
        const known = q.options.some((o) => given === o.label || picked.includes(o.label));
        return h('div', { class: 'question' },
          q.header ? h('p', { class: 'question-head' }, q.header) : null,
          h('p', { class: 'question-text' }, q.question),
          h('ul', { class: 'question-options' }, q.options.map((o) => {
            const chosen = given === o.label || picked.includes(o.label);
            return h('li', { class: `question-option${chosen ? ' is-chosen' : ''}` },
              chosen ? pic('check') : null,
              h('span', { class: 'option-label' }, o.label),
              o.description ? h('span', { class: 'option-desc' }, o.description) : null,
              chosen ? h('span', { class: 'visually-hidden' }, ` (${tt('chat.answerChosen')})`) : null);
          })),
          h('p', { class: 'question-answer' }, item.answers === null ? tt('chat.questionWaiting')
            : typeof given !== 'string' ? tt('chat.questionSkipped')
              : known ? tt('chat.answered', { answer: given }) : tt('chat.answeredOwn', { answer: given })));
      }),
      meta(item));
  }

  function dayView(item) {
    return h('li', { class: 'msg-day', role: 'separator', 'aria-label': day(item.day) }, h('span', {}, day(item.day)));
  }

  const VIEWS = { user: userView, assistant: claudeView, thinking: thinkingView, tool: toolView, question: questionView, day: dayView };
  return {
    node: (item) => VIEWS[item.type]?.(item) ?? null,
    markdown: md,
    replyMeta,
    diffView,
    todosView,
  };
}
