// Interpreter (AI agent): authored this file; pending human review

// The skills index (or22/id100): which of the installed skills matter to the point a chat is opened on, as a short
// block for the chat's first request. Exact, no AI: it scores each enabled skill by how many of its name and
// description words overlap the person's request and the point's name, then keeps only the top few within a byte cap.
// It never says "use them all": it hands the few that fit, the way practicesFocus hands practices.

const FOLD_RE = /[\u0300-\u036f]/g;
const WORD_RE = /[a-z0-9]+/g;

const WORDS = {
  en: { head: 'Skills that fit this point (use one only when it fits the request; never all of them):' },
  'pt-BR': { head: 'Skills que servem a este ponto (use uma s\u00f3 quando couber no pedido; nunca todas):' },
};

// The transcript reader counts tokens of this shape as item codes and places the chat by them: none may go in.
const hasCode = (text) => /(?<![\w-])[a-z]{1,4}(?:-[a-z]{1,4})?\d{1,4}(?![\w-])/i.test(text);

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(FOLD_RE, '');
const bytes = (text) => Buffer.byteLength(text, 'utf8');
// Words every skill description repeats ("Use when the user...") would match any request: they never count.
const STOP = new Set(('use used uses using when whenever the this that these those for and with from into your you user users any all are was were will can not but its also only '
  + 'que para com uma umas uns por pelo pela quando usar como mais isso essa esse este esta nos das dos ele ela sem sobre').split(' '));
const words = (s) => new Set((fold(s).match(WORD_RE) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)));
const langOf = (lang) => (String(lang ?? '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en');

function byteSafe(text, max) {
  if (bytes(text) <= max) return text;
  const chars = Array.from(text);
  while (chars.length && bytes(chars.join('') + '\u2026') > max) chars.pop();
  return chars.length ? chars.join('').trimEnd() + '\u2026' : '';
}

// input: { skills: [{name, description, command, enabled}], part: {name, about}, text: the person's request,
//   lang, limit = 3, maxBytes = 400 } -> text, or '' when nothing fits.
export function skillsFocus({ skills = [], part = null, text = '', lang = 'en', limit = 3, maxBytes = 400 } = {}) {
  const on = (Array.isArray(skills) ? skills : []).filter((k) => k && k.enabled !== false && typeof k.command === 'string' && k.name);
  if (!on.length) return '';
  const want = words([part?.name ?? '', part?.about ?? '', text].join(' '));
  if (!want.size) return '';
  const scored = on.map((k) => {
    const own = words(k.name);
    const sw = words(k.name + ' ' + (k.description ?? ''));
    let hits = 0;
    let strong = false;
    for (const w of want) if (sw.has(w)) { hits++; if (own.has(w) || w.length >= 6) strong = true; }
    return { k, hits, strong };
  }).filter((x) => x.hits >= 2 || x.strong); // one short common word is chance, not fit
  scored.sort((a, b) => (b.hits - a.hits) || (a.k.name < b.k.name ? -1 : a.k.name > b.k.name ? 1 : 0));
  const tongue = langOf(lang);
  const head = WORDS[tongue].head;
  const cap = Math.max(0, Math.min(Number.isInteger(limit) ? limit : 3, 6));
  const lines = [];
  let used = bytes(head);
  for (const { k } of scored) {
    if (lines.length >= cap) break;
    const line = '- ' + k.command + (k.description ? ': ' + k.description : '');
    if (hasCode(line)) continue;
    const room = maxBytes - used - 1;
    if (bytes(line) > room) {
      const cut = byteSafe(line, room);
      if (cut && !hasCode(cut)) { lines.push(cut); used += 1 + bytes(cut); }
      continue;
    }
    lines.push(line);
    used += 1 + bytes(line);
  }
  return lines.length ? [head, ...lines].join('\n') : '';
}
