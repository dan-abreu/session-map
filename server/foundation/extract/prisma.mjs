// Prisma schema reader: models become tables, fields that point to another model become relations.
export const VERSION = 'prisma@1';
export const TYPES = ['prisma'];

const MODEL_RE = /^\s*model\s+(\w+)\s*\{/;
const FIELD_RE = /^\s*(\w+)\s+(\w+)(\[\]|\?)?/;
const REL_NAME_RE = /@relation\(\s*(?:name:\s*)?"([^"]*)"/;
const MAP_RE = /@@map\(\s*"([^"]*)"/;

function parseModels(text, masked) {
  const tl = text.split('\n');
  const ml = masked.split('\n');
  const models = [];
  for (let i = 0; i < ml.length; i++) {
    const m = MODEL_RE.exec(ml[i]);
    if (!m) continue;
    const model = { name: m[1], line: i + 1, fields: [], dbName: null };
    for (i++; i < ml.length && !/^\s*\}/.test(ml[i]); i++) {
      if (/^\s*@@/.test(ml[i])) {
        const mm = MAP_RE.exec(tl[i]);
        if (mm) model.dbName = mm[1];
        continue;
      }
      const f = FIELD_RE.exec(ml[i]);
      if (!f) continue;
      const rn = REL_NAME_RE.exec(tl[i]);
      model.fields.push({ name: f[1], type: f[2], mod: f[3] || '', line: i + 1, relName: rn ? rn[1] : null });
    }
    models.push(model);
  }
  return models;
}

function cardinality(model, field, target) {
  const mine = field.mod === '[]';
  const back = target.fields.find((o) => o.type === model.name && o.relName === field.relName && !(o === field));
  const theirs = back ? back.mod === '[]' : false;
  if (mine && theirs) return 'n-n';
  if (mine || theirs) return '1-n';
  return '1-1';
}

export function extract({ path, text, masked }) {
  const models = parseModels(text, masked || text);
  const byName = new Map(models.map((m) => [m.name, m]));
  const facts = [];
  const base = { file: path, origin: 'EXTRACTED', extractor: VERSION, refs: [] };
  for (const m of models) {
    const columns = m.fields.filter((f) => !byName.has(f.type)).map((f) => ({ name: f.name, type: f.type + f.mod, line: f.line }));
    const attrs = { source: 'prisma', columns };
    if (m.dbName) attrs.dbName = m.dbName;
    facts.push({ ...base, id: `table:${m.name}`, kind: 'table', name: m.name, line: m.line, attrs });
    for (const f of m.fields) {
      const target = byName.get(f.type);
      if (!target) continue;
      facts.push({
        ...base, id: `relation:${m.name}.${f.name}->${target.name}`, kind: 'relation', name: `${m.name}.${f.name}`, line: f.line,
        attrs: { from: m.name, to: target.name, field: f.name, cardinality: cardinality(m, f, target) },
      });
    }
  }
  return { facts, hints: [] };
}
