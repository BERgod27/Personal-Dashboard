import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, secretBox } from '../security.mjs';

test('password hashes verify only the right password', () => {
  const h = hashPassword('correct horse battery');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('wrong', h), false);
});

test('secret box round-trips and rejects tampering or the wrong key', () => {
  const a = secretBox('a'.repeat(40));
  const sealed = a.seal('my-sigarra-password');
  assert.ok(!sealed.includes('sigarra'));
  assert.equal(a.open(sealed), 'my-sigarra-password');
  assert.throws(() => secretBox('b'.repeat(40)).open(sealed));
  const parts = sealed.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => a.open(parts.join('.')));
  assert.throws(() => secretBox('short'));
});
