import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERNALS } from '../server/actions.mjs';
import { createChatHub } from '../server/chat/hub.mjs';
import { cerebroNote, TAG_LINE } from '../server/ai/cerebro-note.mjs';
import { runArgs } from '../server/chat/run.mjs';
import { STANCE } from '../server/ai/stance.mjs';

// The talk chat is told the owner's Cérebro (id156, or67): the rows he put on another AI and how to hand the work over.

const edits = { claude: { edits: 'hooks' }, openai: { edits: 'api' }, gemini: { edits: 'api' }, deepseek: { edits: 'worktree' } };
const aiWith = (functions) => ({ others: { functions } });

test('no row on another AI: only the line that says how to start an agent, so the agents of the tab apply', () => {
  assert.equal(cerebroNote({ ai: aiWith({}), status: edits }), TAG_LINE);
  assert.equal(cerebroNote({ ai: aiWith({ code: { provider: 'claude', model: 'sonnet' }, risk: { provider: 'auto' } }), status: edits }), TAG_LINE);
  assert.equal(cerebroNote({ ai: undefined, status: edits }), TAG_LINE);
  assert.ok(TAG_LINE.includes('begin its description with its kind in brackets, like [code] or [review]'));
  assert.match(TAG_LINE, /kinds: .*security.*money/);
});

test('a row on another AI is named with its kinds, model and level, and whether that AI edits files', () => {
  const note = cerebroNote({ ai: aiWith({ risk: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' }, review: { provider: 'gemini' } }), status: edits });
  assert.match(note, /- risk \(architecture, security, money, personal-data\): deepseek deepseek-v4-pro high, edits files/);
  assert.match(note, /- review \(review\): gemini, answers only/);
  assert.match(note, /run_other_ai/);
  assert.match(note, /ask_other_ai/);
  assert.match(note, /merge_other_ai/);
  assert.ok(note.startsWith(TAG_LINE), 'the tag line leads');
  assert.ok(note.length < 1500, `${note.length} chars`);
});

test('the rows the program runs itself (the entry brain, the book, the bulk work) are not the chat\'s to route', () => {
  const note = cerebroNote({ ai: aiWith({ brain: { provider: 'deepseek' }, book: { provider: 'deepseek' }, background: { provider: 'deepseek' } }), status: edits });
  assert.equal(note, TAG_LINE, 'the engine rows add nothing to the chat');
});

test('the talk run carries the note after its stance, and the stance alone when there is none', () => {
  const run = { kind: 'talk' };
  const plain = runArgs(run);
  assert.equal(plain[plain.indexOf('--append-system-prompt') + 1], STANCE);
  const told = runArgs(run, '', 'NOTE');
  assert.equal(runArgs(run, 'CONDUCTOR TAIL')[runArgs(run).indexOf('--append-system-prompt') + 1], STANCE, 'the conductor tail never reaches the talk chat');
  assert.equal(told[told.indexOf('--append-system-prompt') + 1], `${STANCE}\nNOTE`);
});

test('a talk chat starts with the Cérebro in its prompt when the owner named another AI, and without it when not', async () => {
  const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'sm-cn-root-'));
  const smDir = mkdtempSync(join(tmpdir(), 'sm-cn-sm-'));
  const log = join(smDir, 'argv.json');
  const hub = createChatHub({ smDir, dir: root, bin: FAKE, env: { ...process.env, FAKE_LOG: log }, snapshot: async () => null });
  const state = { projects: [{ id: 'demo', name: 'demo', root, arch: { layers: [], parts: [] }, workCells: [], chats: [] }] };
  Object.defineProperty(state, INTERNALS, { value: { chats: new Map() }, enumerable: false });
  const prompt = () => {
    const argv = JSON.parse(readFileSync(log, 'utf8')).argv;
    return argv[argv.indexOf('--append-system-prompt') + 1];
  };
  const turnEnded = (key) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 10000);
    hub.subscribe(key, { write: (e) => { if (e.type === 'turn-end') { clearTimeout(timer); resolve(); } }, end() {} });
  });
  try {
    const first = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'o que acha de usar Ollama?' }, state);
    assert.equal(first.status, 200);
    await turnEnded(first.body.chatKey);
    assert.equal(prompt(), `${STANCE}
${TAG_LINE}`, 'nothing named: the stance and how to start an agent');
    writeFileSync(join(smDir, 'config.json'), JSON.stringify({ ai: aiWith({ risk: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' } }) }));
    const second = await hub.start({ projectId: 'demo', node: { kind: 'project' }, text: 'o que acha de usar Ollama?' }, state);
    assert.equal(second.status, 200);
    await turnEnded(second.body.chatKey);
    assert.ok(prompt().startsWith(STANCE), 'the stance first');
    assert.match(prompt(), /risk \(architecture, security, money, personal-data\): deepseek deepseek-v4-pro high/);
  } finally {
    await hub.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    rmSync(smDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
