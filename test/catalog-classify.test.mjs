import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, TYPES, classifyRepo } from '../server/catalog-classify.mjs';

const repo = (name, description, topics = []) => ({ name, description, topics });

const CASES = [
  ['a marketplace file wins over plugin files', repo('acme-toolbox', 'Our team plugins', ['claude-code-plugin']),
    ['.claude-plugin/marketplace.json', '.claude-plugin/plugin.json', 'skills/x/SKILL.md'], { type: 'marketplace', category: 'other' }],
  ['a plugin manifest makes a plugin; design words give the category', repo('pixel-polish', 'Polish UI layouts, typography and color palettes', []),
    ['.claude-plugin/plugin.json', 'commands/polish.md'], { type: 'plugin', category: 'design' }],
  ['an .mcp.json or an mcp topic makes an MCP server', repo('pg-bridge', 'Let the assistant query your Postgres database', ['mcp-server']),
    ['package.json', 'src/index.ts'], { type: 'mcp', category: 'data' }],
  ['hooks without a plugin manifest are hooks', repo('guard-rails', 'Block secret leaks and unsafe shell commands before they run', ['claude-code-hooks']),
    ['hooks/pre-tool.sh', 'hooks.json'], { type: 'hook', category: 'security' }],
  ['an agents folder makes agents', repo('review-crew', 'Subagents that write unit tests and review pull requests', ['subagents']),
    ['agents/reviewer.md', 'agents/tester.md'], { type: 'agent', category: 'testing' }],
  ['a SKILL.md at the root makes a skill', repo('plain-writer', 'Write clear docs, READMEs and blog posts', ['claude-skills']),
    ['SKILL.md', 'README.md'], { type: 'skill', category: 'writing' }],
  ['topics alone decide when no files are known', repo('deploy-helper', 'Docker, Kubernetes and CI pipelines made easy', ['claude-code-skills']),
    [], { type: 'skill', category: 'devops' }],
  ['nothing matches: other and other', repo('misc-notes', 'Random notes about my setup', ['claude-code']),
    ['README.md'], { type: 'other', category: 'other' }],
];

for (const [name, r, files, expected] of CASES) {
  test(`classifyRepo: ${name}`, () => assert.deepEqual(classifyRepo(r, files), expected));
}

test('classifyRepo does not match keywords inside other words', () => {
  // "ui" inside "build" and "rag" inside "storage" must not count.
  assert.equal(classifyRepo(repo('x', 'build storage', []), []).category, 'other');
});

test('classifyRepo tolerates missing fields', () => {
  assert.deepEqual(classifyRepo({ name: 'x' }, undefined), { type: 'other', category: 'other' });
});

test('every classification result is a listed type and category', () => {
  for (const [, r, files] of CASES) {
    const out = classifyRepo(r, files);
    assert.ok(TYPES.includes(out.type));
    assert.ok(CATEGORIES.includes(out.category));
  }
});

// Shaped like real catalog entries: almost every repo says claude, ai, agent, skill or plugin somewhere.
const REALISTIC = [
  [repo('lazy-senior', 'Makes your AI agent think like the laziest senior dev. The best code is the code you never write.', ['agent-skills', 'ai-agents', 'claude', 'claude-code', 'claude-code-plugin', 'llm', 'yagni', 'refactoring']), 'code'],
  [repo('agent-recall', 'Persistent memory across sessions for every agent, with embeddings and RAG', ['ai', 'ai-agents', 'ai-memory', 'claude', 'claude-code-plugin', 'long-term-memory']), 'ai'],
  [repo('growth-kit', 'Marketing skills for Claude Code and AI agents. CRO, copywriting, SEO and growth', ['agent-skills', 'ai-agents', 'claude', 'claude-code-plugin', 'marketing', 'seo']), 'marketing'],
  [repo('short-films', 'Claude Code skill for short films with no video model: film styles and ffmpeg', ['agent-skills', 'ai-agents', 'ai-video', 'claude', 'claude-code-plugin', 'video-production']), 'media'],
  [repo('safety-net', 'A pre-execution guard for AI coding agents that blocks destructive git commands', ['ai-agents', 'ai-safety', 'claude', 'claude-code-plugin', 'security', 'guardrails']), 'security'],
  [repo('mission-control', 'Self-hosted mission control for AI coding agents: sessions, terminal and tmux in a web dashboard', ['agent', 'ai-agents', 'claude', 'claude-code-plugin', 'session-manager', 'terminal', 'tmux']), 'workflow'],
  [repo('recall-cards', 'Evidence-based learning engine with spaced repetition', ['claude-code', 'claude-code-plugin', 'education', 'learning']), 'education'],
  [repo('plain-agent', 'An agent plugin for Claude with skills', ['ai', 'agent', 'claude', 'llm', 'skills']), 'other'],
];

for (const [r, category] of REALISTIC) {
  test(`classifyRepo ignores generic words: ${r.name} is ${category}`, () => assert.equal(classifyRepo(r, []).category, category));
}

test('the Discover tab offers exactly the categories the classifier can give', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../server/web/discover.js', import.meta.url), 'utf8');
  const listed = JSON.parse(/const CATEGORIES = (\[[^\]]*\])/.exec(src)[1].replaceAll("'", '"'));
  assert.deepEqual([...listed].sort(), [...CATEGORIES].sort());
});
