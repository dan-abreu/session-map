// The bench's results turned into what the owner reads (or12): report.md in Brazilian Portuguese, plus pt-blind.md
// (the Portuguese texts shuffled under letters, to rate without knowing who wrote them) and pt-key.json (who is who).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeAtomic } from '../store.mjs';
import { KINDS } from './score.mjs';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

export function summarize(results) {
  const groups = new Map();
  for (const r of results) {
    const key = `${r.kind}\u0000${r.contestant}`;
    if (!groups.has(key)) groups.set(key, { kind: r.kind, contestant: r.contestant, list: [] });
    groups.get(key).list.push(r);
  }
  const contestantOrder = [...new Set(results.map((r) => r.contestant))];
  const kindRank = (k) => (KINDS.includes(k) ? KINDS.indexOf(k) : KINDS.length);
  const rows = [...groups.values()].map(({ kind, contestant, list }) => {
    const tried = list.filter((r) => !r.skipped);
    const correct = tried.filter((r) => r.score === 1).length;
    const costUSD = round6(tried.reduce((s, r) => s + (Number(r.costUSD) || 0), 0));
    return {
      kind,
      contestant,
      tried: tried.length,
      correct,
      accuracy: tried.length ? correct / tried.length : null,
      falseAlarms: tried.reduce((s, r) => s + (Number(r.falseAlarms) || 0), 0),
      costUSD,
      costPerCorrect: correct ? round6(costUSD / correct) : null,
      avgMs: tried.length ? Math.round(tried.reduce((s, r) => s + (Number(r.ms) || 0), 0) / tried.length) : null,
      failures: tried.filter((r) => !r.ok).length,
      skipped: list.length - tried.length,
    };
  });
  return rows.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.kind.localeCompare(b.kind)
    || contestantOrder.indexOf(a.contestant) - contestantOrder.indexOf(b.contestant));
}

const KIND_TITLES = {
  classify: ['Classificar conversas', 'Cada conversa sua foi posta numa parte do mapa; acerto é escolher a mesma parte que você escolheria.'],
  code: ['Escrever código', 'A IA escreve uma função a partir de uma descrição; acerto é passar em todos os testes, rodados num lugar fechado do computador.'],
  review: ['Revisão de código', 'A IA procura um erro plantado num trecho (alguns trechos não têm erro); acerto é apontar a linha certa, ou não apontar nada quando não há erro. Alarme falso é apontar erro onde não há.'],
  pt: ['Textos em português', 'A IA escreve uma mensagem simples para você; acerto automático é estar em português, no tamanho pedido e sem palavras técnicas. A sua nota, no arquivo pt-blind.md, vale mais.'],
};

const usd = (n) => {
  if (n === null || n === undefined) return '—';
  const digits = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2;
  return `US$ ${n.toFixed(digits).replace('.', ',')}`;
};
const pct = (n) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const secs = (ms) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

export function reportMarkdown({ runId, rows, notes = [], spentUSD = 0, maxUSD = null }) {
  const out = [
    '# Banco de medição das IAs',
    '',
    `Rodada \`${runId}\`. Gasto total: ${usd(spentUSD)}${maxUSD !== null ? ` (limite: ${usd(maxUSD)})` : ''}.`,
    '',
    'Cada IA fez as mesmas tarefas, na mesma ordem. "Custo por acerto" é o gasto dividido pelos acertos: é o número que mostra quem entrega mais pelo mesmo dinheiro.',
    '',
  ];
  if (notes.length) out.push('## O que ficou de fora', '', ...notes.map((n) => `- ${n}`), '');
  const kinds = [...new Set(rows.map((r) => r.kind))];
  for (const kind of kinds) {
    const [title, about] = KIND_TITLES[kind] ?? [kind, ''];
    const review = kind === 'review';
    const head = ['Participante', 'Tentativas', 'Acertos', 'Taxa de acerto', ...(review ? ['Alarmes falsos'] : []), 'Custo total', 'Custo por acerto', 'Tempo médio', 'Falhas', 'Puladas'];
    out.push(`## ${title}`, '', about, '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
    for (const r of rows.filter((x) => x.kind === kind)) {
      const cells = [r.contestant, r.tried, r.correct, pct(r.accuracy), ...(review ? [r.falseAlarms] : []), usd(r.costUSD), usd(r.costPerCorrect), secs(r.avgMs), r.failures, r.skipped];
      out.push(`| ${cells.join(' | ')} |`);
    }
    out.push('');
  }
  out.push('"Falhas" são respostas que não vieram ou vieram num formato que não deu para ler (contam como erro). "Puladas" são tarefas que não foram feitas, por limite de gasto ou por regra de privacidade.', '');
  return out.join('\n');
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const shuffleRank = (seed, itemId, contestant) => createHash('sha256').update(`${seed}\u0000${itemId}\u0000${contestant}`).digest('hex');

// Only answers that came back are rated. The order under the letters changes from item to item and from run to run,
// but is the same when the same run is written again.
export function ptBlind(results, items, { seed }) {
  const out = [
    '# Textos para você avaliar, sem saber quem escreveu',
    '',
    'Cada pedido abaixo foi respondido por várias IAs. Leia cada texto e dê uma nota de 1 (ruim) a 5 (ótimo): ficou claro? soa natural? é o que você gostaria de ler?',
    'Quem escreveu cada letra está guardado num arquivo à parte (pt-key.json): abra só depois de dar as notas.',
    '',
  ];
  const key = {};
  items.forEach((item, n) => {
    const answers = results
      .filter((r) => r.kind === 'pt' && r.itemId === item.id && r.ok && !r.skipped && typeof r.answer === 'string' && r.answer.trim())
      .sort((a, b) => shuffleRank(seed, item.id, a.contestant).localeCompare(shuffleRank(seed, item.id, b.contestant)));
    if (!answers.length) return;
    key[item.id] = {};
    out.push(`## Pedido ${n + 1} (${item.id})`, '', ...String(item.prompt ?? '').split('\n').map((l) => `> ${l}`), '');
    answers.slice(0, LETTERS.length).forEach((r, i) => {
      key[item.id][LETTERS[i]] = r.contestant;
      out.push(`### ${LETTERS[i]}`, '', r.answer.trim(), '', 'Nota (1 a 5): ___', '');
    });
  });
  return { markdown: out.join('\n'), key };
}

export function writeReports(runDir, { runId, results, ptItems = [], notes = [], spentUSD = 0, maxUSD = null }) {
  const rows = summarize(results);
  writeAtomic(join(runDir, 'report.md'), reportMarkdown({ runId, rows, notes, spentUSD, maxUSD }));
  if (results.some((r) => r.kind === 'pt')) {
    const { markdown, key } = ptBlind(results, ptItems, { seed: runId });
    writeAtomic(join(runDir, 'pt-blind.md'), markdown);
    writeAtomic(join(runDir, 'pt-key.json'), `${JSON.stringify(key, null, 2)}\n`);
  }
  return rows;
}
