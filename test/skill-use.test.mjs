import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillUseOf, weekByPlugin } from '../server/sources/skill-use.mjs';
import { readTranscript, readHelperWork } from '../server/sources/claude.mjs';
import { listPlugins, listSkills } from '../server/sources/skills.mjs';

const skillLine = (id, skill, ts = '2026-10-12T10:00:00.000Z') => JSON.stringify({
  type: 'assistant', sessionId: 's', cwd: '/work/a', timestamp: ts,
  message: { id, model: 'claude-fake-1', role: 'assistant', content: [{ type: 'tool_use', id: `t-${id}`, name: 'Skill', input: { skill } }], usage: { input_tokens: 1, output_tokens: 1 } },
});

function chatFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sm-su-'));
  const session = join(dir, 'sess');
  mkdirSync(join(session, 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'sess.jsonl'), `${skillLine('p1', 'tdd')}\n${skillLine('p2', 'tdd')}\n`);
  writeFileSync(join(session, 'subagents', 'agent-a1.jsonl'), `${skillLine('a1', 'tdd')}\n${skillLine('a2', 'plug:review')}\n`);
  writeFileSync(join(session, 'subagents', 'agent-a2.jsonl'), `${skillLine('b1', 'tdd')}\n`);
  return { dir, session };
}

test('the transcripts of a chat and of its subagents give the skills opened, with counts, weight and the snowball', () => {
  const { dir, session } = chatFixture();
  try {
    const own = readTranscript(join(dir, 'sess.jsonl')).skillCalls;
    const { skillRuns } = readHelperWork(session);
    assert.equal(own.length, 2);
    assert.deepEqual(skillRuns.map((r) => r.agent).sort(), ['a1', 'a2']);
    const sizes = new Map([['tdd', 1000], ['plug:review', 500]]);
    const use = skillUseOf({ own, runs: skillRuns, sizes });
    const tdd = use.skills.find((s) => s.name === 'tdd');
    assert.deepEqual([tdd.count, tdd.agents, tdd.bytes, tdd.snowball], [4, 3, 4000, true]);
    const review = use.skills.find((s) => s.name === 'plug:review');
    assert.deepEqual([review.count, review.agents, review.bytes, review.snowball], [1, 1, 500, false]);
    assert.equal(use.bytes, 4500);
    assert.deepEqual(use.perAgent.find((a) => a.agent === 'a1').skills.map((s) => [s.name, s.count]), [['tdd', 1], ['plug:review', 1]]);
    assert.equal(use.perAgent[0].agent, 'chat');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a skill call repeated on two lines of a split reply is counted once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-su2-'));
  try {
    writeFileSync(join(dir, 's.jsonl'), `${skillLine('m1', 'tdd')}\n${skillLine('m1', 'tdd')}\n`);
    assert.equal(readTranscript(join(dir, 's.jsonl')).skillCalls.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two agents opening a skill is not yet a snowball, and an unknown skill weighs nothing', () => {
  const use = skillUseOf({ own: [{ name: 'x', ts: null }], runs: [{ agent: 'a', calls: [{ name: 'x', ts: null }] }], sizes: new Map() });
  assert.equal(use.skills[0].snowball, false);
  assert.equal(use.skills[0].bytes, 0);
});

test('weekByPlugin counts only the openings of the last 7 days, per plugin', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  const calls = [{ name: 'p:a', ts: '2026-10-12T00:00:00Z' }, { name: 'p:a', ts: '2026-10-01T00:00:00Z' }, { name: 'free', ts: '2026-10-12T00:00:00Z' }];
  const week = weekByPlugin(calls, new Map([['p:a', 100], ['free', 9]]), now);
  assert.deepEqual(week.get('p'), { count: 1, bytes: 100 });
  assert.equal(week.has('free'), false);
});

test('plugins carry their repository, their listing weight and the weight of each SKILL.md', () => {
  const claude = mkdtempSync(join(tmpdir(), 'sm-sp-c-'));
  const root = mkdtempSync(join(tmpdir(), 'sm-sp-r-'));
  try {
    const on = join(claude, 'plugins', 'cache', 'mk', 'on', '1');
    mkdirSync(join(on, 'skills', 'alpha'), { recursive: true });
    const body = `---\nname: alpha\ndescription: ${'d'.repeat(300)}\n---\nbody\n`;
    writeFileSync(join(on, 'skills', 'alpha', 'SKILL.md'), body);
    writeFileSync(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'on@mk': [{ scope: 'user', installPath: on }], 'x@other': [{ scope: 'user', installPath: on }] } }));
    writeFileSync(join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: { 'on@mk': true }, extraKnownMarketplaces: { mk: { source: { source: 'github', repo: 'owner/repo' } } } }));
    const [p, x] = listPlugins(root, claude);
    assert.equal(p.from, 'owner/repo');
    assert.equal(x.from, 'other', 'with no declared repository the marketplace name stands in');
    const skill = listSkills(root, claude).find((s) => s.name === 'alpha' && s.plugin === 'on');
    assert.equal(skill.fullBytes, Buffer.byteLength(body));
    assert.equal(skill.listingBytes, Buffer.byteLength('alpha') + 300);
    assert.deepEqual([p.skillCount, p.listingBytes, p.enabled], [1, 305, true]);
    assert.equal(x.enabled, false);
  } finally { rmSync(claude, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});
