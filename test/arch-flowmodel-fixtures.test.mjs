// The general view on the invented projects of test/fixtures/repos: a Next.js shop and a Flutter + Laravel delivery app,
// the kinds of project the owner builds, not only session-map itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readArch } from '../server/arch/detect.mjs';
import { buildFlowModel } from '../server/arch/flowmodel.mjs';
import { copyFixtureRepo, removeFixtureRepo } from './fixtures/repo-copy.mjs';

async function modelOf(name) {
  const root = copyFixtureRepo(name);
  const reads = [];
  try {
    const arch = { ...(await readArch(root, {})), links: [] };
    const readFile = (abs, ...rest) => {
      reads.push(String(abs).replaceAll('\\', '/'));
      return readFileSync(abs, ...rest);
    };
    return { model: await buildFlowModel({ root, arch, source: arch.source, readFile }), reads };
  } finally {
    removeFixtureRepo(root);
  }
}
const ids = (list) => list.map((x) => x.id);

test('a Next.js shop: people on the web screens, the team on the admin screens, Stripe and the mailer from the code', async () => {
  const { model, reads } = await modelOf('acme-shop');
  assert.ok(ids(model.edges).includes('actor:user>part:web#actor'));
  assert.ok(ids(model.nodes).includes('actor:admin'), 'the admin app has screens even if no part holds it yet');
  assert.ok(ids(model.edges).includes('part:orders>svc:stripe#service'));
  assert.ok(ids(model.edges).includes('part:orders>svc:host:api.mailer.example#service'));
  assert.ok(ids(model.edges).includes('part:worker>svc:redis#service'), 'a dependency draws an arrow when no code showed the call');
  assert.equal(ids(model.nodes).some((id) => id.includes('ghost')), false, 'a URL in a comment is not a service');
  assert.equal(reads.some((p) => p.endsWith('/.env')), false, 'the secrets file is never opened');
});

test('a Flutter app with a Laravel backend: customers on the phone screens, and the hosts each side calls', async () => {
  const { model } = await modelOf('acme-delivery');
  assert.ok(ids(model.edges).includes('actor:customer>part:customer#actor'));
  assert.ok(ids(model.edges).includes('part:customer>svc:host:api.acme-delivery.example#service'));
  assert.ok(ids(model.edges).includes('part:backend>svc:host:mail.acme-delivery.example#service'));
  assert.equal(ids(model.nodes).some((id) => id.includes('ghost')), false, 'a URL inside a string of text is not a call');
});
