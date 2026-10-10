// Workflows you can trace (mind-map-page mm31): each workflow of a conversation tied to the request that launched it (the
// owner's words and the map item they name), every agent placed on the project and part of the file it is on, the files
// and commits it made, and the version that carries each commit. The page reads only repository paths, never the PC's.
import { placer } from './footprint.mjs';
import { normalizePath } from './paths.mjs';
import { tagsFor } from './changes-state.mjs';

const FILES_MAX = 12;

// The first code of the request that names an item on a map, looking in the projects in order: {projectId, partId, code}.
function itemOfCodes(codes, projects) {
  for (const code of codes ?? []) {
    for (const { id, arch } of projects) {
      for (const part of arch?.parts ?? []) {
        const item = (part.groups ?? []).flatMap((g) => g.items ?? []).find((i) => String(i.code ?? '').toLowerCase() === code);
        if (item) return { projectId: id, partId: part.id, code: item.code };
      }
    }
  }
  return null;
}

// w: one workflow from readWorkflows; launch: the request of its run (summary.launches) or null; items: [{id, arch}], the
// project the conversation is listed in first; place(absolutePath) → {projectId, name, partId, path} | null;
// commitOf(commit) → {projectId, tag} | null.
export function workflowView(w, { launch, items, place, commitOf }) {
  const agents = w.agents.map(({ lastFile, editedFiles, commits, ...agent }) => {
    const files = editedFiles.map(place).filter(Boolean);
    return {
      ...agent,
      place: lastFile ? place(lastFile) : null,
      files: files.slice(0, FILES_MAX),
      fileCount: files.length,
      commits: commits.map((c) => ({ ...c, projectId: null, tag: null, ...commitOf(c) })),
      allFiles: files,
    };
  });
  const places = new Map();
  for (const f of agents.flatMap((a) => a.allFiles)) {
    const p = places.get(f.projectId) ?? { projectId: f.projectId, name: f.name, paths: new Set(), partIds: new Set() };
    p.paths.add(f.path);
    if (f.partId) p.partIds.add(f.partId);
    places.set(f.projectId, p);
  }
  return {
    ...w,
    request: launch ? { text: launch.text, ts: launch.ts, item: itemOfCodes(launch.codes, items) } : null,
    agents: agents.map(({ allFiles, ...a }) => a),
    places: [...places.values()].map((p) => ({ projectId: p.projectId, name: p.name, files: p.paths.size, partIds: [...p.partIds] })),
  };
}

// Hangs the trace on every conversation's workflows, in the project it is listed in. built: [{project, key, ownersOf,
// commits}] from collect; groups: [{root, items}]; skip: folders whose files never count. Visitors copy the chat's
// workflows later, so this runs before the footprints are hung.
export async function hangWorkflows(built, groups, { skip, nowMs }) {
  const homes = new Map(built.map((b) => [b.key, b]));
  const byKey = (root) => homes.get(normalizePath(root));
  const commitsOf = (b) => b.commits ?? [];
  const tagWanted = new Map();
  const commitHome = (c) => {
    for (const b of built) {
      const hit = commitsOf(b).find((a) => (c.hash ? a.hash?.startsWith(c.hash) : a.subject === c.subject));
      if (hit) return { b, hash: hit.hash };
    }
    return null;
  };
  const jobs = [];
  for (const g of groups) {
    const b = byKey(g.root);
    if (!b) continue;
    const chats = new Map(b.project.chats.map((c) => [c.sessionId, c]));
    for (const item of g.items) {
      const chat = chats.get(item.summary.sessionId);
      if (!chat?.workflows?.length) continue;
      jobs.push({ b, item, chat });
      for (const c of chat.workflows.flatMap((w) => w.agents ?? []).flatMap((a) => a.commits)) {
        const home = commitHome(c);
        if (home?.hash) tagWanted.set(home.b, [...(tagWanted.get(home.b) ?? []), home.hash]);
      }
    }
  }
  const tags = new Map();
  for (const [b, hashes] of tagWanted) tags.set(b, await tagsFor(b.project.root, [...new Set(hashes)], nowMs));
  const commitOf = (c) => {
    const home = commitHome(c);
    return home ? { projectId: home.b.project.id, tag: (home.hash && tags.get(home.b)?.get(home.hash)) ?? null } : null;
  };
  for (const { b, item, chat } of jobs) {
    const s = item.summary;
    const place = placer({ root: b.project.root, cwd: s.cwd, skip });
    const placeFile = (file) => {
      const hit = place(file);
      const home = hit && byKey(hit.home);
      return home ? { projectId: home.project.id, name: home.project.name, partId: home.ownersOf([hit.rel])[0] ?? null, path: hit.rel } : null;
    };
    // The request's item is looked for in the conversation's own map first, then in the others.
    const items = [b, ...built.filter((x) => x !== b)].map((x) => ({ id: x.project.id, arch: x.project.arch }));
    chat.workflows = chat.workflows.map((w) => (Array.isArray(w.agents) ? workflowView(w, { launch: s.launches?.[w.id] ?? null, items, place: placeFile, commitOf }) : w));
  }
}
