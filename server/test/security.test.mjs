import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, secretBox, rateLimiter } from '../security.mjs';

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

test('the rate limiter counts per key and starts again after the window', async () => {
  const limit = rateLimiter({ max: 2, windowMs: 40 });
  assert.equal(limit.tooMany('a'), false);
  assert.equal(limit.tooMany('a'), false);
  assert.equal(limit.tooMany('a'), true, 'the third try in the window is one too many');
  assert.equal(limit.tooMany('b'), false, 'other keys are not affected');
  limit.clear('a');
  assert.equal(limit.tooMany('a'), false, 'cleared after a successful sign-in');
  assert.equal(limit.tooMany('a'), false);
  assert.equal(limit.tooMany('a'), true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(limit.tooMany('a'), false, 'a new window');
});

test('the rate limiter cannot be made to grow without end', async () => {
  // Keys come from the request (usernames, a forged X-Forwarded-For), so they must not pile up.
  const limit = rateLimiter({ max: 5, windowMs: 60e3, maxKeys: 100 });
  for (let i = 0; i < 100; i++) assert.equal(limit.tooMany('ip:' + i), false);
  for (let i = 100; i < 5000; i++) assert.equal(limit.tooMany('ip:' + i), true, 'a full table turns new keys away');
  assert.equal(limit.size, 100, 'never more than maxKeys entries');
  // The flood did not make it forget anyone: a guesser gets no fresh attempts out of it.
  for (let i = 0; i < 4; i++) assert.equal(limit.tooMany('ip:0'), false);
  assert.equal(limit.tooMany('ip:0'), true, 'the first key is still on its original count');

  const quick = rateLimiter({ max: 5, windowMs: 50, maxKeys: 3 });
  for (const k of ['a', 'b', 'c']) quick.tooMany(k);
  assert.equal(quick.tooMany('d'), true);
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(quick.tooMany('d'), false, 'there is room again once windows end');
  assert.equal(quick.size, 1, 'windows that ended are dropped');

  // A key of any length takes up a fixed amount of room, and long keys stay distinct.
  const long = rateLimiter({ max: 1, windowMs: 60e3 });
  const big = 'user:' + 'x'.repeat(4000);
  assert.equal(long.tooMany(big), false);
  assert.equal(long.tooMany(big), true);
  assert.equal(long.tooMany(big + 'y'), false);
  long.clear(big);
  assert.equal(long.tooMany(big), false);
});
