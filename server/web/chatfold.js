// What the chat folds out of a reply: the leading status line some CLAUDE.md files ask for ("Skills: … · Agents: …"),
// the session-map card and the run block. The page shows them as small chips; the run block also drives the header.

export const RUN_LEVELS = ['direct', 'helpers', 'reinforced', 'ask-reinforce'];
const WHY_MAX = 160;
const RUN_FENCE = /```session-map-run[^\n]*\n([\s\S]*?)```/g;
// Closed blocks, then one still being written at the end of a streaming reply.
const BLOCKS = /```session-map(-run)?[^\n]*\n([\s\S]*?)(?:```|$)/g;
const STATUS_LINE = /^\s*(?:>\s*)?\**skills\**\s*:.*·/i;

// A reason past the limit ends at the last whole word, with an ellipsis: the header and the ask card show it as is.
function clipWhy(why) {
  if (why.length <= WHY_MAX) return why;
  const cut = why.slice(0, WHY_MAX - 1);
  const whole = /\s/.test(why[WHY_MAX - 1]) ? cut : cut.replace(/\S*$/, '');
  return `${whole.replace(/[\s,;:.]+$/, '') || cut}…`;
}

// The maestro's own word on the level it works at, from the last block of a reply (server and page read it alike).
export function readRunBlock(text) {
  const blocks = [...String(text ?? '').matchAll(RUN_FENCE)];
  if (!blocks.length) return null;
  let data;
  try { data = JSON.parse(blocks.at(-1)[1]); } catch { return null; }
  if (!data || !RUN_LEVELS.includes(data.level)) return null;
  const out = { level: data.level };
  if (typeof data.why === 'string' && data.why.trim()) out.why = clipWhy(data.why.trim());
  if (Number.isFinite(data.estimateUSD) && data.estimateUSD >= 0) out.estimateUSD = data.estimateUSD;
  return out;
}

const readCard = (body) => {
  try {
    const data = JSON.parse(body);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
};

// → {text (what the bubble shows), plan (the status line, unbolded) | null, card ({} when unreadable) | null, run | null}
export function foldReply(raw) {
  let text = String(raw ?? '');
  let plan = null;
  let card = null;
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && STATUS_LINE.test(lines[first])) {
    plan = lines[first].replace(/^\s*>\s*/, '').replace(/\*\*/g, '').trim();
    text = lines.slice(first + 1).join('\n');
  }
  text = text.replace(BLOCKS, (_, isRun, body) => {
    if (!isRun) card = readCard(body);
    return '';
  });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), plan, card, run: readRunBlock(raw) };
}
