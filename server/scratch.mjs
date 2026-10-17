// A folder where conversations ran that the owner does not keep as a project (id161, id163): the folder is gone (a helper's
// worktree, a test run's copy), it sits in the system's temp folder, inside a hidden tool folder (.claude, .dev,
// .session-map-runs), in the DeepSeek Harness's own workspace, or outside the folder he keeps his projects in (config.json
// projectsRoot, when he names one). The page puts these away behind "other folders"; their cost still counts everywhere
// and nothing is deleted.
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { normalizePath } from './paths.mjs';

const TOOL_FOLDERS = new Set(['deepseek-harness']);

const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// The folders the owner keeps his projects in: config.json projectsRoot, one folder or a list; none = anywhere.
export const projectsRootsOf = (userConfig) => [userConfig?.projectsRoot ?? []].flat().filter((r) => typeof r === 'string' && r.trim());

const inside = (path, base) => path === base || path.startsWith(`${base}/`);

// 'gone' | 'temp' | 'tool' | 'outside' | null (a project the owner keeps). within: projectsRootsOf's answer.
export function scratchWhy(root, { exists = isDir, tmp = tmpdir(), within = [] } = {}) {
  if (!exists(root)) return 'gone';
  const path = normalizePath(root);
  if (inside(path, normalizePath(tmp))) return 'temp';
  const segments = path.split('/').filter(Boolean);
  if (segments.some((s) => s.startsWith('.') || TOOL_FOLDERS.has(s))) return 'tool';
  return within.length && !within.some((r) => inside(path, normalizePath(r))) ? 'outside' : null;
}
