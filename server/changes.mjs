// Every file a conversation created, edited, removed or renamed (mind-map-page mm30), read from its transcript step by
// step: the edit tools and their results, and the commands that remove or rename files. Like claude.mjs, this depends on
// Claude Code's undocumented transcript format (toolUseResult with structuredPatch, written next to each tool result).
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { maskSecrets } from './sources/claude-conversation.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const USE_RE = /"name":"(Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)"/;
const RESULT_ID_RE = /"tool_use_id":"([^"]+)"/g;
const DRIVE_RE = /^[a-z]:\//i;
const GIT_BASH_DRIVE_RE = /^\/([a-z])(?=\/)/i;
const UNSURE_RE = /[*?[\]$`%{}~]/;
const DETAIL_LINES_MAX = 3000;
const CHUNK = 4 * 1024 * 1024;

const slash = (p) => String(p).replaceAll('\\', '/');
const linesOf = (text) => {
  const s = String(text ?? '');
  if (!s) return [];
  const out = s.split(/\r?\n/);
  if (out.at(-1) === '') out.pop();
  return out;
};

// A path of a step as one spelling: forward slashes, relative ones resolved from the folder the step ran in, and Git Bash's
// /c/dev written C:/dev when the folder is a Windows one.
function resolveFrom(cwd, p) {
  const base = slash(cwd ?? '');
  let path = slash(p);
  if (DRIVE_RE.test(base)) path = path.replace(GIT_BASH_DRIVE_RE, (_, d) => `${d.toUpperCase()}:`);
  if (DRIVE_RE.test(path)) return path.slice(0, 2) + posix.normalize(path.slice(2));
  if (path.startsWith('/')) return posix.normalize(path);
  if (!base) return posix.normalize(path);
  const drive = DRIVE_RE.test(base) ? base.slice(0, 2) : '';
  return drive + posix.join(drive ? base.slice(2) : base, path);
}

// Lines that differ between two texts once the lines both share at the start and the end are set aside.
// ponytail: not a real diff; a change with moved blocks counts a few lines too many. The patch, when the transcript has it, is exact.
function lineStats(before, after) {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { added: b.length - start - end, removed: a.length - start - end };
}

const patchStats = (patch) => {
  let added = 0;
  let removed = 0;
  for (const hunk of patch) for (const line of hunk?.lines ?? []) {
    if (line[0] === '+') added++;
    else if (line[0] === '-') removed++;
  }
  return { added, removed };
};

function inputStats(name, input) {
  if (name === 'Edit') return lineStats(input.old_string, input.new_string);
  if (name === 'MultiEdit') {
    return (Array.isArray(input.edits) ? input.edits : []).reduce((sum, e) => {
      const s = lineStats(e?.old_string, e?.new_string);
      return { added: sum.added + s.added, removed: sum.removed + s.removed };
    }, { added: 0, removed: 0 });
  }
  return { added: linesOf(input.content ?? input.new_source).length, removed: 0 };
}

// ---- commands that remove or rename files ----------------------------------------------------------

// Shell words with quotes honoured; null when the segment holds something only the shell could expand.
function words(segment) {
  const out = [];
  let cur = '';
  let quote = null;
  let any = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = '';
      any = false;
    } else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

const flagless = (args) => args.filter((a) => !a.startsWith('-'));
// PowerShell's named arguments: -Path x, -Destination y, -NewName z; the switches (-Force, -Recurse) take nothing.
function psArgs(args) {
  const named = {};
  const loose = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const key = a.startsWith('-') ? a.slice(1).toLowerCase() : null;
    if (key && ['path', 'literalpath', 'destination', 'newname'].includes(key) && i + 1 < args.length) named[key] = args[++i];
    else if (!key) loose.push(a);
  }
  return { path: named.path ?? named.literalpath ?? loose[0], to: named.destination ?? named.newname ?? loose[1], loose };
}

function segmentChanges(argv, cwd) {
  const [cmd, ...rest] = argv;
  const name = cmd?.toLowerCase();
  const at = (p) => resolveFrom(cwd, p);
  const del = (paths) => paths.map((p) => ({ kind: 'delete', path: at(p) }));
  const move = (from, to, nameOnly = false) => {
    if (!from || !to) return [];
    const target = nameOnly ? posix.join(posix.dirname(slash(from)), to) : slash(to).endsWith('/') ? posix.join(slash(to), posix.basename(slash(from))) : to;
    return [{ kind: 'rename', from: at(from), path: at(target) }];
  };
  if (name === 'rm' || name === 'del' || name === 'erase' || name === 'unlink') return del(flagless(rest));
  if (name === 'git' && rest[0] === 'rm') return rest.includes('--cached') ? [] : del(flagless(rest.slice(1)));
  if (name === 'mv' || (name === 'git' && rest[0] === 'mv')) {
    const args = flagless(name === 'git' ? rest.slice(1) : rest);
    return args.length === 2 ? move(args[0], args[1]) : [];
  }
  if (name === 'remove-item' || name === 'ri') {
    const { path } = psArgs(rest);
    return path ? del([path]) : [];
  }
  if (name === 'move-item' || name === 'mi') {
    const { path, to } = psArgs(rest);
    return move(path, to);
  }
  if (name === 'rename-item' || name === 'rni') {
    const { path, to } = psArgs(rest);
    return move(path, to, true);
  }
  return [];
}

// What a command removed or renamed, one segment at a time ("cd x && rm y" removes x/y). A segment with a glob, a
// variable or anything else only the shell could expand is skipped: a wrong file on the page is worse than a missing one.
export function bashChanges(command, cwd) {
  const out = [];
  let here = slash(cwd ?? '');
  for (const segment of String(command ?? '').split(/&&|\|\||[;\n|]/)) {
    const argv = words(segment.trim());
    if (!argv?.length) continue;
    if (argv[0] === 'cd' || argv[0].toLowerCase() === 'set-location') {
      const to = flagless(argv.slice(1))[0];
      if (to && !UNSURE_RE.test(to)) here = resolveFrom(here, to);
      continue;
    }
    if (argv.slice(1).some((a) => UNSURE_RE.test(a))) continue;
    out.push(...segmentChanges(argv, here));
  }
  return out;
}

// ---- reading the steps -------------------------------------------------------------------------

const contentOf = (entry) => (Array.isArray(entry.message?.content) ? entry.message.content.filter((b) => b && typeof b === 'object') : []);

// Steps waiting for their results; push(entry, at) returns the changes the entry completes. at: the byte offset of the
// entry's line in its transcript, kept so the before and after can be read again later without holding them in memory.
function createScanner(defaultCwd = '') {
  const pending = new Map();
  const push = (entry, at = null) => {
    const out = [];
    if (entry.type === 'assistant') {
      for (const b of contentOf(entry)) {
        if (b.type !== 'tool_use' || !(EDIT_TOOLS.has(b.name) || SHELL_TOOLS.has(b.name))) continue;
        const input = b.input && typeof b.input === 'object' ? b.input : {};
        const cwd = typeof entry.cwd === 'string' && entry.cwd ? entry.cwd : defaultCwd;
        const base = { toolUseId: b.id, name: b.name, ts: entry.timestamp ?? null, model: entry.message?.model ?? null, useAt: at };
        if (SHELL_TOOLS.has(b.name)) {
          const found = bashChanges(input.command, cwd);
          if (found.length) pending.set(b.id, { ...base, found });
        } else {
          const file = input.file_path ?? input.notebook_path;
          if (typeof file === 'string' && file) pending.set(b.id, { ...base, path: resolveFrom(cwd, file), stats: inputStats(b.name, input) });
        }
      }
      return out;
    }
    if (entry.type !== 'user') return out;
    for (const b of contentOf(entry)) {
      if (b.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
      const use = pending.get(b.tool_use_id);
      pending.delete(b.tool_use_id);
      if (b.is_error === true) continue;
      const result = entry.toolUseResult && typeof entry.toolUseResult === 'object' ? entry.toolUseResult : null;
      const common = { toolUseId: use.toolUseId, ts: entry.timestamp ?? use.ts, model: use.model, at, useAt: use.useAt };
      if (use.found) {
        use.found.forEach((f) => out.push({ ...common, ...f, added: 0, removed: 0 }));
        continue;
      }
      const created = use.name === 'Write' && (result ? result.type === 'create' : /created successfully/i.test(JSON.stringify(b.content ?? '')));
      const patch = Array.isArray(result?.structuredPatch) ? result.structuredPatch : [];
      const stats = patch.length && !created ? patchStats(patch) : use.stats;
      out.push({ ...common, kind: created ? 'create' : 'edit', path: use.path, added: stats.added, removed: stats.removed });
    }
    return out;
  };
  return { push };
}

export function changesIn(entries, { cwd = '' } = {}) {
  const scanner = createScanner(cwd);
  return entries.flatMap((entry) => scanner.push(entry, entry._at ?? null));
}

// ---- the change log of a transcript, read as it grows -----------------------------------------------

const logs = new Map();

// Calls fn(lineText, offset) for every whole line between from and the end of the file; returns where the next pass starts.
function eachLineFrom(file, from, fn, deadline = Infinity) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let rest = Buffer.alloc(0);
    let restAt = from;
    let pos = from;
    for (let n; (n = readSync(fd, buf, 0, CHUNK, pos)) > 0; pos += n) {
      let data = Buffer.concat([rest, buf.subarray(0, n)]);
      let at = restAt;
      for (let nl; (nl = data.indexOf(10)) !== -1; data = data.subarray(nl + 1)) {
        fn(data.toString('utf8', 0, nl), at);
        at += nl + 1;
      }
      rest = Buffer.from(data);
      restAt = at;
      if (Date.now() > deadline) break;
    }
    return restAt;
  } finally {
    closeSync(fd);
  }
}

// Every change in a transcript, oldest first. Transcripts only grow: each pass reads what was appended since the last one,
// so a live conversation costs only its new lines. A line is parsed only when it can hold an edit step or the result of
// one still waiting.
// deadline: past it, the pass stops after the chunk it is reading and the next pass goes on from there: a month of
// transcripts (a gigabyte or more) loads over a few passes instead of freezing the server on the first one.
export function readChanges(file, { deadline = Infinity } = {}) {
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st) {
    logs.delete(file);
    return [];
  }
  let log = logs.get(file);
  if (!log || st.size < log.offset) {
    log = { offset: 0, scanner: createScanner(), pendingIds: new Set(), changes: [] };
    logs.set(file, log);
  }
  if (st.size === log.offset || Date.now() > deadline) return log.changes;
  const fresh = [];
  log.offset = eachLineFrom(file, log.offset, (line, at) => {
    const isUse = line.includes('"tool_use"') && USE_RE.test(line);
    const isResult = !isUse && line.includes('"tool_result"') && [...line.matchAll(RESULT_ID_RE)].some((m) => log.pendingIds.has(m[1]));
    if (!isUse && !isResult) return;
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    if (isUse) for (const b of contentOf(entry)) if (b.type === 'tool_use') log.pendingIds.add(b.id);
    if (isResult) for (const b of contentOf(entry)) if (b.type === 'tool_result') log.pendingIds.delete(b.tool_use_id);
    fresh.push(...log.scanner.push(entry, at));
  }, deadline);
  if (fresh.length) log.changes = [...log.changes, ...fresh];
  return log.changes;
}

function lineAt(file, at) {
  if (!Number.isInteger(at) || at < 0) return null;
  const fd = openSync(file, 'r');
  try {
    const parts = [];
    const buf = Buffer.alloc(CHUNK);
    for (let pos = at, n; (n = readSync(fd, buf, 0, CHUNK, pos)) > 0; pos += n) {
      const nl = buf.subarray(0, n).indexOf(10);
      parts.push(Buffer.from(buf.subarray(0, nl === -1 ? n : nl)));
      if (nl !== -1) break;
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

const masked = (lines) => lines.map((l) => maskSecrets(l));

// The before and after of one change, read again from its transcript: the patch the edit tool wrote (a few lines of
// context around each change), the whole text of a new file, or the replaced pieces when no patch was kept. Secrets masked.
// null when the offsets no longer point at that step (the transcript was rewritten).
export function changeDetail(file, change) {
  const use = lineAt(file, change.useAt);
  const tool = use && contentOf(use).find((b) => b.type === 'tool_use' && b.id === change.toolUseId);
  if (!tool) return null;
  const result = change.at === null || change.at === undefined ? null : lineAt(file, change.at);
  if (result === null && change.at != null) return null;
  if (result && !contentOf(result).some((b) => b.type === 'tool_result' && b.tool_use_id === change.toolUseId)) return null;
  const r = result?.toolUseResult && typeof result.toolUseResult === 'object' ? result.toolUseResult : null;
  const input = tool.input ?? {};
  let hunks = [];
  if (SHELL_TOOLS.has(tool.name)) hunks = [];
  else if (r?.type === 'create' || (tool.name === 'Write' && !r?.structuredPatch?.length)) {
    hunks = [{ oldStart: 0, newStart: 1, lines: linesOf(r?.content ?? input.content ?? input.new_source).map((l) => `+${l}`) }];
  } else if (Array.isArray(r?.structuredPatch) && r.structuredPatch.length) {
    hunks = r.structuredPatch.map((h) => ({ oldStart: h.oldStart ?? 0, newStart: h.newStart ?? 0, lines: (h.lines ?? []).map(String) }));
  } else {
    const pieces = tool.name === 'MultiEdit' && Array.isArray(input.edits) ? input.edits : [input];
    hunks = pieces.map((e) => ({ oldStart: 0, newStart: 0, lines: [...linesOf(e?.old_string).map((l) => `-${l}`), ...linesOf(e?.new_string).map((l) => `+${l}`)] }));
  }
  let left = DETAIL_LINES_MAX;
  let cut = false;
  hunks = hunks.map((h) => {
    const lines = h.lines.slice(0, Math.max(0, left));
    if (lines.length < h.lines.length) cut = true;
    left -= lines.length;
    return { ...h, lines: masked(lines) };
  }).filter((h) => h.lines.length);
  return { hunks, cut };
}

// ---- the rows of the Changes tab ------------------------------------------------------------------

const FRESH_MS = 10 * 60_000;
const isSave = (c) => (c.kind === 'commit' || c.kind === 'merge') && c.hash && Array.isArray(c.files);

// One row per change of a project, newest first (mm30). events: the conversations' changes already on this project's
// paths; worktree: what the folder holds not saved yet (workingTree); commits: the version history (with files);
// tagOf: commit → the first version that carries it. A change is saved by the first saved change at or after it that holds
// the file, and released when a version carries that one. What the folder holds and no conversation explains becomes a
// row of its own, made by hand or by another tool.
export function changeRows({ events, worktree = [], commits = [], tagOf = new Map(), ownersOf, nowIso }) {
  const saves = commits.filter(isSave).sort((a, b) => a.ts.localeCompare(b.ts));
  const rows = events.map((e) => {
    const at = Date.parse(e.ts);
    const save = saves.find((c) => Date.parse(c.ts) >= at && c.files.includes(e.path));
    const tag = save ? tagOf.get(save.hash) ?? null : null;
    return { ...e, state: tag ? 'released' : save ? 'saved' : 'pending', ...(save ? { hash: save.hash } : {}), ...(tag ? { tag } : {}) };
  });
  for (const w of worktree) {
    const mine = rows.filter((r) => r.state === 'pending' && r.path === w.path && r.sessionId);
    if (mine.length) {
      for (const r of mine) {
        r.inFolder = true;
        // A removal or a rename from the command line has no lines of its own: the folder knows how many went.
        if ((r.kind === 'delete' || r.kind === 'rename') && !r.added && !r.removed) Object.assign(r, { added: w.added, removed: w.removed });
      }
      continue;
    }
    rows.push({
      id: `wt:${w.path}`, ts: w.ts ?? nowIso, kind: w.kind, path: w.path, ...(w.from ? { from: w.from } : {}), added: w.added, removed: w.removed,
      sessionId: null, title: null, agent: null, model: null, state: 'pending', inFolder: true,
    });
  }
  const owners = ownersOf(rows.map((r) => r.path));
  rows.forEach((r, i) => { r.partId = owners[i] ?? null; });
  return rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => b.ts.localeCompare(a.ts) || i - j).map(([r]) => r);
}

// What changed in the last minutes, for the boxes that light up with "+N files +M lines now": distinct files and lines
// (added plus removed), in all and per part. null when nothing changed in that time.
export function freshOf(rows, nowMs, windowMs = FRESH_MS) {
  const recent = rows.filter((r) => {
    const at = Date.parse(r.ts);
    return at >= nowMs - windowMs && at <= nowMs + windowMs;
  });
  if (!recent.length) return null;
  const tally = (list) => ({ files: new Set(list.map((r) => r.path)).size, lines: list.reduce((n, r) => n + r.added + r.removed, 0) });
  const parts = {};
  for (const id of new Set(recent.map((r) => r.partId).filter(Boolean))) parts[id] = tally(recent.filter((r) => r.partId === id));
  return { ...tally(recent), parts };
}

export { lineStats, resolveFrom };
