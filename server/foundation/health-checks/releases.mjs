// Health checks (fd08) for the releases category: versions, tags, changelog, release notes, commit style, automation.
// Pure functions of the context; the only network-fed one (releases on the host) reads `ctx.api` and is `unverified`
// when the facts are missing.
import { docStats } from '../health-find.mjs';
import { classifyCommit, compareSemver, parseSemver, relationOf } from '../versions-core.mjs';
import { guarded, unverifiedFor } from './security-api.mjs';

const result = (state, extra = {}) => ({ state, evidence: [], reason: null, detail: {}, ...extra });
const pass = (detail = {}, evidence = []) => result('pass', { detail, evidence });
const fail = (reason, detail = {}, evidence = []) => result('fail', { reason, detail, evidence });
const unverified = (reason, evidence = []) => result('unverified', { reason, evidence });

const COMMIT_WINDOW = 50;
const COMMIT_SHARE = 0.7;
const CHANGELOG_MIN_LINES = 10;

// ---------- versions declared at the root ----------

// VERSION > package.json > pubspec.yaml > composer.json (the order of the versions contract). A manifest with no version
// (a private app) is simply not a candidate. `unreadable` = a file that exists but cannot be read (too big, secret).
function rootVersions(ctx) {
  const found = [];
  let unreadable = null;
  const take = (file, pick) => {
    if (!file) return;
    const text = ctx.read(file);
    if (text == null) { unreadable ??= file; return; }
    const version = pick(text);
    if (version != null) found.push({ file, version });
  };
  take(ctx.find(['version'], { dirs: [''], exts: ['', '.txt'] }), (t) => t.replace(/^﻿/, '').trim().split(/\r?\n/)[0].trim() || null);
  const json = (t) => { try { const v = JSON.parse(t.replace(/^﻿/, '')).version; return typeof v === 'string' ? v : null; } catch { return null; } };
  if (ctx.has('package.json')) take('package.json', json);
  if (ctx.has('pubspec.yaml')) take('pubspec.yaml', (t) => /^version:\s*['"]?([^\s'"#]+)/m.exec(t)?.[1] ?? null);
  if (ctx.has('composer.json')) take('composer.json', json);
  return { found, unreadable };
}

const semver = (ctx) => {
  const { found, unreadable } = rootVersions(ctx);
  if (unreadable) return unverified('too-big', [{ file: unreadable }]);
  const evidence = found.map((f) => ({ file: f.file }));
  if (!found.length) return fail('missing');
  const bad = found.filter((f) => !parseSemver(f.version));
  if (bad.length) return fail('invalid', { versions: found.map((f) => f.version) }, bad.map((f) => ({ file: f.file })));
  if (found.some((f) => compareSemver(f.version, found[0].version) !== 0)) {
    return fail('invalid', { versions: found.map((f) => f.version) }, evidence);
  }
  return pass({ version: found[0].version }, evidence);
};

// ---------- tags ----------

function highestTag(tags) {
  let best = null;
  for (const tag of tags) {
    if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) continue;
    if (best === null || compareSemver(tag, best) > 0) best = tag;
  }
  return best;
}

const tags = (ctx) => {
  const git = ctx.git ?? {};
  const list = Array.isArray(git.tags) ? git.tags : [];
  if (!list.length && !(git.subjects?.length) && !git.remote && !ctx.versions?.tag) return unverified('no-data');
  const tag = ctx.versions?.tag || highestTag(list);
  if (!tag) return fail(list.length ? 'invalid' : 'missing', { tags: list.length });
  const code = ctx.versions?.code?.version ?? rootVersions(ctx).found[0]?.version ?? null;
  if (!code || !parseSemver(code)) return unverified('no-data');
  const relation = relationOf(code, tag);
  if (relation === 'equal') return pass({ tag, code });
  return fail('stale', { tag, code, relation });
};

// ---------- changelog ----------

const VERSION_HEADING = /^#{1,6}\s*\[?v?\d+\.\d+\.\d+/m;
const UNRELEASED = /unreleased|n[ãa]o lan[çc]ado/i;

const changelog = (ctx) => {
  const file = ctx.find(['changelog', 'changes', 'history']);
  if (!file) return fail('missing');
  const text = ctx.read(file);
  if (text == null) return unverified('too-big', [{ file }]);
  const stats = docStats(text);
  const evidence = [{ file }];
  if (stats.markers.length) return fail('placeholder', { count: stats.markers.length }, stats.markers.map((m) => ({ file, line: m.line })));
  if (stats.lines < CHANGELOG_MIN_LINES) return fail('too-short', { lines: stats.lines }, evidence);
  if (!VERSION_HEADING.test(text) || !UNRELEASED.test(text)) {
    return fail('invalid', { versions: VERSION_HEADING.test(text), unreleased: UNRELEASED.test(text) }, evidence);
  }
  return pass({ lines: stats.lines }, evidence);
};

// ---------- releases on the host ----------

const ghReleases = (ctx) => {
  const list = ctx.api?.releases;
  if (!Array.isArray(list)) return unverifiedFor(ctx);
  if (!list.length) return fail('missing', { count: 0, total: 0 });
  const without = list.filter((r) => !r?.hasNotes).map((r) => r?.tag ?? '');
  if (without.length) return fail('missing', { count: list.length - without.length, total: list.length, tags: without.slice(0, 20) });
  return pass({ count: list.length });
};

// ---------- commit style ----------

const conventionalCommits = (ctx) => {
  const subjects = (Array.isArray(ctx.git?.subjects) ? ctx.git.subjects : [])
    .slice(0, COMMIT_WINDOW * 2).filter((s) => !/^Merge /.test(s)).slice(0, COMMIT_WINDOW);
  if (!subjects.length) return unverified('no-data');
  const count = subjects.filter((s) => classifyCommit(s).type !== null).length;
  const detail = { count, total: subjects.length };
  return count / subjects.length >= COMMIT_SHARE ? pass(detail) : fail('invalid', detail);
};

// ---------- automation and publishing ----------

const workflowTexts = (ctx) => {
  const paths = ctx.list('.github/workflows/').filter((p) => /\.ya?ml$/i.test(p));
  if (ctx.has('.gitlab-ci.yml')) paths.push('.gitlab-ci.yml');
  return paths.map((p) => ({ file: p, text: ctx.read(p) })).filter((w) => w.text != null);
};

const AUTOMATION_FILE = /^(release-please-config\.json|\.release-please-manifest\.json|\.changeset\/config\.json|\.releaserc(\.[a-z]+)?|release\.config\.[a-z]+)$/i;
const AUTOMATION_TEXT = /release-please|changesets\/action|changeset (version|publish)|semantic-release/i;

const automation = (ctx) => {
  const file = ctx.files.map((r) => r.path).find((p) => AUTOMATION_FILE.test(p));
  if (file) return pass({ tool: file }, [{ file }]);
  const flow = workflowTexts(ctx).find((w) => AUTOMATION_TEXT.test(w.text));
  if (flow) return pass({ tool: 'workflow' }, [{ file: flow.file }]);
  const pj = ctx.has('package.json') ? ctx.read('package.json') : null;
  if (pj && /"semantic-release"|"release-it"|"@changesets\/cli"/.test(pj)) return pass({ tool: 'package.json' }, [{ file: 'package.json' }]);
  return fail('missing');
};

const PUBLISH_STEP = /\b(npm|pnpm|yarn)\s+(?:--\S+\s+)*publish\b|changesets?\s+publish|\b(dart|flutter)\s+pub\s+publish|semantic-release|release-please|pypa\/gh-action-pypi-publish|gh release create|JS-DevTools\/npm-publish/i;

// One state per publishable package: a publish step in any workflow, or in that package's own scripts. A PHP library
// reaches Packagist by webhook, which leaves no trace in the repository: that package is `unverified`, never `fail`.
const registryPublish = (ctx) => {
  const publishable = ctx.packages.filter((p) => p.publishable);
  if (!publishable.length) return result('na', { reason: 'not-library' });
  const flows = workflowTexts(ctx);
  const flowHit = flows.find((w) => PUBLISH_STEP.test(w.text));
  const packages = publishable.map((p) => {
    if (flowHit || Object.values(p.scripts ?? {}).some((s) => PUBLISH_STEP.test(s))) return { dir: p.dir, state: 'pass' };
    return { dir: p.dir, state: p.kind === 'php' ? 'unverified' : 'fail' };
  });
  const evidence = flowHit ? [{ file: flowHit.file }] : [];
  const failing = packages.filter((p) => p.state === 'fail').length;
  if (failing) return { ...fail('missing', { count: failing }, evidence), packages };
  if (packages.some((p) => p.state === 'unverified')) return { ...unverified('no-data'), packages };
  return { ...pass({}, evidence), packages };
};

export const CHECKS = {
  'releases.semver': guarded('releases.semver', semver),
  'releases.tags': guarded('releases.tags', tags),
  'releases.changelog': guarded('releases.changelog', changelog),
  'releases.gh_releases': guarded('releases.gh_releases', ghReleases),
  'releases.conventional_commits': guarded('releases.conventional_commits', conventionalCommits),
  'releases.automation': guarded('releases.automation', automation),
  'releases.registry_publish': guarded('releases.registry_publish', registryPublish),
};
