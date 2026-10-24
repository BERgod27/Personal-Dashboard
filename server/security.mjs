// Session tokens, constant-time comparison, encryption of stored secrets and rate limits.
// Built on node:crypto only. (Sign-in itself is Google's: see google.mjs.)

import { randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// AES-256-GCM with a key derived from APP_SECRET. The key lives only in the host's
// environment, so a copy of the database alone can't reveal the stored secrets.
export function secretBox(appSecret) {
  if (!appSecret || appSecret.length < 32) {
    throw new Error('APP_SECRET must be set to a random string of at least 32 characters');
  }
  const key = Buffer.from(hkdfSync('sha256', appSecret, 'personal-dashboard', 'secret-box-v1', 32));
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;
    },
    open(sealed) {
      const [v, iv, tag, body] = String(sealed).split('.');
      if (v !== 'v1') throw new Error('unknown secret format');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
    },
  };
}

// Fixed-window limiter, per key (IP or user). Enough for a personal app.
export function rateLimiter({ max, windowMs, maxKeys = 10000 }) {
  const hits = new Map();
  return {
    tooMany(key) {
      const now = Date.now();
      // Keys can come from a forged X-Forwarded-For, so old windows are swept out before the
      // map can grow without end.
      if (hits.size >= maxKeys) for (const [k, h] of hits) if (h.reset < now) hits.delete(k);
      if (hits.size >= maxKeys) hits.clear();
      const h = hits.get(key);
      if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return false; }
      h.n += 1;
      return h.n > max;
    },
  };
}
