const QUESTION_WINDOW = 300;

export function waitingFor(summary, live, card) {
  const stopped = !live || live.status === 'idle';
  const strong = stopped && summary.pendingQuestion === true;
  const weak = stopped && !strong && endsWithQuestion(summary.lastAssistantText);
  return { strong, weak, items: card?.waiting ?? [] };
}

function endsWithQuestion(text) {
  return /\?[\s*_`~]*$/.test((text ?? '').slice(-QUESTION_WINDOW));
}
