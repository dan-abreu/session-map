// The "classify" set of the measuring bench (or12): the owner's own conversations, each with the answer the product's
// placer should give. Built at run time from the owner's data and written OUTSIDE the repo
// (<smDir>/bench/sets/classify.json): the prompts carry the owner's words, paths and commit subjects.
//
// WHICH ANSWERS CAN BE TRUSTED AS GOLD (decided from server/collect.mjs placeInPart, which ranks the ways a conversation
// lands on a part: owner > project chat > item code > page > files > ai):
//   - 'owner'  the part (or "no part", partId null) the OWNER set by hand in placements.json (server/placements.mjs).
//   - 'code'   an item code the conversation cites that the map assigns to one part (partByCodes in arch/attach.mjs).
//   - 'files'  the files it edited, owned by one part of the map (partOfFiles in arch/attach.mjs).
//   Never gold: brain/<project>/placed.json (the AI's own earlier answers; grading a model against a model), 'page' (the
//   part's page the chat was opened on: a click, not a judgment), 'project' (a chat of the whole project), and a
//   conversation nothing placed ('none': nobody knows the answer). The placer is run here with no AI answers and no page,
//   so it can only return owner / code / files / none, whatever the live state is.
//   'code' and 'files' gold are rule-made, so they are easier than what the product really sends to the AI (it only asks
//   when no rule decided). Every item carries its `source` so the report can split the accuracy by it.
//
// A gold answer must be one a reader of the prompt could reach. The product's rules see more than the prompt shows
// (every code cited anywhere in the transcript, the helpers' edits), so the bench keeps a rule-made gold only when:
//   - 'files': it comes from the conversation's OWN edits (helpers' edits are not in the digest) and the digest lists files;
//   - 'code':  one part's codes strictly outnumber every other part's (no tie broken by "cited last"), at least one of
//              that part's codes is written in the digest itself, and the conversation's own files do not point elsewhere;
//   - any:     no other item of the project shows the very same digest with a different gold (no model can be right
//              on both).
//
// Each prompt is placePrompt(digestOf(...), arch, examples) exactly as the product builds it. The examples are the owner's
// other hand placements of the project (as the product passes them), never the item's own, which would give the answer away.
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAiRunnerCwd } from '../ai/runner.mjs';
import { digestOf } from '../ai/digest.mjs';
import { PLACE_SCHEMA, placePrompt } from '../ai/place.mjs';
import { readArch } from '../arch/detect.mjs';
import { withLocalParts } from '../arch/local.mjs';
import { partOfFiles } from '../arch/attach.mjs';
import { key as codeKey } from '../arch/parse.mjs';
import { workCellsOf } from '../brain/workcells.mjs';
import { placeInPart, placeInWorkCell, topLevelOf } from '../collect.mjs';
import { loadConfig } from '../config.mjs';
import { readRemoved } from '../hidden.mjs';
import { normalizePath, projectIdOf } from '../paths.mjs';
import { readPlacements } from '../placements.mjs';
import { claudeDir, listTranscripts, readHelperWork, readTranscript } from '../sources/claude.mjs';
import { mainBranch, projectRoot } from '../sources/git.mjs';
import { writeAtomic } from '../store.mjs';

export const DEFAULT_LIMIT = 200;
const GOLD_SOURCES = new Set(['owner', 'code', 'files']);
// The same cap collect.mjs puts on the owner's hand placements shown to the AI, and on a title.
const EXAMPLES_MAX = 20;
const TEXT_MAX = 280;
const MIN_PARTS = 2;

export const classifySetPath = (smDir) => join(smDir, 'bench', 'sets', 'classify.json');

const cut = (s) => String(s ?? '').slice(0, TEXT_MAX);
const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// What the build reads from the machine. Tests replace any of these.
const DEFAULT_DEPS = {
  // [{summary, card, helperEdits}] for every transcript under the Claude folder.
  conversations(dir) {
    const out = [];
    for (const ref of listTranscripts(dir)) {
      try {
        const summary = readTranscript(ref.path);
        if (!summary) continue;
        out.push({ summary, helperEdits: readHelperWork(join(dirname(ref.path), ref.sessionId)).editedFiles, card: null });
      } catch { /* an unreadable transcript is just not in the set */ }
    }
    return out;
  },
  async rootOf(cwd) {
    return (await projectRoot(cwd)) ?? cwd;
  },
  async archOf(root, smDir, projectId) {
    const main = await mainBranch(root);
    return withLocalParts(await readArch(root, loadConfig(root, smDir), { mainBranch: main }), smDir, projectId);
  },
  topLevelOf,
  async workCellsOf(root, placeFiles) {
    const main = await mainBranch(root);
    return main ? workCellsOf(root, (files) => placeFiles(files.map((f) => f.path)), { main }) : [];
  },
};

// Can a reader of the digest reach the part the item codes point to? -> null when yes, else why not.
// mentions: [{code, n}] as the transcript reader counts them; filesPart: what the conversation's own files say.
export function codeGoldProblem(mentions, arch, digest, filesPart) {
  const owner = new Map();
  for (const p of arch.parts) for (const g of p.groups) for (const i of g.items) if (i.code) owner.set(codeKey(i.code), p.id);
  const score = new Map();
  const codesOf = new Map();
  for (const { code, n } of mentions ?? []) {
    const id = owner.get(codeKey(String(code)));
    if (!id) continue;
    score.set(id, (score.get(id) ?? 0) + (Number(n) || 0));
    if (!codesOf.has(id)) codesOf.set(id, new Set());
    codesOf.get(id).add(codeKey(String(code)));
  }
  const ranked = [...score].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return 'no-code';
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return 'code-tie';
  const [winner] = ranked[0];
  const text = [digest.title, digest.branch ?? '', ...digest.prompts, ...digest.commits].join('\n');
  const words = new Set((text.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []).map(codeKey));
  if (![...codesOf.get(winner)].some((c) => words.has(c))) return 'code-not-in-prompt';
  if (filesPart && filesPart !== winner) return 'files-disagree';
  return null;
}

// Round-robin over the buckets (project x kind of gold), each in session-id order: the same data gives the same set, and
// a small limit still holds every project, every source and the "none fits" answers.
function pickBalanced(buckets, limit) {
  const keys = [...buckets.keys()].sort();
  const lists = keys.map((k) => buckets.get(k).sort((a, b) => a.id.localeCompare(b.id)));
  const picked = [];
  for (let round = 0; picked.length < limit && lists.some((l) => round < l.length); round++) {
    for (const list of lists) if (round < list.length && picked.length < limit) picked.push(list[round]);
  }
  return picked;
}

// -> {path, total, limit, available, byProject: {id: {available, total, owner, code, files, none}}, skippedProjects, dropped: {reason: n}}
// `none` counts the items whose gold is null (the owner said "no part").
export async function buildClassifySet({ smDir, projectId, limit = DEFAULT_LIMIT, dir = claudeDir(), deps = {} } = {}) {
  if (!smDir) throw new Error('buildClassifySet needs smDir');
  const d = { ...DEFAULT_DEPS, ...deps };
  const placements = readPlacements(smDir);
  const removed = readRemoved(smDir);

  const seen = new Set();
  const groups = new Map();
  for (const item of await d.conversations(dir, smDir)) {
    const s = item.summary;
    if (!s?.sessionId || seen.has(s.sessionId) || removed.has(s.sessionId) || !s.cwd || isAiRunnerCwd(s.cwd, smDir)) continue;
    seen.add(s.sessionId);
    const moved = placements[s.sessionId]?.root;
    const root = moved && isDir(moved) ? moved : await d.rootOf(s.cwd);
    const key = normalizePath(root);
    if (!groups.has(key)) groups.set(key, { root, items: [] });
    groups.get(key).items.push(item);
  }

  const buckets = new Map();
  const byProject = {};
  const skippedProjects = [];
  const candidates = [];
  const dropped = {}; // reason -> how many conversations had a rule-made answer the prompt does not let anyone reach
  for (const { root, items } of [...groups.values()].sort((a, b) => a.root.localeCompare(b.root))) {
    const pid = projectIdOf(root);
    if (projectId && pid !== projectId) continue;
    const arch = await d.archOf(root, smDir, pid);
    if (arch.parts.length < MIN_PARTS) {
      skippedProjects.push({ projectId: pid, reason: 'fewer than two parts' });
      continue;
    }
    const topLevel = d.topLevelOf(root);
    const placeFiles = (files) => partOfFiles(files, arch, { topLevel });
    const workCells = await d.workCellsOf(root, placeFiles);
    const owned = items
      .filter((i) => placements[i.summary.sessionId] && 'partId' in placements[i.summary.sessionId])
      .map((i) => ({ sessionId: i.summary.sessionId, title: cut(placements[i.summary.sessionId].title || i.summary.title) }));

    byProject[pid] = { available: 0, total: 0, owner: 0, code: 0, files: 0, none: 0 };
    for (const item of items) {
      const s = item.summary;
      // No AI answers, no page: only the rules and the owner can decide (see the head of this file). The helpers'
      // edits are left out: the digest does not show them, so a gold drawn from them could not be reached.
      const own = { ...item, helperEdits: [] };
      const where = placeInPart(own, arch, placeFiles, root, {}, null, placements[s.sessionId]);
      if (!GOLD_SOURCES.has(where.partSource)) continue;
      const cell = workCells.find((w) => w.id === placeInWorkCell(s, item.card, workCells).workCellId) ?? null;
      const digest = digestOf(s, cell);
      if (!digest.prompts.length && !digest.files.length && !digest.commits.length) continue;
      if (where.partSource === 'files' && !digest.files.length) { dropped['files-not-in-prompt'] = (dropped['files-not-in-prompt'] ?? 0) + 1; continue; }
      if (where.partSource === 'code') {
        const filesPart = placeInPart({ ...own, summary: { ...s, mentionedCodes: [] } }, arch, placeFiles, root, {}, null, undefined).partId;
        const problem = codeGoldProblem(s.mentionedCodes, arch, digest, filesPart);
        if (problem) { dropped[problem] = (dropped[problem] ?? 0) + 1; continue; }
      }
      const examples = owned
        .filter((o) => o.sessionId !== s.sessionId && placements[o.sessionId].partId && arch.parts.some((p) => p.id === placements[o.sessionId].partId))
        .slice(0, EXAMPLES_MAX)
        .map((o) => ({ title: o.title, partId: placements[o.sessionId].partId }));
      candidates.push({
        bucket: `${pid}|${where.partSource}${where.partId === null ? '-null' : ''}`,
        seen: `${pid} ${JSON.stringify(digest)}`,
        item: {
          id: s.sessionId,
          project: pid,
          source: where.partSource,
          prompt: placePrompt(digest, arch, examples),
          schemaHint: PLACE_SCHEMA,
          gold: { partId: where.partId },
        },
      });
    }
  }

  // The same conversation digest with two different answers: no model can be right on both, so neither is a fair
  // question. (The prompts differ only by the examples, which leave out each item's own placement.)
  const goldsOf = new Map();
  for (const { seen, item } of candidates) {
    if (!goldsOf.has(seen)) goldsOf.set(seen, new Set());
    goldsOf.get(seen).add(item.gold.partId);
  }
  for (const { bucket, seen, item } of candidates) {
    if (goldsOf.get(seen).size > 1) { dropped['same-prompt-other-gold'] = (dropped['same-prompt-other-gold'] ?? 0) + 1; continue; }
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(item);
    byProject[item.project].available++;
  }

  const items = pickBalanced(buckets, limit).sort((a, b) => a.project.localeCompare(b.project) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  for (const item of items) {
    const counts = byProject[item.project];
    counts.total++;
    counts[item.source]++;
    if (item.gold.partId === null) counts.none++;
  }
  const path = classifySetPath(smDir);
  const set = {
    kind: 'classify',
    version: 1,
    about: 'Conversations of the owner whose part is known for sure (placed by hand, by an item code or by file ownership), each with the prompt the product sends to the placer. Personal: never commit.',
    items,
  };
  writeAtomic(path, `${JSON.stringify(set, null, 1)}\n`);
  return { path, total: items.length, limit, available: Object.values(byProject).reduce((n, c) => n + c.available, 0), byProject, skippedProjects, dropped };
}

// Run by hand: node server/bench/classify-build.mjs [--project <id>] [--limit N] [--sm-dir <path>]
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const smDir = arg('sm-dir') ?? join(claudeDir(), 'session-map');
  const summary = await buildClassifySet({ smDir, projectId: arg('project'), limit: arg('limit') ? Number(arg('limit')) : DEFAULT_LIMIT });
  console.log(JSON.stringify(summary, null, 2));
}
