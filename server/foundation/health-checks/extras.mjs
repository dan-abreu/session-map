// Health checks (fd08) for the extras category: agent instructions, AI policy, llms.txt, repository metadata, badges,
// SPDX headers. Pure functions of the context. Two items have no local answer (social image, OpenSSF badge): they are
// `unverified` until the host's API says something, and the social image never does.
import { docStats } from '../health-find.mjs';
import { guarded, unverifiedFor } from './security-api.mjs';

const result = (state, extra = {}) => ({ state, evidence: [], reason: null, detail: {}, ...extra });
const pass = (detail = {}, evidence = []) => result('pass', { detail, evidence });
const fail = (reason, detail = {}, evidence = []) => result('fail', { reason, detail, evidence });
const unverified = (reason, evidence = []) => result('unverified', { reason, evidence });

const AGENT_DOC_MIN_LINES = 5;
const BADGES_MIN = 2;
const SPDX_SHARE = 0.8;
const SPDX_SAMPLE = 500;
const SPDX_HEAD_LINES = 5;

// ---------- instructions for coding agents ----------

// Only at the root: a copy inside docs/ is not where the tools look.
const agentDoc = (name) => (ctx) => {
  const file = ctx.find([name], { dirs: [''], exts: ['.md'] });
  if (!file) return fail('missing');
  const text = ctx.read(file);
  if (text == null) return unverified('too-big', [{ file }]);
  const { lines } = docStats(text);
  return lines >= AGENT_DOC_MIN_LINES ? pass({ lines }, [{ file }]) : fail('too-short', { lines }, [{ file }]);
};

// ---------- AI policy ----------

const AI_HEADING = /^#{1,6}[ \t].*(?:\bAI\b|\bIA\b|artificial intelligence|intelig[êe]ncia artificial|\bLLMs?\b|copilot)/im;

const aiPolicy = (ctx) => {
  const own = ctx.find(['ai_policy', 'ai-policy', 'ai_usage', 'ai-usage', 'ai'], { exts: ['.md', '.txt'] });
  if (own) return pass({}, [{ file: own }]);
  for (const names of [['contributing'], ['readme']]) {
    const file = ctx.find(names);
    const text = file ? ctx.read(file) : null;
    if (text && AI_HEADING.test(text)) return pass({}, [{ file }]);
  }
  return fail('missing');
};

// ---------- llms.txt ----------

const llmsTxt = (ctx) => {
  const file = ctx.find(['llms'], { dirs: ['', 'public'], exts: ['.txt'] });
  if (!file) return fail('missing');
  const text = ctx.read(file);
  if (text == null) return unverified('too-big', [{ file }]);
  return text.trim() ? pass({}, [{ file }]) : fail('too-short', {}, [{ file }]);
};

// ---------- what the host knows ----------

// description, at least one topic and a homepage. A field the API did not give (`null`) is not a failure.
const repoMeta = (ctx) => {
  const a = ctx.api;
  const fields = { description: a?.description, topics: a?.topics, homepage: a?.homepage };
  const known = Object.entries(fields).filter(([, v]) => v != null);
  if (!known.length) return unverifiedFor(ctx);
  const missing = known.filter(([, v]) => (Array.isArray(v) ? v.length === 0 : String(v).trim() === '')).map(([k]) => k);
  if (missing.length) return fail('missing', { missing });
  if (known.length < 3) return unverifiedFor(ctx);
  return pass();
};

// The pretty picture for link previews is only set in the host's settings: nothing here or in the API can read it.
const socialImage = () => unverified('no-data');

const openssfBadge = (ctx) => {
  const badge = ctx.api?.openssfBadge;
  if (badge == null) return unverifiedFor(ctx);
  return badge === false ? fail('missing') : pass({ level: badge });
};

// ---------- badges ----------

const IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)/gi;
const BADGE_URL = /shields\.io|badge\.svg|badgen\.net|badge\.fury\.io|\/badges?\//i;

const badges = (ctx) => {
  const file = ctx.find(['readme']);
  if (!file) return fail('missing');
  const text = ctx.read(file);
  if (text == null) return unverified('too-big', [{ file }]);
  let count = 0;
  for (const m of text.matchAll(IMAGE)) if (BADGE_URL.test(m[1] ?? m[2] ?? '')) count++;
  return count >= BADGES_MIN ? pass({ count }, [{ file }]) : fail('too-short', { count }, [{ file }]);
};

// ---------- SPDX headers ----------

const spdxHeaders = (ctx) => {
  const sample = ctx.files.filter((r) => r.kind === 'code' && r.included).map((r) => r.path).sort().slice(0, SPDX_SAMPLE);
  let total = 0;
  let count = 0;
  const lacking = [];
  for (const file of sample) {
    const text = ctx.read(file);
    if (text == null) continue;
    total++;
    if (text.split(/\r?\n/, SPDX_HEAD_LINES).some((l) => l.includes('SPDX-License-Identifier:'))) count++;
    else if (lacking.length < 20) lacking.push({ file });
  }
  if (!total) return result('na', { reason: 'no-code' });
  const detail = { count, total };
  return count / total >= SPDX_SHARE ? pass(detail) : fail('missing', detail, lacking);
};

export const CHECKS = {
  'extras.agents_md': guarded('extras.agents_md', agentDoc('agents')),
  'extras.claude_md': guarded('extras.claude_md', agentDoc('claude')),
  'extras.ai_policy': guarded('extras.ai_policy', aiPolicy),
  'extras.llms_txt': guarded('extras.llms_txt', llmsTxt),
  'extras.repo_meta': guarded('extras.repo_meta', repoMeta),
  'extras.social_image': guarded('extras.social_image', socialImage),
  'extras.badges': guarded('extras.badges', badges),
  'extras.openssf_badge': guarded('extras.openssf_badge', openssfBadge),
  'extras.spdx_headers': guarded('extras.spdx_headers', spdxHeaders),
};
