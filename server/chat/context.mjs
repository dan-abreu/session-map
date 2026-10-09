// What a chat opened on a point of the architecture map reads first (desenho-3 § 3): where it is, what the point holds,
// and the rule that keeps the map true. Pure: it receives the project and returns text.
// Keep code-shaped tokens out of the fixed texts: the transcript reader counts them as item codes and places the chat by them.

const KINDS = new Set(['layer', 'part', 'group', 'item', 'idea', 'create-arch']);
const LIST_MAX = 40;

const WORDS = {
  pt: { missing: 'O que falta', doing: 'em andamento' },
  en: { missing: "What's missing", doing: 'in progress' },
};

const fail = (status, error) => ({ error, status });
const layerOf = (arch, partId) => arch.layers.find((l) => l.partIds.includes(partId)) ?? null;
const itemLine = (i) => `- [${i.status === 'done' ? 'x' : ' '}] ${i.title}${i.code ? ` \`${i.code}\`` : ''}`;

// idea: the "Nova ideia" chat writes its item only after the person's OK, so the rule that a new request becomes an
// item before the work starts stays out of it.
function upkeep(arch, { idea = false } = {}) {
  const w = WORDS[arch.lang] ?? WORDS.en;
  if (arch.source !== 'worktree') {
    return [
      `This project's architecture map is read from its main branch (${arch.dir}/); it is not in this folder, so do not edit it here.`,
      'If the work changes what is planned, say in your reply which item should be added, started or closed.',
    ].join('\n');
  }
  return [
    `This project keeps its plan in ${arch.dir}/ (the session-map:architecture convention): one file per part, the open work under "## ${w.missing}".`,
    !idea && `- Something new the person asks for becomes an item in that section of the right part before you start: \`- [ ] what to do\` ending with its code in backticks, under a \`###\` group if one fits. The code is the prefix the part's items use plus the next number in the folder.`,
    `- When you start an item, put \`**${w.doing}:**\` in front of its text, or add \`${w.doing}\` as the first token of the bold prefix it already has (tokens are separated by \` · \`). When it is done, tick it: \`- [x]\`.`,
    '- Keep the rest of the file as it is, and cite the item\'s code in your replies.',
  ].filter(Boolean).join('\n');
}

function ideaText(arch) {
  const w = WORDS[arch.lang] ?? WORDS.en;
  const here = arch.source === 'worktree';
  const parts = arch.parts.slice(0, LIST_MAX).map((p) => `- ${p.name}: ${p.file}`);
  return [
    'The person has a new idea for this project. Place it in the architecture map before anything else:',
    here
      ? `1. Read ${arch.dir}/README.md and the files of the parts that could hold it.`
      : '1. Pick the parts that could hold it from the list below; their files are on the main branch, not in this folder.',
    '2. Say which part it belongs to (or propose a new part, with its layer) and which group, and why, in a few lines.',
    `3. Show the exact item line you would add under "## ${w.missing}".`,
    here
      ? '4. Write it only after the person says OK. Do not start building the idea unless they ask.'
      : '4. Show the line and say where it goes; do not edit here. Do not start building the idea unless they ask.',
    '',
    `Parts:\n${parts.join('\n')}`,
  ].join('\n');
}

const CREATE_TEXT = [
  'This project has no architecture map yet, and the person wants one in the session-map convention:',
  '1. Study the repository: its folders, its docs and how the code is split.',
  '2. Propose in this chat the layers and, for each, its parts: one line per part with its name, what it is and its main folders.',
  '3. Wait for the person\'s OK. Write nothing before it, and change the list if they ask.',
  '4. Then write the folder docs/architecture/ (docs/arquitetura/ if the project\'s docs are written in Portuguese):',
  '   - README.md: what the map is, a mermaid flowchart where each layer is `subgraph id["Layer name"]` holding one node `ID[Part name]` per part, and a list linking each part to its file: `[Part name](part-file.md)`.',
  '   - One file per part, named after the part in lowercase with dashes (never README.md, in any case: on Windows it would replace the map\'s README): `# Part name`, an opening paragraph saying what it is, then "## How it works", "## Where in the code" (paths in backticks, relative to the repository root), "## Rules that must not break" and "## What\'s missing" with items `- [ ] what to do` that end with a code in backticks, the code being two or three letters of the part plus a number.',
  '   - In Portuguese the sections are "## Como funciona", "## Onde está no código", "## Regras que não podem quebrar" and "## O que falta".',
  '5. Do not change anything outside that folder.',
].join('\n');

function findItem(part, node) {
  for (const group of part.groups) {
    const item = group.items.find((i) => (node.code ? i.code === node.code : Number.isInteger(node.line) && i.line === node.line));
    if (item) return { group, item };
  }
  return null;
}

function partSections(project, part, extra) {
  const { arch } = project;
  const path = [project.name, layerOf(arch, part.id)?.name, part.name, ...extra.path].filter(Boolean).join(' › ');
  return [
    `Point on the architecture map: ${path}`,
    `Part of the architecture: ${part.name}${part.about ? ` (${part.about})` : ''}\nPart file: ${part.file}`,
    ...extra.sections,
    upkeep(arch),
  ];
}

// node: {kind, partId?, layerId?, group?, code?, line?} → {sections, part} or {error, status}.
export function contextOf(project, node) {
  if (!node || typeof node !== 'object' || !KINDS.has(node.kind)) return fail(400, 'bad-node');
  const { arch } = project;
  const hasArch = arch && arch.source !== 'none';
  if (node.kind === 'create-arch') return hasArch ? fail(409, 'arch-exists') : { sections: [CREATE_TEXT], part: null };
  if (!hasArch) return fail(409, 'no-arch');
  if (node.kind === 'idea') return { sections: [`Project: ${project.name}`, ideaText(arch), upkeep(arch, { idea: true })], part: null };
  if (node.kind === 'layer') {
    const layer = arch.layers.find((l) => l.id === node.layerId);
    if (!layer) return fail(404, 'unknown-layer');
    const parts = layer.partIds.map((id) => arch.parts.find((p) => p.id === id)).filter(Boolean).map((p) => `- ${p.name}: ${p.file}`);
    return { sections: [`Point on the architecture map: ${project.name} › ${layer.name}`, `Layer: ${layer.name}. Its parts:\n${parts.join('\n')}`, upkeep(arch)], part: null };
  }
  const part = arch.parts.find((p) => p.id === node.partId);
  if (!part) return fail(404, 'unknown-part');
  if (node.kind === 'part') return { sections: partSections(project, part, { path: [], sections: [] }), part };
  if (node.kind === 'group') {
    const group = part.groups.find((g) => g.name === node.group);
    if (!group) return fail(404, 'unknown-group');
    const open = group.items.filter((i) => i.status !== 'done').slice(0, LIST_MAX).map(itemLine);
    return { sections: partSections(project, part, { path: [group.name], sections: [`Group: ${group.name || '(no group)'}${open.length ? `\n${open.join('\n')}` : ''}`] }), part };
  }
  const found = findItem(part, node);
  if (!found) return fail(404, 'unknown-item');
  const { group, item } = found;
  const facts = [item.status === 'doing' ? 'in progress' : item.status === 'done' ? 'done' : 'to do', item.who && `with: ${item.who}`, item.weight && `weight: ${item.weight}`, item.milestone && `step ${item.milestone}`].filter(Boolean);
  const lines = [`Item${item.code ? ` \`${item.code}\`` : ''}: ${item.title}`, `State: ${facts.join(' · ')}`, ...item.detail.map((d) => `- ${d}`)];
  return { sections: partSections(project, part, { path: [group.name], sections: [lines.join('\n')] }), part };
}
