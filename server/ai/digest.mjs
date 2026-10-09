import { relativeFiles } from '../brain/cells.mjs';

const PROMPT_MAX = 160;
const FIRST_PROMPTS = 3;
const LAST_PROMPTS = 5;
const FILES_MAX = 30;
const COMMITS_MAX = 10;

// The opening prompts carry the purpose, the latest ones where the work went; the middle is dropped.
function pickPrompts(prompts) {
  const picked = prompts.length > FIRST_PROMPTS + LAST_PROMPTS
    ? [...prompts.slice(0, FIRST_PROMPTS), ...prompts.slice(-LAST_PROMPTS)]
    : prompts;
  return picked.map((p) => String(p).slice(0, PROMPT_MAX));
}

// What the AI reads about one conversation: never the transcript, only this.
export function digestOf(summary, workCell) {
  const bases = [summary.cwd, workCell?.path];
  const files = [...new Set([
    ...relativeFiles(summary.editedFiles ?? [], bases),
    ...(workCell?.files ?? []).map((f) => f.path),
  ])].slice(0, FILES_MAX);
  const subjects = (summary.commits ?? []).map((c) => c.subject);
  if (workCell?.lastCommit && !subjects.includes(workCell.lastCommit.subject)) subjects.push(workCell.lastCommit.subject);
  return {
    title: summary.title ?? '',
    branch: workCell?.branch ?? null,
    prompts: pickPrompts(summary.userPrompts ?? []),
    files,
    commits: subjects.slice(-COMMITS_MAX),
  };
}
