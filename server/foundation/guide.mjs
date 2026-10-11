import { buildCompass } from './compass.mjs';
import { loadLibrary, localKnowledgeDir, sharedKnowledgeDir } from './library.mjs';
import { detectProfile, mergeDetected, readProfile, writeProfile } from './profile.mjs';
import { depsOf, readTextOf } from './profile-stacks.mjs';
import { attestsOf, evaluatePractices } from './practices.mjs';
import { readFd, writeFd } from './store.mjs';

// B5-T10: the guide's orchestrator. profile -> practices -> compass, in that order, from what the reading round left under
// brain/<id>/foundation/ and what the library holds. Three steps:
//   readGuideInputs  the only I/O: the foundation files, the library, the profile detection (manifests and the git author
//                    count) and a text reader that already refuses secrets and anything outside the project
//   computeGuide     pure: the same inputs give the same three documents, byte for byte
//   recomputeGuide   reads, computes and writes profile.json (keeping `owner`), practices.json and compass.json, only when
//                    their content changed. Nothing is written in the project, and no chat is opened here.

const nowIso = (now) => {
  const d = new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error('invalid date'), { code: 'bad-now' });
  return d.toISOString();
};

// opts: { now, authors (what gitAuthors returns, for a test), sharedDir, localDir }
export async function readGuideInputs(smDir, project, { now, authors, sharedDir, localDir } = {}) {
  const id = project.id;
  const census = readFd(smDir, id, 'census.json', null);
  const factsDoc = readFd(smDir, id, 'facts.json', null);
  const facts = Array.isArray(factsDoc?.facts) ? factsDoc.facts : [];
  const health = readFd(smDir, id, 'health.json', null);
  const root = typeof project.root === 'string' ? project.root : null;
  const readText = root ? readTextOf(root) : () => null;
  const prev = readProfile(smDir, id);
  // Without a census there is nothing to detect from: keep what was detected before instead of replacing it by an empty card.
  const detected = census ? await detectProfile({ root, census, facts, readText, ...(authors ? { authors } : {}) }) : prev.detected;
  const library = loadLibrary({ sharedDir: sharedDir ?? sharedKnowledgeDir(), localDir: localDir ?? localKnowledgeDir(smDir) });
  return {
    now: nowIso(now),
    profile: mergeDetected(prev, detected),
    prevProfile: prev,
    census,
    facts,
    health,
    deps: depsOf({ census, readText }),
    readText,
    packages: library.packages,
    attest: attestsOf(readFd(smDir, id, 'practices.json', null)),
  };
}

export function computeGuide(inputs) {
  const { profile, packages, census, facts, deps, readText, health, attest, now } = inputs;
  const practices = evaluatePractices({ packages, profile, census, facts, deps, readText, health, attest, now });
  const compass = buildCompass({ practices, profile, census, now, packages, facts });
  return { profile, practices, compass };
}

const sameDoc = (a, b) => !!a && JSON.stringify({ ...a, generatedAt: null }) === JSON.stringify({ ...b, generatedAt: null });
const sameProfile = (a, b) => JSON.stringify([a.detected, a.owner, a.askedAt]) === JSON.stringify([b.detected, b.owner, b.askedAt]);

export async function recomputeGuide(smDir, project, opts = {}) {
  const inputs = await readGuideInputs(smDir, project, opts);
  const out = computeGuide(inputs);
  const id = project.id;
  if (!sameProfile(inputs.prevProfile, out.profile)) writeProfile(smDir, id, out.profile, inputs.now);
  for (const [name, doc] of [['practices.json', out.practices], ['compass.json', out.compass]]) {
    if (!sameDoc(readFd(smDir, id, name, null), doc)) writeFd(smDir, id, name, doc);
  }
  return out;
}
