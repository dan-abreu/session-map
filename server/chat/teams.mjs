// The background work a conversation started and that never finished (sv16). A Workflow run and a background Agent helper
// live inside the conversation's claude process: when the process ends (a restart of session-map past its wait, a fall),
// they die with it, and nothing tells Claude when it is resumed. The truth is in the conversation's transcript: each
// launch answers with toolUseResult {status: 'async_launched', taskId, runId, scriptPath...} (a workflow) or {isAsync,
// agentId, description...} (a helper), and each end comes back as a message that starts with
// <task-notification><task-id>...<status>; a finished run also leaves <session>/workflows/<runId>.json with its taskId
// and status. A resumed run keeps its runId under a new taskId, so only the newest launch of a run counts.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const RUN_ID_RE = /^wf_[\w-]+$/;
const ID_RE = /^[\w-]+$/;
const NOTICE_RE = /^\s*<task-notification>\s*<task-id>([\w-]+)<\/task-id>([\s\S]*?)(?:<\/task-notification>|$)/;
const STATUS_RE = /<status>(\w+)<\/status>/;
// The statuses that end a task. Claude Code, resumed after its process died, writes "stopped" for the work that died
// with it: that one is a cut, not an end.
const ENDED = new Set(['completed', 'failed', 'killed', 'stopped']);
const CUT_RE = /didn't finish before the previous session ended/;
const endsTask = (rest) => {
  const status = STATUS_RE.exec(rest)?.[1];
  return ENDED.has(status) && !(status === 'stopped' && CUT_RE.test(rest));
};
// A note names a handful: more would bury the conversation's own work.
const LISTED_MAX = 10;
const WORDS_MAX = 120;
const PATH_MAX = 500;

const NONE = Object.freeze({ workflows: Object.freeze([]), agents: Object.freeze([]) });
const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// The texts a line may carry a notification in: a queued message, a user message, an attachment of a queued command.
function noticeTexts(entry) {
  const texts = [];
  if (entry.type === 'queue-operation' && typeof entry.content === 'string') texts.push(entry.content);
  if (entry.type === 'user') {
    const content = entry.message?.content;
    if (typeof content === 'string') texts.push(content);
    else if (Array.isArray(content)) for (const b of content) if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
  }
  if (entry.type === 'attachment' && typeof entry.attachment?.prompt === 'string') texts.push(entry.attachment.prompt);
  return texts;
}

function metaTaskId(sessionDir, runId) {
  try {
    const meta = JSON.parse(readFileSync(join(sessionDir, 'workflows', `${runId}.json`), 'utf8'));
    // Written when a run ends; its status says how.
    if (!meta || typeof meta !== 'object' || !ENDED.has(meta.status)) return null;
    return { taskId: typeof meta.taskId === 'string' ? meta.taskId : null };
  } catch {
    return null;
  }
}

// file: the conversation's transcript. since: launches older than this are history, not news. -> {workflows: [{runId,
// taskId, name, scriptPath}], agents: [{agentId, taskId, description}]}, oldest first. For a conversation whose process
// is gone these were cut; in a live one (since: when its process started) they are still at work.
export function cutTeams(file, { since = 0 } = {}) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return NONE; }
  const workflows = new Map();
  const agents = new Map();
  const ended = new Set();
  const cut = new Set();
  for (const line of text.split('\n')) {
    const launch = line.includes('"async_launched"');
    const notice = line.includes('task-notification');
    if (!launch && !notice) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || typeof entry !== 'object') continue;
    if (notice) {
      for (const t of noticeTexts(entry)) {
        const m = NOTICE_RE.exec(t);
        if (m) {
          if (endsTask(m[2])) ended.add(m[1]);
          else if (CUT_RE.test(m[2])) cut.add(m[1]);
        }
      }
    }
    const r = entry.type === 'user' ? entry.toolUseResult : null;
    if (!launch || !r || typeof r !== 'object' || r.status !== 'async_launched') continue;
    const at = Date.parse(entry.timestamp);
    if (typeof r.runId === 'string' && RUN_ID_RE.test(r.runId) && typeof r.taskId === 'string' && ID_RE.test(r.taskId)) {
      // The newest launch of a run wins: Map keeps the first place, so the run is moved to the end.
      workflows.delete(r.runId);
      workflows.set(r.runId, { runId: r.runId, taskId: r.taskId, name: oneLine(r.workflowName, WORDS_MAX), scriptPath: oneLine(r.scriptPath, PATH_MAX), at });
    } else if (r.isAsync === true && typeof r.agentId === 'string' && ID_RE.test(r.agentId)) {
      agents.set(r.agentId, { agentId: r.agentId, taskId: r.agentId, description: oneLine(r.description, WORDS_MAX), at });
    }
  }
  const sessionDir = join(dirname(file), basename(file, '.jsonl'));
  const recent = (x) => Number.isFinite(x.at) && x.at >= since;
  const open = (x) => !ended.has(x.taskId);
  const finished = (w) => {
    if (cut.has(w.taskId)) return false;
    const meta = metaTaskId(sessionDir, w.runId);
    return meta !== null && (meta.taskId === null || meta.taskId === w.taskId);
  };
  const strip = ({ at, ...x }) => x;
  return {
    workflows: [...workflows.values()].filter((w) => recent(w) && open(w) && !finished(w)).map(strip),
    agents: [...agents.values()].filter((a) => recent(a) && open(a)).map(strip),
  };
}

export const hasCutTeams = (teams) => Boolean(teams && (teams.workflows?.length || teams.agents?.length));

// What Claude reads after the message that resumes the conversation: which work was cut and how to resume it. Advisory:
// a run may have done part of its work outside (a push, a payment), so it looks first and asks before repeating that.
export function teamsNote(teams) {
  if (!hasCutTeams(teams)) return '';
  const lines = ['[session-map: background work this conversation started was cut off before it finished, when its process stopped (a restart of session-map or a fall).'];
  if (teams.workflows.length) {
    lines.push('Workflows cut midway; each resumes from where it stopped, and the agents that had finished come back from the cache instead of running again:');
    for (const w of teams.workflows) {
      const name = w.name ? ` ("${w.name}")` : '';
      lines.push(w.scriptPath
        ? `- ${w.runId}${name}, script ${w.scriptPath}: Workflow({scriptPath: ${JSON.stringify(w.scriptPath)}, resumeFromRunId: ${JSON.stringify(w.runId)}})`
        : `- ${w.runId}${name}: resume it with the Workflow tool's resumeFromRunId ${JSON.stringify(w.runId)} and its script`);
    }
  }
  if (teams.agents.length) {
    lines.push(`Background helpers (Agent) cut midway, to start again if their work is still needed: ${teams.agents.map((a) => (a.description ? `${a.agentId} ("${a.description}")` : a.agentId)).join(', ')}.`);
  }
  lines.push('First look at what each one already did (its journal, the files, the commits). Ask the person before repeating anything costly or with effects outside this computer (a push, a deploy, a payment). Then tell the person, in plain words, which work you resume and which you leave.]');
  return lines.join('\n');
}
