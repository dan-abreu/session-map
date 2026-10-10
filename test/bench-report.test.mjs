// The bench's report (or12): a summary per kind and contestant, the owner's report in Portuguese, and the blind
// file of Portuguese texts with its answer key kept apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ptBlind, reportMarkdown, summarize } from '../server/bench/report.mjs';

const R = (contestant, kind, itemId, extra) => ({ contestant, kind, itemId, ok: true, score: 1, costUSD: 0.01, ms: 1000, error: null, ...extra });

test('summary: accuracy, cost per right answer, average time and failures per kind and contestant', () => {
  const rows = summarize([
    R('claude:haiku', 'classify', 'a'),
    R('claude:haiku', 'classify', 'b', { score: 0, ms: 3000 }),
    R('claude:haiku', 'classify', 'c', { ok: false, score: 0, error: 'timeout', costUSD: 0, ms: 2000 }),
    R('claude:haiku', 'classify', 'd', { skipped: 'budget', ok: false, score: 0, costUSD: 0, ms: 0 }),
    R('openai:gpt-6-luna', 'review', 'r1', { falseAlarms: 2, costUSD: 0.002 }),
    R('openai:gpt-6-luna', 'review', 'r2', { score: 0, falseAlarms: 1, costUSD: 0.002 }),
  ]);
  const haiku = rows.find((r) => r.contestant === 'claude:haiku');
  assert.equal(haiku.kind, 'classify');
  assert.equal(haiku.tried, 3);
  assert.equal(haiku.correct, 1);
  assert.equal(haiku.accuracy, 1 / 3);
  assert.equal(haiku.failures, 1);
  assert.equal(haiku.skipped, 1);
  assert.equal(haiku.costUSD, 0.02);
  assert.equal(haiku.costPerCorrect, 0.02);
  assert.equal(haiku.avgMs, 2000);
  const luna = rows.find((r) => r.contestant === 'openai:gpt-6-luna');
  assert.equal(luna.falseAlarms, 3);
  assert.equal(luna.costPerCorrect, 0.004);
});

test('summary: no right answer means no cost per right answer, not a division by zero', () => {
  const [row] = summarize([R('claude:opus', 'code', 'k', { score: 0 })]);
  assert.equal(row.costPerCorrect, null);
});

test('summary rows follow the order of kinds, then the order contestants first appeared', () => {
  const rows = summarize([R('b:x', 'pt', '1'), R('a:y', 'code', '1'), R('b:x', 'code', '1')]);
  assert.deepEqual(rows.map((r) => `${r.kind} ${r.contestant}`), ['code b:x', 'code a:y', 'pt b:x']);
});

test('the report is in Portuguese, has a table per kind and says what was left out', () => {
  const rows = summarize([R('claude:haiku', 'review', 'r1', { falseAlarms: 1 }), R('claude:haiku', 'code', 'k1', { score: 0 })]);
  const md = reportMarkdown({ runId: 'run-1', rows, notes: ['Parou no limite de US$ 8,00: 3 respostas ficaram de fora.'], spentUSD: 0.02, maxUSD: 8 });
  assert.match(md, /^# Banco de medição/m);
  assert.match(md, /Revisão de código/);
  assert.match(md, /Escrever código/);
  assert.match(md, /Alarmes falsos/);
  assert.match(md, /claude:haiku/);
  assert.match(md, /Parou no limite/);
  assert.match(md, /US\$ 0,02/);
  // Only the review table has a false-alarm column.
  const codeTable = md.split('## ').find((s) => s.startsWith('Escrever código'));
  assert.doesNotMatch(codeTable, /Alarmes falsos/);
});

test('the blind file hides who wrote each text; the key says who, and the shuffle is the same for the same run', () => {
  const items = [{ id: 'p1', prompt: 'Explain the search box.' }];
  const results = [
    R('claude:haiku', 'pt', 'p1', { answer: 'Texto do Haiku.' }),
    R('claude:opus', 'pt', 'p1', { answer: 'Texto do Opus.' }),
    R('openai:gpt-6-luna', 'pt', 'p1', { answer: 'Texto do Luna.' }),
    R('openai:gpt-6.1-sol', 'pt', 'p1', { ok: false, answer: '', error: 'timeout' }),
  ];
  const a = ptBlind(results, items, { seed: 'run-1' });
  assert.ok(!/claude|openai|haiku|opus|luna/i.test(a.markdown.replace(/Texto do \w+/g, '')), 'the blind file names a contestant');
  assert.match(a.markdown, /Explain the search box/);
  assert.deepEqual(Object.keys(a.key.p1).sort(), ['A', 'B', 'C']);
  assert.deepEqual(Object.values(a.key.p1).sort(), ['claude:haiku', 'claude:opus', 'openai:gpt-6-luna']);
  for (const [letter, who] of Object.entries(a.key.p1)) {
    const name = who.split(':')[1].replace('gpt-6-', '');
    assert.match(a.markdown, new RegExp(`### ${letter}\\n\\nTexto do ${name}`, 'i'));
  }
  assert.deepEqual(ptBlind(results, items, { seed: 'run-1' }), a);
});

test('the blind file shuffles differently across items, so a letter does not always mean the same AI', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, prompt: `q${i}` }));
  const results = items.flatMap((it) => ['c:a', 'c:b', 'c:c'].map((c) => R(c, 'pt', it.id, { answer: `t ${c}` })));
  const { key } = ptBlind(results, items, { seed: 's' });
  const firstLetters = new Set(Object.values(key).map((k) => k.A));
  assert.ok(firstLetters.size > 1);
});
