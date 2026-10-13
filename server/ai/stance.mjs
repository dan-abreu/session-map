// One rule for every AI session-map talks to (or27, id107): Claude's chats in every way they run, and the outside AIs
// when they judge (review, reasoning). A yes-man and a contrarian are both wrong: the stance comes from the facts.
export const STANCE = 'Agree or disagree on evidence, never to please: which, the facts (numbers, file:line) and what would change your mind; without facts, say so and measure.';

const JUDGING = new Set(['review', 'reasoning']);

// A draft, a summary or a label goes as written: the rule there would be noise the owner pays for.
export const withStance = (kind, prompt) => (JUDGING.has(kind) ? `${STANCE}\n\n${prompt}` : prompt);
