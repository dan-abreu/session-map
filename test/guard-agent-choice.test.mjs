import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_CODE, NO_OWNER_OK, NO_PLAN, NO_PROOF, NO_REPRO, NO_REVIEW, NO_SKILL, NO_TARGET, BRIEF_CAP_BYTES, WHOLE_FILE_BYTES, NO_BRIEF_LONG, NO_REREAD, chatSkillSettings, guardAgent, guardAgentRead, guardAgentTool, guardStep, guardWorkflow, roleFromBrief } from '../server/chat/guard.mjs';
import { roleLine, roleOf } from '../server/ai/agents.mjs';
import { levelFor } from '../server/ai/policy.mjs';

// The Cérebro's choices ride on the agents (or42): the guard holds each agent's model and effort from the row of the
// kind it executes. The specialist roles (id148, or55) ride with them: the role line opens the brief, and inside the
// agent only the role's tools and skills hold. Only Claude models can run today (the Agent tool is Claude Code);
// another engine's choice leaves the policy holding.

const agent = (description, prompt = 'p') => ({ tool_name: 'Agent', tool_input: { description, prompt } });
const set = (out) => out.hookSpecificOutput.updatedInput;
const rolePrompt = (kind) => roleLine(roleOf(kind));

test('the Cérebro choice rides on the agent when it is a Claude model', () => {
  const out = guardAgent(agent('[code] fix the header', 'fix the header, run the tests'), { functions: { code: { provider: 'claude', model: 'opus', effort: 'xhigh' } } });
  assert.deepEqual(set(out), { description: '[code] fix the header', prompt: `${rolePrompt('code')}\nfix the header, run the tests`, model: 'opus', effort: 'xhigh' });
});

test('a choice for another engine leaves the policy holding: agents still run on Claude Code', () => {
  const out = guardAgent(agent('[code] fix the header', 'fix the header, run the tests'), { functions: { code: { provider: 'deepseek', model: 'deepseek-v4-pro', effort: 'high' } } });
  assert.deepEqual(set(out), { description: '[code] fix the header', prompt: `${rolePrompt('code')}\nfix the header, run the tests`, model: 'sonnet', effort: 'medium' });
});

test('a non-Claude model or effort word is ignored, and the ladder still climbs', () => {
  const bad = guardAgent(agent('[code] fix', 'fix it, run the tests'), { functions: { code: { model: 'gpt-6-luna' } } });
  assert.equal(set(bad).model, 'sonnet', 'not a Claude model: ignored');
  const up = guardAgent(agent('[code^1] again', 'The first try failed: tests red.'), { functions: { code: { model: 'opus' } } });
  assert.equal(set(up).model, 'opus', 'the choice rides on the ladder rung');
  assert.equal(set(up).effort, 'high', 'the rung effort stays');
  assert.match(set(up).prompt, /^session-map-role: coder /);
});

test('no functions, no change: the policy alone', () => {
  const out = guardAgent(agent('[code] fix the header', 'fix the header, run the tests'));
  assert.deepEqual(set(out), { description: '[code] fix the header', prompt: `${rolePrompt('code')}\nfix the header, run the tests`, model: 'sonnet', effort: 'medium' });
});

test('the "agents" row rides on top of every kind row: the owner\'s one knob for all agents (id146)', () => {
  const all = guardAgent(agent('[code] fix the header', 'fix the header, run the tests'), { functions: { code: { model: 'opus', effort: 'high' }, agents: { model: 'sonnet', effort: 'low' } } });
  assert.equal(set(all).model, 'sonnet', 'the agents row wins over the kind row');
  assert.equal(set(all).effort, 'low');
  const risk = guardAgent(agent('[security] check the key'), { functions: { agents: { model: 'haiku' } } });
  assert.equal(set(risk).model, 'haiku', 'every kind, the same knob');
  assert.equal(set(risk).effort, 'high', 'the kind\'s own effort stays when the row names no level');
  const outside = guardAgent(agent('[code] fix', 'fix it, run the tests'), { functions: { agents: { provider: 'gemini', model: 'gemini-3.1-flash-lite' } } });
  assert.equal(set(outside).model, 'sonnet', 'another engine\'s agents choice leaves the policy holding');
});

test('every kind has its role: the line rides the brief and the reason names it', () => {
  const out = guardAgent(agent('[architecture] design the module'));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(set(out).prompt, /^session-map-role: architect /);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /role architect/);
});

test('money agents act only after the owner\'s one-click confirmation (or43)', () => {
  const why = (out) => out.hookSpecificOutput.permissionDecisionReason;
  assert.equal(why(guardAgent(agent('[money] pay the invoice'))), NO_OWNER_OK);
  assert.equal(why(guardAgent(agent('[money] pay the invoice', 'Recommend it to the owner.'))), NO_OWNER_OK, 'a recommendation is still not an approval');
  const ok = guardAgent(agent('[money] pay the invoice', 'The owner approved. Pay it now.'));
  assert.equal(ok.hookSpecificOutput.permissionDecision, 'allow');
  assert.equal(set(ok).model, 'opus', 'approved money work runs at the policy level');
  assert.match(set(ok).prompt, /^session-map-role: guardian /, 'money work is the guardian\'s');
  const pt = guardAgent(agent('[money] pagar a fatura', 'O dono aprovou. Pague.'));
  assert.equal(pt.hookSpecificOutput.permissionDecision, 'allow', 'the approval words work in both languages');
});

// The senior entry gates (id149, or56): a senior worker refuses a vague ticket — the brief must carry the role's
// ingredient, or the agent never starts.
test('the senior entry gates: a vague brief is denied before the agent starts', () => {
  assert.equal(why(guardAgent(agent('[code] fix the header', 'fix the header.'))), NO_PROOF);
  assert.equal(why(guardAgent(agent('[debug] look at the login', 'check the login flow.'))), NO_REPRO);
  assert.equal(why(guardAgent(agent('[review] check it', 'please check my work.'))), NO_TARGET);
  assert.equal(why(guardAgent(agent('[docs] write it', 'write the docs.'))), NO_CODE);
});

test('the senior entry gates let the senior brief through, in both languages', () => {
  const ok = guardAgent(agent('[code] fix the header', 'fix the header and run the tests.'));
  assert.equal(ok.hookSpecificOutput.permissionDecision, 'allow');
  const pt = guardAgent(agent('[code] consertar o cabeçalho', 'conserta o cabeçalho e roda a suíte.'));
  assert.equal(pt.hookSpecificOutput.permissionDecision, 'allow', 'suíte matches too');
  const dbg = guardAgent(agent('[debug] the login', 'the login is broken: reproduce with the failing test.'));
  assert.equal(dbg.hookSpecificOutput.permissionDecision, 'allow');
  const rev = guardAgent(agent('[review] the diff', 'review the diff of server/chat/guard.mjs'));
  assert.equal(rev.hookSpecificOutput.permissionDecision, 'allow');
  const doc = guardAgent(agent('[docs] the guard', 'document `server/chat/guard.mjs`'));
  assert.equal(doc.hookSpecificOutput.permissionDecision, 'allow');
});

// The role's hold inside the agent (id148, or55): tools and skills, with the brief carrying the role line.
const inner = (tool, text) => guardAgentTool({ tool_name: tool, agent_id: 'a', tool_input: {} }, { brief: () => text });
const why = (out) => out?.hookSpecificOutput?.permissionDecisionReason;

test('inside the agent, a tool the role does not carry is denied; its own tools pass', () => {
  const coder = `${rolePrompt('code')}\ndo the work`;
  assert.equal(inner('Bash', coder), null, 'Bash is the coder\'s tool');
  assert.equal(inner('Edit', coder), null, 'Edit is the coder\'s tool');
  assert.match(why(inner('Workflow', coder)), /does not carry the Workflow tool/);
  assert.match(why(inner('Agent', coder)), /does not carry the Agent tool/, 'an agent executes its role, it does not run an orchestra');
  const finder = `${rolePrompt('search')}\nlist the files`;
  assert.match(why(inner('Edit', finder)), /does not carry the Edit tool/);
  assert.match(why(inner('Bash', finder)), /does not carry the Bash tool/);
  const reviewer = `${rolePrompt('review')}\ncheck the diff`;
  assert.equal(inner('Bash', reviewer), null, 'the reviewer runs the tests to verify claims');
  assert.match(why(inner('Edit', reviewer)), /does not carry the Edit tool/, 'the reviewer never fixes');
});

test('no readable brief means no tools gate: the guard fails open on its own failure', () => {
  assert.equal(inner('Bash', null), null);
});

test('a skill passes only when the brief names it AND the role carries it', () => {
  const skill = (name, text) => guardAgent({ tool_name: 'Skill', agent_id: 'a', tool_input: { skill: name } }, { brief: () => text });
  const coder = rolePrompt('code');
  assert.equal(skill('test-driven-development', `${coder}\nuse test-driven-development`), null);
  assert.equal(why(skill('test-driven-development', `${coder}\njust fix the header`)), NO_SKILL, 'the brief must name it (or32)');
  assert.match(why(skill('brainstorming', `${coder}\nuse brainstorming`)), /does not carry the skill/);
  assert.equal(skill('superpowers:test-driven-development', `${coder}\nuse superpowers:test-driven-development`), null, 'the namespaced name matches too');
  const guardian = rolePrompt('security');
  assert.match(why(skill('brainstorming', `${guardian}\nuse brainstorming`)), /does not carry the skill/);
});

test('the role line names the role, and roleFromBrief reads it back', () => {
  assert.equal(roleFromBrief(`${rolePrompt('debug')}\nfix the leak`).id, 'debugger');
  assert.equal(roleFromBrief('no line here'), null);
});

// The economy as law (id150, or57): the brief is capped per role; inside an agent the map, the rules and the whole
// big file are off the reading list — with the capacity kept: the roles whose work is context get the bigger brief,
// and the architect and the planner keep the map.
test('the brief cap is per role: the worker roles keep the lean cap, the context roles get the bigger brief', () => {
  const coderCap = roleOf('code').briefBytes;
  assert.equal(roleOf('architecture').briefBytes, 24576);
  assert.equal(roleOf('review').briefBytes, 16384);
  const long = 'x'.repeat(coderCap + 1);
  assert.equal(why(guardAgent(agent('[code] fix it', `run the tests. ${long}`))), NO_BRIEF_LONG(coderCap));
  const at = 'x'.repeat(coderCap - 'run the tests. '.length);
  assert.equal(guardAgent(agent('[code] fix it', `run the tests. ${at}`)).hookSpecificOutput.permissionDecision, 'allow', 'at the role cap passes');
  const arch = 'x'.repeat(10000);
  assert.equal(guardAgent(agent('[architecture] the design', `design the module. ${arch}`)).hookSpecificOutput.permissionDecision, 'allow', 'the architect carries a bigger brief');
  assert.equal(guardAgent(agent('[code] fix it', `run the tests. ${arch}`)).hookSpecificOutput.permissionDecision, 'deny', 'the same brief is over the coder cap');
});

test('inside an agent, the map and the rules are not re-read — the architect and the planner keep them', () => {
  const read = (file_path, role, cwd = '/repo') => guardAgentRead({ tool_name: 'Read', agent_id: 'a', tool_input: { file_path }, cwd }, { brief: () => roleLine(roleOf(role)) });
  assert.equal(why(read('/repo/docs/architecture/orchestration.md', 'code')), NO_REREAD);
  assert.equal(why(read('/repo/docs/standard/politica-de-modelos.md', 'code')), NO_REREAD);
  assert.equal(read('/repo/docs/architecture/orchestration.md', 'architecture'), null, 'the map is the architect\'s own work');
  assert.equal(read('/repo/docs/standard/politica-de-modelos.md', 'plan'), null, 'the standards are the planner\'s own work');
  assert.equal(why(read('/repo/CLAUDE.md', 'architecture')), NO_REREAD, 'CLAUDE.md is every agent\'s inherited context');
  assert.equal(why(read('/repo/CLAUDE.md', 'code')), NO_REREAD);
  assert.equal(read('/repo/docs/superpowers/plans/p.md', 'code'), null, 'the plan files stay readable');
  assert.equal(read('/repo/server/ai/agents.json', 'code'), null, 'the work files stay readable');
  assert.equal(guardAgentRead({ tool_name: 'Read', agent_id: 'a', tool_input: { file_path: '/repo/docs/architecture/x.md' }, cwd: '/repo' }, { brief: () => null }), null, 'a brief without a role line fails open: the guard never stops work on its own failure');
});

test('inside an agent, a whole big file is denied: a slice (offset/limit) or the index', () => {
  const read = (extra = {}, stat = { size: WHOLE_FILE_BYTES + 1 }) => guardAgentRead(
    { tool_name: 'Read', agent_id: 'a', tool_input: { file_path: '/repo/server/web/i18n.js', ...extra }, cwd: '/repo' },
    { stat: () => stat, exists: () => true });
  assert.match(why(read()), /over 64 KB/);
  assert.equal(read({ offset: 1, limit: 50 }), null, 'a slice passes');
  assert.equal(read({ offset: 1 }), null, 'offset alone is a slice');
  assert.equal(read({ limit: 200 }), null, 'limit alone is a slice');
  assert.equal(read({}, { size: 100 }), null, 'a small file reads whole');
  assert.equal(read({}, { size: WHOLE_FILE_BYTES }), null, 'exactly at the cap reads whole');
  assert.equal(read({}, null), null, 'an unreadable file fails open: the guard never stops work on its own failure');
  assert.equal(guardAgentRead({ tool_name: 'Read', tool_input: { file_path: '/repo/docs/architecture/x.md' }, cwd: '/repo' }), null, 'the conductor itself reads freely');
});

// The superpowers doors (id133, or44): the plan and the review, as engines.
const wf = (script) => ({ tool_name: 'Workflow', tool_input: { script, cwd: process.cwd() } });

test('the plan door: a 3+ agent workflow runs only when it names a plan that exists and parses', () => {
  const three = Array.from({ length: 3 }, (_, i) => `await agent({ label: 'a${i}', prompt: 'x' });`).join('\n');
  assert.match(why(guardWorkflow(wf(three))), /needs a plan/);
  const named = `// plan: docs/superpowers/plans/2026-10-14-user-hooks-fixture.md\n${three}`;
  assert.equal(guardWorkflow(wf(named)), null, 'the fixture plan exists and parses');
  assert.match(why(guardWorkflow(wf(`// plan: docs/superpowers/plans/no-such-plan.md\n${three}`))), /plan-missing/);
});

test('the review door: code work ships only with its [review] agent of another family', () => {
  const code = "await agent({ label: '[code] fix it', prompt: 'p' });";
  const review = "await agent({ label: '[review] check it', prompt: 'p' });";
  assert.match(why(guardWorkflow(wf(code))), /needs its review/);
  assert.equal(guardWorkflow(wf(`${code}\n${review}`)), null);
  assert.equal(guardWorkflow(wf("await agent({ label: '[plan] think', prompt: 'p' });")), null, 'no code work: no review needed');
});

// The airplane mode (id136): one switch, every skill and plugin off — the program's own never falls.
test('the airplane mode turns every skill name-only and every plugin off except the program itself', () => {
  const skills = [{ name: 'ponytail', command: '/ponytail', origin: 'user', enabled: true }];
  const plugins = [
    { id: 'ponytail@ponytail', name: 'ponytail', enabled: true, month: { count: 0 } },
    { id: 'session-map@session-map', name: 'session-map', enabled: true, month: { count: 3 } },
  ];
  const air = chatSkillSettings({ skills, plugins, part: null, text: 'usa a ponytail', skillsOn: false });
  assert.deepEqual(air.skillOverrides, { ponytail: 'name-only' });
  assert.deepEqual(air.enabledPlugins, { 'ponytail@ponytail': false }, 'the program\'s own plugin stays');
  const on = chatSkillSettings({ skills, plugins, part: null, text: 'usa a ponytail' });
  assert.equal(on.skillOverrides.ponytail, 'on', 'with the mode off the focus still picks the named skill');
  assert.equal(on.enabledPlugins['ponytail@ponytail'], undefined, 'and the plugin stays on when named');
});

// The per-skill switches (id139): a skill the owner turned off stays name-only whatever the focus picks.
test('an off skill never loads, even when the focus picks it', () => {
  const skills = [{ name: 'ponytail', command: '/ponytail', origin: 'user', enabled: true }];
  const off = chatSkillSettings({ skills, plugins: [], part: null, text: 'usa a ponytail', skillsOff: ['/ponytail'] });
  assert.equal(off.skillOverrides.ponytail, 'name-only', 'the owner\'s off beats the focus');
  const byName = chatSkillSettings({ skills, plugins: [], part: null, text: 'usa a ponytail', skillsOff: ['ponytail'] });
  assert.equal(byName.skillOverrides.ponytail, 'name-only', 'the name works too');
  const onAgain = chatSkillSettings({ skills, plugins: [], part: null, text: 'usa a ponytail', skillsOff: [] });
  assert.equal(onAgain.skillOverrides.ponytail, 'on', 'and an empty list restores the focus');
});

test('open (id154): no AI is stopped by a work rule; the routing, the force push and the money OK stay', async () => {
  const open = { open: true, brief: () => `${rolePrompt('search')}\nlist the files` };
  assert.equal(await guardStep(agent('no tag here'), open), null, 'an untagged agent runs as it was asked');
  const routed = await guardStep(agent('[code] fix the header', 'fix it'), open);
  assert.equal(routed.hookSpecificOutput.permissionDecision, 'allow', 'a vague brief still runs, on the policy\'s model');
  assert.equal(set(routed).model, levelFor('code', 0).model);
  assert.equal(set(await guardStep(agent('[code^1] fix it', 'again'), open)).model, levelFor('code', 0).model, 'a climb without a failure runs on the plain rung');
  const inside = { agent_id: 'a1', tool_input: {} };
  assert.equal(await guardStep({ ...inside, tool_name: 'Edit', tool_input: { file_path: 'src/a.mjs' } }, open), null, 'a role does not hold its tools');
  assert.equal(await guardStep({ ...inside, tool_name: 'Skill', tool_input: { skill: 'superpowers:brainstorming' } }, open), null, 'nor its skills');
  assert.equal(await guardStep({ tool_name: 'Workflow', tool_input: { script: 'agent("[code] a");'.repeat(30) } }, open), null, 'nor a workflow');
  assert.equal(await guardStep({ tool_name: 'Edit', tool_input: { file_path: 'docs/architecture/x.md' }, cwd: '.' }, { ...open, env: {} }), null, 'nor the map');
  assert.equal(why(await guardStep(agent('[money] buy the plan', 'buy it'), open)), NO_OWNER_OK, 'money still waits for the owner');
  const push = ['git', 'push', '--force'].join(' ');
  assert.match(why(await guardStep({ tool_name: 'Bash', tool_input: { command: push } }, open)), /force/i, 'a force push is still refused');
});
