// Relations between parts (mm05): the dotted lines of "Show relations". What makes one strong, whether it was written down
// or only seen in the work, their order in the list, and the ones the person asked to stop seeing (kept per project by the
// page). Pure, so node:test loads it.
import { matchParts, parseFlow } from './flow.js';

export const relationKey = (l) => `${l.a}|${l.b}`;

export const strengthOf = (weight) => (weight >= 3 ? 'strong' : weight === 2 ? 'fair' : 'weak');

// The arrows of the README's own diagram, as the pairs of parts they join.
export function declaredPairs(arch) {
  const out = new Set();
  const model = arch.mermaid ? parseFlow(arch.mermaid) : null;
  if (!model?.ok) return out;
  const part = matchParts(model, arch.parts);
  for (const e of model.edges) {
    const x = part.get(e.from), y = part.get(e.to);
    if (x && y && x !== y) out.add(x < y ? `${x}|${y}` : `${y}|${x}`);
  }
  return out;
}

// "Declared" is what people wrote (a part's file points to the other, or the README draws an arrow); "detected" is what
// session-map saw in chats and branches.
export const isDeclared = (link, pairs) => pairs.has(relationKey(link)) || link.reasons.some((r) => r.kind === 'file-ref');

export function sortRelations(links, nameOf) {
  return [...links].sort((p, q) => q.weight - p.weight || q.reasons.length - p.reasons.length
    || nameOf(p.a).localeCompare(nameOf(q.a)) || nameOf(p.b).localeCompare(nameOf(q.b)));
}

export const serializeIgnored = (set) => JSON.stringify([...set]);

export function parseIgnored(raw) {
  try {
    const list = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function splitIgnored(links, ignored) {
  return { shown: links.filter((l) => !ignored.has(relationKey(l))), ignored: links.filter((l) => ignored.has(relationKey(l))) };
}

// What the pointer shows over a line: "A ↔ B · 3 reasons".
export const relationTip = (link, nameOf, reasonsWords) => `${nameOf(link.a)} ↔ ${nameOf(link.b)} · ${reasonsWords(link.reasons.length)}`;
