// What a project chat reads first (orchestration or01, first step): a compact summary of the whole project built from the
// state, never the history of its conversations. Pure: it receives the project and returns text.
// Keep code-shaped tokens out of the fixed texts: the transcript reader counts them as item codes.

// The whole summary, in bytes: a first message that stays cheap however big the project grows.
export const PROJECT_CONTEXT_MAX = 3800;
const LINE_MAX = 160;
const ABOUT_MAX = 110;
const DECIDED_CHATS = 8;
const VERSIONS_MAX = 5;
// Each list's share of what the fixed texts leave.
const SHARE = { arch: 0.44, working: 0.13, waiting: 0.13, decided: 0.1, changes: 0.14, versions: 0.06 };
// The blank line between two sections.
const SEPARATOR = 2;

const size = (s) => Buffer.byteLength(s, 'utf8');
const oneLine = (s, max = LINE_MAX) => {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const day = (ts) => (typeof ts === 'string' ? ts.slice(0, 10) : '');

// rows: [{text, counted}]. The rows that fit the budget and, when some are left out, the line counting them, which fits
// the budget too: rows give way to it.
function fit(rows, budget, more) {
  const kept = [];
  let used = 0;
  for (const row of rows) {
    if (used + size(row.text) + 1 > budget) break;
    kept.push(row);
    used += size(row.text) + 1;
  }
  while (kept.length < rows.length) {
    const left = rows.slice(kept.length).filter((r) => r.counted).length;
    if (!left) break;
    const line = more(left);
    if (used + size(line) + 1 <= budget) return [...kept.map((r) => r.text), line];
    if (!kept.length) break;
    used -= size(kept.pop().text) + 1;
  }
  return kept.map((r) => r.text);
}

function openCount(part) {
  const items = part.groups.flatMap((g) => g.items).filter((i) => i.status !== 'done');
  const doing = items.filter((i) => i.status === 'doing').length;
  if (!items.length) return 'nothing open';
  return doing ? `${items.length} open, ${doing} in progress` : `${items.length} open`;
}

function archRows(arch) {
  const partLine = (p) => ({ text: `- ${p.name}${p.about ? `: ${oneLine(p.about, ABOUT_MAX)}` : ''} (${openCount(p)})`, counted: true });
  const placed = new Set(arch.layers.flatMap((l) => l.partIds));
  const rows = arch.layers.flatMap((l) => [
    { text: `${l.name}:`, counted: false },
    ...l.partIds.map((id) => arch.parts.find((p) => p.id === id)).filter(Boolean).map(partLine),
  ]);
  const rest = arch.parts.filter((p) => !placed.has(p.id));
  if (rest.length) rows.push({ text: 'Other parts:', counted: false }, ...rest.map(partLine));
  return rows;
}

// A titled list inside its budget, the title included.
function section(title, rows, budget, more) {
  const lines = fit(rows, budget - size(title) - 1, more);
  return lines.length ? `${title}\n${lines.join('\n')}` : null;
}
const counted = (texts) => texts.map((text) => ({ text, counted: true }));

// project: the state's project. rule: the upkeep text of the map (context.mjs), or null when there is no map.
export function projectSections(project, rule) {
  const { arch } = project;
  const hasArch = Boolean(arch && arch.source !== 'none');
  const partName = (id) => arch?.parts.find((p) => p.id === id)?.name ?? null;
  const chats = (project.chats ?? []).filter((c) => !c.archived);
  const head = [
    `Project: ${project.name}`,
    'This is a chat about the whole project, opened at its root folder. What follows is a compact summary from session-map, not the history of its conversations: read the files when you need detail.',
    hasArch ? null : 'This project has no architecture map yet.',
  ].filter(Boolean).join('\n');
  // The blank line before each section after the head is counted here, so each share holds only its own section.
  const fixed = size(head) + (rule ? size(rule) : 0) + SEPARATOR * (Object.keys(SHARE).length + 1);
  const room = Math.max(0, PROJECT_CONTEXT_MAX - fixed);
  const budget = (name) => Math.floor(room * SHARE[name]);

  const working = counted([
    ...chats.filter((c) => c.status === 'busy').map((c) => `- Conversation "${oneLine(c.title, 80)}"${c.card?.doing ? `: ${oneLine(c.card.doing)}` : ''}`),
    ...(hasArch ? arch.parts.flatMap((p) => p.groups.flatMap((g) => g.items).filter((i) => i.status === 'doing').map((i) => `- Item in progress: ${oneLine(i.title)} (${p.name})`)) : []),
  ]);
  const waiting = counted([
    ...(project.decisions ?? []).map((d) => `- ${oneLine(d.text)}${d.partId && partName(d.partId) ? ` (${partName(d.partId)})` : ''}`),
    ...chats.filter((c) => c.status !== 'busy' && (c.waiting?.strong || c.waiting?.weak)).map((c) => `- Conversation "${oneLine(c.title, 80)}" asks you something`),
  ]);
  const newest = [...chats].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))).slice(0, DECIDED_CHATS);
  const decided = counted([...new Set(newest.flatMap((c) => (Array.isArray(c.card?.decided) ? c.card.decided : [])).filter((d) => typeof d === 'string').map((d) => oneLine(d)))].map((d) => `- ${d}`));
  const activity = project.activity ?? [];
  const changes = counted(activity.filter((a) => (a.kind === 'commit' || a.kind === 'merge') && a.subject).map((a) => `- ${day(a.ts)} ${oneLine(a.subject)}`));
  const tags = activity.filter((a) => a.kind === 'tag' && a.subject).slice(0, VERSIONS_MAX).map((a) => oneLine(a.subject, 40));
  const versions = tags.length ? fit([{ text: `Versions: ${tags.join(', ')}`, counted: false }], budget('versions'), () => '') : [];
  const more = (what) => (n) => `- … and ${n} more ${what}`;

  return [
    head,
    hasArch ? section(`Architecture map (${arch.dir}/), by layer, with the open items of each part:`, archRows(arch), budget('arch'), (n) => `… and ${n} more parts (see ${arch.dir}/README.md)`) : null,
    section('Working now:', working, budget('working'), more('running')),
    section('Waiting for you:', waiting, budget('waiting'), more('waiting')),
    section('Recent decisions:', decided, budget('decided'), more('decisions')),
    section('Last changes:', changes, budget('changes'), more('changes')),
    versions.length ? versions.join('\n') : null,
    rule,
  ].filter(Boolean);
}
