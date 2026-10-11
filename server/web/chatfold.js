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

// ---- quick replies (pc18): the options a reply really offers at its very end, as buttons. Never invented: only a
// numbered or lettered list (1, 2, 3 or a, b, c in order) next to a question, or a last question "X ou Y?" whose two
// sides are short. Anything less sure gives no buttons; the person can always write.
const QUICK_MAX = 6;
const QUICK_WORDS = 8;
const OPTION_CHARS = 160;
const LIST_ITEM = /^\s{0,3}(?:[-*+]\s+)?\(?(\d{1,2}|[a-zA-Z])[.)]\s+(.+?)\s*$/;
const FENCE = /```[\s\S]*?(?:```|$)/g;
// What leads into the choice ("prefere que eu", "do you want me to"), cut off so the button holds only the option. Whole
// words, accents included (\b does not know "não" or "opção").
const LEAD_VERBS = 'prefere|preferem|prefira|quer|querem|deseja|desejam|devo|posso|melhor|prefer|prefers|want|wants|would you like|should i|shall i|do i';
const CHOICE_LEAD = new RegExp(`^.*?(?<!\\p{L})(?:${LEAD_VERBS})(?!\\p{L})\\s*(?:que\\s+)?(?:eu\\s+)?(?:(?:me|you)\\s+)?(?:to\\s+)?`, 'iu');
const SIDE_LEAD = /^(?:que\s+eu\s+|que\s+|se\s+|eu\s+|(?:me|you)\s+to\s+|to\s+|i\s+)/i;
const LEAD_VERB = new RegExp(`(?<!\\p{L})(?:${LEAD_VERBS})(?!\\p{L})`, 'iu');
// A question that names the choice ("qual prefere?", "which one?"), or a line that asks for one ("escolha uma opção:").
const NAMES_CHOICE = /(?<!\p{L})(?:qual|quais|which|escolh|choose|pick|prefer|prefir|op[cç][aãõ]|option|alternativ)/iu;
// A closing question that points back at the list: "qual deles…", "qual você prefere?", "which one?", "escolha um". A
// "qual" alone ("qual o próximo passo?") asks about something else, so a report above it stays a report.
const POINTS_AT_LIST = new RegExp([
  '(?<!\\p{L})(?:qual|quais|which)(?!\\p{L}).*?(?<!\\p{L})(?:del[ae]s?|dess[ae]s?|dest[ae]s?|daquel[ae]s?|one|ones|of (?:these|those|them)',
  '|prefer\\p{L}*|prefir\\p{L}*|op[cç][aãõ]\\p{L}*|options?|alternativ\\p{L}*|caminho|forma|jeito|way|path)(?!\\p{L})',
  '|(?<!\\p{L})(?:escolh\\p{L}*|choose|pick|prefer\\p{L}*|prefir\\p{L}*)\\s+(?:qual|quais|which|uma|um|one)(?!\\p{L})',
].join(''), 'iu');
// The line above the list asks the person to choose: "Escolha uma opção:", "Pick one:", but not "Escolhi…" (I chose).
const ASKS_TO_PICK = /(?<!\p{L})(?:escolha|escolham|escolher|selecione|choose|pick|select)(?!\p{L})/iu;
// "…se o arquivo existe ou se foi apagado?": the "ou" belongs to the "se" / "whether" clause, and the second half alone
// would send a claim the person never made ("Foi apagado").
const SUBORDINATE = /(?<!\p{L})(?:se|whether|if)(?!\p{L})/iu;
// "não", "never", "don't": a side would lose it and its button would ask for the opposite.
const NEGATION = /(?<!\p{L})(?:não|nao|nunca|jamais|nem|not|never)(?!\p{L})|n't(?!\p{L})/iu;
// Courtesy and yes/no questions offer no choice.
const NO_CHOICE = /(?<!\p{L})(?:sim|yes|mais alguma coisa|algo mais|alguma dúvida|alguma pergunta|anything else|something else|any questions)(?!\p{L})/iu;

const unmark = (s) => s.replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_](\S)/g, '$1$2').replace(/(\S)[*_](?=\s|$)/g, '$1').trim();
const capital = (s) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const endsAsking = (line) => /\?[*_\s]*$/.test(line);

function listOption(raw) {
  const bold = /^\*\*(.+?)\*\*/.exec(raw.trim());
  const text = unmark(raw).replace(/[.;,]+$/, '');
  const label = bold ? unmark(bold[1]).replace(/[.:;,]+$/, '') : text;
  return { label, text };
}

// The list at the end (blank lines may sit between items), with the line above it and the question under it, if any.
function trailingList(lines) {
  let end = lines.length;
  let ask = null;
  if (end && !LIST_ITEM.test(lines[end - 1]) && endsAsking(lines[end - 1])) {
    ask = lines[end - 1];
    end -= 1;
    while (end && !lines[end - 1].trim()) end -= 1;
  }
  const items = [];
  let at = end;
  while (at > 0) {
    const line = lines[at - 1];
    if (!line.trim() && items.length) { at -= 1; continue; }
    const m = LIST_ITEM.exec(line);
    if (!m) break;
    items.unshift({ key: m[1], raw: m[2] });
    at -= 1;
  }
  while (at > 0 && !lines[at - 1].trim()) at -= 1;
  return { items, lead: at > 0 ? lines[at - 1] : '', ask };
}

// Markers that count 1, 2, 3 or a, b, c from the start: anything else is a list that is not a set of choices.
function inOrder(keys) {
  const first = keys[0];
  const numbers = /^\d+$/.test(first);
  return keys.every((k, n) => (numbers ? Number(k) === n + 1 : k.toLowerCase() === String.fromCharCode(97 + n)));
}

function fromList(lines) {
  const { items, lead, ask } = trailingList(lines);
  if (items.length < 2 || items.length > QUICK_MAX || !inOrder(items.map((i) => i.key))) return [];
  // The line above the list asks; or the reply closes with a question and either the line above asks the person to pick
  // ("Escolha uma opção:"), or the question points at the list ("qual deles?"), or both name the choice ("Opções:" …
  // "Which would you like?"). A closing question about something else ("Quer que eu faça o commit?", "Qual o próximo
  // passo?") does not make a report a set of options.
  const colon = /:[*_\s]*$/.test(lead);
  const picks = ask && ((colon && ASKS_TO_PICK.test(lead)) || POINTS_AT_LIST.test(ask) || (colon && NAMES_CHOICE.test(lead) && NAMES_CHOICE.test(ask)));
  if (!endsAsking(lead) && !picks) return [];
  const options = items.map((i) => ({ key: i.key, ...listOption(i.raw) }));
  return options.every((o) => o.text && o.text.length <= OPTION_CHARS) ? options : [];
}

// "…, prefere que eu junte as setas ou que mostre cada uma?" → the two short sides of the last "ou" / "or". Only when a
// word that asks to choose leads the question and comes off cleanly, with no negation, courtesy or yes/no, and when
// neither side keeps a "prefere" / "want" of its own: both buttons then start the same way.
function fromAlternatives(lines) {
  const last = lines.at(-1) ?? '';
  if (!endsAsking(last)) return [];
  const sentence = unmark(last).replace(/\?+\s*$/, '').split(/(?<=[.!?:])\s+/).at(-1);
  if (NEGATION.test(sentence) || NO_CHOICE.test(sentence)) return [];
  const parts = sentence.split(/\s(?:ou|or)\s/i);
  if (parts.length !== 2) return [];
  const clause = parts[0].split(/,\s*/).at(-1);
  if (!CHOICE_LEAD.test(clause)) return [];
  const left = clause.replace(CHOICE_LEAD, '').replace(SIDE_LEAD, '').trim();
  const right = parts[1].replace(SIDE_LEAD, '').trim();
  const loose = (s) => words(s) > QUICK_WORDS || /[?:;]/.test(s) || LEAD_VERB.test(s);
  if (!left || !right || loose(left) || loose(right) || SUBORDINATE.test(left)) return [];
  return [left, right].map((s, n) => ({ key: String(n + 1), label: capital(s), text: capital(s) }));
}

// → [{key ("1", "a"), label (what the button says), text (what a click sends)}], or [] when the reply offers no choice.
export function quickReplies(raw) {
  const text = String(raw ?? '').replace(FENCE, '\n\u0000\n').trimEnd();
  if (!text) return [];
  const lines = text.split('\n').map((l) => l.trimEnd());
  const listed = fromList(lines);
  return listed.length ? listed : fromAlternatives(lines);
}
