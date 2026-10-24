import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretBox, rateLimiter, safeEqual } from '../security.mjs';
import { parseAllowlist, publicUrl } from '../google.mjs';

test('safeEqual compares whole strings only', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', undefined), false);
});

test('rate limiter counts per key and never grows without end', () => {
  const lim = rateLimiter({ max: 2, windowMs: 60e3, maxKeys: 100 });
  assert.equal(lim.tooMany('a'), false);
  assert.equal(lim.tooMany('a'), false);
  assert.equal(lim.tooMany('a'), true);
  assert.equal(lim.tooMany('b'), false);
  for (let i = 0; i < 1000; i++) lim.tooMany('ip:' + i); // forged addresses
  assert.ok(lim.tooMany('c') === false);
});

test('allowlist: lower case, any separator, owner first', () => {
  const list = parseAllowlist(' Owner@Gmail.com, friend@example.com;x@y.pt\nowner@gmail.com ');
  assert.deepEqual([...list], ['owner@gmail.com', 'friend@example.com', 'x@y.pt']);
  assert.equal(parseAllowlist('').size, 0);
  assert.equal(parseAllowlist(undefined).size, 0);
});

test('the public address is https (http only on localhost) and never a path', () => {
  assert.equal(publicUrl({ PUBLIC_URL: 'https://day.example.com/some/path' }), 'https://day.example.com');
  assert.equal(publicUrl({ RENDER_EXTERNAL_URL: 'https://bernardos-day.onrender.com' }), 'https://bernardos-day.onrender.com');
  assert.equal(publicUrl({}, 8080), 'http://localhost:8080');
  assert.equal(publicUrl({ PUBLIC_URL: 'http://127.0.0.1:9000' }), 'http://127.0.0.1:9000');
  assert.throws(() => publicUrl({ PUBLIC_URL: 'http://day.example.com' }), /https/);
  assert.throws(() => publicUrl({ PUBLIC_URL: 'javascript:alert(1)' }), /https/);
  assert.throws(() => publicUrl({ PUBLIC_URL: 'not a url' }), /valid/);
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
