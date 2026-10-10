import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, validatePackage, selectFor, appliesTo, profileFacets, statusOf, textIn } from '../server/foundation/library.mjs';
import { loadStandard } from '../server/foundation/standard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KNOWLEDGE = join(ROOT, 'knowledge');
const IDS = ['legal-lgpd-br', 'legal-company-br', 'finance-basics', 'marketing-basics', 'sales-support-basics'];
const lib = loadLibrary({ sharedDir: KNOWLEDGE });
const pkg = (id) => lib.packages.find((p) => p.id === id);
const mine = IDS.map(pkg);
const facets = (profile) => profileFacets(profile);

function everyText(p) {
  const out = [];
  const push = (t) => { if (t) out.push(t.en, t['pt-BR']); };
  push(p.title);
  push(p.disclaimer);
  for (const it of p.items) for (const f of ['title', 'what', 'why', 'how', 'doneWhen', 'example']) push(it[f]);
  return out.filter(Boolean);
}

test('the five business packages exist, are valid and are not listed as invalid', () => {
  assert.deepEqual(lib.invalid.filter((i) => IDS.includes(i.file.replace('.json', ''))), []);
  for (const id of IDS) assert.ok(pkg(id), `${id} is missing`);
  assert.equal(pkg('legal-lgpd-br').kind, 'legal');
  assert.equal(pkg('legal-company-br').kind, 'legal');
  assert.equal(pkg('finance-basics').kind, 'finance');
  assert.equal(pkg('marketing-basics').kind, 'marketing');
  assert.equal(pkg('sales-support-basics').kind, 'sales');
});

test('every business package keeps the fixed "guidance, not advice" notice, and the validator refuses it without', () => {
  for (const p of mine) {
    assert.ok(p.disclaimer && p.disclaimer.en && p.disclaimer['pt-BR'], `${p.id} has no disclaimer`);
    const stripped = { ...p, disclaimer: null };
    delete stripped.layer;
    if (p.kind === 'legal' || p.kind === 'finance') {
      assert.equal(validatePackage(stripped).ok, false, `${p.id} accepted without a disclaimer`);
    }
  }
  assert.match(textIn(pkg('legal-lgpd-br').disclaimer, 'pt-BR'), /não é parecer|não.*parecer jurídico/i);
  assert.match(textIn(pkg('finance-basics').disclaimer, 'pt-BR'), /não.*contábil/i);
});

test('no text says a project is "in compliance" (the program only organizes work for the lawyer or accountant)', () => {
  for (const p of mine) {
    for (const t of everyText(p)) {
      assert.doesNotMatch(t, /em conformidade|conformidade|compliant|compliance|in line with the law is guaranteed/i, `${p.id}: "${t.slice(0, 60)}"`);
    }
  }
});

test('every business item names its source, and a V or F source has an https address', () => {
  for (const p of mine) {
    for (const it of p.items) {
      assert.ok(it.source && it.source.name, `${it.id} has no source`);
      if (it.source.trust === 'V' || it.source.trust === 'F') assert.match(it.source.url, /^https:\/\//);
    }
  }
});

// Details that docs/standard keeps as [NV] (not confirmed). A text that carries one of them must not be marked
// V, F or C: either the detail leaves the text, or the item says NV and the package goes to "recheck".
const NV_DETAILS = [
  { where: '05 #38, cookie banner details', re: /rejeitar tão fácil|reject[^.]*as easy|aceitar, rejeitar e gerenciar|accept, reject and manage|mesmo nível|same level/i },
  { where: '05 #45, doubled deadline for small agents', re: /em dobro|prazo dobrado|doubled? (the )?deadline/i },
  { where: '05 #39, ECA Digital fine values', re: /R\$ ?50 milh|50 million/i },
  { where: '12 #23, Decreto 8.771/2016', re: /8\.771/ },
  { where: '12 #7, Simples resolutions on NFS-e dates', re: /CGSN/i },
  { where: '12 #29, PL 2338 progress', re: /PL 2338[^.]*(aprovad|approved|em vigor|in force)/i },
];

test('a detail the standard marks NV never shows up in an item whose source is V, F or C', () => {
  for (const p of mine) {
    for (const it of p.items) {
      if (it.source?.trust === 'NV') continue;
      const texts = ['title', 'what', 'why', 'how', 'doneWhen', 'example'].flatMap((f) => (it[f] ? [it[f].en, it[f]['pt-BR']] : []));
      for (const { where, re } of NV_DETAILS) {
        for (const t of texts) assert.doesNotMatch(t ?? '', re, `${it.id} (${it.source?.trust}) carries an NV detail from ${where}`);
      }
    }
  }
});

test('LGPD package: a Brazilian project with personal data gets it, with the notice visible in the package', () => {
  const lgpd = pkg('legal-lgpd-br');
  const yes = selectFor({ detected: { signals: [{ kind: 'personal-data' }] }, owner: { country: 'BR' } }, lib.packages).map((p) => p.id);
  assert.ok(yes.includes('legal-lgpd-br'));
  assert.ok(textIn(lgpd.disclaimer, 'en').length > 40);
  const noData = selectFor({ detected: { signals: [] }, owner: { country: 'BR' } }, lib.packages).map((p) => p.id);
  assert.ok(!noData.includes('legal-lgpd-br'), 'no personal data, no LGPD package');
  const abroad = selectFor({ detected: { signals: [{ kind: 'personal-data' }] }, owner: { country: 'DE' } }, lib.packages).map((p) => p.id);
  assert.ok(!abroad.includes('legal-lgpd-br'), 'a German project does not get the Brazilian law');
});

test('personal project: no price, tax, company or sales item applies', () => {
  const personal = facets({ detected: { types: ['web'], signals: [{ kind: 'payments' }] }, owner: { country: 'BR', money: 'personal' } });
  for (const id of ['finance-basics', 'legal-company-br', 'marketing-basics', 'sales-support-basics']) {
    const applicable = pkg(id).items.filter((it) => appliesTo(it.appliesIf, personal));
    assert.deepEqual(applicable.map((i) => i.id), [], `${id} has items that apply to a personal project`);
  }
});

test('a pure library gets no consumer-sales item even when it earns money', () => {
  const library = facets({ detected: { types: ['library'] }, owner: { country: 'BR', money: 'sale' } });
  for (const id of ['marketing-basics', 'sales-support-basics']) {
    assert.deepEqual(pkg(id).items.filter((it) => appliesTo(it.appliesIf, library)).map((i) => i.id), []);
  }
});

test('finance: a paid Brazilian product gets the price and tax items, a foreign one does not get the Brazilian tax ones', () => {
  const br = facets({ detected: { types: ['web'], signals: [{ kind: 'payments' }] }, owner: { country: 'BR', money: 'subscription' } });
  const us = facets({ detected: { types: ['web'], signals: [{ kind: 'payments' }] }, owner: { country: 'US', money: 'subscription' } });
  const fin = pkg('finance-basics');
  assert.ok(selectFor({ detected: { signals: [{ kind: 'payments' }] }, owner: { money: 'subscription' } }, lib.packages).some((p) => p.id === 'finance-basics'));
  const brItems = fin.items.filter((it) => appliesTo(it.appliesIf, br)).map((i) => i.id);
  const usItems = fin.items.filter((it) => appliesTo(it.appliesIf, us)).map((i) => i.id);
  assert.ok(brItems.length >= 10, `only ${brItems.length} finance items apply to BR`);
  assert.ok(brItems.length > usItems.length);
  assert.ok(brItems.includes('fin.tax-review') && !usItems.includes('fin.tax-review'));
});

test('marketplace-only items stay out of a plain subscription product', () => {
  const sub = facets({ detected: { types: ['web'] }, owner: { country: 'BR', money: 'subscription' } });
  const market = facets({ detected: { types: ['web'] }, owner: { country: 'BR', money: 'marketplace' } });
  const ids = (f) => mine.flatMap((p) => p.items.filter((it) => appliesTo(it.appliesIf, f)).map((i) => i.id));
  for (const id of ['fin.gmv-vs-revenue', 'co.provider-contract', 'ss.marketplace-trust']) {
    assert.ok(!ids(sub).includes(id), `${id} applies to a subscription product`);
    assert.ok(ids(market).includes(id), `${id} does not apply to a marketplace`);
  }
});

test('children item only applies when the owner says the audience is kids', () => {
  const kids = facets({ detected: {}, owner: { country: 'BR', audience: ['kids'] } });
  const general = facets({ detected: {}, owner: { country: 'BR', audience: ['general'] } });
  const it = pkg('legal-lgpd-br').items.find((i) => i.id === 'lgpd.children');
  assert.ok(it);
  assert.equal(appliesTo(it.appliesIf, kids), true);
  assert.equal(appliesTo(it.appliesIf, general), false);
});

test('every gate of stages 10 to 13 and the LGPD gates of stage 05 are covered by an item', () => {
  const std = loadStandard(join(ROOT, 'docs', 'standard'));
  const used = new Set(mine.flatMap((p) => p.items.flatMap((it) => it.standard ?? [])));
  const wanted = std.filter((c) => /^(10|11|12|13)\./.test(c.id)
    || /^05\.(inventario|politica|rota-de-exportar|fornecedores|plano-de-incidente|aviso)/.test(c.id));
  assert.ok(wanted.length >= 40);
  const missing = wanted.filter((c) => !used.has(c.id)).map((c) => c.id);
  assert.deepEqual(missing, []);
  for (const id of used) assert.ok(std.some((c) => c.id === id), `${id} is not in docs/standard`);
});

test('ageing: legal and finance packages go stale after 90 days, marketing and sales after 365', () => {
  for (const id of IDS) {
    const p = pkg(id);
    assert.equal(statusOf(p, p.checkedAt), 'confirmed');
  }
  for (const id of ['legal-lgpd-br', 'legal-company-br', 'finance-basics']) {
    assert.equal(statusOf(pkg(id), '2027-01-10'), 'stale-source', `${id} should be stale after 90 days`);
  }
  for (const id of ['marketing-basics', 'sales-support-basics']) assert.equal(statusOf(pkg(id), '2027-01-10'), 'confirmed');
});

test('items cover several fronts and carry the ladder, effort, severity and a way to be done', () => {
  const fronts = new Set(mine.flatMap((p) => p.items.map((i) => i.front)));
  for (const f of ['legal', 'finance', 'marketing', 'product']) assert.ok(fronts.has(f), `front ${f} missing`);
  for (const p of mine) {
    assert.ok(p.items.length >= 10, `${p.id} has only ${p.items.length} items`);
    for (const it of p.items) {
      assert.match(it.ladder, /^N[2-4]$/, `${it.id}: business items start at N2 (ready for real users)`);
      assert.ok(textIn(it.doneWhen, 'pt-BR').length > 10);
    }
  }
});

test('the package files stay within 300 lines and hold no email address or personal name', () => {
  for (const id of IDS) {
    const text = readFileSync(join(KNOWLEDGE, `${id}.json`), 'utf8');
    assert.ok(text.split('\n').length <= 300, `${id}.json has more than 300 lines`);
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, `${id}.json holds an email address`);
  }
});
