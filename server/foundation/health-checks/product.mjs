// Health checks, product, users and operation (fd08, 9 items). Each check is a pure function of the health context:
// files and text in, `{ state, evidence, reason, detail }` out. Nothing is written, no secrets file is opened (ctx.read
// refuses them), no network. An app that has no users owes none of these: the check answers `na` before looking.
import { docStats } from '../health-find.mjs';
import { HEALTH_ITEMS } from '../health-items.mjs';
import { appliesTo } from '../health-score.mjs';

const ITEM = new Map(HEALTH_ITEMS.map((i) => [i.id, i]));

const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const segmentsOf = (p) => p.split('/').slice(0, -1);
const extOf = (p) => { const b = baseOf(p); const i = b.lastIndexOf('.'); return i < 0 ? '' : b.slice(i + 1).toLowerCase(); };
// "privacy.blade.php" and "privacy.md" both have the stem "privacy".
const stemOf = (p) => baseOf(p).replace(/\.blade\.php$/i, '').replace(/\.[^.]+$/, '');
const depthOf = (p) => p.split('/').length;

// A folder of samples or tests is not the product itself.
const SAMPLE_SEGMENTS = new Set(['fixtures', '__fixtures__', 'testdata', 'test', 'tests', '__tests__', 'spec', 'example', 'examples', 'templates', 'template', 'node_modules', 'vendor']);
const TEST_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec']);
const isReal = (p) => !segmentsOf(p).some((s) => SAMPLE_SEGMENTS.has(s.toLowerCase()));

const DOC_EXT = new Set(['md', 'markdown', 'mdx', 'txt', 'rst']);
const PAGE_EXT = new Set(['html', 'htm', 'php', 'tsx', 'jsx', 'vue', 'svelte', 'astro', 'dart', 'ts', 'js']);
// Where a screen or a route of the product lives (a page called "privacy" counts only there).
const ROUTE_SEGMENTS = new Set(['pages', 'app', 'routes', 'views', 'resources', 'public', 'screens', 'www']);
const isRouteLike = (p) => segmentsOf(p).some((s) => ROUTE_SEGMENTS.has(s.toLowerCase())) || (extOf(p) === 'dart' && /(^|\/)lib\//.test(p));

const result = (state, { evidence = [], reason = null, detail = {} } = {}) => ({ state, evidence, reason, detail });
const missing = () => result('fail', { reason: 'missing' });

function guarded(id, check) {
  const item = ITEM.get(id);
  return (ctx) => {
    const a = appliesTo(item, ctx);
    if (!a.applies) return result(a.state, { reason: a.reason });
    return check(ctx);
  };
}

const includedPaths = (ctx) => ctx.files.filter((r) => r.included).map((r) => r.path);

// ---------- documents by topic: privacy and terms ----------

function topicRe(words) {
  return new RegExp(`^(?:${words.join('|')})(?:[-_. ]?(?:policy|policies|notice|statement|screen|page|view))?$`, 'i');
}

// A page or document whose own name says the topic. A page counts only inside the product's routes or screens; a folder
// called after the topic counts for the page files inside it (app/privacy/page.tsx).
function topicFiles(ctx, re) {
  const out = [];
  for (const p of includedPaths(ctx)) {
    if (!isReal(p)) continue;
    const ext = extOf(p);
    const doc = DOC_EXT.has(ext) || ext === 'html' || ext === 'htm';
    const page = PAGE_EXT.has(ext) && isRouteLike(p);
    if (!doc && !page) continue;
    const byName = re.test(stemOf(p));
    const byFolder = page && segmentsOf(p).some((s) => re.test(s));
    if (byName || byFolder) out.push(p);
  }
  return out.sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : 1));
}

// Judges one document by its size and by what a template leaves behind. A page or route has no lines to count: it exists.
function judgeDoc(ctx, path, minLines) {
  if (!DOC_EXT.has(extOf(path))) return result('pass', { evidence: [{ file: path }] });
  const text = ctx.read(path);
  if (text === null) return result('unverified', { evidence: [{ file: path }], reason: 'too-big' });
  const stats = docStats(text);
  if (stats.markers.length) {
    return result('fail', { evidence: stats.markers.slice(0, 5).map((m) => ({ file: path, line: m.line })), reason: 'placeholder', detail: { count: stats.markers.length } });
  }
  if (stats.lines < minLines) return result('fail', { evidence: [{ file: path }], reason: 'too-short', detail: { count: stats.lines } });
  return result('pass', { evidence: [{ file: path }] });
}

function topicCheck(re, minLines) {
  return (ctx) => {
    const files = topicFiles(ctx, re);
    if (!files.length) return missing();
    const judged = files.map((p) => judgeDoc(ctx, p, minLines));
    return judged.find((r) => r.state === 'pass') ?? judged[0];
  };
}

const PRIVACY_RE = topicRe(['privacy', 'privacidade', 'lgpd', 'gdpr', 'politica[-_ ]de[-_ ]privacidade', 'pol\\u00edtica[-_ ]de[-_ ]privacidade']);
const TERMS_RE = topicRe(['terms', 'termos', 'tos', 'terms[-_ ]of[-_ ](?:service|use)', 'terms[-_ ]and[-_ ]conditions', 'termos[-_ ]de[-_ ]uso', 'termos[-_ ]e[-_ ]condicoes']);

// ---------- reading helpers ----------

// First line of `lines` matching `re`, as 1-based number.
const lineOf = (text, re) => {
  const rows = text.split(/\r?\n/);
  const i = rows.findIndex((row) => re.test(row));
  return i < 0 ? null : i + 1;
};

const fileUnder = (ctx, prefix, exts, limit) => includedPaths(ctx)
  .filter((p) => p.startsWith(prefix) && exts.has(extOf(p)) && isReal(p))
  .sort().slice(0, limit);

// ---------- accessibility ----------

const A11Y_RE = /\b(?:wcag|axe|aria|a11y|jest-axe|pa11y)\b|aria-[a-z]+/i;
const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'dart', 'php', 'py', 'md']);
const SCAN_MAX = 60;

function accessibility(ctx) {
  const doc = ctx.find(['accessibility', 'acessibilidade']);
  let short = null;
  if (doc) {
    const stats = docStats(ctx.read(doc) ?? '');
    if (stats.lines >= 3) return result('pass', { evidence: [{ file: doc }] });
    short = doc;
  }
  const readme = ctx.find(['readme']);
  const docs = fileUnder(ctx, 'docs/', DOC_EXT, SCAN_MAX);
  const tests = includedPaths(ctx)
    .filter((p) => segmentsOf(p).some((s) => TEST_SEGMENTS.has(s.toLowerCase())) && CODE_EXT.has(extOf(p)) && !segmentsOf(p).some((s) => ['fixtures', '__fixtures__', 'node_modules', 'vendor'].includes(s)))
    .sort().slice(0, SCAN_MAX);
  for (const file of [readme, ...docs, ...tests]) {
    if (!file) continue;
    const text = ctx.read(file);
    if (text === null) continue;
    const line = lineOf(text, A11Y_RE);
    if (line) return result('pass', { evidence: [{ file, line }] });
  }
  return short ? result('fail', { evidence: [{ file: short }], reason: 'too-short' }) : missing();
}

// ---------- i18n ----------

const STRONG_I18N_DIRS = new Set(['locales', 'locale', 'i18n', 'l10n', 'translations', 'lang']);
// i18n-fd/ and i18n.js name the same thing as i18n/.
const I18N_DIR_PREFIX = /^(?:i18n|l10n|locales?)[-_.]/;
const I18N_STEM = /^(?:i18n|l10n)$/;
const DATA_EXT = new Set(['json', 'yaml', 'yml', 'po', 'php', 'xlf', 'xliff', 'arb', 'properties']);
const I18N_DEPS = new Set(['i18next', 'next-intl', 'vue-i18n', 'react-intl', 'svelte-i18n', 'flutter_localizations', 'easy_localization', 'intl_utils']);
const I18N_DEP_PREFIXES = ['@formatjs/', '@lingui/', '@ngx-translate/', 'laravel-lang/', 'i18next-'];

function i18n(ctx) {
  for (const p of includedPaths(ctx)) {
    if (!isReal(p)) continue;
    const dirs = segmentsOf(p).map((s) => s.toLowerCase());
    const hit = extOf(p) === 'arb'
      || dirs.some((s) => STRONG_I18N_DIRS.has(s) || I18N_DIR_PREFIX.test(s))
      || I18N_STEM.test(stemOf(p))
      || (dirs.includes('messages') && DATA_EXT.has(extOf(p)));
    if (hit) return result('pass', { evidence: [{ file: p }] });
  }
  const dep = dependenciesOf(ctx).find((d) => I18N_DEPS.has(d.name) || I18N_DEP_PREFIXES.some((x) => d.name.startsWith(x)));
  if (dep) return result('pass', { evidence: [{ file: dep.file, line: dep.line }], detail: { name: dep.name } });
  return missing();
}

// ---------- observability ----------

// The names a manifest lists as dependencies, with the line, for every package of the project (Node, Composer, Dart).
function namesFromJson(text, keys) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return []; }
  const names = new Set();
  for (const key of keys) {
    const group = data?.[key];
    if (group && typeof group === 'object' && !Array.isArray(group)) for (const n of Object.keys(group)) names.add(n);
  }
  return [...names].map((name) => ({ name, line: lineOf(text, new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"\\s*:`)) }));
}

function namesFromPubspec(text) {
  const out = [];
  let inside = false;
  let indent = null;
  text.split(/\r?\n/).forEach((row, i) => {
    if (/^\S/.test(row)) { inside = /^(?:dev_)?dependencies\s*:/.test(row); indent = null; return; }
    const m = inside ? /^( +)([A-Za-z0-9_]+)\s*:/.exec(row) : null;
    if (!m) return;
    indent ??= m[1].length;
    if (m[1].length === indent) out.push({ name: m[2], line: i + 1 });
  });
  return out;
}

function dependenciesOf(ctx) {
  const out = [];
  for (const pkg of ctx.packages) {
    const text = ctx.read(pkg.manifest);
    if (typeof text !== 'string') continue;
    const names = pkg.kind === 'node' ? namesFromJson(text, ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
      : pkg.kind === 'php' ? namesFromJson(text, ['require', 'require-dev'])
        : namesFromPubspec(text);
    for (const n of names) out.push({ ...n, file: pkg.manifest });
  }
  return out;
}

const OBS_DEPS = new Set([
  'pino', 'winston', 'bunyan', 'log4js', 'loglevel', 'prom-client', 'newrelic', 'dd-trace', 'elastic-apm-node', 'rollbar', 'raven',
  'monolog/monolog', 'laravel/telescope', 'laravel/pulse', 'laravel/nightwatch',
  'sentry_flutter', 'sentry', 'firebase_crashlytics', 'firebase_performance', 'datadog_flutter_plugin', 'bugsnag_flutter', 'logger', 'logging',
]);
const OBS_PREFIXES = ['pino-', 'winston-', '@sentry/', '@opentelemetry/', 'open-telemetry/', 'sentry/', '@datadog/', '@bugsnag/', 'bugsnag/'];

function observability(ctx) {
  const list = dependenciesOf(ctx).filter((d) => OBS_DEPS.has(d.name) || OBS_PREFIXES.some((x) => d.name.startsWith(x)));
  if (!list.length) return missing();
  const first = list[0];
  return result('pass', { evidence: [{ file: first.file, ...(first.line ? { line: first.line } : {}) }], detail: { name: first.name, count: list.length } });
}

// ---------- operation documents: incident, backup ----------

function opDocCheck(re, minLines) {
  return (ctx) => {
    const files = includedPaths(ctx).filter((p) => isReal(p) && DOC_EXT.has(extOf(p)) && re.test(stemOf(p)))
      .sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : 1));
    if (!files.length) return null;
    const judged = files.map((p) => judgeDoc(ctx, p, minLines));
    return judged.find((r) => r.state === 'pass') ?? judged[0];
  };
}

const INCIDENT_STEM = /^(?:incidents?|incidentes?|resposta[-_ ]a[-_ ]incidentes?|plano[-_ ]de[-_ ]incidentes?)(?![a-z])/i;
const BACKUP_STEM = /backup|restor|restaur|disaster|recupera|dr[-_ ]plan/i;
const BACKUP_HEADING = /^ {0,3}#{1,6}\s+.*(?:backup|restor|restaur|disaster recovery|recupera)/i;

const incidentResponse = (ctx) => opDocCheck(INCIDENT_STEM, 3)(ctx) ?? missing();

// A heading about backup or restore with at least two lines under it, in the README, the operations notes or docs/.
function backupSection(ctx) {
  const named = ctx.find(['operations', 'operacao', 'operacoes', 'runbook', 'readme']);
  const files = [...new Set([named, ...fileUnder(ctx, 'docs/', DOC_EXT, SCAN_MAX), ...fileUnder(ctx, 'runbooks/', DOC_EXT, SCAN_MAX)].filter(Boolean))];
  for (const file of files) {
    const rows = (ctx.read(file) ?? '').split(/\r?\n/);
    let fenced = false;
    for (let i = 0; i < rows.length; i++) {
      if (/^\s*(```|~~~)/.test(rows[i])) { fenced = !fenced; continue; }
      if (fenced || !BACKUP_HEADING.test(rows[i])) continue;
      let body = 0;
      for (let j = i + 1; j < rows.length && !/^ {0,3}#{1,6}\s/.test(rows[j]); j++) if (rows[j].trim()) body++;
      if (body >= 2) return result('pass', { evidence: [{ file, line: i + 1 }] });
    }
  }
  return null;
}

function backup(ctx) {
  const doc = opDocCheck(BACKUP_STEM, 3)(ctx);
  if (doc?.state === 'pass') return doc;
  return backupSection(ctx) ?? doc ?? missing();
}

// ---------- status page, support channel ----------

const STATUS_URL = /https?:\/\/(?:status\.[\w-]+|[\w.-]*(?:statuspage\.io|instatus\.com|betteruptime\.com|betterstack\.com|uptimerobot\.com|hyperping\.io|openstatus\.dev)\b)/i;
const STATUS_LINK = /\[[^\]]*\bstatus\b[^\]]*\]\(\s*https?:\/\//i;

function statusPage(ctx) {
  const file = ctx.find(['status', 'status-page', 'statuspage']);
  if (file) return result('pass', { evidence: [{ file }] });
  const readme = ctx.find(['readme']);
  const text = readme ? ctx.read(readme) : null;
  if (text === null || text === undefined) return missing();
  const line = lineOf(text, STATUS_URL) ?? lineOf(text, STATUS_LINK);
  return line ? result('pass', { evidence: [{ file: readme, line }] }) : missing();
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const URL_RE = /https?:\/\/[^\s)>\]]+/i;
const hasChannel = (row) => (EMAIL.test(row) || URL_RE.test(row)) && docStats(row).markers.length === 0;
const CONTACT_HEADING = /^ {0,3}#{1,6}\s*(?:support|suporte|contact|contato|help|ajuda|get help|need help|fale conosco)\b/i;

function supportChannel(ctx) {
  const doc = ctx.find(['support', 'suporte']);
  if (doc) {
    const text = ctx.read(doc) ?? '';
    const stats = docStats(text);
    if (stats.markers.length) {
      return result('fail', { evidence: stats.markers.slice(0, 5).map((m) => ({ file: doc, line: m.line })), reason: 'placeholder', detail: { count: stats.markers.length } });
    }
    if (stats.lines < 3) return result('fail', { evidence: [{ file: doc }], reason: 'too-short', detail: { count: stats.lines } });
    const line = text.split(/\r?\n/).findIndex(hasChannel);
    if (line < 0) return result('fail', { evidence: [{ file: doc }], reason: 'no-contact' });
    return result('pass', { evidence: [{ file: doc, line: line + 1 }] });
  }
  const readme = ctx.find(['readme']);
  const rows = (readme ? ctx.read(readme) ?? '' : '').split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    if (!CONTACT_HEADING.test(rows[i])) continue;
    for (let j = i + 1; j < rows.length && j <= i + 15 && !/^ {0,3}#{1,6}\s/.test(rows[j]); j++) {
      if (hasChannel(rows[j])) return result('pass', { evidence: [{ file: readme, line: j + 1 }] });
    }
  }
  return missing();
}

export const PRODUCT_CHECKS = Object.freeze({
  'product.privacy': guarded('product.privacy', topicCheck(PRIVACY_RE, 10)),
  'product.terms': guarded('product.terms', topicCheck(TERMS_RE, 10)),
  'product.accessibility': guarded('product.accessibility', accessibility),
  'product.i18n': guarded('product.i18n', i18n),
  'product.observability': guarded('product.observability', observability),
  'product.incident_response': guarded('product.incident_response', incidentResponse),
  'product.backup': guarded('product.backup', backup),
  'product.status_page': guarded('product.status_page', statusPage),
  'product.support_channel': guarded('product.support_channel', supportChannel),
});

// Same table under the name most of the sibling modules use, for health-checks/index.mjs.
export const CHECKS = PRODUCT_CHECKS;
