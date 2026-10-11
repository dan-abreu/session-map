import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAll, checkClaim, settleImportant, vocabularyOf } from '../server/foundation/evidence-check.mjs';

// The checker of the AI claims (fd04, contract section 5), measured against the twelve claims of B2-T2: four true ones
// keep their badge, the eight planted false ones are removed, each for the reason the answer key says.
const REPOS = join(import.meta.dirname, 'fixtures', 'repos');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const answer = readJson(join(REPOS, 'acme-shop.answer.json'));
const model = readJson(join(REPOS, 'acme-shop.model-answer.json'));
const planted = readJson(join(import.meta.dirname, 'fixtures', 'claims', 'acme-shop.claims.json'));
const facts = [...answer.facts, ...(answer.extraFacts ?? [])];
const vocab = vocabularyOf(model, facts);

let opened = [];
function linesOf(file) {
  opened.push(file);
  const path = join(REPOS, 'acme-shop', file);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const lines = bytes.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return { lines, sha: createHash('sha256').update(bytes).digest('hex').slice(0, 16) };
}
const byId = (id) => planted.claims.find((c) => c.claim.id === id);
const clone = (v) => JSON.parse(JSON.stringify(v));
const good = () => clone(byId('claim:01').claim);
const explain = () => clone(byId('claim:02').claim);

test('the vocabulary is every id of the model (nodes, edges, journeys) and every fact id, and nothing else', () => {
  assert.ok(vocab instanceof Set);
  for (const n of model.nodes) assert.ok(vocab.has(n.id), n.id);
  for (const e of model.edges) assert.ok(vocab.has(e.id), e.id);
  for (const f of facts) assert.ok(vocab.has(f.id), f.id);
  assert.equal(vocab.size, new Set([...model.nodes, ...model.edges, ...facts].map((x) => x.id)).size);
  assert.ok(!vocab.has('ctr:apps/billing'));
  const withJourney = vocabularyOf({ nodes: [], edges: [], journeys: [{ id: 'j:checkout', steps: [] }] }, { facts: [] });
  assert.deepEqual([...withJourney], ['j:checkout']);
  assert.equal(vocabularyOf(null, null).size, 0);
});

test('each of the twelve claims of the answer key gets the verdict, badge and reason it expects', () => {
  for (const { claim, expect } of planted.claims) {
    const got = checkClaim(claim, vocab, linesOf, facts);
    if (expect.verdict === 'rejected') assert.deepEqual(got, { ok: false, reason: expect.reason }, claim.id);
    else if (expect.verdict === 'approved') assert.deepEqual(got, { ok: true, badge: expect.badge }, claim.id);
    else assert.equal(got.ok, true, `${claim.id}: an important claim passes its own checks first`);
  }
});

test('checkAll keeps the four true claims with their badge and removes all eight planted ones (rate 8/8)', () => {
  const claims = planted.claims.map((c) => c.claim);
  const readingsOf = (claim) => byId(claim.id)?.readings;
  const out = checkAll(claims, { vocab, linesOf, facts, model, now: '2026-10-10T10:00:00.000Z', run: 'study-test', readingsOf });
  const shown = new Map(out.approved.map((c) => [c.id, c]));
  const gone = new Map(out.rejected.map((c) => [c.id, c]));
  for (const { claim, expect } of planted.claims) {
    if (expect.verdict === 'approved') {
      assert.equal(shown.get(claim.id)?.badge, expect.badge, claim.id);
      assert.equal(shown.get(claim.id).checkedAt, '2026-10-10T10:00:00.000Z');
      assert.equal(shown.get(claim.id).run, 'study-test');
    } else if (expect.verdict === 'rejected') {
      assert.equal(gone.get(claim.id)?.reason, expect.reason, claim.id);
      assert.ok(!shown.has(claim.id), claim.id);
    } else {
      assert.equal(shown.get(claim.id)?.badge, 'not-found', claim.id);
      assert.equal(shown.get(claim.id).reason, 'disagreement', claim.id);
    }
  }
  const removed = planted.claims.filter((c) => c.planted && !(shown.get(c.claim.id)?.badge && shown.get(c.claim.id).badge !== 'not-found'));
  const limits = readJson(join(REPOS, 'limits.json'));
  assert.equal(removed.length / planted.claims.filter((c) => c.planted).length, limits.claims.plantedRemoved);
  assert.equal(out.approved.length + out.rejected.length, 12);
});

test('the hash at check is the hash of the node the claim is about; the readings never reach the output', () => {
  const m = { nodes: [{ id: 'cmp:apps/api#root', hash: 'aaaa000011112222' }], edges: [] };
  const out = checkAll([good()], { vocab, linesOf, facts, model: m, now: 'x', run: 'r' });
  assert.equal(out.approved[0].hashAtCheck, 'aaaa000011112222');
  const none = checkAll([{ ...explain(), readings: [] }], { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.equal(none.approved[0].hashAtCheck, null);
  assert.ok(!('readings' in none.approved[0]));
});

test('an AI item citing an unknown id is rejected (fd03), in about or in factIds', () => {
  assert.deepEqual(checkClaim({ ...explain(), about: 'ctr:apps/billing' }, vocab, linesOf, facts), { ok: false, reason: 'unknown-id' });
  assert.deepEqual(checkClaim({ ...explain(), factIds: ['queue:emails', 'queue:sms'] }, vocab, linesOf, facts), { ok: false, reason: 'unknown-id' });
  assert.deepEqual(checkClaim({ ...explain(), about: undefined }, vocab, linesOf, facts), { ok: false, reason: 'unknown-id' });
  assert.deepEqual(checkClaim({ ...explain(), about: 'ctr:apps/billing' }, new Set(), linesOf, facts), { ok: false, reason: 'unknown-id' });
});

test('the AI trying to stamp its claim EXTRACTED (or DECLARED) is rejected; it never chooses its own badge', () => {
  assert.deepEqual(checkClaim({ ...good(), origin: 'EXTRACTED' }, vocab, linesOf, facts), { ok: false, reason: 'bad-origin' });
  assert.deepEqual(checkClaim({ ...explain(), origin: 'DECLARED' }, vocab, linesOf, facts), { ok: false, reason: 'bad-origin' });
  assert.deepEqual(checkClaim({ ...explain(), origin: 'INFERRED' }, vocab, linesOf, facts), { ok: true, badge: 'interpretation' });
  const out = checkAll([{ ...explain(), badge: 'confirmed', hashAtCheck: 'forged', origin: 'INFERRED' }], { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.equal(out.approved[0].badge, 'interpretation');
  assert.equal(out.approved[0].hashAtCheck, null);
  assert.ok(!('origin' in out.approved[0]));
  const forged = checkAll([{ ...good(), origin: 'EXTRACTED' }], { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.deepEqual(forged.approved, []);
  assert.equal(forged.rejected[0].reason, 'bad-origin');
});

test('a claim that is not the shape of the contract is rejected before anything is opened', () => {
  opened = [];
  for (const bad of [null, 'text', { ...explain(), type: 'guess' }, { ...explain(), cites: 'x' }, { ...explain(), factIds: null }, { ...explain(), cites: [null] }]) {
    assert.deepEqual(checkClaim(bad, vocab, linesOf, facts), { ok: false, reason: 'bad-shape' });
  }
  assert.deepEqual(opened, []);
});

test('the order of the contract: the first failure is the reason, even when a later check would fail too', () => {
  const twoWrong = { ...explain(), about: 'ctr:nope', cites: [] };
  assert.equal(checkClaim(twoWrong, vocab, linesOf, facts).reason, 'unknown-id');
  const c = explain();
  const lineAndQuote = { ...c, cites: [{ ...c.cites[0], line: 999, quote: 'not there' }] };
  assert.equal(checkClaim(lineAndQuote, vocab, linesOf, facts).reason, 'line-out');
  // Across cites: the second cite misses a file, the first has a wrong quote: the file comes first in the order.
  const across = { ...c, cites: [{ ...c.cites[0], quote: 'not there at all' }, { ...c.cites[0], file: 'apps/nope.ts' }] };
  assert.equal(checkClaim(across, vocab, linesOf, facts).reason, 'file-missing');
});

test('a not-found claim needs no cite, but a cite it carries is checked like any other', () => {
  const nf = clone(byId('claim:03').claim);
  assert.deepEqual(checkClaim(nf, vocab, linesOf, facts), { ok: true, badge: 'not-found' });
  const withBadCite = { ...nf, cites: [{ file: 'apps/api/src/server.ts', line: 13, quote: 'app.delete(', sha: good().cites[0].sha }] };
  assert.deepEqual(checkClaim(withBadCite, vocab, linesOf, facts), { ok: false, reason: 'quote-mismatch' });
});

test('a cite to a secrets file, an absolute path or a path climbing out is a missing file, and is never opened', () => {
  opened = [];
  const c = explain();
  for (const file of ['.env', 'apps/api/.env.local', '/etc/passwd', 'C:/Windows/win.ini', '../outside.ts', 'apps/../../x.ts', 'apps\\api\\src\\server.ts', '']) {
    assert.deepEqual(checkClaim({ ...c, cites: [{ ...c.cites[0], file }] }, vocab, linesOf, facts), { ok: false, reason: 'file-missing' }, file);
  }
  assert.deepEqual(opened, []);
});

test('the line must be a whole number inside the file', () => {
  const c = explain();
  for (const line of [0, -1, 1.5, '10', null, 10_000]) {
    assert.deepEqual(checkClaim({ ...c, cites: [{ ...c.cites[0], line }] }, vocab, linesOf, facts), { ok: false, reason: 'line-out' }, String(line));
  }
});

test('a cite without the sha the program recorded, or with an old one, is stale', () => {
  const c = explain();
  assert.deepEqual(checkClaim({ ...c, cites: [{ ...c.cites[0], sha: undefined }] }, vocab, linesOf, facts), { ok: false, reason: 'stale-sha' });
  assert.deepEqual(checkClaim({ ...c, cites: [{ ...c.cites[0], sha: '0000000000000000' }] }, vocab, linesOf, facts), { ok: false, reason: 'stale-sha' });
  const noSha = (file) => { const got = linesOf(file); return got && { lines: got.lines }; };
  assert.deepEqual(checkClaim(c, vocab, noSha, facts), { ok: false, reason: 'stale-sha' }, 'a reader that gives no sha proves nothing');
});

test('the quote is found with the spaces normalized within two lines of the cite, and not further', () => {
  const lines = ['line one', 'const a =', '    new Worker(', "      'emails',", '      processEmail)', 'x', 'y', 'z'];
  const reader = () => ({ lines, sha: 'feedfacefeedface' });
  const v = new Set(['ctr:x']);
  const at = (line, quote) => checkClaim({ id: 'claim:q', about: 'ctr:x', type: 'explain', text: { en: 'a', 'pt-BR': 'a' }, cites: [{ file: 'a.ts', line, quote, sha: 'feedfacefeedface' }], factIds: [], important: false }, v, reader, []);
  assert.equal(at(3, "new Worker( 'emails', processEmail)").ok, true, 'spread over three lines');
  assert.equal(at(4, 'const a = new Worker(').ok, true, 'starting two lines above');
  assert.equal(at(5, 'const a = new Worker(').reason, 'quote-mismatch', 'starting three lines above');
  assert.equal(at(2, "'emails',").ok, true, 'two lines below');
  assert.equal(at(2, 'processEmail').reason, 'quote-mismatch', 'three lines below');
  assert.equal(at(8, 'new Worker(').reason, 'quote-mismatch', 'three lines above');
  assert.equal(at(3, '').reason, 'quote-mismatch', 'an empty quote proves nothing');
  assert.equal(at(3, '  (  ').reason, 'quote-mismatch', 'a quote of one or two letters proves nothing');
  assert.equal(at(3, undefined).reason, 'quote-mismatch');
  assert.equal(at(2, 'CONST A').reason, 'quote-mismatch', 'case counts');
});

test('a fact claim whose text says a number the fact does not have is fact-mismatch, in either language', () => {
  const c = good();
  assert.deepEqual(checkClaim(c, vocab, linesOf, facts), { ok: true, badge: 'confirmed' });
  assert.deepEqual(checkClaim({ ...c, text: { ...c.text, 'pt-BR': 'GET /status é declarado na linha 14.' } }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(checkClaim({ ...c, text: { en: 'GET /status is one route.', 'pt-BR': 'GET /status é uma rota.' } }, vocab, linesOf, facts), { ok: true, badge: 'confirmed' }, 'no number, nothing to compare');
  // A number that is part of the fact itself (its path, its file) is not a count.
  const v1 = { ...c, factIds: ['route:GET /v1/orders/:id'], cites: [{ file: 'apps/api/src/routes/orders.ts', line: 6, quote: "app.get('/orders/:id'", sha: byId('claim:05').claim.cites[0].sha }],
    text: { en: 'GET /v1/orders/:id is at line 6.', 'pt-BR': 'GET /v1/orders/:id fica na linha 6.' } };
  assert.deepEqual(checkClaim(v1, vocab, linesOf, facts), { ok: true, badge: 'confirmed' });
  assert.deepEqual(checkClaim({ ...v1, text: { en: 'GET /v1/orders/:id is at line 7.', 'pt-BR': 'linha 7' } }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' });
});

test('a fact claim must repeat a real fact and cite the file where that fact is', () => {
  const c = good();
  assert.deepEqual(checkClaim({ ...c, factIds: [] }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' }, 'repeats no fact');
  assert.deepEqual(checkClaim({ ...c, factIds: ['ctr:apps/api'] }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' }, 'a model id is not a fact');
  assert.deepEqual(checkClaim(c, vocab, linesOf, []), { ok: false, reason: 'fact-mismatch' }, 'no facts given, nothing confirmed');
  const w = explain();
  assert.deepEqual(checkClaim({ ...c, text: { en: 'GET /status exists.', 'pt-BR': 'GET /status existe.' }, cites: w.cites }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' }, 'cites another file');
  // The answer key keeps no columns, so the count is checked on a copy of the facts that has three.
  const cols = [{ name: 'id', type: 'Int', line: 23 }, { name: 'status', type: 'OrderStatus', line: 24 }, { name: 'customer', type: 'Customer', line: 25 }];
  const withCols = facts.map((f) => (f.id === 'table:Order' ? { ...f, attrs: { ...f.attrs, columns: cols } } : f));
  const order = withCols.find((f) => f.id === 'table:Order');
  const cite = { file: order.file, line: order.line, quote: 'model Order', sha: linesOf(order.file).sha };
  const say = (k) => ({ ...c, factIds: ['table:Order'], cites: [cite], text: { en: `Order has ${k} columns.`, 'pt-BR': `Order tem ${k} colunas.` } });
  assert.deepEqual(checkClaim(say(3), vocab, linesOf, withCols), { ok: true, badge: 'confirmed' }, 'the count of columns is a number the fact has');
  assert.deepEqual(checkClaim(say(8), vocab, linesOf, withCols), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(checkClaim(say(3), vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' }, 'the key without columns has no 3');
});

test('settleImportant: two readers who agree and an adversary who knocks nothing approve; anything else is a disagreement', () => {
  const agree = byId('claim:04').readings;
  assert.deepEqual(settleImportant(agree), { ok: true });
  const no = { ok: false, badge: 'not-found', reason: 'disagreement' };
  assert.deepEqual(settleImportant(byId('claim:11').readings), no);
  const [r1, r2, adv] = clone(agree);
  assert.deepEqual(settleImportant([r1, r2, { ...adv, rejects: [0] }]), no, 'the adversary knocks a cite');
  assert.deepEqual(settleImportant([r1, adv]), no, 'one reader only');
  assert.deepEqual(settleImportant([r1, r2]), no, 'no adversary');
  assert.deepEqual(settleImportant([]), no);
  assert.deepEqual(settleImportant(undefined), no);
  assert.deepEqual(settleImportant([r1, { ...r2, factIds: [] }, adv]), no, 'same about, other facts');
  assert.deepEqual(settleImportant([r1, { ...r2, factIds: [...r2.factIds].reverse() }, adv]), { ok: true }, 'the order of the facts does not matter');
  const claim = byId('claim:04').claim;
  assert.deepEqual(settleImportant(agree, claim), { ok: true });
  assert.deepEqual(settleImportant(agree, { ...claim, about: 'ctr:apps/web' }), no, 'the readers agree with each other but not with the claim');
});

test('an important claim with no readings is not confirmed; a failed cite is still a rejection, not a downgrade', () => {
  const c = { ...clone(byId('claim:04').claim) };
  const out = checkAll([c], { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.deepEqual([out.approved[0].badge, out.approved[0].reason], ['not-found', 'disagreement']);
  const broken = { ...c, cites: [{ ...c.cites[0], quote: 'nothing like it' }], readings: byId('claim:04').readings };
  const out2 = checkAll([broken], { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.deepEqual(out2.approved, []);
  assert.equal(out2.rejected[0].reason, 'quote-mismatch');
});

test('checkAll opens each file once, never throws on a broken item, and takes no list as an empty list', () => {
  opened = [];
  const many = [explain(), explain(), { ...explain(), id: 'claim:x' }, null, 42];
  const out = checkAll(many, { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.equal(out.approved.length, 3);
  assert.equal(out.rejected.length, 2);
  assert.deepEqual(out.rejected.map((r) => r.reason), ['bad-shape', 'bad-shape']);
  assert.deepEqual(opened, ['apps/worker/src/worker.ts']);
  assert.deepEqual(checkAll(undefined, { vocab, linesOf }), { approved: [], rejected: [] });
  const throwing = () => { throw new Error('disk'); };
  assert.equal(checkAll([explain()], { vocab, linesOf: throwing, facts, now: 'x', run: 'r' }).rejected[0].reason, 'file-missing');
});

test('checkClaim does not change the claim it is given', () => {
  const c = good();
  const before = JSON.stringify(c);
  checkClaim(c, vocab, linesOf, facts);
  checkAll([c], { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.equal(JSON.stringify(c), before);
});

// Review of B2-T4: the numbers of a fact are not one bag. A line is compared with lines, a count with counts, and the
// digits inside a name count only where the exact name is written.
test('a fact claim saying a wrong line is fact-mismatch even when that number is a count the fact has', () => {
  const c = good();
  const at = (en, pt) => checkClaim({ ...c, text: { en, 'pt-BR': pt } }, vocab, linesOf, facts);
  assert.deepEqual(at('GET /status is declared at line 1.', 'GET /status é declarado na linha 1.'), { ok: false, reason: 'fact-mismatch' }, 'the fact is at line 13, "1" is only how many places it has');
  assert.deepEqual(at('GET /status is declared at L1.', 'GET /status fica em L1.'), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(at('GET /status is declared at L13.', 'GET /status fica na linha 13.'), { ok: true, badge: 'confirmed' });
  assert.deepEqual(at('GET /status is declared in 13 places.', 'GET /status aparece em 13 lugares.'), { ok: false, reason: 'fact-mismatch' }, 'a line is not a count');
  assert.deepEqual(at('GET /status is declared in 1 place.', 'GET /status aparece em 1 lugar.'), { ok: true, badge: 'confirmed' });
});

test('a count of columns is compared with the count, never with the lines of the columns', () => {
  const cols = [{ name: 'id', type: 'Int', line: 23 }, { name: 'status', type: 'OrderStatus', line: 24 }, { name: 'customer', type: 'Customer', line: 25 }];
  const withCols = facts.map((f) => (f.id === 'table:Order' ? { ...f, attrs: { ...f.attrs, columns: cols } } : f));
  const order = withCols.find((f) => f.id === 'table:Order');
  const cite = { file: order.file, line: order.line, quote: 'model Order', sha: linesOf(order.file).sha };
  const say = (en, pt) => checkClaim({ ...good(), factIds: ['table:Order'], cites: [cite], text: { en, 'pt-BR': pt } }, vocab, linesOf, withCols);
  assert.deepEqual(say('Order has 24 columns.', 'Order tem 24 colunas.'), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(say('Order is declared at line 22.', 'Order fica na linha 22.'), { ok: true, badge: 'confirmed' });
  assert.deepEqual(say('Order is declared at line 3.', 'Order fica na linha 3.'), { ok: false, reason: 'fact-mismatch' }, 'the count is not a line');
});

test('the digits of a name or path are accepted only where the exact name is written', () => {
  const sha = byId('claim:05').claim.cites[0].sha;
  const v1 = { ...good(), factIds: ['route:GET /v1/orders/:id'], cites: [{ file: 'apps/api/src/routes/orders.ts', line: 6, quote: "app.get('/orders/:id'", sha }] };
  const say = (en, pt) => checkClaim({ ...v1, text: { en, 'pt-BR': pt } }, vocab, linesOf, facts);
  assert.deepEqual(say('GET /v1/orders/:id is at line 6.', 'GET /v1/orders/:id fica na linha 6.'), { ok: true, badge: 'confirmed' });
  assert.deepEqual(say('GET /v2/orders/:id is at line 6.', 'GET /v2/orders/:id fica na linha 6.'), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(say('The orders route has 1 version.', 'A rota de pedidos tem 1 versão.'), { ok: true, badge: 'confirmed' }, '1 place');
  assert.deepEqual(say('GET /orders/:id is at line 1.', 'GET /orders/:id fica na linha 1.'), { ok: false, reason: 'fact-mismatch' }, 'the 1 of v1 is not a line');
});

test('the about the AI chose frees no number', () => {
  const v = new Set([...vocab, 'cmp:apps/api7']);
  const c = { ...good(), about: 'cmp:apps/api7', text: { en: 'GET /status answers in 7 ways.', 'pt-BR': 'GET /status responde de 7 jeitos.' } };
  assert.deepEqual(checkClaim(c, v, linesOf, facts), { ok: false, reason: 'fact-mismatch' });
});

test('a claim with no text in both languages, a loose text, a non-text id or a non-boolean important is bad-shape', () => {
  const c = good();
  const { text: _t, ...noText } = c;
  const { id: _i, ...noId } = c;
  const { important: _p, ...noImportant } = c;
  for (const bad of [noText, { ...c, text: 'GET /status is at line 13.' }, { ...c, text: { en: 'only english' } }, { ...c, text: { en: 'a', 'pt-BR': 7 } }, noId, { ...c, id: 12 }, { ...c, important: 'yes' }]) {
    assert.deepEqual(checkClaim(bad, vocab, linesOf, facts), { ok: false, reason: 'bad-shape' }, JSON.stringify(bad).slice(0, 80));
  }
  assert.deepEqual(checkClaim(noImportant, vocab, linesOf, facts), { ok: true, badge: 'confirmed' }, 'important may be left out');
});

test('without readingsOf the readings the AI put inside its own claim are not believed', () => {
  const c = { ...clone(byId('claim:04').claim), readings: byId('claim:04').readings };
  const out = checkAll([c], { vocab, linesOf, facts, now: 'x', run: 'r' });
  assert.deepEqual([out.approved[0].badge, out.approved[0].reason], ['not-found', 'disagreement']);
  const given = checkAll([c], { vocab, linesOf, facts, now: 'x', run: 'r', readingsOf: () => byId('claim:04').readings });
  assert.equal(given.approved[0].badge, 'interpretation');
  assert.ok(!('reason' in given.approved[0]));
});

test('a claim about a fact keeps the hash of its cites, so a change in the cited file makes it out of date', () => {
  const c = { ...explain(), about: 'queue:emails' };
  const out = checkAll([c], { vocab, linesOf, facts, model, now: 'x', run: 'r' });
  const want = createHash('sha256').update(c.cites.map((x) => x.sha).join('\n')).digest('hex').slice(0, 16);
  assert.equal(out.approved[0].hashAtCheck, want);
  const nf = { ...clone(byId('claim:03').claim), about: 'queue:emails' };
  assert.equal(checkAll([nf], { vocab, linesOf, facts, model, now: 'x', run: 'r' }).approved[0].hashAtCheck, null, 'nothing cited, nothing to hash');
});

test('a text attribute made only of digits is a count, and a name is never cut out of a longer word or number', () => {
  const withVersion = facts.map((f) => (f.id === 'route:GET /status' ? { ...f, attrs: { ...f.attrs, version: '2', tag: 'v1' } } : f));
  const say = (en, pt) => checkClaim({ ...good(), text: { en, 'pt-BR': pt } }, vocab, linesOf, withVersion);
  assert.deepEqual(say('GET /status is declared at line 12.', 'GET /status é declarado na linha 12.'), { ok: false, reason: 'fact-mismatch' }, 'the "2" of the version is not erased from 12');
  assert.deepEqual(say('GET /status has 2 versions.', 'GET /status tem 2 versões.'), { ok: true, badge: 'confirmed' });
  assert.deepEqual(say('GET /status is tag v12.', 'GET /status é a tag v12.'), { ok: false, reason: 'fact-mismatch' }, 'v1 is not cut out of v12');
  assert.deepEqual(say('GET /status is tag v1.', 'GET /status é a tag v1.'), { ok: true, badge: 'confirmed' });
  assert.deepEqual(say('GET /status is at lines 13-14.', 'GET /status fica nas linhas 13 a 14.'), { ok: false, reason: 'fact-mismatch' }, 'both ends of a range are lines');
});

// Review of B2-T4 (3rd round): any way of writing "line N" is a line, whatever the case, the mark between the word and
// the number, a list of lines, or the file:line and #L forms. A number that looks like a line never falls into counts.
test('a wrong line is fact-mismatch however it is written: case, marks, lists, file:line and #L', () => {
  const c = good();
  const at = (en, pt = en) => checkClaim({ ...c, text: { en, 'pt-BR': pt } }, vocab, linesOf, facts);
  const wrong = [
    'GET /status is declared at Line 1.', 'GET /status is declared at LINE 1.', 'Linha 1 declara GET /status.',
    'GET /status is declared in apps/api/src/server.ts:1.', 'GET /status is declared in server.ts#L1.',
    'GET /status is declared at line #1.', 'GET /status is declared at line: 1.', 'GET /status fica na linha nº 1.',
    'GET /status is declared at line no. 1.', 'GET /status is declared at lines 13 and 1.', 'GET /status fica nas linhas 13 e 1.',
    'GET /status is declared at lines 13, 1.', 'GET /status is declared at lines 13-14.',
    'GET /status is declared at line-1.', 'GET /status is declared at l. 1.', 'GET /status is declared at ln 1.',
    'GET /status is declared at line number 1.', 'GET /status fica na linha número 1.', 'GET /status is declared in server.ts(1).',
  ];
  for (const t of wrong) assert.deepEqual(at(t), { ok: false, reason: 'fact-mismatch' }, t);
  const right = [
    'GET /status is declared at Line 13.', 'Linha 13 declara GET /status.', 'GET /status is declared in apps/api/src/server.ts:13.',
    'GET /status is declared in server.ts#L13.', 'GET /status is declared at line #13.', 'GET /status fica na linha nº 13.',
  ];
  for (const t of right) assert.deepEqual(at(t), { ok: true, badge: 'confirmed' }, t);
});

test('a text that is empty or only spaces, in either language, is bad-shape', () => {
  const c = good();
  for (const text of [{ en: '', 'pt-BR': '' }, { en: '   ', 'pt-BR': 'GET /status existe.' }, { en: 'GET /status exists.', 'pt-BR': '\n\t' }]) {
    assert.deepEqual(checkClaim({ ...c, text }, vocab, linesOf, facts), { ok: false, reason: 'bad-shape' }, JSON.stringify(text));
  }
});

test('the :line after a path that has digits is still a line, not a count left behind when the path is erased', () => {
  const withRef = facts.map((f) => (f.id === 'route:GET /status' ? { ...f, refs: [...(f.refs ?? []), { file: 'apps/v2/x.ts', line: 40 }] } : f));
  const say = (en) => checkClaim({ ...good(), text: { en, 'pt-BR': en } }, vocab, linesOf, withRef);
  assert.deepEqual(say('GET /status is also used in apps/v2/x.ts:2.'), { ok: false, reason: 'fact-mismatch' }, '2 is how many places, not a line');
  assert.deepEqual(say('GET /status is also used in apps/v2/x.ts:40.'), { ok: true, badge: 'confirmed' });
});

// Second opinion from another family (OpenAI, 2026-10-10): the four holes confirmed in the code, each shown here before the fix.
const mini = () => ({
  vocab: new Set(['f']),
  facts: [{ id: 'f', file: 'a.js', line: 1, attrs: {} }],
  linesOf: (file) => (file === 'a.js' ? { lines: ['abc'], sha: 's' } : null),
  claim: {
    id: 'c', about: 'f', type: 'fact', text: { en: 'One entry.', 'pt-BR': 'Uma entrada.' }, factIds: ['f'],
    cites: [{ file: 'a.js', line: 1, sha: 's', quote: 'abc' }],
  },
});
const says = (en, pt = en) => ({ en, 'pt-BR': pt });

test('a decimal is one number, never two digits that each pass as a count', () => {
  const { vocab, facts, linesOf, claim } = mini();
  assert.deepEqual(checkClaim({ ...claim, text: says('There are 1.1 entries.', 'Há 1,1 entradas.') }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(checkClaim(claim, vocab, linesOf, facts), { ok: true, badge: 'confirmed' });
});

test('digits of other scripts are numbers too, so twelve in fullwidth or Arabic-Indic cannot slip by', () => {
  const { vocab, facts, linesOf, claim } = mini();
  assert.deepEqual(checkClaim({ ...claim, text: says('There are １２ entries.') }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(checkClaim({ ...claim, text: says('There are ١٢ entries.') }, vocab, linesOf, facts), { ok: false, reason: 'fact-mismatch' });
  assert.deepEqual(checkClaim({ ...claim, text: says('There are １ entries.') }, vocab, linesOf, facts), { ok: true, badge: 'confirmed' });
});

test('a position kept as text is never a count, and a count whose key starts with col is still a count', () => {
  const { vocab, linesOf, claim } = mini();
  const asText = [{ id: 'f', file: 'a.js', line: 1, attrs: { line: '99' } }];
  assert.deepEqual(checkClaim({ ...claim, text: says('There are 99 entries.') }, vocab, linesOf, asText), { ok: false, reason: 'fact-mismatch' });
  const colors = [{ id: 'f', file: 'a.js', line: 1, attrs: { colorCount: 2 } }];
  assert.deepEqual(checkClaim({ ...claim, text: says('There are 2 colors.') }, vocab, linesOf, colors), { ok: true, badge: 'confirmed' });
  const column = [{ id: 'f', file: 'a.js', line: 1, attrs: { column: 7, startLine: 3 } }];
  assert.deepEqual(checkClaim({ ...claim, text: says('There are 7 entries.') }, vocab, linesOf, column), { ok: false, reason: 'fact-mismatch' });
});

test('a list of cites with a hole is bad-shape and checkAll never throws on it', () => {
  const { vocab, facts, linesOf, claim } = mini();
  const holed = { ...claim, type: 'explain', cites: Array(1) };
  assert.deepEqual(checkClaim(holed, vocab, linesOf, facts), { ok: false, reason: 'bad-shape' });
  const out = checkAll([holed], { vocab, linesOf, facts, now: '2026-10-10T10:00:00.000Z' });
  assert.equal(out.approved.length, 0);
  assert.equal(out.rejected[0].reason, 'bad-shape');
});
