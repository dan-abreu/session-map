// Stand-in for the `claude` CLI. One-shot mode (ai runner): logs how it was called to FAKE_LOG and prints FAKE_REPLY
// (or sleeps FAKE_SLEEP_MS). Chat mode (--input-format stream-json): speaks the lines recorded in .dev/prova/RESULTADO.md.
//   "PERM:<Tool>" (repeatable) asks our permission MCP once per occurrence; "SLOW" streams until interrupted;
//   anything else is echoed back as "echo: <text>". set_permission_mode changes the mode the next init reports.
//   FAKE_TRANSCRIPTS: a folder where each conversation is written as <sessionId>.jsonl, as claude does under ~/.claude/projects.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const logCall = (stdin) => {
  if (process.env.FAKE_LOG) {
    writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv, cwd: process.cwd(), envKeys: Object.keys(process.env), stdin }));
  }
};

if (flag('--input-format') === 'stream-json') chat();
else oneShot();

function oneShot() {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { stdin += chunk; });
  process.stdin.on('end', () => {
    logCall(stdin);
    const reply = () => process.stdout.write(process.env.FAKE_REPLY ?? '');
    if (process.env.FAKE_SLEEP_MS) setTimeout(reply, Number(process.env.FAKE_SLEEP_MS));
    else reply();
  });
}

function chat() {
  logCall('');
  const sessionId = flag('--resume') ?? randomUUID();
  const out = (msg) => process.stdout.write(`${JSON.stringify({ ...msg, session_id: sessionId })}\n`);
  let interrupted = false;
  let mode = flag('--permission-mode');
  const transcript = (entry) => {
    if (!process.env.FAKE_TRANSCRIPTS) return;
    mkdirSync(process.env.FAKE_TRANSCRIPTS, { recursive: true });
    appendFileSync(join(process.env.FAKE_TRANSCRIPTS, `${sessionId}.jsonl`), `${JSON.stringify({ ...entry, sessionId, cwd: process.cwd(), timestamp: new Date().toISOString() })}
`);
  };
  let turn = Promise.resolve();
  let mcp = null;

  const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
  const result = (extra = {}) => out({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', terminal_reason: 'completed', total_cost_usd: 0.001, permission_denials: [], ...extra });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function startMcp() {
    const raw = flag('--mcp-config');
    const config = JSON.parse(raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8'));
    const server = config.mcpServers.sessionmap;
    const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
    const waiting = new Map();
    createInterface({ input: child.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    });
    let next = 0;
    const rpc = (method, params) => new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    const ready = (async () => {
      const discover = await rpc('server/discover', {});
      if (discover.error?.code !== -32601) throw new Error('server/discover must answer -32601');
      await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fake', version: '0' } });
      const list = await rpc('tools/list', {});
      if (!list.result.tools.some((t) => t.name === 'approve')) throw new Error('no approve tool');
    })();
    return { child, ask: async (args) => { await ready; return rpc('tools/call', { name: 'approve', arguments: args }); } };
  }

  async function run(text) {
    out({ type: 'system', subtype: 'init', cwd: process.cwd(), permissionMode: mode, mcp_servers: [{ name: 'sessionmap', status: 'connected' }] });
    out({ type: 'system', subtype: 'hook_started', hook_name: 'SessionStart' });
    transcript({ type: 'user', message: { role: 'user', content: text } });
    const perms = [...text.matchAll(/PERM:(\w+)/g)].map((m) => m[1]);
    if (perms.length) {
      mcp ??= startMcp();
      const denials = [];
      for (const [i, toolName] of perms.entries()) {
        const id = `toolu_${i}`;
        const input = { file_path: 'x.txt', content: 'hi' };
        out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: toolName, input }] } });
        const reply = await mcp.ask({ tool_name: toolName, input, tool_use_id: id });
        const decision = JSON.parse(reply.result.content[0].text);
        const allowed = decision.behavior === 'allow' && JSON.stringify(decision.updatedInput) === JSON.stringify(input);
        if (!allowed) denials.push({ tool_name: toolName, tool_use_id: id, tool_input: input });
        out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: allowed ? 'written' : decision.message, ...(allowed ? {} : { is_error: true }) }] } });
      }
      out({ type: 'assistant', message: { content: [{ type: 'text', text: 'DONE' }] } });
      return result({ result: 'DONE', permission_denials: denials });
    }
    if (text.includes('SLOW')) {
      for (let i = 0; i < 400; i++) {
        if (interrupted) {
          interrupted = false;
          return result({ subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming' });
        }
        delta(`${i}\n`);
        await sleep(10);
      }
      return result({ result: 'numbers' });
    }
    const reply = `echo: ${text}`;
    delta(reply.slice(0, 3));
    delta(reply.slice(3));
    out({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: reply }] } });
    transcript({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } });
    return result({ result: reply });
  }

  createInterface({ input: process.stdin }).on('line', (line) => {
    const msg = JSON.parse(line);
    if (msg.type === 'control_request' && msg.request?.subtype === 'interrupt') {
      interrupted = true;
      out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { still_queued: [] } } });
    } else if (msg.type === 'control_request' && msg.request?.subtype === 'set_permission_mode') {
      mode = msg.request.mode;
      out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { mode } } });
    } else if (msg.type === 'user') {
      turn = turn.then(() => run(msg.message.content));
    }
  }).on('close', () => turn.then(() => { mcp?.child.kill(); process.exit(0); }));
}
