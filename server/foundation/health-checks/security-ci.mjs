// Health (fd08), security of the pipeline and of the dependencies: 7 `security.*` items. One pure function per item over a
// health context; the answer is { state, evidence, reason, detail, packages? }. Workflows are read line by line, with no
// YAML library: what matters is a handful of keys, and anything we cannot tell is left out of the verdict, not guessed.
// Whether the item applies (library, users...) is decided by the caller with `appliesTo`; here the only "not applicable"
// is a repository with no code and nothing to look at.

const EVIDENCE_MAX = 20;
const WORKFLOW_DIR = '.github/workflows/';

const result = (state, evidence = [], reason = null, detail = {}, extra = {}) => ({
  state, evidence: evidence.slice(0, EVIDENCE_MAX), reason, detail, ...extra,
});
const missing = (ctx) => (ctx.hasCode ? result('fail', [], 'missing') : result('na', [], 'no-code'));

// ---------- reading a workflow by lines ----------

const indentOf = (s) => s.length - s.trimStart().length;
const BLOCK_START = /^[|>][+-]?\d*\s*(#.*)?$/;
const RUN_KEY = /^(\s*(?:-\s+)?)(run|script)\s*:\s*(.*)$/;

// Each line gets { n, indent, text, comment, run }. `run` is true when the line is shell (or script) code, either the
// value of `run:` on the same line or a line of its block; `text` is then the code, otherwise the whole line.
export function linesOf(source) {
  const rows = [];
  let blockKey = null;
  String(source).replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const row = { n: i + 1, indent: indentOf(raw), text: raw, comment: false, run: false, blank: !raw.trim() };
    rows.push(row);
    if (row.blank) {
      if (blockKey !== null) row.run = true;
      return;
    }
    if (blockKey !== null) {
      if (row.indent > blockKey) {
        row.run = true;
        row.comment = false;
        return;
      }
      blockKey = null;
    }
    if (raw.trimStart().startsWith('#')) {
      row.comment = true;
      return;
    }
    const m = RUN_KEY.exec(raw);
    if (!m) return;
    const value = m[3].trim();
    if (BLOCK_START.test(value)) blockKey = m[1].length;
    else if (value) {
      row.run = true;
      row.text = value;
    }
  });
  return rows;
}

const live = (rows) => rows.filter((r) => !r.blank && !r.comment);
const unquote = (v) => {
  const s = v.trim();
  const q = /^(["'])(.*?)\1/.exec(s);
  if (q) return q[2];
  return s.replace(/\s+#.*$/, '').trim();
};

// ---------- the workflows of a project ----------

function workflowsOf(ctx) {
  return ctx.list(WORKFLOW_DIR)
    .filter((p) => /\.ya?ml$/i.test(p) && !p.slice(WORKFLOW_DIR.length).includes('/'))
    .map((path) => ({ path, text: ctx.read(path) }));
}

// Runs `analyze(rows)` -> [{line}] on every readable workflow. Findings win; a workflow too big to read, with no finding
// elsewhere, makes the answer not verified (a pass would be a guess).
function overWorkflows(ctx, analyze, failReason) {
  const wfs = workflowsOf(ctx);
  if (!wfs.length) return missing(ctx);
  const found = [];
  const unreadable = [];
  for (const w of wfs) {
    if (typeof w.text !== 'string') {
      unreadable.push({ file: w.path });
      continue;
    }
    for (const f of analyze(linesOf(w.text))) found.push({ file: w.path, line: f.line });
  }
  if (found.length) return result('fail', found, failReason, { count: found.length });
  if (unreadable.length) return result('unverified', unreadable, 'too-big', { count: unreadable.length });
  return result('pass', wfs.map((w) => ({ file: w.path })), null, { count: wfs.length });
}

// ---------- security.workflows_safe ----------

const PR_TARGET_ON = /^\s*(?:-\s*)?pull_request_target\s*:?\s*(?:#.*)?$/;
const PR_TARGET_INLINE = /^\s*on\s*:.*\bpull_request_target\b/;
const CHECKOUT = /^\s*(?:-\s+)?uses\s*:\s*["']?actions\/checkout\b/;
const REF_KEY = /^\s*(?:-\s+)?(?:ref|repository)\s*:\s*(.*)$/;
const PR_HEAD = /github\.event\.pull_request\.(?:head|merge_commit_sha)|github\.head_ref|refs\/pull\//;
const PR_CHECKOUT_CMD = /\bgh\s+pr\s+checkout\b/;
// The tail of a github.event path that holds a number or a fixed word, not text someone typed.
const SAFE_EVENT_TAIL = new Set(['number', 'id', 'action', 'sha', 'after', 'before', 'run_id', 'run_number']);

// A step starts at its "- " line and lasts until a line at the same indent or less.
function stepAround(rows, at) {
  let start = at;
  for (let j = at; j >= 0; j--) {
    if (!rows[j].blank && !rows[j].comment && /^\s*-\s/.test(rows[j].text) && rows[j].indent <= rows[at].indent) {
      start = j;
      break;
    }
  }
  let end = rows.length;
  for (let k = at + 1; k < rows.length; k++) {
    if (!rows[k].blank && !rows[k].comment && rows[k].indent <= rows[start].indent) {
      end = k;
      break;
    }
  }
  return rows.slice(start, end);
}

function unsafeWorkflowLines(rows) {
  const found = new Map();
  const mark = (n) => found.set(n, { line: n });
  const body = live(rows);
  const target = body.some((r) => !r.run && (PR_TARGET_ON.test(r.text) || PR_TARGET_INLINE.test(r.text)));
  if (target) {
    rows.forEach((r, i) => {
      if (r.comment || r.blank) return;
      if (!r.run && CHECKOUT.test(r.text)) {
        for (const s of stepAround(rows, i)) {
          const k = !s.comment && !s.run ? REF_KEY.exec(s.text) : null;
          if (k && PR_HEAD.test(k[1])) mark(s.n);
        }
      }
      if (r.run && PR_CHECKOUT_CMD.test(r.text)) mark(r.n);
    });
  }
  for (const r of body) {
    if (!r.run) continue;
    for (const e of r.text.matchAll(/\$\{\{([^}]*)\}\}/g)) {
      for (const p of e[1].matchAll(/github\.(?:event\.([\w.]+)|head_ref)/g)) {
        const tail = p[1] ? p[1].split('.').pop() : null;
        if (!tail || !SAFE_EVENT_TAIL.has(tail)) mark(r.n);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line);
}

const workflowsSafe = (ctx) => overWorkflows(ctx, unsafeWorkflowLines, 'unsafe');

// ---------- security.token_permissions ----------

const PERMISSIONS = /^permissions\s*:/;

// Lines of the jobs that have no permissions: of their own (only needed when the workflow has none at the top).
function jobsWithoutPermissions(rows) {
  const body = live(rows);
  if (body.some((r) => r.indent === 0 && PERMISSIONS.test(r.text))) return [];
  const jobsAt = body.findIndex((r) => r.indent === 0 && /^jobs\s*:/.test(r.text));
  if (jobsAt < 0) return [{ line: 1 }];
  const section = [];
  for (const r of body.slice(jobsAt + 1)) {
    if (r.indent === 0) break;
    section.push(r);
  }
  if (!section.length) return [{ line: body[jobsAt].n }];
  const jobIndent = section[0].indent;
  const out = [];
  let current = null;
  const close = () => {
    if (!current) return;
    const child = current.lines[0]?.indent;
    const has = child !== undefined && current.lines.some((r) => r.indent === child && PERMISSIONS.test(r.text.trim()));
    if (!has) out.push({ line: current.line });
  };
  for (const r of section) {
    if (r.indent === jobIndent) {
      close();
      current = { line: r.n, lines: [] };
    } else current?.lines.push(r);
  }
  close();
  return out;
}

const tokenPermissions = (ctx) => overWorkflows(ctx, jobsWithoutPermissions, 'missing');

// ---------- security.actions_pinned ----------

const USES = /^\s*(?:-\s+)?uses\s*:\s*(.+)$/;
const PINNED = /@[0-9a-f]{40}$/i;

function unpinnedUses(rows) {
  const out = [];
  for (const r of live(rows)) {
    if (r.run) continue;
    const m = USES.exec(r.text);
    if (!m) continue;
    const value = unquote(m[1]);
    if (!value || value.startsWith('./') || value.startsWith('docker://')) continue;
    if (!PINNED.test(value)) out.push({ line: r.n });
  }
  return out;
}

const actionsPinned = (ctx) => overWorkflows(ctx, unpinnedUses, 'unsafe');

// ---------- security.update_bot ----------

const ECOSYSTEM = { node: 'npm', php: 'composer', dart: 'pub' };
const RENOVATE = ['renovate.json', 'renovate.json5', '.renovaterc', '.renovaterc.json'];

const cleanDir = (d) => {
  const s = `/${unquote(d).replace(/^\/+|\/+$/g, '')}`;
  return s === '/' ? '/' : s;
};
const globRe = (pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replaceAll('\0', '.*')}$`);

// [{ eco, dirs: ['/', '/apps/*'] }] from the "updates:" list of a dependabot file.
export function dependabotEntries(text) {
  const rows = live(linesOf(text));
  const at = rows.findIndex((r) => r.indent === 0 && /^updates\s*:/.test(r.text));
  if (at < 0) return [];
  const items = [];
  let itemIndent = null;
  for (const r of rows.slice(at + 1)) {
    if (r.indent === 0) break;
    if (itemIndent === null && /^\s*-\s/.test(r.text)) itemIndent = r.indent;
    if (itemIndent !== null && r.indent === itemIndent && /^\s*-\s/.test(r.text)) items.push([]);
    if (items.length) items[items.length - 1].push(r);
  }
  return items.map((lines) => {
    const entry = { eco: null, dirs: [] };
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i].text.replace(/^(\s*)-\s+/, (_, sp) => `${sp}  `);
      let m = /^\s*package-ecosystem\s*:\s*(.+)$/.exec(row);
      if (m) entry.eco = unquote(m[1]);
      m = /^\s*directory\s*:\s*(.+)$/.exec(row);
      if (m) entry.dirs.push(cleanDir(m[1]));
      m = /^\s*directories\s*:\s*(.*)$/.exec(row);
      if (m) {
        const inline = /^\[(.*)\]/.exec(m[1].trim());
        if (inline) inline[1].split(',').filter((s) => s.trim()).forEach((s) => entry.dirs.push(cleanDir(s)));
        const keyIndent = indentOf(row);
        for (let j = i + 1; j < lines.length && lines[j].indent > keyIndent; j++) {
          const item = /^\s*-\s+(.+)$/.exec(lines[j].text);
          if (item) entry.dirs.push(cleanDir(item[1]));
        }
      }
    }
    if (!entry.dirs.length) entry.dirs.push('/');
    return entry;
  }).filter((e) => e.eco);
}

function updateBot(ctx) {
  const renovate = ctx.find(RENOVATE, { dirs: ['', '.github'], exts: [''] });
  if (renovate) return result('pass', [{ file: renovate }]);
  const file = ctx.find(['dependabot.yml', 'dependabot.yaml'], { dirs: ['.github'], exts: [''] });
  if (!file) return missing(ctx);
  const text = ctx.read(file);
  if (typeof text !== 'string') return result('unverified', [{ file }], 'too-big');
  const entries = dependabotEntries(text);
  const packages = ctx.packages.filter((p) => ECOSYSTEM[p.kind]).map((p) => {
    const dir = cleanDir(p.dir);
    const covered = entries.some((e) => e.eco === ECOSYSTEM[p.kind] && e.dirs.some((d) => globRe(d).test(dir)));
    return { dir: p.dir, state: covered ? 'pass' : 'fail' };
  });
  const failing = packages.filter((p) => p.state === 'fail');
  if (failing.length) return result('fail', [{ file }], 'missing', { count: failing.length, dirs: failing.map((p) => p.dir || '.') }, { packages });
  return result('pass', [{ file }], null, { count: packages.length }, { packages });
}

// ---------- security.sast ----------

const SAST_RE = /codeql|semgrep/i;
const SAST_FILES = [/^\.semgrep(\.ya?ml)?(\/|$)/, /^\.github\/codeql\//];

function sast(ctx) {
  const wfs = workflowsOf(ctx);
  let unreadable = 0;
  for (const w of wfs) {
    if (typeof w.text !== 'string') {
      unreadable++;
      continue;
    }
    if (live(linesOf(w.text)).some((r) => SAST_RE.test(r.text))) return result('pass', [{ file: w.path }]);
  }
  const conf = ctx.list('').find((p) => SAST_FILES.some((re) => re.test(p)));
  if (conf) return result('pass', [{ file: conf }]);
  if (unreadable) return result('unverified', [], 'too-big', { count: unreadable });
  return wfs.length ? result('fail', [], 'missing') : missing(ctx);
}

// ---------- security.sbom ----------

const SBOM_FILE = [/\.spdx(\.json)?$/i, /^bom\.(json|xml)$/i, /^sbom[.\-_]/i, /sbom.*\.(json|xml|spdx)$/i, /\.cdx\.(json|xml)$/i];
const SBOM_STEP = /\b(sbom|cyclonedx|cdxgen|syft)\b/i;
const SBOM_ASSET = /sbom|spdx|cyclonedx|\.cdx\.|(^|[^a-z])bom\.json$/i;

// The reason an API answer is missing: no network, no token (or no access), or simply nothing came back.
const apiGap = (api) => (api?.error === 'no-network' ? 'no-network' : api?.mode !== 'token' ? 'no-token' : 'no-data');

function sbom(ctx) {
  const file = ctx.list('').find((p) => SBOM_FILE.some((re) => re.test(p.slice(p.lastIndexOf('/') + 1))));
  if (file) return result('pass', [{ file }]);
  for (const w of workflowsOf(ctx)) {
    if (typeof w.text === 'string' && live(linesOf(w.text)).some((r) => SBOM_STEP.test(r.text))) return result('pass', [{ file: w.path }]);
  }
  const releases = ctx.api?.releases;
  if (!Array.isArray(releases)) return result('unverified', [], apiGap(ctx.api));
  const asset = releases.find((r) => Array.isArray(r?.assets) && r.assets.some((a) => SBOM_ASSET.test(String(a))));
  if (asset) return result('pass', [], null, { tag: asset.tag });
  return result('fail', [], 'missing');
}

// ---------- security.fuzzing ----------

const FUZZ_DEPS = ['fast-check', 'jsfuzz', '@jazzer.js/core', 'jazzer', 'atheris'];
const FUZZ_PATH = [/(^|\/)fuzz(ing)?\//i, /\.fuzz\.[a-z]+$/i, /(^|\/)fuzz_test\.go$/];
const PY_DEPS = /^(requirements[\w.-]*\.txt|pyproject\.toml|setup\.py|setup\.cfg|Pipfile)$/;

function fuzzing(ctx) {
  const dir = ctx.list('').find((p) => FUZZ_PATH.some((re) => re.test(p)));
  if (dir) return result('pass', [{ file: dir }]);
  for (const pkg of ctx.packages) {
    const text = ctx.read(pkg.manifest);
    if (typeof text !== 'string') continue;
    let names;
    if (pkg.kind === 'node') {
      let data = null;
      try { data = JSON.parse(text); } catch { data = null; }
      names = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
        .flatMap((k) => (data?.[k] && typeof data[k] === 'object' ? Object.keys(data[k]) : []));
    } else names = FUZZ_DEPS.filter((d) => new RegExp(`"${d.replace(/[.]/g, '\\.')}"`).test(text));
    const hit = FUZZ_DEPS.find((d) => names.includes(d));
    if (hit) return result('pass', [{ file: pkg.manifest }], null, { name: hit });
  }
  for (const p of ctx.list('').filter((q) => PY_DEPS.test(q.slice(q.lastIndexOf('/') + 1)))) {
    const text = ctx.read(p) ?? '';
    if (text.split(/\r?\n/).some((l) => /^\s*["']?atheris\b/i.test(l))) return result('pass', [{ file: p }], null, { name: 'atheris' });
  }
  return result('fail', [], 'missing');
}

export const SECURITY_CI_IDS = Object.freeze([
  'security.workflows_safe', 'security.token_permissions', 'security.actions_pinned', 'security.update_bot',
  'security.sast', 'security.sbom', 'security.fuzzing',
]);

export const SECURITY_CI_CHECKS = Object.freeze({
  'security.workflows_safe': workflowsSafe,
  'security.token_permissions': tokenPermissions,
  'security.actions_pinned': actionsPinned,
  'security.update_bot': updateBot,
  'security.sast': sast,
  'security.sbom': sbom,
  'security.fuzzing': fuzzing,
});
