// A folder where conversations ran that the owner does not keep as a project (id161): the folder is gone (a helper's
// worktree, a test run's copy), it sits in the system's temp folder, inside a hidden tool folder (.claude, .dev,
// .session-map-runs) or in the DeepSeek Harness's own workspace. The page puts these away behind "other folders"; their
// cost still counts everywhere and nothing is deleted.
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { normalizePath } from './paths.mjs';

const TOOL_FOLDERS = new Set(['deepseek-harness']);

const isDir = (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// 'gone' | 'temp' | 'tool' | null (a project the owner keeps).
export function scratchWhy(root, { exists = isDir, tmp = tmpdir() } = {}) {
  if (!exists(root)) return 'gone';
  const path = normalizePath(root);
  const base = normalizePath(tmp);
  if (path === base || path.startsWith(`${base}/`)) return 'temp';
  const segments = path.split('/').filter(Boolean);
  return segments.some((s) => s.startsWith('.') || TOOL_FOLDERS.has(s)) ? 'tool' : null;
}
