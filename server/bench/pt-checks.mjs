// Automatic checks for the "pt" kind of the measuring bench: is the answer Brazilian Portuguese, the right size,
// and free of the jargon the page itself never shows the owner (same word list as test/web-plain.test.mjs).

export const JARGON = /\b(commits?|merg(e|es|ed|ing)|branch(es)?|tokens?|README|API|repo|repos|repositor(y|ies)|repositórios?|CLI|JSON|push(ed|es)?|rebase|workflows?|agents?|agentes?|subagents?|diff|MCP|hooks?|mermaid|markdown|git|ramos?|config|serv(er|idor)|process(o|es)?|marketplaces?)\b|\?k=/i;

const PT = new Set('de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele'.split(' '));
const EN = new Set('the of and to in is that it for as with was on are by this be at or from have an not but they which you were we has had can will your their there been would about so if what when who all more one into than them its our also do does did should'.split(' '));

const wordsOf = (t) => String(t || '').toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) || [];

export function countWords(text) { return wordsOf(text).length; }

// Share of words that are common Portuguese / English function words.
export function languageShare(text) {
  const w = wordsOf(text);
  if (!w.length) return { pt: 0, en: 0, words: 0 };
  let pt = 0, en = 0;
  for (const x of w) { if (PT.has(x)) pt++; if (EN.has(x)) en++; }
  return { pt: pt / w.length, en: en / w.length, words: w.length };
}

export function isPortuguese(text) {
  const { pt, en, words } = languageShare(text);
  return words >= 10 && pt >= 0.2 && pt > en * 2;
}

export function jargonIn(text) {
  const out = new Set();
  const re = new RegExp(JARGON.source, 'gi');
  for (const m of String(text || '').matchAll(re)) out.add(m[0].toLowerCase());
  return [...out];
}

// The prompts ask for 60-180 words; the bounds leave a little room either side.
export const PT_BOUNDS = { min: 50, max: 200 };

export function checkPt(text, bounds = PT_BOUNDS) {
  const words = countWords(text);
  const language = isPortuguese(text);
  const lengthOk = words >= bounds.min && words <= bounds.max;
  const jargon = jargonIn(text);
  const checks = { language, lengthOk, noJargon: jargon.length === 0 };
  const passed = Object.values(checks).filter(Boolean).length;
  return { ok: language && lengthOk && jargon.length === 0, score: passed / 3, words, jargon, ...checks };
}
