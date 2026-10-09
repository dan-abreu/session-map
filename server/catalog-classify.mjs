export const TYPES = ['marketplace', 'plugin', 'mcp', 'hook', 'agent', 'skill', 'other'];

// A leading "=" asks for the whole word; the rest match from the start of a word ("typograph" → "typography").
const CATEGORY_KEYWORDS = {
  design: ['design', '=ui', '=ux', 'css', 'figma', 'typograph', 'color', 'palette', 'layout', 'frontend', 'landing', 'accessib', 'brand', 'animation'],
  security: ['secur', 'secret', 'vulnerab', 'owasp', '=cve', 'pentest', 'malware', 'threat', 'leak', 'unsafe', 'exploit', 'audit', 'crypto'],
  testing: ['test', 'tdd', 'unit', '=qa', 'coverage', '=e2e', 'playwright', 'jest', 'pytest', 'regression'],
  writing: ['writ', '=docs', '=doc', 'documentation', 'document', 'readme', 'blog', 'markdown', 'copywrit', 'essay', 'prose', 'changelog'],
  data: ['data', '=sql', 'postgres', 'mysql', 'sqlite', 'mongo', '=csv', 'analytics', 'spreadsheet', 'excel', '=etl', 'pandas', 'dashboard'],
  devops: ['devops', 'docker', 'kubernetes', '=k8s', 'deploy', '=ci', '=cd', 'pipeline', 'terraform', '=aws', 'cloud', 'infrastructure'],
  product: ['product', 'roadmap', '=prd', 'backlog', '=pm', 'startup', 'strateg', 'prioriti', '=okr', 'persona', 'jira', 'stakeholder'],
  ai: ['agent', '=llm', 'prompt', '=ai', '=rag', 'embedding', 'orchestrat', 'multi-agent', 'memory', '=gpt'],
};

export const CATEGORIES = [...Object.keys(CATEGORY_KEYWORDS), 'other'];

const matcher = (keyword) => new RegExp(String.raw`\b${keyword.replace(/^=/, '')}${keyword.startsWith('=') ? String.raw`\b` : ''}`);
const MATCHERS = Object.entries(CATEGORY_KEYWORDS).map(([category, words]) => [category, words.map(matcher)]);

function categoryOf(text) {
  let best = 'other';
  let bestScore = 0;
  for (const [category, matchers] of MATCHERS) {
    const score = matchers.filter((m) => m.test(text)).length;
    if (score > bestScore) [best, bestScore] = [category, score];
  }
  return best;
}

// repo: {name, description, topics}; files: paths or top-level names seen in the repository (may be empty).
// Pure: the page's filters and badges come from here, so there is no model call and no network.
export function classifyRepo(repo, files = []) {
  const topics = (repo.topics ?? []).map((tp) => tp.toLowerCase());
  const name = String(repo.name ?? '').toLowerCase();
  const paths = new Set(files.map((f) => f.toLowerCase()));
  const hasPath = (p) => paths.has(p);
  const hasDir = (dir) => [...paths].some((f) => f === dir || f.startsWith(`${dir}/`));
  const topic = (re) => topics.some((tp) => re.test(tp));

  let type = 'other';
  if (hasPath('.claude-plugin/marketplace.json')) type = 'marketplace';
  else if (hasPath('.claude-plugin/plugin.json') || topic(/^claude-code-plugins?$/)) type = 'plugin';
  else if (hasPath('.mcp.json') || topic(/^(mcp|mcp-server|model-context-protocol)$/) || /(^|[-_])mcp([-_]|$)/.test(name)) type = 'mcp';
  else if (hasPath('hooks.json') || hasDir('hooks') || topic(/hooks?$/)) type = 'hook';
  else if (hasDir('agents') || topic(/^(subagents?|claude-code-(sub)?agents)$/)) type = 'agent';
  else if (paths.has('skill.md') || hasDir('skills') || topic(/skills?$/)) type = 'skill';

  const text = [name, repo.description ?? '', ...topics].join(' ').toLowerCase();
  return { type, category: categoryOf(text) };
}
