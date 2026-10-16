import { readFileSync } from 'node:fs';
import { partRules } from '../arch/parse.mjs';
import { fileOwners } from '../arch/fileowners.mjs';
import { partOfFiles } from '../arch/attach.mjs';
import { AGENTS, roleById } from './agents.mjs';
import { levelFor } from './policy.mjs';

// The domain specialists (id158, or68): one agent per code part of the project's architecture map, written once as
// vendor-neutral data. The map is the source of truth — what the part owns ("Where in the code"), its invariants ("Rules
// that must not break") and the tests that cover its files — so editing the map and running the sync is the whole
// training, for every AI. A specialist is domain × role: this module gives the domain (the card); the kind tag on the
// call still picks the role (method, tools, gates) and the model through the guard (or55, or56).

export const CONFIG = Object.freeze(JSON.parse(readFileSync(new URL('./specialists.json', import.meta.url), 'utf8')));

const TEST_FILE_RE = /\.(test|spec)\.[a-z0-9]+$|_test\.[a-z0-9]+$/;
export const isTestFile = (path) => TEST_FILE_RE.test(String(path));

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Cut by code points, so an emoji is never split into a lone surrogate (invalid in TOML and strict YAML).
const clip = (s, n) => { const chars = Array.from(s); return chars.length > n ? `${chars.slice(0, n - 1).join('').trimEnd()}…` : s; };

// The first sentence of the part's own words, bounded: it rides the description every session loads.
export function shortAbout(about) {
  const text = oneLine(about);
  const end = text.search(/[.!?](\s|$)/);
  return clip(end > 0 ? text.slice(0, end + 1) : text, 220);
}

// A part of the program (not the registry of requests, not the operation part) that names code.
export const isCodePart = (p) => !p.role && Array.isArray(p.codePaths) && p.codePaths.length > 0;

// arch: the parsed map (server/arch). readPart(part) → the text of its markdown file. files: the project's tracked files
// (relative paths), which gives each part its tests the way the map's own file boxes do (fileOwners, fd16).
// testCommand: the prefix that runs given test files ('node --test'), or null when the project's runner is unknown.
export function deriveSpecialists({ arch, readPart, files = [], testCommand = null, config = CONFIG }) {
  const owners = files.length ? fileOwners(files, arch) : [];
  return arch.parts.filter(isCodePart).map((p) => {
    const tests = files.filter((f, i) => isTestFile(f) && owners[i]?.includes(p.id)).sort();
    return Object.freeze({
      id: `${config.prefix}${p.id}`,
      partId: p.id,
      name: p.name,
      about: shortAbout(p.about),
      file: p.file,
      owns: Object.freeze([...p.codePaths]),
      rules: Object.freeze(partRules(readPart(p))),
      tests: Object.freeze(tests),
      testCommand,
    });
  });
}

// The specialist that owns most of the given files, or null when none does or two tie (the map's own placement rule).
export function specialistForFiles(files, arch, specialists, opts = {}) {
  const { partId } = partOfFiles(files, arch, opts);
  return partId ? specialists.find((s) => s.partId === partId) ?? null : null;
}

// How a builder works, per kind of task: the catalog's own methods (or56), so the file is self-sufficient on an AI the
// guard cannot see inside. Claude's guard writes the same line again for a tagged call; it is a few hundred bytes.
function methodBlock(config = CONFIG) {
  const lines = [];
  for (const kind of config.builder.kinds) {
    const role = AGENTS.agents.find((r) => r.kinds.includes(kind));
    if (!role) continue;
    const tag = lines.find((l) => l.role === role.id);
    if (tag) { tag.kinds.push(kind); continue; }
    lines.push({ role: role.id, kinds: [kind], method: role.method, deliver: role.deliver });
  }
  return lines.map((l) => `- ${l.kinds.join('/')}: ${l.method.map((s, i) => `${i + 1}) ${s}`).join('; ')}. Deliver: ${l.deliver}.`);
}

// The card: the system text of a specialist. Bounded by cardMaxBytes (it is input tokens on every call): the tests list
// shrinks first, then the rules, never the ownership.
export function specialistCard(s, config = CONFIG) {
  const build = (testsN, rulesN) => {
    const out = [`You own the "${s.name}" part of this project${s.about ? `: ${s.about}` : '.'}`, ''];
    out.push(`Your part, from the architecture map (${s.file}):`);
    for (const p of s.owns.slice(0, config.ownsListed)) out.push(`- ${p}`);
    if (s.owns.length > config.ownsListed) out.push(`- …and ${s.owns.length - config.ownsListed} more in that section`);
    out.push('Work inside your part. If the task needs a file outside it, change the least there and say so in your answer.');
    if (s.rules.length) {
      out.push('', 'Rules that must not break (the map, "Rules that must not break"):');
      for (const r of s.rules.slice(0, rulesN)) out.push(`- ${clip(oneLine(r), config.ruleMaxChars)}`);
      if (s.rules.length > rulesN) out.push(`- …and ${s.rules.length - rulesN} more in ${s.file}; read them before changing behaviour`);
    }
    out.push('');
    if (s.tests.length) {
      const shown = s.tests.slice(0, testsN);
      const names = shown.length ? ` (${shown.join(', ')}${s.tests.length > shown.length ? ', …' : ''})` : '';
      out.push(`Proof: ${s.tests.length} test file${s.tests.length === 1 ? '' : 's'} cover your part${names}.`);
      out.push(`Run only the ones that cover what you changed${s.testCommand ? ` with \`${s.testCommand} <files>\`` : ''}; the whole suite runs once at the end, by the conductor.`);
    } else {
      out.push('Proof: the map maps no test file to your part (its folder may be shared with another part); find the tests named after the files you change and say what you ran to check the change.');
    }
    out.push('', 'How to work, by the kind tag of your task:', ...methodBlock(config));
    out.push('', 'End with what you changed (file:line), the proof you ran and its result, and anything left undone.');
    return out.join('\n');
  };
  const bytes = (t) => Buffer.byteLength(t, 'utf8');
  let testsN = config.testsListed;
  let rulesN = config.rulesListed;
  let card = build(testsN, rulesN);
  while (bytes(card) > config.cardMaxBytes && testsN > 0) card = build(--testsN, rulesN);
  while (bytes(card) > config.cardMaxBytes && rulesN > 0) card = build(testsN, --rulesN);
  return card;
}

const CLASS_OF_TOOL = { Read: 'read', Glob: 'read', Grep: 'read', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', Bash: 'shell', PowerShell: 'shell' };

// The neutral classes a role carries: reads are free for every role (the hook never sees them), the rest follows its tools.
const classesOfRole = (role) => ['read', ...new Set(role.tools.map((t) => CLASS_OF_TOOL[t]).filter((c) => c && c !== 'read'))];

function roleSystem(role, classes) {
  const out = [`You are the ${role.label} of this project's AI team. Deliver: ${role.deliver}.`, `Method: ${role.method.map((s, i) => `${i + 1}) ${s}`).join('; ')}.`];
  if (!classes.includes('edit')) out.push(classes.includes('shell') ? 'You edit no file; you may run commands to check the work.' : 'You read and report; you change nothing.');
  else out.push('Edit only what your deliverable needs.');
  out.push('End with what you found or changed, the proof, and what you did not do.');
  return out.join('\n');
}

// The vendor-neutral agent specs: every specialist and every native role, each with its description, system text, tool
// classes and the model and level the policy gives its primary kind. The renderers (agent-files.mjs) only spell them.
export function agentSpecs({ specialists, config = CONFIG, level = levelFor }) {
  const specs = specialists.map((s) => {
    const { model, effort } = level(config.builder.primary);
    const where = s.owns.slice(0, 3).join(', ');
    return {
      id: s.id, type: 'specialist', partId: s.partId,
      description: clip(oneLine(`Owner of the ${s.name} part. ${clip(s.about, 140)} Its code: ${where}, and the tests that cover it. Use proactively for code, tests and debugging there.`), 480),
      system: specialistCard(s, config),
      classes: [...config.builder.classes], primaryKind: config.builder.primary, model, effort,
    };
  });
  for (const id of config.nativeRoles) {
    const role = roleById(id);
    if (!role) continue;
    const classes = classesOfRole(role);
    const { model, effort } = level(role.kinds[0]);
    specs.push({
      id: `${config.prefix}${role.id}`, type: 'role', roleId: role.id,
      description: clip(oneLine(`${role.label} — ${role.deliver}.`), 480),
      system: roleSystem(role, classes), classes, primaryKind: role.kinds[0], model, effort,
    });
  }
  return specs;
}
