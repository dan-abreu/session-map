import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../server/ai/redact.mjs';

const hides = (input, secret, mark) => {
  const out = redact(input);
  assert.ok(!out.includes(secret), `${secret} still in: ${out}`);
  if (mark) assert.ok(out.includes(mark), `${mark} missing in: ${out}`);
  return out;
};

test('redact masks e-mail addresses', () => {
  hides('write to maria.souza+loja@exemplo.com.br today', 'maria.souza+loja@exemplo.com.br', '[email]');
});

test('redact masks phone numbers written the Brazilian and the international way', () => {
  hides('call (11) 98765-4321 now', '98765-4321', '[phone]');
  hides('call +55 11 98765-4321 now', '98765-4321', '[phone]');
  hides('call 11 98765 4321 now', '98765 4321', '[phone]');
  hides('call 415-555-0100 now', '555-0100', '[phone]');
  hides('call +1 415 555 0100 now', '555 0100', '[phone]');
});

test('redact masks CPF and CNPJ, with or without punctuation', () => {
  hides('cpf 123.456.789-09 here', '123.456.789-09', '[cpf]');
  hides('cnpj 12.345.678/0001-95 here', '12.345.678/0001-95', '[cnpj]');
  hides('cpf 12345678909 here', '12345678909');
  hides('cnpj 12345678000195 here', '12345678000195');
});

test('redact masks card-like digit runs that pass the card checksum', () => {
  hides('card 4111 1111 1111 1111 exp', '4111 1111 1111 1111', '[card]');
  hides('card 4111-1111-1111-1111 exp', '1111-1111-1111', '[card]');
  hides('card 5500005555555559 exp', '5500005555555559', '[card]');
});

test('redact masks the credentials in a URL but keeps the host', () => {
  const out = hides('db at postgres://admin:hunter22@db.local:5432/shop', 'hunter22');
  assert.ok(!out.includes('admin:'), out);
  assert.ok(out.includes('db.local:5432/shop'), out);
});

test('redact masks secret-looking tokens', () => {
  hides('key sk-ant-api03-abcdefghijklmnopQRSTUVWX0123', 'abcdefghijklmnopQRSTUVWX0123', '[secret]');
  hides('key sk-or-v1-0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef', '[secret]');
  hides('key AIzaSyA1234567890abcdefghijklmnopqrstu', 'AIzaSyA1234567890abcdefghijklmnopqrstu', '[secret]');
  hides('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', '[secret]');
  hides('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', 'eyJhbGciOiJIUzI1NiJ9', 'Bearer [secret]');
  hides('hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '9f86d081884c7d659a2feaa0c55ad015', '[secret]');
  hides('blob QWxhZGRpbjpvcGVuIHNlc2FtZQ9Xk2LmR7pQz8vWn4Ty6uB3cE1fH0sJ', 'QWxhZGRpbjpvcGVuIHNlc2FtZQ9Xk2LmR7pQz8vWn4Ty6uB3cE1fH0sJ', '[secret]');
});

test('redact leaves the ordinary text of a digest alone', () => {
  const text = [
    'Basket totals on branch feat/checkout-v2, see server/foundation/docwatch-agree.mjs and apps/site/components/CartSummary.tsx',
    'fix lines 1200-1300, version 1.2.3, released 2026-10-10 at 12:30, commit 1a2b3c4, issue #42, 50% off',
    'call claude-haiku-4-5 with 30 calls per hour',
  ].join('\n');
  assert.equal(redact(text), text);
});

test('redact accepts anything and always returns a string', () => {
  assert.equal(redact(''), '');
  assert.equal(redact(undefined), '');
  assert.equal(redact(42), '42');
});

test('redact masks what starts a line or follows a tab inside a JSON-quoted digest', () => {
  const lines = {
    cpf: '123.456.789-09', bare: '12345678909', cnpj: '12.345.678/0001-95', card: '4111 1111 1111 1111', phone: '11 98765-4321',
    bearer: 'Bearer abc.def.ghi', aws: 'AKIAABCDEFGHIJKLMNOP', slack: 'xoxb-1234567890-abcdefghij',
    anthropic: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyzabcdefgh', google: 'AIzaSyA1234567890abcdefghijklmnopqrstu',
    github: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', email: 'maria@exemplo.com',
  };
  for (const [name, secret] of Object.entries(lines)) {
    for (const sep of ['\n', '\t', '\r\n']) {
      const prompt = `Digest:\n${JSON.stringify({ prompts: [`${name}${sep}${secret}`] }, null, 1)}`;
      const out = redact(prompt);
      const shown = secret.replace(/^Bearer /, '');
      assert.ok(!out.includes(shown), `${name} after ${JSON.stringify(sep)} still in: ${out}`);
      assert.ok(out.includes(JSON.stringify(sep).slice(1, -1)), `the escape itself is kept: ${out}`);
    }
  }
});

test('redact masks the usual Brazilian ways of writing a phone number', () => {
  hides('ligue (11) 9 8765-4321 hoje', '8765-4321', '[phone]');
  hides('ligue +55 (11) 9 8765-4321 hoje', '8765-4321', '[phone]');
  hides('ligue 11 9 8765-4321 hoje', '8765-4321', '[phone]');
  hides('ligue 55 11 987654321 hoje', '987654321', '[phone]');
  hides('https://wa.me/5511987654321', '5511987654321', '[phone]');
  hides('fone: 1133334444', '1133334444', '[phone]');
  hides('whatsapp 1133334444', '1133334444', '[phone]');
  assert.equal(redact('logged at 1760090000 and 1760090000123'), 'logged at 1760090000 and 1760090000123', 'timestamps stay');
});

test('redact masks a whole e-mail address with accented letters', () => {
  const out = hides('fale com joão@empresa.com.br', 'jo', '[email]');
  assert.equal(out, 'fale com [email]');
});

// /api/ai/ask takes prompts up to 200 KB: a pattern that re-scans the rest of the text from every position
// turns one such prompt into seconds (or minutes) of a frozen server.
const SIZE = 200 * 1024;
const fill = (unit) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
const SHAPES = {
  letters: 'z', digits: '7', hex: 'a1', base64: 'aZ9+/', dots: '.', at: '@', spaces: ' ', mixed: 'a.b-1 ',
  'word dot': 'a.', 'digit dot': '1.', 'digit dash': '1-', 'word plus': 'a+', 'word dash': 'a-', 'letter percent': 'a%',
  accented: 'é', 'at dot': 'a@a.', 'secret prefix': 'sk-', 'url scheme': 'a://', escapes: '\\n',
  'key header': '-----BEGIN A PRIVATE KEY-----', 'open key': '-----BEGIN PRIVATE KEY-----x', 'key end only': '-----END A',
};
for (const [name, unit] of Object.entries(SHAPES)) {
  test(`redact handles 200 KB of ${name} in under 200 ms`, () => {
    const text = fill(unit);
    const time = () => { const t = performance.now(); redact(text); return performance.now() - t; };
    let ms = time();
    if (ms >= 200) ms = Math.min(ms, time()); // a second try forgives one hiccup of a busy machine
    assert.ok(ms < 200, `${name}: ${ms.toFixed(0)} ms`);
  });
}

test('redact keeps masking the e-mail edge cases the fast path must not lose', () => {
  assert.equal(redact('a@b.cc1@d.com'), '[email][email]');
  assert.equal(redact('x a@b@c.com y'), 'x a@[email] y');
  assert.equal(redact('..@x.com'), '[email]');
  assert.equal(redact('mail 𝒜b@x.com'), 'mail [email]');
  assert.equal(redact(`${'z'.repeat(5000)}@x.com`), '[email]', 'a whole long local part goes');
});

test('redact keeps masking URL credentials after a dotted or plus scheme', () => {
  assert.equal(redact('see 1.postgres://u:p@h/db'), 'see 1.postgres://[credentials]@h/db');
  assert.equal(redact('git+ssh://me:pw@host/x'), 'git+ssh://[credentials]@host/x');
  assert.equal(redact('x_postgres://u:p@h'), 'x_postgres://u:p@h', 'no word boundary, no scheme, as before');
});

test('redact masks a private key from its first header to the first footer, and leaves an open header alone', () => {
  const key = (label, body) => `-----BEGIN ${label}PRIVATE KEY-----\n${body}\n-----END ${label}PRIVATE KEY-----`;
  assert.equal(redact(`-----BEGIN A PRIVATE KEY-----\nAAA\n${key('RSA ', 'BBB')} tail`), '[secret] tail');
  assert.equal(redact(`${key('', 'a')} mid ${key('', 'b')}`), '[secret] mid [secret]');
  assert.equal(redact('pre -----BEGIN PRIVATE KEY----- open'), 'pre -----BEGIN PRIVATE KEY----- open');
  assert.equal(redact(`-----BEGIN PRIVATE KEY----- x ${key('EC ', 'c')}`), '[secret]');
});
