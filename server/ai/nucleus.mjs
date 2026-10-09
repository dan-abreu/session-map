import { createHash } from 'node:crypto';
import { NUCLEUS_SCHEMA, nucleusPrompt } from './prompts.mjs';

const BATCH = 5;
const CHATS_MAX = 6;
const LAST_MAX = 200;
const STATE_MAX = 200;
const ITEM_MAX = 160;
const ITEMS_MAX = 5;
const BRANCH_TODO_MAX = 5;

const hashOf = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex');
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const items = (v) => (Array.isArray(v) ? v.map((s) => text(s, ITEM_MAX)).filter(Boolean).slice(0, ITEMS_MAX) : []);

// What the AI reads to write a unit's nucleus: the digests of its newest chats and its branches, never a transcript.
// chats: [{updatedAt, digest, last}] where last is the chat's last assistant line.
export function nucleusInputOf(unit, chats, branches) {
  const newest = [...chats].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, CHATS_MAX);
  return {
    id: unit.id,
    name: unit.name,
    purpose: unit.purpose ?? '',
    chats: newest.map(({ digest, last }) => ({ title: digest.title, prompts: digest.prompts, commits: digest.commits, last: text(last, LAST_MAX) })),
    branches: branches.map((w) => ({
      branch: w.branch, commits: w.commits, files: w.files.length, lastCommit: w.lastCommit?.subject ?? null, todo: (w.openspec?.todo ?? []).slice(0, BRANCH_TODO_MAX),
    })),
  };
}

// store: {unitId: {hash, state, decided, todo}} from the last run. Only units whose content changed are asked again,
// a few per call; the hourly cap stops the round and the rest wait for the next one.
export async function writeAiNuclei(inputs, store, ask) {
  const next = { ...store };
  const stale = inputs.map((input) => ({ input, hash: hashOf(input) })).filter(({ input, hash }) => store[input.id]?.hash !== hash);
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH);
    const units = batch.map((b) => b.input);
    const res = await ask({ key: { kind: 'nucleus', units }, prompt: nucleusPrompt(units), schemaHint: NUCLEUS_SCHEMA });
    if (res.error === 'rate-limited' || res.error === 'ai-off') break;
    if (!res.ok || !Array.isArray(res.value?.units)) continue;
    for (const answer of res.value.units) {
      const asked = batch.find((b) => b.input.id === answer?.id);
      if (!asked) continue;
      next[asked.input.id] = { hash: asked.hash, state: text(answer.state, STATE_MAX), decided: items(answer.decided), todo: items(answer.todo) };
    }
  }
  return next;
}
