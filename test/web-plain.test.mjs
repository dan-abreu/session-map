// Plain words everywhere: no jargon in what the page says by default, with the original technical terms one switch
// away ("technical details"), in English and Portuguese.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, TECH, translator } from '../server/web/i18n.js';

// The words a person who never coded does not know. Each has a plain stand-in in the glossary of DESIGN.md.
const JARGON = /\b(commits?|merg(e|es|ed|ing)|branch(es)?|tokens?|README|API|repo|repos|repositor(y|ies)|repositórios?|CLI|JSON|push(ed|es)?|rebase|workflows?|agents?|agentes?|subagents?|diff|MCP|hooks?|mermaid|markdown|git|ramos?|config|serv(er|idor)|process(o|es)?)\b|\?k=/i;
// Texts that are technical by nature: the terminal's command-line help lists its flags.
const TECHNICAL_BY_NATURE = new Set(['cli.help']);

test('what the page says by default has no jargon, in both languages', () => {
  const hits = [];
  for (const [lang, dict] of Object.entries(LANGS)) {
    for (const [key, text] of Object.entries(dict)) {
      if (TECHNICAL_BY_NATURE.has(key)) continue;
      const m = text.replace(/\{\w+\}/g, '').match(JARGON);
      if (m) hits.push(`${lang} ${key}: “${m[0]}”`);
    }
  }
  assert.deepEqual(hits, []);
});

test('every technical original belongs to a plain text, in both languages, with the same blanks', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(TECH['pt-BR']).sort(), Object.keys(TECH.en).sort());
  assert.ok(Object.keys(TECH.en).length >= 40, 'the technical originals are kept');
  for (const [lang, dict] of Object.entries(TECH)) {
    for (const [key, text] of Object.entries(dict)) {
      assert.ok(key in LANGS[lang], `${lang} ${key} has no plain text`);
      assert.ok(text.trim(), `${lang} ${key} is empty`);
      assert.deepEqual(vars(text), vars(LANGS[lang][key]), `${lang} ${key} blanks differ`);
      assert.notEqual(text, LANGS[lang][key], `${lang} ${key} says the same thing in both modes`);
    }
  }
});

test('the translator speaks plainly by default and shows the technical terms when asked', () => {
  const plain = translator('en');
  const tech = translator('en', { tech: true });
  assert.equal(plain('chat.branch'), LANGS.en['chat.branch']);
  assert.equal(tech('chat.branch'), TECH.en['chat.branch']);
  assert.match(tech('chat.branch'), /branch/i);
  assert.doesNotMatch(plain('chat.branch'), /branch/i);
  // Keys with no technical original read the same in both modes.
  assert.equal(tech('tab.map'), plain('tab.map'));
  assert.equal(translator('pt-BR', { tech: true }).count('wc.commitsCount', 2), '2 commits');
  assert.equal(translator('pt-BR').count('wc.commitsCount', 2), '2 mudanças salvas');
});
