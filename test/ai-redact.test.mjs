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
