import { foldReply } from '../web/chatfold.js';

const QUESTION_WINDOW = 300;

// strong: an open AskUserQuestion, or the Automatic maestro's ask to reinforce (its run block), which waits for an OK.
// weak: the reply, without the blocks the page folds away, ends with a question.
export function waitingFor(summary, live, card) {
  const stopped = !live || live.status === 'idle';
  const reply = foldReply(summary.lastAssistantText);
  const strong = stopped && (summary.pendingQuestion === true || reply.run?.level === 'ask-reinforce');
  const weak = stopped && !strong && endsWithQuestion(reply.text);
  return { strong, weak, items: card?.waiting ?? [] };
}

function endsWithQuestion(text) {
  return /\?[\s*_`~]*$/.test((text ?? '').slice(-QUESTION_WINDOW));
}
