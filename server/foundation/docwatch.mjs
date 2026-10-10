// The document watcher (fd06, fd13): reads the project's Markdown files, runs the pure rules of docwatch-cites and
// docwatch-agree on them, merges the result with the findings of earlier rounds and stores it. This is the only part
// of the watcher that touches the disk and git; the rules themselves never do. Nothing here asks an AI.
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isSecretsFile, safeResolve } from '../files.mjs';
import { log } from '../log.mjs';
import { linksOf } from './mdlinks.mjs';
import { docCitesMissing, codeWithoutDoc, ownerMissing, pointerBroken } from './docwatch-cites.mjs';
import { docSize, docsDisagree, staleImage, versionMismatch } from './docwatch-agree.mjs';
import { mergeFindings, readFindings, writeFindings } from './findings.mjs';
import { readFd, writeFd } from './store.mjs';

// ponytail: deliberate ceilings. A huge repository is read in part rather than stalling the round; `truncated` says so.
export const DOC_FILES_MAX = 300;
export const DOC_BYTES_MAX = 200 * 1024;
export const COMMITS_MAX = 2000;
const GIT_TIMEOUT_MS = 20_000;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
const SHOWS = /<!--\s*shows\s*:\s*(.+?)\s*-->/i;
const STATE_FILE = 'docwatch.json';

export const RULES = [
  { name: 'doc-cites-missing', run: docCitesMissing },
  { name: 'pointer-broken', run: pointerBroken },
  { name: 'code-without-doc', run: codeWithoutDoc },
  { name: 'owner-missing', run: ownerMissing },
  { name: 'version-mismatch', run: versionMismatch },
  { name: 'docs-disagree', run: docsDisagree },
  { name: 'stale-image', run: staleImage },
  { name: 'doc-size', run: docSize },
];

// The included Markdown files of the census with their text: [{ path, text }]. Never a secret, never a file that
// resolves outside the root, never one over maxBytes.
export function readDocs(root, census, { maxFiles = DOC_FILES_MAX, maxBytes = DOC_BYTES_MAX } = {}) {
  const rows = (Array.isArray(census?.files) ? census.files : [])
    .filter((f) => f && typeof f.path === 'string' && /\.md$/i.test(f.path) && f.included !== false && f.kind !== 'secret' && !isSecretsFile(f.path))
    .map((f) => f.path)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const docs = [];
  let truncated = false;
  for (const path of rows) {
    const abs = safeResolve(root, path);
    if (!abs || isSecretsFile(abs)) continue;
    let text;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > maxBytes) continue;
      text = readFileSync(abs, 'utf8');
    } catch { continue; }
    if (docs.length >= maxFiles) { truncated = true; break; }
    docs.push({ path, text });
  }
  return { docs, truncated };
}

// Images the documents show: [{ doc, line, image, shows }]. `shows` is the screen file declared by a marker comment
// `<!-- shows: path -->` on the line of the image or the line right above it, else null.
export function imagesOf(docs) {
  const out = [];
  for (const doc of docs) {
    const rows = doc.text.split(/\r?\n/);
    for (const link of linksOf(doc.text)) {
      if (link.external || !link.path || !IMAGE_EXT.test(link.path)) continue;
      if (link.kind !== 'image' && link.kind !== 'html') continue;
      const here = rows[link.line - 1] ?? '';
      const above = rows[link.line - 2] ?? '';
      const marker = SHOWS.exec(here) ?? SHOWS.exec(above);
      out.push({ doc: doc.path, line: link.line, image: link.path, shows: marker ? marker[1].trim().replaceAll('\\', '/') : null });
    }
  }
  return out;
}

function runGit(root, args, exec) {
  return new Promise((resolve) => {
    exec('git', args, { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// Path -> ISO date of the last commit that touched it, from ONE `git log --name-only` (the newest commit seen first
// wins). Dates come from commits, not from mtime, because a checkout resets mtime (bloco-3 decision 9).
export async function commitDatesOf(root, { maxCommits = COMMITS_MAX, exec = execFile } = {}) {
  const dates = new Map();
  const out = await runGit(root, ['-c', 'core.quotepath=off', 'log', '-n', String(maxCommits), '--name-only', '--no-renames', '--format=%x01%cI'], exec);
  if (!out) return dates;
  let when = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('\u0001')) { when = line.slice(1).trim(); continue; }
    if (line && when && !dates.has(line)) dates.set(line, when);
  }
  return dates;
}

// Everything the rules take (the RuleInput of bloco-3b). The fix step of docfix.mjs reuses it, so the two agree.
export async function buildRuleInput({ root, census, facts, model, arch, versions, config, prevFactIds, commitDates } = {}) {
  const { docs, truncated } = readDocs(root, census);
  return {
    root, docs, truncated, census, facts, model, arch, versions, config,
    prevFactIds,
    commitDates: commitDates ?? await commitDatesOf(root),
    images: imagesOf(docs),
  };
}

const ruleName = (rule) => rule.name || rule.ruleName || 'rule';

// runDocwatch({ root, smDir, id, census, facts, model, arch, versions, config, now }) -> { ok, findings, ... }.
// Without a census there is nothing to read: the earlier findings stay exactly as they are.
export async function runDocwatch(args, { extraRules = [] } = {}) {
  const { smDir, id, now = Date.now } = args ?? {};
  if (!Array.isArray(args?.census?.files)) return { ok: false, error: 'no-census' };
  const seen = readFd(smDir, id, STATE_FILE, null);
  const prevFactIds = Array.isArray(seen?.factIds) ? new Set(seen.factIds) : undefined;
  const input = await buildRuleInput({ ...args, prevFactIds });

  const current = [];
  const failedRules = [];
  const rules = [...RULES, ...extraRules.map((run) => ({ name: ruleName(run), run }))];
  for (const rule of rules) {
    try {
      current.push(...rule.run(input));
    } catch (err) {
      // One broken rule must not leave the other documents unwatched.
      failedRules.push(rule.name);
      log('warn', 'docwatch-rule-failed', { projectId: id, rule: rule.name, error: err.message });
    }
  }
  const findings = mergeFindings(readFindings(smDir, id), current, new Date(now()).toISOString());
  writeFindings(smDir, id, findings);
  if (Array.isArray(args.facts?.facts)) {
    writeFd(smDir, id, STATE_FILE, { version: 1, generatedAt: new Date(now()).toISOString(), factIds: args.facts.facts.map((f) => f.id) });
  }
  return { ok: true, findings, docs: input.docs.length, truncated: input.truncated, failedRules };
}
