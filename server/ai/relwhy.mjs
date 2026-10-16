import { createHash } from 'node:crypto';

// The plain-words reason for a relation, written by a motor (sb16), not by an AI: the reasons the map already holds
// are structured facts — a chat or a branch that worked on both parts, a chat continued from one in the other, a
// document of one that points to the other — so the sentence is rendered by one template per reason kind, in the
// map's language. No call, no hourly budget. A reason kind without a template is simply left out of the sentence,
// exactly as a failed AI call left the relation without one before.
const ABOUT_MAX = 200;
const REASONS_MAX = 8;
const FILES_MAX = 4;
const WHY_MAX = 300;
const TITLE_MAX = 90;
const CLAUSES_MAX = 2;

const reasonFacts = (r) => ({
  kind: r.kind,
  text: r.text,
  ...(r.files?.length ? { files: r.files.slice(0, FILES_MAX) } : {}),
  ...(r.commit ? { commit: r.commit } : {}),
  ...(r.spec ? { plan: r.spec.change } : {}),
  ...(r.file ? { file: r.file } : {}),
});

// The reasons the sentence is written from: in one canonical order (not the order they came in), the first REASONS_MAX of them.
const shownReasons = (link) => link.reasons.map(reasonFacts).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))).slice(0, REASONS_MAX);

// The two parts as the sentence names them.
const sideOf = (arch, id) => {
  const p = arch.parts.find((x) => x.id === id);
  return { name: p?.name ?? id, about: (p?.about ?? '').slice(0, ABOUT_MAX) };
};

// What the sentence was written from: the two parts, the reasons the sentence reads and the language. Whatever the
// sentence does not read (tasks ticked, session ids, a fifth file) is not in it, so such a change keeps the sentence.
export function reasonsHash(link, arch) {
  const facts = { lang: arch.lang ?? 'en', a: link.a, b: link.b, first: sideOf(arch, link.a), second: sideOf(arch, link.b), reasons: shownReasons(link) };
  return createHash('sha1').update(JSON.stringify(facts)).digest('hex');
}

// A title or branch name as the sentence quotes it: one line, cut with an ellipsis when it is long.
const quoteOf = (text) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t) : null;
};

// One short plain sentence per reason kind, in the map's language, or null when the kind has no template.
function clauseFor(r, names, pt) {
  switch (r.kind) {
    case 'file-ref':
      return pt ? `O documento de ${names.first} aponta para ${names.second}.` : `The document of ${names.first} points to ${names.second}.`;
    case 'shared-chat': {
      const title = quoteOf(r.text);
      return title ? (pt ? `A conversa "${title}" trabalhou nas duas.` : `The conversation "${title}" worked on both.`) : null;
    }
    case 'lineage':
      return pt ? `Uma conversa continuou de ${names.first} em ${names.second}.` : `A conversation continued from ${names.first} into ${names.second}.`;
    case 'shared-branch': {
      const branch = quoteOf(r.text);
      return branch ? (pt ? `A linha de trabalho "${branch}" trabalhou nas duas.` : `The line of work "${branch}" worked on both.`) : null;
    }
    case 'shared-spec': {
      const plan = quoteOf(r.text);
      return plan ? (pt ? `O plano "${plan}" trabalhou nas duas.` : `The plan "${plan}" worked on both.`) : null;
    }
    default:
      return null;
  }
}

// -> the sentence the motor writes for this relation, or null when no reason kind is covered.
export function relationWhyByRules(link, arch) {
  const pt = arch?.lang === 'pt';
  const nameOf = (id) => arch?.parts?.find((x) => x.id === id)?.name ?? id;
  const names = { first: nameOf(link?.a), second: nameOf(link?.b) };
  const clauses = [];
  for (const r of shownReasons(link ?? { reasons: [] })) {
    const clause = clauseFor(r, names, pt);
    if (clause) clauses.push(clause);
    if (clauses.length >= CLAUSES_MAX) break;
  }
  return clauses.length ? clauses.join(' ').slice(0, WHY_MAX) : null;
}
