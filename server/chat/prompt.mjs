import { RUN_NOTE_END, RUN_NOTE_HEAD } from './run.mjs';

// The first message of a chat the page starts: what session-map knows, then the person's words.
const list = (items) => items.map((i) => `- ${i}`).join('\n');

export const CONTEXT_HEAD = 'Context from session-map (this is all you need from earlier work):';
const BOARD_HINT = 'When you finish a step, run /session-map:board.';
// Without the plugin there is no /session-map:board: the chat is told the card format itself.
const CARD_HINT = [
  'When you finish a step, end your reply with a short block like this, so session-map can show where the work stands:',
  '```session-map',
  '{"title": "what this conversation is about", "doing": "the step you are on", "todo": ["what is left"], "decided": ["what was settled"], "waiting": ["questions for the person"]}',
  '```',
  'Use only the fields that apply; keep each line short.',
].join('\n');

// What a new chat reads instead of the whole history (desenho-2 § 21, "Continuar aqui").
// board: the session-map plugin is installed and on, so its /session-map:board command exists.
// sections: what the point of the map the chat was opened on says (chat/context.mjs).
export function firstPrompt({ sections = [], mother, workCell, text, board = false }) {
  const parts = [...sections];
  if (workCell) parts.push(`Branch: ${workCell.branch}`);
  const card = mother?.card;
  if (card) {
    const lines = [`Previous conversation: ${card.title || mother.title}`];
    if (card.doing) lines.push(`Doing: ${card.doing}`);
    if (card.todo?.length) lines.push(`To do:\n${list(card.todo)}`);
    if (card.waiting?.length) lines.push(`Waiting:\n${list(card.waiting)}`);
    if (card.decided?.length) lines.push(`Decided:\n${list(card.decided)}`);
    parts.push(lines.join('\n'));
  }
  if (!parts.length) return text;
  const hint = board ? BOARD_HINT : CARD_HINT;
  return `${CONTEXT_HEAD}\n\n${parts.join('\n\n')}\n\n${hint}\n\n${text}`;
}

// A prompt as the person wrote it, without the context block firstPrompt put before it or the note of a changed way
// of working (run.mjs).
export function personsWords(prompt) {
  if (prompt.startsWith(RUN_NOTE_HEAD)) {
    const at = prompt.indexOf(`
${RUN_NOTE_END}

`);
    if (at >= 0) return personsWords(prompt.slice(at + RUN_NOTE_END.length + 3));
  }
  if (!prompt.startsWith(CONTEXT_HEAD)) return prompt;
  for (const hint of [BOARD_HINT, CARD_HINT]) {
    const at = prompt.indexOf(`\n\n${hint}\n\n`);
    if (at >= 0) return prompt.slice(at + hint.length + 4);
  }
  return prompt;
}
