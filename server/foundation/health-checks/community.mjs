// Health (fd08), community files: the 13 `community.*` items. One pure function per item over a health context; the
// answer is { state, evidence, reason, detail }. The content is judged, not only the presence of the file. Whether the
// item applies to the project (public, library...) is decided by the caller with `appliesTo`.
import { docStats } from '../health-find.mjs';

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const URL_RE = /https?:\/\/[^\s)>\]]+/i;
const hasChannel = (text) => EMAIL.test(text) || URL_RE.test(text);

const out = (state, file, reason = null, detail = {}, line) => ({
  state,
  evidence: file ? [line ? { file, line } : { file }] : [],
  reason,
  detail,
});
const pass = (file, detail) => out('pass', file, null, detail);
const fail = (reason, file, detail, line) => out('fail', file, reason, detail, line);
const missing = () => out('fail', null, 'missing');

// Reads the first of `names` and hands text and stats to `judge`. Unreadable (too big) counts as present but empty.
function onDoc(ctx, names, opts, judge) {
  const file = ctx.find(names, opts);
  if (!file) return missing();
  const text = ctx.read(file) ?? '';
  return judge(file, text, docStats(text));
}

// A leftover template marker is always a failure, and it points at the line.
const markerFail = (file, stats) => (stats.markers.length ? fail('placeholder', file, { count: stats.markers.length }, stats.markers[0].line) : null);

const SPDX_SIGNS = [
  ['AGPL-3.0', /GNU AFFERO GENERAL PUBLIC LICENSE/i],
  ['LGPL-3.0', /GNU LESSER GENERAL PUBLIC LICENSE/i],
  ['GPL-3.0', /GNU GENERAL PUBLIC LICENSE[\s\S]{0,40}Version 3/i],
  ['GPL-2.0', /GNU GENERAL PUBLIC LICENSE[\s\S]{0,40}Version 2/i],
  ['Apache-2.0', /Apache License[\s\S]{0,40}Version 2\.0/i],
  ['MPL-2.0', /Mozilla Public License[\s\S]{0,40}2\.0/i],
  ['Unlicense', /This is free and unencumbered software released into the public domain/i],
  ['BSD-3-Clause', /Redistribution and use in source and binary forms[\s\S]*Neither the name/i],
  ['BSD-2-Clause', /Redistribution and use in source and binary forms/i],
  ['ISC', /Permission to use, copy, modify, and\/or distribute this software/i],
  ['MIT', /Permission is hereby granted, free of charge|^\s*MIT License/im],
];
const spdxOf = (text) => SPDX_SIGNS.find(([, re]) => re.test(text))?.[0] ?? null;

function licenseField(ctx) {
  const raw = ctx.read('package.json');
  if (!raw) return null;
  try {
    const v = JSON.parse(raw).license;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function license(ctx) {
  const file = ctx.find(['LICENSE', 'LICENCE', 'COPYING'], { dirs: [''] });
  if (file) {
    const text = ctx.read(file) ?? '';
    const stats = docStats(text);
    if (stats.lines < 5) return fail('too-short', file, { lines: stats.lines });
    return pass(file, { spdx: spdxOf(text) });
  }
  const field = licenseField(ctx);
  if (field) return pass('package.json', { spdx: field });
  return missing();
}

const readme = (ctx) =>
  onDoc(ctx, 'README', undefined, (file, text, s) => (s.lines < 10 || s.titles < 2 ? fail('too-short', file, { lines: s.lines, titles: s.titles }) : pass(file, { lines: s.lines })));

const codeOfConduct = (ctx) =>
  onDoc(ctx, ['CODE_OF_CONDUCT', 'CODE-OF-CONDUCT'], undefined, (file, text, s) => {
    if (s.lines < 5) return fail('too-short', file, { lines: s.lines });
    return markerFail(file, s) ?? (hasChannel(text) ? pass(file) : fail('no-contact', file));
  });

const contributing = (ctx) =>
  onDoc(ctx, 'CONTRIBUTING', undefined, (file, text, s) => {
    if (s.lines < 8) return fail('too-short', file, { lines: s.lines });
    const ok = /\btests?\b/i.test(text) && /pull request|merge request|\bPRs?\b/i.test(text);
    return ok ? pass(file) : fail('invalid', file);
  });

const security = (ctx) =>
  onDoc(ctx, 'SECURITY', { exts: ['', '.md', '.txt', '.rst'] }, (file, text, s) => {
    if (s.lines < 6) return fail('too-short', file, { lines: s.lines });
    return markerFail(file, s) ?? (hasChannel(text) ? pass(file) : fail('no-contact', file));
  });

const support = (ctx) =>
  onDoc(ctx, 'SUPPORT', undefined, (file, text, s) => {
    if (s.lines < 3) return fail('too-short', file, { lines: s.lines });
    return markerFail(file, s) ?? (hasChannel(text) ? pass(file) : fail('no-contact', file));
  });

const FUNDING_KEYS = ['github', 'patreon', 'ko_fi', 'open_collective', 'custom', 'liberapay', 'tidelift', 'buy_me_a_coffee', 'polar', 'thanks_dev', 'issuehunt', 'community_bridge', 'lfx_crowdfunding'];
const FUNDING_RE = new RegExp(`^\\s*(?:${FUNDING_KEYS.join('|')})\\s*:\\s*\\S`, 'm');

function funding(ctx) {
  const file = ctx.find('FUNDING', { dirs: ['.github'], exts: ['.yml', '.yaml'] });
  if (!file) return missing();
  return FUNDING_RE.test(ctx.read(file) ?? '') ? pass(file) : fail('invalid', file);
}

const hasKey = (text, key) => new RegExp(`^\\s*${key}\\s*:\\s*\\S`, 'm').test(text);

function issueTemplates(ctx) {
  const files = ctx
    .list('.github/ISSUE_TEMPLATE/')
    .filter((p) => /\.(ya?ml|md)$/i.test(p) && !/\/config\.ya?ml$/i.test(p));
  if (!files.length) return missing();
  const good = files.filter((p) => {
    const text = ctx.read(p) ?? '';
    return /\.md$/i.test(p) ? hasKey(text, 'name') && hasKey(text, 'about') : hasKey(text, 'name') && hasKey(text, 'description');
  });
  if (good.length) return out('pass', good[0], null, { count: good.length });
  return fail('invalid', files[0], { count: files.length });
}

function prTemplate(ctx) {
  let file = ctx.find('pull_request_template', { exts: ['', '.md', '.txt'] });
  if (!file) file = ctx.list('.github/PULL_REQUEST_TEMPLATE/').find((p) => /\.md$/i.test(p)) ?? null;
  if (!file) return missing();
  const s = docStats(ctx.read(file) ?? '');
  return s.lines < 3 ? fail('too-short', file, { lines: s.lines }) : pass(file);
}

function discussionTemplates(ctx) {
  const files = ctx.list('.github/DISCUSSION_TEMPLATE/').filter((p) => /\.ya?ml$/i.test(p));
  return files.length ? out('pass', files[0], null, { count: files.length }) : missing();
}

const OWNER = /(?:^|\s)@[\w./-]+|[\w.+-]+@[\w-]+\.[\w.-]+/;

function codeowners(ctx) {
  const file = ctx.find('CODEOWNERS', { dirs: ['.github', '', 'docs'], exts: [''] });
  if (!file) return missing();
  const text = ctx.read(file) ?? '';
  const rules = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!rules.length) return fail('placeholder', file);
  const ok = rules.some((l) => /^\S+\s+\S/.test(l) && OWNER.test(l.replace(/^\S+/, '')));
  return ok ? pass(file, { rules: rules.length }) : fail('invalid', file);
}

function citation(ctx) {
  const file = ctx.find('CITATION', { dirs: [''], exts: ['.cff'] });
  if (!file) return missing();
  const text = ctx.read(file) ?? '';
  return ['cff-version', 'title', 'authors'].every((k) => hasKey(text, k) || new RegExp(`^${k}\\s*:\\s*$`, 'm').test(text)) ? pass(file) : fail('invalid', file);
}

const governance = (ctx) =>
  onDoc(ctx, 'GOVERNANCE', undefined, (file, text, s) => (s.lines < 5 ? fail('too-short', file, { lines: s.lines }) : pass(file)));

export const COMMUNITY_CHECKS = Object.freeze({
  'community.readme': readme,
  'community.license': license,
  'community.code_of_conduct': codeOfConduct,
  'community.contributing': contributing,
  'community.security': security,
  'community.support': support,
  'community.funding': funding,
  'community.issue_templates': issueTemplates,
  'community.pr_template': prTemplate,
  'community.discussion_templates': discussionTemplates,
  'community.codeowners': codeowners,
  'community.citation': citation,
  'community.governance': governance,
});
