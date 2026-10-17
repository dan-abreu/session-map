import { AI_FUNCTIONS, functionsOf } from './brainpanel.mjs';
import { enginesStatus } from './agent-engines.mjs';
import { KINDS } from './policy.mjs';

// The Cérebro told to the talk chat (id156, or67): the owner's table of which AI does each kind of work is the order,
// and until now the chat never heard of it, so it never handed anything to the AI he named. This is the short note that
// goes after the stance in the chat's prompt: how to start an agent so its specialist and the owner's choice apply (the
// kind in brackets), and, for the work rows the owner put on another AI, how to hand the work over. Pure but for the
// cached engine probe.

// The rows of work the chat itself routes. The engine rows (the entry brain, the map's bulk work, the book) are run by
// the program, never by the chat, so they are not told.
const WORK_ROWS = new Set(['plan', 'gather', 'docs', 'code', 'screen', 'debug', 'review', 'opinion', 'risk', 'agents']);
const NOTE_MAX = 2000;
// An agent gets its specialist (method, delivery) and the owner's model and level only when its description starts with
// its kind: the Agentes list of the tab is true only if the chat is told this.
export const TAG_LINE = `When you start an agent, begin its description with its kind in brackets, like [code] or [review] (kinds: ${KINDS.join(', ')}): session-map then gives that agent its specialist's method and the model and level the owner chose for it.`;

let cached = null;
const probe = () => {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), status: enginesStatus() };
  return cached.status;
};

// -> the note text: the tag line always, and the table of the rows on another AI when there are any. ai: config.json's ai
// part; status: enginesStatus' answer (injected by the tests).
export function cerebroNote({ ai, status } = {}) {
  const choices = functionsOf(ai);
  const named = AI_FUNCTIONS
    .filter((f) => WORK_ROWS.has(f.id))
    .map((f) => ({ f, c: choices[f.id] }))
    .filter(({ c }) => c?.provider && c.provider !== 'auto' && c.provider !== 'claude');
  if (!named.length) return TAG_LINE;
  const engines = status ?? probe();
  const edits = (p) => ['worktree', 'claude-base'].includes(engines?.[p]?.edits);
  // Rows on the same AI, model and level read as one line, so a table with many rows stays short.
  const groups = new Map();
  for (const { f, c } of named) {
    const level = [c.model && c.model !== 'auto' ? c.model : null, c.effort && c.effort !== 'auto' ? c.effort : null].filter(Boolean).join(' ');
    const how = `${c.provider}${level ? ` ${level}` : ''}${edits(c.provider) ? ', edits files' : ', answers only'}`;
    const g = groups.get(how) ?? { ids: [], kinds: [] };
    g.ids.push(f.id);
    for (const k of f.kinds ?? []) if (!g.kinds.includes(k)) g.kinds.push(k);
    groups.set(how, g);
  }
  const rows = [...groups].map(([how, g]) => `- ${g.ids.join(', ')}${g.kinds.length ? ` (${g.kinds.join(', ')})` : ''}: ${how}`);
  // The rows come last: if the note is ever cut at NOTE_MAX, only the tail of the table is lost, never an instruction.
  const lines = [
    TAG_LINE,
    'The owner\'s Cérebro is his own table of which AI does each kind of work; it is the order, not a hint.',
    'Every row not listed below runs on Claude: do it yourself or with your own agents.',
    'To hand a row\'s work to its AI: run_other_ai (kind, provider, a task that names its proof) where it says "edits files": it works in an isolated copy. Check the diff, have it reviewed by another family than the author (a [review] agent on Claude, or ask_other_ai), then merge_other_ai. Where it says "answers only", ask_other_ai for a draft or an opinion that you apply and test yourself.',
    'A defect found in review goes back to the AI that wrote it, with the findings in the task (run_other_ai again, same row): Claude reviews and sends back, it does not redo the work. After 2 rounds on one task, stop and tell the owner.',
    'Rows on another AI:',
    ...rows,
  ];
  const text = lines.join('\n');
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text;
}
