import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENTS, ROLE_LINE_TAG, roleById, roleLine, roleOf, validateAgents } from '../server/ai/agents.mjs';
import { KINDS } from '../server/ai/policy.mjs';

// The specialist agents' catalog (id148, or55): complete over the policy kinds, well-shaped, and resolved by the motor.

test('the catalog covers every policy kind, each exactly once, in nine roles', () => {
  const byKind = new Map();
  for (const r of AGENTS.agents) {
    for (const k of r.kinds) {
      assert.ok(KINDS.includes(k), `unknown kind ${k}`);
      assert.ok(!byKind.has(k), `kind ${k} belongs to two roles`);
      byKind.set(k, r.id);
    }
  }
  assert.deepEqual([...byKind.keys()].sort(), [...KINDS].sort());
  assert.equal(AGENTS.agents.length, 9);
});

test('every role is well-shaped: id, labels, exit, tools, skills and the senior method', () => {
  for (const r of AGENTS.agents) {
    assert.match(r.id, /^[a-z-]+$/);
    assert.ok(r.label && r.labelPt && r.deliver && r.deliverPt, r.id);
    assert.ok(Array.isArray(r.tools) && Array.isArray(r.skills), r.id);
    assert.ok(Number.isInteger(r.briefBytes) && r.briefBytes >= 2048, `${r.id}: the brief cap is per role (or57)`);
    assert.ok(Array.isArray(r.method) && r.method.length >= 3, `${r.id}: the method is the senior training (or56)`);
    assert.ok(Array.isArray(r.methodPt) && r.methodPt.length === r.method.length, `${r.id}: the method speaks both languages`);
    assert.ok(r.method.every((s) => typeof s === 'string' && s.trim()), r.id);
  }
  assert.equal(roleById('coder').kinds.join(','), 'code,test');
  assert.equal(roleById('guardian').kinds.join(','), 'security,money,personal-data');
  assert.equal(roleById('architect').briefBytes, 24576, 'the architect carries context: a bigger brief (or57)');
  assert.equal(roleById('coder').briefBytes, 8192, 'the worker roles keep the lean brief (or57)');
});

test('roleOf resolves the role of a kind, null for an unknown one', () => {
  assert.equal(roleOf('code').id, 'coder');
  assert.equal(roleOf('architecture').id, 'architect');
  assert.equal(roleOf('money').id, 'guardian');
  assert.equal(roleOf('review').id, 'reviewer');
  assert.equal(roleOf('nada'), null);
});

test('roleLine is the fixed line: tag, role, tools, method, exit — and no skill names', () => {
  const line = roleLine(roleOf('code'));
  assert.match(line, new RegExp(`^${ROLE_LINE_TAG}: coder `));
  assert.match(line, /tools: Edit, Write, MultiEdit, Bash, PowerShell/);
  assert.match(line, /method: 1\) define done/);
  assert.match(line, /exit: code with its tests passing/);
  assert.doesNotMatch(line, /test-driven-development/, 'the skills stay out of the line: the brief must name them (or32)');
  const guardian = roleLine(roleOf('money'));
  assert.match(guardian, /tools: none/);
  assert.match(guardian, /method: 1\) name the risk/);
  assert.match(guardian, /acts only with the owner's OK/);
});

test('a broken catalog stops the load, with the reason', () => {
  const base = JSON.parse(readFileSync(new URL('../server/ai/agents.json', import.meta.url), 'utf8'));
  assert.throws(() => validateAgents(null), /not an object/);
  assert.throws(() => validateAgents({}), /no roles/);
  assert.throws(() => validateAgents({ agents: [{ ...base.agents[0], id: 'bad id!' }] }), /no id/);
  assert.throws(() => validateAgents({ agents: base.agents.filter((r) => r.id !== 'coder') }), /kind code has no role/);
  const twice = [{ ...base.agents[0] }, { ...base.agents[0], id: 'other', kinds: ['plan'] }];
  assert.throws(() => validateAgents({ agents: twice }), /belongs to two roles/);
  const noMethod = [{ ...base.agents[0], method: undefined }];
  assert.throws(() => validateAgents({ agents: noMethod }), /no en method/);
  const emptyMethod = [{ ...base.agents[0], method: { en: [], pt: ['um'] } }];
  assert.throws(() => validateAgents({ agents: emptyMethod }), /no en method/);
  const ptOnly = [{ ...base.agents[0], method: { en: ['one'], pt: [] } }];
  assert.throws(() => validateAgents({ agents: ptOnly }), /no pt method/);
  const noBytes = [{ ...base.agents[0], briefBytes: undefined }];
  assert.throws(() => validateAgents({ agents: noBytes }), /no briefBytes/);
});
