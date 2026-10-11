// A folder name as GitHub takes it for a repository (sv15): letters, digits, '.', '_' and '-'; accents lose their marks,
// the rest becomes '-'. Shared by the server, which creates the repository, and the page, which shows its name first.
const REPO_MAX = 100;

export function repoNameOf(name) {
  const out = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, REPO_MAX);
  return out || null;
}
