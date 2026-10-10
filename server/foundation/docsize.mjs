// Pure size rules for documents (fd13). Reading files from disk lives in docwatch.mjs.
export const DEFAULT_LIMITS = {
  agent: { warn: 150, strong: 200 },
  memory: { warn: 150, strong: 200, kb: 25 },
  skill: { warn: 400, strong: 500 },
  'arch-part': { warn: 300, strong: 500 },
  readme: { warn: 200, strong: 400 },
  plan: { warn: 300, strong: 500 },
  registry: { warn: 400, strong: 800 },
  changelog: { warn: 400, strong: 800 },
};

const APPEND_ONLY = new Set(['registry', 'changelog']);

export function docTypeOf(path) {
  const p = String(path || '').replaceAll('\\', '/');
  const name = p.split('/').pop();
  const lower = name.toLowerCase();
  if (!lower.endsWith('.md')) return null;
  if (name === 'CLAUDE.md' || name === 'AGENTS.md') return 'agent';
  if (name === 'MEMORY.md') return 'memory';
  if (name === 'SKILL.md') return 'skill';
  if (/^changelog/i.test(name)) return 'changelog';
  if (/^readme/i.test(name)) return 'readme';
  if (/(^|\/)docs\/(arch|arquitetura)[^/]*\//i.test(p)) return 'arch-part';
  if (/^(glossario|glossary|rotas|routes)\b/i.test(lower)) return 'registry';
  if (/(^|\/)docs\/decisions\//i.test(p)) return 'registry';
  if (/(^|\/)\.dev\//.test(p) && /^(plano|plan|brief)/i.test(lower)) return 'plan';
  return null;
}

export function measureDoc(text) {
  const src = String(text || '');
  const all = src === '' ? [] : src.split(/\r?\n/);
  let ignored = 0;
  let skipping = false;
  let kept = 0;
  let keptBytes = 0;
  for (const line of all) {
    const fence = /^\s*(```|~~~)\s*(\w*)/.exec(line);
    if (skipping) {
      ignored++;
      if (fence && !fence[2]) skipping = false;
      continue;
    }
    if (fence && /^(generated|mermaid)$/i.test(fence[2])) {
      skipping = true;
      ignored++;
      continue;
    }
    kept++;
    keptBytes += Buffer.byteLength(line, 'utf8') + 1;
  }
  return { lines: kept, kb: Math.round((keptBytes / 1024) * 100) / 100, ignored };
}

export function sizeState(type, m, limits = {}) {
  const base = DEFAULT_LIMITS[type];
  if (!base) return 'ok';
  const l = { ...base, ...(limits && limits[type]) };
  if (m.lines > l.strong || (l.kb && m.kb >= l.kb)) return 'strong';
  if (m.lines > l.warn) return 'warning';
  return 'ok';
}

export function needsSummary(type, text) {
  if (type !== 'arch-part') return false;
  const m = measureDoc(text);
  if (m.lines <= 100) return false;
  return !/^#{1,6}\s*(sum[aá]rio|summary)\b/im.test(String(text));
}

export function docAction(type, state) {
  if (state === 'ok') return 'none';
  return APPEND_ONLY.has(type) ? 'archive' : 'split';
}
