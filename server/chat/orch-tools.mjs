// The tools of the orchestrator (or01/or17/or18): only its own sessionmap MCP lists them, and the hub answers a call
// only for the chat whose node kind is 'orchestrator' (orchestra.mjs). Pure data, so the MCP child stays light.
import { EFFORTS, MODELS } from './run.mjs';

// The same four as priority.mjs's PRIORITIES (a test keeps them equal): kept here so the MCP child loads no file code.
export const TOOL_PRIORITIES = ['urgent', 'important', 'normal', 'polish'];

const text = { type: 'string' };
const run = { model: { type: 'string', enum: MODELS }, effort: { type: 'string', enum: EFFORTS } };
const shape = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });

export const ORCH_TOOLS = [
  { name: 'list_chats', description: 'Your activity chats (key, item code, title, model, state, cost, last summary) and your total cost so far.', inputSchema: shape({}) },
  {
    name: 'start_chat',
    description: 'Opens an activity chat on one item code of the map, with only that item\'s context; the instructions are its first message. Model and effort: the cheapest that do the item well (default opus, high). With no free place it waits in the priority line and starts on its turn. Priority: from the item\'s mark unless you say it; "urgent" only when the person said so.',
    inputSchema: shape({ code: text, instructions: text, ...run, priority: { type: 'string', enum: TOOL_PRIORITIES } }, ['code', 'instructions']),
  },
  { name: 'send_to_chat', description: 'Sends the next instructions to one of your activity chats; mid-turn, they wait for its turn end.', inputSchema: shape({ key: text, instructions: text }, ['key', 'instructions']) },
  { name: 'read_chat', description: 'The last replies (1 by default, at most 5) of one of your chats, as plain text.', inputSchema: shape({ key: text, last: { type: 'integer', minimum: 1, maximum: 5 } }, ['key']) },
  { name: 'list_conversations', description: 'The project\'s older conversations that are not live now and not driven by session-map, newest first (at most 50).', inputSchema: shape({}) },
  {
    name: 'continue_conversation',
    description: 'Resumes an older conversation with these instructions as one of your activity chats. Refused for one live in another window.',
    inputSchema: shape({ sessionId: text, instructions: text, ...run }, ['sessionId', 'instructions']),
  },
  { name: 'archive_conversation', description: 'Archives a finished conversation; say why.', inputSchema: shape({ sessionId: text, reason: text }, ['sessionId', 'reason']) },
  { name: 'rename_conversation', description: 'Gives a conversation a clear title.', inputSchema: shape({ sessionId: text, title: text }, ['sessionId', 'title']) },
];

export const ORCH_TOOL_NAMES = new Set(ORCH_TOOLS.map((t) => t.name));
