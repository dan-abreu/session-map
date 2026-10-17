// The model lists the program has read from the makers (id168, or72): one entry per model, per AI, held in memory. Filled
// at the start of the program from the cache file and again after every look (models.mjs); read by the scripts that
// validate a choice, name a model or decide which levels it takes. Imports nothing, so efforts.mjs can read it without a
// cycle. Empty (the tests, a first start): every reader falls back to what is built in.
//
// An entry: { id, name, noteEn?, notePt?, resolved?, context?, priceIn?, priceOut?, maker?, levels?, levelsFrom? }.
// levelsFrom: 'maker' when the maker's own list says which levels the model takes (Claude Code, DeepSeek), 'guess' when
// the program chose the cautious set; no `levels` at all means nothing is known.

const lists = new Map();
let version = 0;

export function setListed(provider, entries, at = null) {
  if (typeof provider !== 'string' || !Array.isArray(entries)) return;
  lists.set(provider, { entries, at });
  version += 1;
}

export const listedOf = (provider) => lists.get(provider)?.entries ?? null;
export const listedAt = (provider) => lists.get(provider)?.at ?? null;
export const listedEntry = (provider, id) => listedOf(provider)?.find((e) => e.id === id) ?? null;
// Changes with every list set or cleared: whoever caches something derived from the lists keeps it by this number.
export const listedVersion = () => version;
export function clearListed() {
  lists.clear();
  version += 1;
}
