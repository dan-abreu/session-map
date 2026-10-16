// Who is responsible for a function (id120, fl16): the AI (it calls a model or drives the claude process),
// a bot (it runs on its own: the server, a loop, a timer, a watcher) or a plain script. Mechanical only: no AI
// reads a line. The reasons are kept for the hover, so a wrong guess can always be checked against the facts.
// Precedence: server > ai > bot > script; page modules (server/web/) are always scripts (the bot is the server).
const AI_SDK_RE = /^@?(anthropic-ai|openai|google\/generative-ai|deepseek-ai|mistralai|cohere-ai|groq|ollama|claude-code)\//;
const AI_SERVICE_RE = /^(claude|openai|anthropic|gemini|deepseek|mistral|cohere)/;
// ai/ helpers that are pure (they mask, count or digest — never call a model): importing only these is not "the AI".
const AI_PURE = new Set(['digest', 'redact', 'usage', 'activity', 'stance', 'policy', 'life', 'versions', 'keys']);
// ai/runner.mjs holds both: pure helpers (isAiRunnerCwd, cleanEnv, findClaude) and the call itself (runClaudeJSON).
const RUNNER_AI_NAMES = new Set(['runClaudeJSON', 'runClaude', 'haiku']);
const SCHEDULER_SPECS = new Set(['chokidar', 'node-cron', 'cron', 'croner', '@nestjs/schedule']);
// Robots by definition: they run on their own (their timers may sit past the head the classifier reads).
const KNOWN_BOTS = new Set(['server/restart.mjs', 'server/arch/clerk.mjs', 'server/arch/livemark.mjs']);
const ROBOT_NAME_RE = /(^|\/)(watcher|daemon|cron|worker|workers|background|sweep)(\/|\.|$)/;
// Only the loop that runs forever counts; a parser's for(;;) or a one-shot setTimeout is not a bot. The import
// checks catch the schedulers (chokidar, cron) — their names in the text would match their own regex literals.
const ROBOT_TEXT_RE = /setInterval\s*\(/;
const SERVER_NAME_RE = /(^|\/)(main|server|index|app|cli)\.(mjs|js|cjs)$/;

// file: { path, type, text (a head is enough for the loop look), imports: [{spec, target|null, names}], signals, isHook }.
export function classifyFile({ path = '', text = '', imports = [], signals = [], isHook = false }) {
  const reasons = [];
  const lower = String(path).toLowerCase();
  const segments = lower.split('/');
  const name = segments.at(-1) ?? lower;
  const aiFolderTargets = imports.filter((imp) => {
    const t = (imp.target ?? '').toLowerCase();
    if (!/(^|\/)ai\/|(^|\/)llm\//.test(t)) return false;
    const base = (t.split('/').at(-1) ?? '').replace(/\.(mjs|js|cjs)$/, '');
    if (AI_PURE.has(base)) return false;
    // runner.mjs: pure helpers (isAiRunnerCwd, findClaude) do not make the importer the AI; the call does.
    if (base === 'runner' && imp.names?.length && !imp.names.some((n) => RUNNER_AI_NAMES.has(n))) return false;
    return true;
  });
  const owner = (() => {
    // The server first: the entry that listens is the one bot that calls everything else, the AI included.
    if (signals.some((s) => s.type === 'listen' || s.type === 'bind-all') && SERVER_NAME_RE.test(name)) {
      reasons.push('server');
      return 'bot';
    }
    // The page is what you touch: a script, whatever it shows.
    if (segments[0] === 'server' && segments[1] === 'web') {
      return 'script';
    }
    if (isHook) {
      reasons.push('hook');
      return 'ai';
    }
    if (aiFolderTargets.length) {
      reasons.push(`ai-folder:${aiFolderTargets[0].spec}`);
      return 'ai';
    }
    for (const imp of imports) {
      if (AI_SDK_RE.test(imp.spec ?? '')) {
        reasons.push(`ai-sdk:${imp.spec}`);
        return 'ai';
      }
    }
    // The file that starts and talks to the claude process is the AI's door, whatever it imports.
    if (lower === 'server/chat/driver.mjs' || lower === 'server/chat/hub.mjs') {
      reasons.push('driver');
      return 'ai';
    }
    // A claude command counts inside the chat pipeline; elsewhere (the actions) it is only a shortcut someone may use.
    const inChatPipeline = segments[0] === 'server' && (segments[1] === 'chat' || segments[1] === 'ai');
    const aiSignal = signals.find((s) => (s.type === 'command' && s.value === 'claude' && inChatPipeline)
      || ((s.type === 'sdk' || s.type === 'dep' || s.type === 'host') && AI_SERVICE_RE.test(s.value ?? '')));
    if (aiSignal) {
      reasons.push(`ai-service:${aiSignal.value}`);
      return 'ai';
    }
    if (KNOWN_BOTS.has(lower)) {
      reasons.push('robot');
      return 'bot';
    }
    if (ROBOT_NAME_RE.test(lower)) {
      reasons.push('name');
      return 'bot';
    }
    if (imports.some((imp) => SCHEDULER_SPECS.has(imp.spec))) {
      reasons.push('scheduler');
      return 'bot';
    }
    if (ROBOT_TEXT_RE.test(text)) {
      reasons.push('loop');
      return 'bot';
    }
    return 'script';
  })();
  return { owner, reasons };
}

