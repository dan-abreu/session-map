// Health checks (fd08) for repository management: three read the GitHub API facts, four read the project documents.
// Pure functions of the context. All of them only matter on a public repository (applies "P" in the catalog).
import { guarded, unverifiedFor } from './security-api.mjs';

const result = (state, extra = {}) => ({ state, evidence: [], reason: null, detail: {}, ...extra });
const missing = (detail = {}, evidence = []) => result('fail', { reason: 'missing', detail, evidence });

const GOVERNANCE_DOCS = ['support', 'contributing', 'governance'];
const SECURITY_DOCS = ['security', 'support'];

// Documents that exist among `names`, with their text. Unreadable ones (secrets, too big) are skipped.
function docsOf(ctx, names) {
  const out = [];
  for (const name of names) {
    const file = ctx.find([name]);
    const text = file ? ctx.read(file) : null;
    if (text != null) out.push({ file, text });
  }
  return out;
}

function lineOf(text, re) {
  const i = text.split('\n').findIndex((l) => re.test(l));
  return i < 0 ? undefined : i + 1;
}

function docMention(ctx, names, re) {
  const evidence = [];
  for (const { file, text } of docsOf(ctx, names)) {
    const line = lineOf(text, re);
    if (line) evidence.push({ file, line });
  }
  return evidence.length ? result('pass', { evidence }) : missing();
}

const countApi = (id, field) => guarded(id, (ctx) => {
  const n = ctx.api?.[field];
  if (typeof n !== 'number') return unverifiedFor(ctx);
  return n >= 1 ? result('pass', { detail: { count: n } }) : missing({ count: n });
});

const TRIAGE = /\b(triag\w*|prazo|deadline)\b/i;
const RESPONSE = /\b(?:\d+|one|two|three|four|five|seven|um|dois|tr[eê]s|cinco|sete)\s*(?:business\s+|working\s+|úteis\s+)?(?:days?|dias?|hours?|horas?)\b/i;
const OWNER = /(?:^|\s)@[\w-]+(?:\/[\w-]+)?|[\w.+-]+@[\w-]+\.[\w.-]+/g;
const STALE = /\bstale\b|sem atividade|inativ\w+/i;

function ownersIn(text) {
  const owners = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    for (const m of line.matchAll(OWNER)) owners.add(m[0].trim());
  }
  return owners;
}

export const CHECKS = {
  'management.labels': guarded('management.labels', (ctx) => {
    const labels = ctx.api?.labels;
    if (!Array.isArray(labels)) return unverifiedFor(ctx);
    const have = new Set(labels.map((l) => String(l).toLowerCase()));
    const gone = ['bug', 'good first issue'].filter((n) => !have.has(n));
    return gone.length ? missing({ missing: gone }) : result('pass');
  }),

  'management.milestones': countApi('management.milestones', 'milestones'),
  'management.projects': countApi('management.projects', 'projects'),

  'management.triage': guarded('management.triage', (ctx) => docMention(ctx, GOVERNANCE_DOCS, TRIAGE)),
  'management.response_time': guarded('management.response_time', (ctx) => docMention(ctx, SECURITY_DOCS, RESPONSE)),

  // MAINTAINERS or CODEOWNERS with at least one real owner; the number of people is kept in `detail.count`.
  'management.maintainers': guarded('management.maintainers', (ctx) => {
    const owners = new Set();
    const evidence = [];
    for (const { file, text } of [...docsOf(ctx, ['maintainers']), ...docsOf(ctx, ['codeowners'])]) {
      const found = ownersIn(text);
      if (!found.size) continue;
      found.forEach((o) => owners.add(o));
      evidence.push({ file });
    }
    return owners.size ? result('pass', { evidence, detail: { count: owners.size } }) : missing({ count: 0 });
  }),

  'management.stale_policy': guarded('management.stale_policy', (ctx) => {
    const evidence = [];
    for (const f of ctx.list('.github/')) {
      const low = f.toLowerCase();
      if (low === '.github/stale.yml') evidence.push({ file: f });
      else if (low.startsWith('.github/workflows/') && /\.ya?ml$/.test(low)) {
        const text = ctx.read(f);
        const line = text == null ? undefined : lineOf(text, /\bactions\/stale\b/);
        if (line) evidence.push({ file: f, line });
      }
    }
    if (evidence.length) return result('pass', { evidence });
    return docMention(ctx, GOVERNANCE_DOCS, STALE);
  }),
};
