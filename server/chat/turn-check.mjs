import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { priceReply, usageOf } from '../statement.mjs';
import { parseLines } from '../sources/claude.mjs';
import { roleOf } from '../ai/agents.mjs';
import { contextOf } from '../waste.mjs';

// The OK at the end of a request (or26), read from what the turn left behind without asking any AI: did the tests run
// and pass, which plan items were ticked, what was saved, what the turn cost, and what is missing. Since or58 it also
// reads the roles that worked (every Agent/Task call's kind tag mapped to the catalog) and charges each one its proof.

const SHELLS = new Set(['Bash', 'PowerShell']);
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const AGENT_TAG_RE = /^\s*\[([a-z-]+)(?:\^[12])?\]/;
const TEST_CMD = /\b(?:npm\s+(?:run\s+)?test|npx\s+(?:vitest|jest)|vitest|jest|pytest|node\s+(?:\S+\s+)*--test|go\s+test|cargo\s+test)\b/;
const DOC_FILE = /\.(?:md|txt)$/i;
const PLAN_FILE = /(?:^|[\\/])docs[\\/]architecture[\\/][^\\/]+\.md$/i;
const PLAN_DOC_RE = /(?:^|[\\/])docs[\\/]superpowers[\\/]plans[\\/][^\\/]+\.md$/i;
const ITEM = /^\s*- \[([ x])\].*`([a-z]+\d+)`\s*$/;
const USAGE_FIELDS = ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output', 'thinking', 'webSearch'];

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text ?? '').join('\n') : '');
const blocksOf = (entry) => (Array.isArray(entry?.message?.content) ? entry.message.content : []);

// The test run's numbers from the runner's own words (node, pytest, jest/vitest, go).
function readTestRun(text, isError) {
  // Jest and vitest count suites on one line and tests on the next: the tests line speaks.
  const jest = /^\s*Tests:(.*)$/m.exec(text)?.[1];
  const scope = jest ?? text;
  const count = (re) => { const m = re.exec(scope); return m ? Number(m[1]) : null; };
  let failed = count(/(?:ℹ|#)\s*fail\s+(\d+)/i) ?? count(/\b(\d+)\s+(?:failed|failing)\b/i);
  const passed = count(/(?:ℹ|#)\s*pass\s+(\d+)/i) ?? count(/\b(\d+)\s+passed\b/i);
  // A summary of passes and no FAIL line: a test whose name says "failed" is no failure.
  if (failed === null && passed !== null && !isError && !/\bFAIL\b/.test(text)) failed = 0;
  if (failed === null) {
    // "0 failed" and "fail 0" are clean; any other word of failure is not.
    const rest = text.replace(/\b0\s+(?:failed|failing|failures?)\b/gi, '').replace(/\bfail\w*\s*[:=]?\s*0\b/gi, '');
    failed = /\bFAIL\b|\bfail(?:ed|ing|ure)/i.test(rest) ? 1 : 0;
  }
  if (isError && failed === 0) failed = 1;
  return { ran: passed === null ? null : passed + failed, passed, failed };
}

const plansOf = (text) => {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = ITEM.exec(line);
    if (m) out.set(m[2], m[1] === 'x');
  }
  return out;
};

// gitBefore/gitAfter: {plans: {path: text}} (the plan files at the start and at the end), gitAfter.commits: [{hash, at (ms), subject}].
export function turnCheck({ entries = [], startedAt = 0, gitBefore = null, gitAfter = null, prices = {} } = {}) {
  const inTurn = entries.filter((e) => {
    const at = Date.parse(e?.timestamp);
    return !Number.isFinite(at) || at >= startedAt;
  });
  const replies = new Map();
  const calls = [];
  const results = new Map();
  const agentKinds = [];
  for (const e of inTurn) {
    if (e.type === 'assistant' && e.message?.usage) {
      const u = usageOf(e.message.usage);
      const key = e.message.id ?? e.uuid ?? replies.size;
      const r = replies.get(key) ?? { model: e.message.model ?? '', speed: null, geo: null, ...Object.fromEntries(USAGE_FIELDS.map((k) => [k, 0])) };
      for (const k of USAGE_FIELDS) r[k] = Math.max(r[k], u[k] ?? 0);
      r.speed ??= e.message.usage.speed ?? null;
      r.geo ??= e.message.usage.inference_geo ?? null;
      replies.set(key, r);
    }
    for (const b of blocksOf(e)) {
      if (b?.type === 'tool_use') {
        calls.push(b);
        if (AGENT_TOOLS.has(b.name)) {
          const tag = AGENT_TAG_RE.exec(String(b.input?.description ?? ''));
          if (tag) agentKinds.push(tag[1]);
        }
      } else if (b?.type === 'tool_result') results.set(b.tool_use_id, { text: textOf(b.content), isError: b.is_error === true });
    }
  }
  let costUSD = 0;
  for (const r of replies.values()) costUSD += priceReply(r, prices)?.total ?? 0;
  costUSD = Math.round(costUSD * 1e6) / 1e6;

  let tests = null;
  for (const c of calls) {
    const command = String(c.input?.command ?? '');
    if (!SHELLS.has(c.name) || !TEST_CMD.test(command) || !results.has(c.id)) continue;
    const res = results.get(c.id);
    tests = { ...readTestRun(res.text, res.isError), command };
  }

  const codeChanged = calls.some((c) => EDITS.has(c.name) && !results.get(c.id)?.isError && !DOC_FILE.test(String(c.input?.file_path ?? c.input?.notebook_path ?? '')));

  // Ticked: the plan files' lines that went from [ ] to [x]; without the files' texts, the turn's own edits of them.
  const ticked = new Set();
  const before = gitBefore?.plans ?? {};
  const after = gitAfter?.plans ?? {};
  for (const [file, text] of Object.entries(after)) {
    const was = plansOf(before[file]);
    for (const [code, done] of plansOf(text)) if (done && was.get(code) === false) ticked.add(code);
  }
  for (const c of calls) {
    if (!EDITS.has(c.name) || !PLAN_FILE.test(String(c.input?.file_path ?? ''))) continue;
    const was = plansOf(c.input?.old_string);
    for (const [code, done] of plansOf(c.input?.new_string)) if (done && was.get(code) === false) ticked.add(code);
  }

  const commits = (gitAfter?.commits ?? []).filter((c) => !Number.isFinite(c.at) || c.at + 1000 > startedAt); // git times its commits in whole seconds
  const saved = commits.map((c) => String(c.hash).slice(0, 7));

  // An item named in a commit subject whose line is still open was worked on and not ticked.
  const open = new Set();
  for (const text of Object.values(after)) for (const [code, done] of plansOf(text)) if (!done) open.add(code);
  const worked = commits.flatMap((c) => [...String(c.subject ?? '').matchAll(/\b([a-z]+\d+)\b/g)].map((m) => m[1])).filter((code) => open.has(code) && !ticked.has(code));

  const missing = [];
  if (codeChanged && !tests) missing.push('no-tests');
  if (tests && tests.failed > 0) missing.push('tests-failed');
  if (worked.length) missing.push('not-ticked');
  if ((codeChanged || ticked.size) && !saved.length) missing.push('not-saved');
  // The roles that worked (or58): every agent's kind mapped to the catalog, and each one charged its proof. The
  // planner's exit is a plan on paper; a planner that worked without one leaves 'role-plan'.
  const roles = [...new Set(agentKinds.map((k) => roleOf(k)?.id).filter(Boolean))];
  const planEdited = calls.some((c) => EDITS.has(c.name) && !results.get(c.id)?.isError
    && (PLAN_FILE.test(String(c.input?.file_path ?? '')) || PLAN_DOC_RE.test(String(c.input?.file_path ?? ''))));
  if (roles.includes('planner') && !planEdited) missing.push('role-plan');
  return { tests, roles, ticked: [...ticked], saved, costUSD, missing };
}

// The memory a conversation carries (pc37): the prompt side of the last reply of the chat itself (a helper's lines are
// not the chat's), null when no reply reported any.
export function contextTokens(entries = []) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type !== 'assistant' || e.isSidechain || !e.message?.usage || e.message.model === '<synthetic>') continue;
    const tokens = contextOf(usageOf(e.message.usage));
    if (tokens > 0) return tokens;
  }
  return null;
}

// ---- reading the turn's surroundings (the hub's side; every failure gives nothing) ----

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

// The plan files now (docs/architecture/*.md of the folder) and, with sinceMs, the commits made since.
export function gitState(cwd, sinceMs = null) {
  const out = { plans: {}, commits: [] };
  try {
    const folder = join(cwd, 'docs', 'architecture');
    for (const name of readdirSync(folder)) {
      if (name.endsWith('.md')) out.plans[`docs/architecture/${name}`] = readFileSync(join(folder, name), 'utf8');
    }
  } catch { /* no plan files here */ }
  if (sinceMs !== null) {
    const log = git(cwd, ['log', `--since=${new Date(sinceMs).toISOString()}`, '--format=%h%x09%ct%x09%s']);
    out.commits = log.split('\n').filter(Boolean).map((line) => {
      const [hash, ct, ...subject] = line.split('\t');
      return { hash, at: Number(ct) * 1000, subject: subject.join('\t') };
    });
  }
  return out;
}

// The last part of a transcript (a turn is far smaller than this), as entries.
export function tailEntries(file, bytes = 4_000_000) {
  const size = statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return parseLines(start > 0 ? text.slice(text.indexOf('\n') + 1) : text);
  } finally { closeSync(fd); }
}
