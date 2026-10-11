// fd08: drafts that fix a health gap. Pure: reads nothing from disk, returns only NEW files. A draft never invents a
// contact, a link, a name, a promised deadline or legal text; whatever the program cannot know stays as a marker in
// capitals (<CONTACT EMAIL>) and the check keeps failing ("placeholder") until the owner fills it in.
// LICENSE, privacy and terms are always manual: they have no entry here. The write goes through care.applyOp.

const DOC_DIRS = ['', '.github', 'docs'];
const DOC_EXTS = ['', '.md', '.txt', '.rst'];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,60}$/;
const SCRIPT_RE = /^[A-Za-z0-9][\w:.-]{0,40}$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]{0,80}$/;
const CONTACT = '<CONTACT EMAIL>';
const OWNER = '<GITHUB USER OR TEAM>';
const TEST_CMD = '<TEST COMMAND>';

const ECOSYSTEM_OF_KIND = { node: 'npm', php: 'composer', dart: 'pub' };
// ponytail: closed table of the ecosystems dependabot understands that we can detect; anything else is ignored.
const ECOSYSTEMS = new Set(['npm', 'composer', 'pub', 'github-actions', 'pip', 'cargo', 'gomod', 'bundler', 'docker']);

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// Does a document with one of these base names exist (any case, root, .github or docs, with or without extension)?
function hasDoc(files, names) {
  const want = new Set();
  for (const d of DOC_DIRS) for (const n of names) for (const e of DOC_EXTS) want.add(`${d ? d + '/' : ''}${n}${e}`.toLowerCase());
  return files.some((f) => want.has(f.toLowerCase()));
}
const hasExact = (files, paths) => files.some((f) => paths.includes(f.toLowerCase()));
const hasUnder = (files, prefix) => files.some((f) => f.toLowerCase().startsWith(prefix));

function clean(input) {
  const i = input && typeof input === 'object' ? input : {};
  const files = (Array.isArray(i.files) ? i.files : []).filter((f) => typeof f === 'string').map(norm);
  const packages = (Array.isArray(i.packages) ? i.packages : []).filter((p) => p && typeof p === 'object');
  const rootPkg = packages.find((p) => !p.dir || p.dir === '.' || p.dir === '');
  const loose = i.scripts && typeof i.scripts === 'object' && !Array.isArray(i.scripts);
  const rawScripts = loose ? i.scripts : (rootPkg?.scripts && typeof rootPkg.scripts === 'object' ? rootPkg.scripts : {});
  const scripts = Object.keys(rawScripts).filter((k) => SCRIPT_RE.test(k));
  // Who runs the scripts depends on where they came from: loose scripts without a root package are Node's only when
  // package.json sits at the root; any other origin is unknown and gets no command.
  const scriptsKind = rootPkg ? rootPkg.kind : loose && files.includes('package.json') ? 'node' : null;
  const envNames = [...new Set((Array.isArray(i.envNames) ? i.envNames : []).filter((n) => typeof n === 'string' && ENV_RE.test(n)))].sort();
  const projectName = typeof i.projectName === 'string' && NAME_RE.test(i.projectName.trim()) ? i.projectName.trim() : 'this project';
  const ecosystems = (Array.isArray(i.ecosystems) ? i.ecosystems : []).filter((e) => ECOSYSTEMS.has(e));
  return { files, packages, scripts, scriptsKind, envNames, projectName, ecosystems };
}

const out = (item, files, placeholders = []) => ({
  files,
  why: { msg: 'health.draft.create', params: { item, paths: files.map((f) => f.path) } },
  placeholders,
});

// The command that runs a script, or null when the program does not know the runner (dart, unknown origin).
function runnerOf(c) {
  if (c.scriptsKind === 'php') return (s) => `composer run ${s}`;
  if (c.scriptsKind !== 'node') return null;
  if (c.files.includes('pnpm-lock.yaml')) return (s) => `pnpm run ${s}`;
  if (c.files.includes('yarn.lock')) return (s) => `yarn ${s}`;
  return (s) => `npm run ${s}`;
}

function security(c) {
  if (hasDoc(c.files, ['security'])) return null;
  const after = `# Security policy

If you find a security problem in ${c.projectName}, please report it privately and do not open a public issue.

## How to report

Write to ${CONTACT} with a short description of the problem and the steps to reproduce it.
If the host of this repository offers private vulnerability reporting, you can use it instead.

## What to include

- What you found and where.
- How to reproduce it.
- What you think the impact is.

## What happens next

The maintainers read every report, work on a fix and say when it is available.
`;
  return out('community.security', [{ path: 'SECURITY.md', after }], [CONTACT]);
}

function conduct(c) {
  if (hasDoc(c.files, ['code_of_conduct', 'code-of-conduct'])) return null;
  const after = `# Code of conduct

We want ${c.projectName} to be a respectful place for everyone who takes part.

## What we expect

- Be kind and patient with other people.
- Give and accept feedback about the work, not about the person.
- Assume good intentions and ask when something is unclear.

## What is not accepted

- Insults, harassment and personal attacks.
- Publishing other people's private information.
- Any behavior that makes others feel unwelcome.

## Reporting a problem

Write to ${CONTACT}. Reports are read privately and taken seriously.
`;
  return out('community.code_of_conduct', [{ path: 'CODE_OF_CONDUCT.md', after }], [CONTACT]);
}

function contributing(c) {
  if (hasDoc(c.files, ['contributing'])) return null;
  const run = runnerOf(c);
  const has = (s) => Boolean(run) && c.scripts.includes(s);
  const hasTest = has('test');
  const steps = [];
  if (has('dev')) steps.push(`- Start it while you work: \`${run('dev')}\`.`);
  else if (has('start')) steps.push(`- Start it while you work: \`${run('start')}\`.`);
  if (has('lint')) steps.push(`- Check the style: \`${run('lint')}\`.`);
  if (has('build')) steps.push(`- Build it: \`${run('build')}\`.`);
  steps.push(hasTest ? `- Run the tests: \`${run('test')}\`.` : `- Run the tests: \`${TEST_CMD}\`.`);
  const after = `# Contributing to ${c.projectName}

Thank you for helping. A small change that is easy to review is the best kind.

## Before you start

- Open an issue (or comment on an existing one) to talk about bigger changes first.
- Keep one subject per pull request.

## Working on a change

${steps.join('\n')}

## Sending the pull request

1. Make sure the tests pass.
2. Describe what changed and why in the pull request.
3. Answer the review comments; the maintainers will merge when it is ready.
`;
  return out('community.contributing', [{ path: 'CONTRIBUTING.md', after }], hasTest ? [] : [TEST_CMD]);
}

function support(c) {
  if (hasDoc(c.files, ['support'])) return null;
  const after = `# Getting help

Questions about using ${c.projectName} are welcome.

- Read the README and the documents in this repository first.
- Search the existing issues; your question may already have an answer.
- Otherwise open a new issue, or write to ${CONTACT}.

For security problems, use the security policy instead of a public issue.
`;
  return out('community.support', [{ path: 'SUPPORT.md', after }], [CONTACT]);
}

const BUG = `name: Bug report
description: Something does not work as expected
labels: ["bug"]
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: What did you expect, and what happened instead?
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Version
`;
const FEATURE = `name: Feature request
description: Suggest an idea
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem would this solve?
    validations:
      required: true
  - type: textarea
    id: idea
    attributes:
      label: What would you like to happen?
`;

function issueTemplates(c) {
  if (hasUnder(c.files, '.github/issue_template/') || hasExact(c.files, ['.github/issue_template.md', 'issue_template.md', 'docs/issue_template.md'])) return null;
  return out('community.issue_templates', [
    { path: '.github/ISSUE_TEMPLATE/bug_report.yml', after: BUG },
    { path: '.github/ISSUE_TEMPLATE/feature_request.yml', after: FEATURE },
  ]);
}

function prTemplate(c) {
  if (hasDoc(c.files, ['pull_request_template', 'pull-request-template'])) return null;
  const after = `## What changed

<!-- A short description of the change and why it is needed. -->

## How to check

<!-- How can a reviewer see that it works? -->

## Checklist

- [ ] The tests pass
- [ ] The documentation is updated, if needed
`;
  return out('community.pr_template', [{ path: '.github/pull_request_template.md', after }]);
}

function codeowners(c) {
  if (hasExact(c.files, ['codeowners', '.github/codeowners', 'docs/codeowners'])) return null;
  const after = `# Who reviews what. Replace the marker below and remove the leading "#" to turn the rule on.
# The pattern on the left is a path; the owner on the right is a user or a team.
# * @${OWNER}
`;
  return out('community.codeowners', [{ path: '.github/CODEOWNERS', after }], [OWNER]);
}

function updateBot(c) {
  if (hasExact(c.files, ['.github/dependabot.yml', '.github/dependabot.yaml', 'renovate.json', '.github/renovate.json', '.renovaterc', '.renovaterc.json'])) return null;
  const seen = new Set();
  const entries = [];
  const add = (eco, dir) => {
    const key = `${eco} ${dir}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ eco, dir });
  };
  for (const p of c.packages) {
    const eco = ECOSYSTEM_OF_KIND[p.kind];
    const d = typeof p.dir === 'string' ? norm(p.dir).replace(/^\.$|^\/+|\/+$/g, '') : '';
    // A scoped dir (packages/@acme/ui) is fine; "@" followed by a domain looks like an e-mail and stays out.
    if (eco && /^[\w./@-]*$/.test(d) && !/@[\w-]+\.[a-z]/i.test(d) && !d.split('/').includes('..')) add(eco, `/${d}`);
  }
  for (const e of c.ecosystems) add(e, '/');
  if (!entries.length) return null;
  const after = `version: 2
updates:
${entries.map((e) => `  - package-ecosystem: "${e.eco}"
    directory: "${e.dir}"
    schedule:
      interval: "weekly"
`).join('')}`;
  return out('security.update_bot', [{ path: '.github/dependabot.yml', after }]);
}

function editorconfig(c) {
  if (hasExact(c.files, ['.editorconfig'])) return null;
  const after = `root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
`;
  return out('hygiene.editorconfig', [{ path: '.editorconfig', after }]);
}

function gitignore(item, c) {
  if (hasExact(c.files, ['.gitignore'])) return null;
  const kinds = new Set(c.packages.map((p) => p.kind));
  if (c.files.some((f) => f.endsWith('package.json'))) kinds.add('node');
  if (c.files.some((f) => f.endsWith('composer.json'))) kinds.add('php');
  if (c.files.some((f) => f.endsWith('pubspec.yaml'))) kinds.add('dart');
  const lines = ['# Secrets and keys', '.env', '.env.*', '!.env.example', '*.pem', '*.key', '', '# Editors and system', '.DS_Store', 'Thumbs.db', '.idea/', '.vscode/', '*.log'];
  if (kinds.has('node')) lines.push('', '# Node', 'node_modules/', 'dist/', 'build/', 'coverage/');
  if (kinds.has('php')) lines.push('', '# PHP', 'vendor/', 'storage/logs/');
  if (kinds.has('dart')) lines.push('', '# Dart and Flutter', '.dart_tool/', 'build/', '.packages');
  return out(item, [{ path: '.gitignore', after: lines.join('\n') + '\n' }]);
}

function envExample(c) {
  if (hasExact(c.files, ['.env.example', '.env.sample', '.env.dist', '.env.template'])) return null;
  if (!c.envNames.length) return null;
  const after = `# Names only. Copy this file to .env and fill in your own values; never commit the real file.
${c.envNames.map((n) => `${n}=`).join('\n')}
`;
  return out('hygiene.env_example', [{ path: '.env.example', after }]);
}

function changelog(c) {
  if (hasDoc(c.files, ['changelog', 'changes', 'history'])) return null;
  const after = `# Changelog

All notable changes to ${c.projectName} are listed here, newest first.
The format follows Keep a Changelog.

## [Unreleased]

### Added

### Changed

### Fixed

## [<VERSION>] - <DATE>

### Added

- <WHAT CHANGED>
`;
  // The program never invents a version or a date: the first release section stays as markers ("fail placeholder").
  return out('releases.changelog', [{ path: 'CHANGELOG.md', after }], ['<VERSION>', '<DATE>', '<WHAT CHANGED>']);
}

const DRAFTS = {
  'community.security': security,
  'community.code_of_conduct': conduct,
  'community.contributing': contributing,
  'community.support': support,
  'community.issue_templates': issueTemplates,
  'community.pr_template': prTemplate,
  'community.codeowners': codeowners,
  'security.update_bot': updateBot,
  'hygiene.editorconfig': editorconfig,
  'hygiene.gitignore': (c) => gitignore('hygiene.gitignore', c),
  'security.gitignore_secrets': (c) => gitignore('security.gitignore_secrets', c),
  'hygiene.env_example': envExample,
  'releases.changelog': changelog,
};

// null = no draft: the item is manual (LICENSE, privacy, terms, ...), or the file already exists, or nothing is known to fill it.
export function draftFor(itemId, input) {
  const make = Object.hasOwn(DRAFTS, itemId) ? DRAFTS[itemId] : null;
  return make ? make(clean(input)) : null;
}
