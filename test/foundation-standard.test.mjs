import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGES, loadStandard, conditionMatches, stagesFor, checkApplies, severityFor, unknownStandardRefs, flatProfile,
} from '../server/foundation/standard.mjs';

const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'standard');

function tmpStandard(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-std-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
const table = (rows) => `# Stage\n\n| Verificação | Como é detectada | Sev. |\n|---|---|---|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n\nDepois.\n`;

test('every one of the 14 stage files yields at least one check', () => {
  const std = loadStandard(REAL);
  for (const s of STAGES) assert.ok(std.some((c) => c.stage === s), `stage ${s} has no check`);
  assert.equal(STAGES.length, 14);
});

test('loadStandard parses every table row of the real standard (independent count)', () => {
  let expected = 0;
  for (const f of readdirSync(REAL).filter((n) => /^\d\d-.*\.md$/.test(n))) {
    const lines = readFileSync(join(REAL, f), 'utf8').split(/\r?\n/);
    const at = lines.findIndex((l) => /^\|\s*Verificação\s*\|\s*Como é detectada\s*\|\s*Sev\.\s*\|/.test(l));
    assert.ok(at >= 0, `${f} has no gates table`);
    for (let i = at + 2; i < lines.length && lines[i].startsWith('|'); i++) expected++;
  }
  assert.equal(loadStandard(REAL).length, expected);
  assert.ok(expected >= 100);
});

test('ids are <NN>.<slug>, unique, and severity is E, R or A', () => {
  const std = loadStandard(REAL);
  const ids = std.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of std) {
    assert.match(c.id, /^\d\d\.[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(c.id.startsWith(`${c.stage}.`));
    assert.ok(['E', 'R', 'A'].includes(c.severity));
    assert.ok(c.text && c.detect);
  }
  const webhook = std.find((c) => c.stage === '05' && /^Webhook com assinatura/.test(c.text));
  assert.equal(webhook.severity, 'E');
});

test('every docs/standard file stays at or under 300 lines', () => {
  for (const f of readdirSync(REAL).filter((n) => n.endsWith('.md'))) {
    const n = readFileSync(join(REAL, f), 'utf8').split('\n').length;
    assert.ok(n <= 301, `${f} has ${n} lines`);
  }
});

test('qualifiers map through the closed table; unknown ones apply always and keep the text', () => {
  const dir = tmpStandard({
    '03-x.md': table([
      ['Só web', 'a', 'Essencial (web)'],
      ['Sem qualificador', 'b', 'Essencial'],
      ['Com robôs', 'c', 'Essencial com robôs'],
      ['Sobe em produto novo', 'd', 'Recomendado (essencial em produto novo)'],
      ['Sobe em coisa estranha', 'e', 'Recomendado (essencial em lógica crítica)'],
      ['Avançado', 'f', 'Avançado (recomendado em dinheiro)'],
      ['Só web', 'g', 'Essencial (web)'],
    ]),
  });
  try {
    const std = loadStandard(dir);
    const [web, plain, robots, grows, strange, adv, dup] = std;
    assert.deepEqual([web.severity, web.when, web.whenText], ['E', { types: ['web'] }, 'web']);
    assert.deepEqual([plain.when, plain.whenText, plain.raise], [null, null, null]);
    assert.deepEqual([robots.severity, robots.when, robots.whenText], ['E', null, 'com robôs']);
    assert.equal(grows.severity, 'R');
    assert.equal(grows.raise.to, 'E');
    assert.deepEqual(grows.raise.when.stage, ['idea', 'prototype']);
    assert.equal(strange.raise.when, null);
    assert.equal(adv.severity, 'A');
    assert.equal(adv.raise.to, 'R');
    assert.notEqual(web.id, dup.id, 'same text twice must not collide');
    assert.equal(web.id, '03.so-web');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('files outside NN-*.md and a missing folder are ignored', () => {
  const dir = tmpStandard({ 'README.md': table([['x', 'y', 'Essencial']]), 'notes.md': 'nada' });
  try {
    assert.deepEqual(loadStandard(dir), []);
    assert.deepEqual(loadStandard(join(dir, 'nope')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('conditionMatches: types, signals, sizes, money, stage, team; unknown profile data never hides a check', () => {
  const lib = { profile: flatProfile({ types: ['library'], signals: [] }), idea: { size: 'small', sensitive: [] } };
  assert.equal(conditionMatches({ types: ['web'] }, lib), false);
  assert.equal(conditionMatches({ types: ['library'] }, lib), true);
  assert.equal(conditionMatches({ signals: ['personal-data'] }, lib), false);
  assert.equal(conditionMatches({ sizes: ['medium', 'large'] }, lib), false);
  assert.equal(conditionMatches({ sensitive: true }, lib), false);
  const unknown = { profile: flatProfile({}), idea: { size: 'small', sensitive: [] } };
  assert.equal(conditionMatches({ types: ['web'] }, unknown), true, 'no types detected = unknown = shown');
  assert.equal(conditionMatches({ money: ['subscription'] }, unknown), true);
  assert.equal(conditionMatches({ team: 'notSolo' }, unknown), true);
  const solo = { profile: flatProfile({ team: { kind: 'solo', authors: 1 } }), idea: { size: 'large', sensitive: ['money'] } };
  assert.equal(conditionMatches({ team: 'notSolo' }, solo), false);
  assert.equal(conditionMatches({ sensitive: true, sizes: ['large'] }, solo), true);
  assert.equal(conditionMatches(null, solo), true);
});

test('flatProfile merges detected and owner, owner wins, signals can be strings or objects', () => {
  const p = flatProfile({
    detected: { types: ['web'], signals: [{ kind: 'login', evidence: [] }, 'payments'], team: { kind: 'solo' } },
    owner: { money: 'subscription', audience: ['kids'], stage: 'growth', country: 'BR' },
  });
  assert.deepEqual(p.types, ['web']);
  assert.deepEqual(p.signals.sort(), ['login', 'payments']);
  assert.equal(p.money, 'subscription');
  assert.equal(p.stage, 'growth');
  assert.equal(p.teamKind, 'solo');
});

test('stagesFor: a trivial idea passes through 03, 04 and 06 only', () => {
  const rows = stagesFor({ size: 'trivial', sensitive: [], profile: {} });
  assert.equal(rows.length, 14);
  assert.deepEqual(rows.filter((r) => r.applies).map((r) => r.stage), ['03', '04', '06']);
  for (const r of rows) assert.ok(r.reason && typeof r.reason.msg === 'string');
});

test('stagesFor: a large sensitive idea (charge for a subscription) passes through all 14 when the profile excludes nothing', () => {
  const rows = stagesFor({ size: 'large', sensitive: ['money'], profile: { types: ['web'], money: 'subscription' } });
  assert.equal(rows.filter((r) => r.applies).length, 14);
});

test('stagesFor: medium + sensitive shows what applies and hides what the profile excludes, each with a reason', () => {
  const rows = stagesFor({ size: 'medium', sensitive: ['auth'], profile: { types: ['library'], money: 'personal' } });
  const by = Object.fromEntries(rows.map((r) => [r.stage, r]));
  assert.equal(by['05'].applies, true, 'sensitive auth brings security in');
  assert.equal(by['05'].by, 'sensitive');
  assert.equal(by['05'].reason.params.kind, 'auth');
  assert.equal(by['03'].applies, true);
  assert.equal(by['03'].by, 'size');
  assert.equal(by['01'].applies, true);
  assert.equal(by['07'].applies, false, 'a library runs no service');
  assert.equal(by['07'].by, 'profile');
  assert.equal(by['07'].reason.params.why, 'no-running-service');
  assert.equal(by['13'].applies, false, 'finance is outside a medium idea');
  for (const r of rows) assert.ok(r.reason && r.reason.msg);
});

test('stagesFor: a large idea in a personal library hides the stages the profile excludes, with the why', () => {
  const rows = stagesFor({ size: 'large', sensitive: [], profile: { types: ['library'], money: 'personal' } });
  const by = Object.fromEntries(rows.map((r) => [r.stage, r]));
  assert.deepEqual([by['09'].applies, by['09'].by, by['09'].reason.params.why], [false, 'profile', 'no-screen']);
  for (const s of ['10', '11', '12', '13']) assert.deepEqual([by[s].applies, by[s].reason.params.why], [false, 'personal-project'], s);
  assert.equal(by['05'].applies, true, 'security is never excluded by the profile');
  const withData = stagesFor({ size: 'large', sensitive: [], profile: { types: ['web'], money: 'personal', signals: ['personal-data'] } });
  assert.equal(withData.find((r) => r.stage === '12').applies, true, 'personal data keeps the legal stage');
});

test('stagesFor: a stage outside the size scope is hidden with the size as the reason', () => {
  const rows = stagesFor({ size: 'small', sensitive: [], profile: { types: ['web'] } });
  const s05 = rows.find((r) => r.stage === '05');
  assert.equal(s05.applies, false);
  assert.equal(s05.by, 'size');
  assert.equal(s05.reason.params.size, 'small');
});

test('stagesFor rejects an unknown size', () => {
  assert.throws(() => stagesFor({ size: 'huge', sensitive: [], profile: {} }), (e) => e.code === 'bad-idea');
});

test('checkApplies: a web-only check becomes not applicable in a library; with no profile it stays visible', () => {
  const c = { id: '06.x', stage: '06', severity: 'E', when: { types: ['web'] }, whenText: 'web', raise: null };
  const lib = { profile: flatProfile({ types: ['library'] }), idea: { size: 'medium', sensitive: [] } };
  const none = { profile: flatProfile({}), idea: { size: 'medium', sensitive: [] } };
  assert.equal(checkApplies(c, lib).applies, false);
  assert.equal(checkApplies(c, lib).reason, 'not-applicable');
  assert.equal(checkApplies(c, none).applies, true);
});

test('severityFor raises only when the raise condition holds', () => {
  const c = { severity: 'R', raise: { to: 'E', when: { sensitive: true } } };
  const calm = { profile: flatProfile({}), idea: { size: 'medium', sensitive: [] } };
  const hot = { profile: flatProfile({}), idea: { size: 'medium', sensitive: ['money'] } };
  assert.equal(severityFor(c, calm), 'R');
  assert.equal(severityFor(c, hot), 'E');
  assert.equal(severityFor({ severity: 'A', raise: { to: 'R', when: null } }, hot), 'A');
});

test('unknownStandardRefs lists every package item whose standard id does not exist', () => {
  const std = loadStandard(REAL);
  const good = std[0].id;
  const pkgs = [
    { id: 'p1', items: [{ id: 'a', standard: [good] }, { id: 'b', standard: [good, '05.nao-existe'] }, { id: 'c' }] },
    { id: 'p2', items: [{ id: 'd', standard: ['99.zzz'] }] },
  ];
  assert.deepEqual(unknownStandardRefs(pkgs, std), [
    { pkg: 'p1', item: 'b', ref: '05.nao-existe' },
    { pkg: 'p2', item: 'd', ref: '99.zzz' },
  ]);
  assert.deepEqual(unknownStandardRefs([], std), []);
});

test('real standard: "em média e grande" and "(web)" qualifiers are mapped, not left as free text', () => {
  const std = loadStandard(REAL);
  const est = std.find((c) => c.stage === '14' && /^Estimativa de custo/.test(c.text));
  assert.deepEqual(est.when, { sizes: ['medium', 'large'] });
  assert.ok(std.filter((c) => c.whenText === 'web').every((c) => c.when && c.when.types[0] === 'web'));
});
