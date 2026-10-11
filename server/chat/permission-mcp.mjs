// The permission prompt tool of an in-page chat: a stdio MCP server (one JSON-RPC message per line, no SDK) that
// claude starts as its child. Each request goes to the session-map server on 127.0.0.1, which asks the page.
// The project's orchestrator (SM_ORCHESTRATOR=1) also gets its tools (orch-tools.mjs); a call of any of them goes to
// the same relay with the chat's own secret, so the hub knows who calls and refuses every other chat.
import { createInterface } from 'node:readline';
import { ORCH_TOOLS } from './orch-tools.mjs';

const URL_ = process.env.SM_PERMISSION_URL;
const SECRET = process.env.SM_PERMISSION_SECRET;
const ORCHESTRATOR = process.env.SM_ORCHESTRATOR === '1';
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

const approveTool = {
  name: 'approve',
  description: 'Asks the person in the session-map page to allow or deny a tool call',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
};

async function decide(args) {
  try {
    const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-map-secret': SECRET ?? '' }, body: JSON.stringify(args ?? {}) });
    if (res.ok) return await res.json();
  } catch { /* the server is gone: deny below */ }
  return { behavior: 'deny', message: 'session-map could not ask the person; denied' };
}

// → the tool's answer as MCP content: the hub's text, or its error marked as one.
async function useTool(name, args) {
  let answer = null;
  try {
    const res = await fetch(new URL('/tool', URL_), { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-map-secret': SECRET ?? '' }, body: JSON.stringify({ name, arguments: args ?? {} }) });
    if (res.ok) answer = await res.json();
  } catch { /* the server is gone: said below */ }
  if (answer?.ok) return { content: [{ type: 'text', text: String(answer.text ?? '') }] };
  return { content: [{ type: 'text', text: String(answer?.error ?? 'session-map could not be reached; try again later') }], isError: true };
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sessionmap', version: '1.0.0' } } });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: ORCHESTRATOR ? [approveTool, ...ORCH_TOOLS] : [approveTool] } });
  } else if (method === 'tools/call' && params?.name !== undefined && params.name !== 'approve') {
    send({ jsonrpc: '2.0', id, result: await useTool(String(params.name), params.arguments) });
  } else if (method === 'tools/call') {
    const decision = await decide(params?.arguments);
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
  } else if (id !== undefined) {
    // server/discover lands here too: -32601 makes claude fall back to initialize.
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
  }
});
