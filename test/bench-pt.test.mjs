import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkPt, isPortuguese, jargonIn, countWords, JARGON } from '../server/bench/pt-checks.mjs';

const set = JSON.parse(fs.readFileSync(new URL('../server/bench/sets/pt.json', import.meta.url), 'utf8'));

const GOOD = 'Terminei a caixa de busca da lista de conversas. Agora, quando você digita uma palavra, aparecem só as conversas que falam dela. Testei com as suas 214 conversas e a resposta vem em menos de um segundo. Nada foi apagado nem perdido durante o trabalho. Para experimentar, abra a lista, clique na caixa que está no alto e escreva, por exemplo, o nome de um cliente. Se aparecer algo estranho, me avise que eu corrijo ainda hoje. Também conferi que a busca não mexe em nenhuma conversa: ela só mostra o que já existe, do jeito que estava antes.';

test('the pt set has 20 well-formed prompts with unique ids', () => {
  assert.equal(set.kind, 'pt');
  assert.equal(set.items.length, 20);
  assert.equal(new Set(set.items.map((i) => i.id)).size, 20);
  for (const i of set.items) {
    assert.match(i.prompt, /Brazilian Portuguese/);
    assert.match(i.prompt, /60 and 180 words/);
    assert.ok(i.prompt.length > 150);
  }
});

test('the jargon list is the one test/web-plain.test.mjs enforces', () => {
  const src = fs.readFileSync(new URL('./web-plain.test.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes(JARGON.source));
});

test('a good Portuguese text passes every check', () => {
  const r = checkPt(GOOD);
  assert.ok(countWords(GOOD) >= 60 && countWords(GOOD) <= 180);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.score, 1);
});

test('English text fails the language check', () => {
  const en = 'I finished the search box for the list of conversations. Now when you type a word, only the conversations that mention it are shown. I tested it with your 214 conversations and the answer comes in less than a second. Nothing was deleted or lost during the work. To try it, open the list and click on the box at the top.';
  assert.equal(isPortuguese(en), false);
  assert.equal(checkPt(en).language, false);
});

test('too short and too long texts fail the length check', () => {
  assert.equal(checkPt('Está tudo certo, não precisa fazer nada por enquanto, obrigado.').lengthOk, false);
  assert.equal(checkPt((GOOD + ' ').repeat(3)).lengthOk, false);
});

test('jargon is caught, plain words are not', () => {
  assert.deepEqual(jargonIn('Fiz um commit e um merge no branch.').sort(), ['branch', 'commit', 'merge']);
  assert.deepEqual(jargonIn(GOOD), []);
  const r = checkPt(GOOD + ' Fiz o push do código no repositório.');
  assert.equal(r.ok, false);
  assert.ok(r.jargon.includes('push'));
});

test('empty or missing answers fail without throwing', () => {
  assert.equal(checkPt('').ok, false);
  assert.equal(checkPt(undefined).ok, false);
});
