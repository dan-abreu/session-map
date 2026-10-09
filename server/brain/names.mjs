const NAME_MAX = 40;

export const plain = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

// Folder names lose their accents; these are the common Portuguese words a project folder is named after.
const ACCENTED = {
  seguranca: 'segurança', servico: 'serviço', servicos: 'serviços', area: 'área', areas: 'áreas', pagina: 'página',
  paginas: 'páginas', usuario: 'usuário', usuarios: 'usuários', historico: 'histórico', relatorio: 'relatório',
  relatorios: 'relatórios', preco: 'preço', precos: 'preços', analise: 'análise', midia: 'mídia', logistica: 'logística',
  publico: 'público', catalogo: 'catálogo', metricas: 'métricas', financas: 'finanças', cobranca: 'cobrança',
  orcamento: 'orçamento', orcamentos: 'orçamentos', conteudo: 'conteúdo', conteudos: 'conteúdos', video: 'vídeo',
  videos: 'vídeos', midias: 'mídias', critica: 'crítica', tecnico: 'técnico', grafico: 'gráfico', graficos: 'gráficos',
};

function accented(word) {
  const lower = word.toLowerCase();
  if (ACCENTED[lower]) return ACCENTED[lower];
  // comunicacao → comunicação, configuracoes → configurações, sessao → sessão
  return lower.replace(/cao$/, 'ção').replace(/coes$/, 'ções').replace(/sao$/, 'são').replace(/soes$/, 'sões');
}

const capital = (s) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

// "comunicacao" → "Comunicação", "design-system" → "Design system", "@types" → "Types".
export function readableName(slug) {
  const words = String(slug).replace(/^[.@_-]+/, '').split(/[-_\s]+/).filter(Boolean).map(accented);
  return capital(words.join(' ')) || String(slug);
}

export const sameName = (a, b) => plain(a).replace(/\s+/g, ' ') === plain(b).replace(/\s+/g, ' ');

// What the AI names a unit, made fit for a label: "automação do automação do Chrome" → "automação do Chrome",
// at most 40 characters cut at a word, no trailing punctuation.
export function cleanUnitName(name) {
  let words = String(name ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  for (let changed = true; changed;) {
    changed = false;
    for (let n = Math.floor(words.length / 2); n >= 1 && !changed; n--) {
      for (let i = 0; i + 2 * n <= words.length; i++) {
        const a = words.slice(i, i + n).join(' ');
        const b = words.slice(i + n, i + 2 * n).join(' ');
        if (sameName(a, b)) {
          words = [...words.slice(0, i + n), ...words.slice(i + 2 * n)];
          changed = true;
          break;
        }
      }
    }
  }
  let out = words.join(' ');
  if (out.length > NAME_MAX) {
    const cut = out.slice(0, NAME_MAX + 1);
    out = cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : out.slice(0, NAME_MAX);
  }
  return out.replace(/[\s.,;:!?…·\-–—]+$/u, '');
}
