// A stand-in for Google's sign-in, for the server tests. The server is pointed at it with
// NODE_ENV=test and GOOGLE_TEST_BASE_URL. It has:
//   GET  /o/oauth2/v2/auth   signs in `fake.next` (or says no, if `fake.deny`) and sends the
//                            browser back to redirect_uri with a one-time code
//   POST /token              checks the client secret, redirect URI and PKCE verifier, then
//                            returns an RS256 ID token (`fake.claims` overrides its claims)
//   GET  /oauth2/v1/certs    the public key the tokens are signed with
import http from 'node:http';
import { generateKeyPairSync, createSign, createHash, randomBytes } from 'node:crypto';

const KID = 'fake-key-1';

export async function startFakeGoogle({ clientId, clientSecret }) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map();
  const fake = {
    next: null, // { sub, email, email_verified? }: who the next authorization signs in
    deny: false, // the user presses Cancel at Google
    claims: {}, // extra or replaced ID-token claims (aud, iss, exp, nonce, ...)
    badSignature: false, // sign with a key Google doesn't publish
    lastAuth: null, // the query of the last authorization request
    tokenCalls: 0,
  };

  const jwt = (claims, privateKey) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const signed = `${enc({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${enc(claims)}`;
    return `${signed}.${createSign('RSA-SHA256').update(signed).sign(privateKey, 'base64url')}`;
  };
  const json = (res, code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    if (url.pathname === '/o/oauth2/v2/auth') {
      const q = Object.fromEntries(url.searchParams);
      fake.lastAuth = q;
      const back = new URL(q.redirect_uri);
      if (q.client_id !== clientId || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) {
        res.writeHead(400); return res.end('bad authorization request');
      }
      back.searchParams.set('state', q.state);
      if (fake.deny) back.searchParams.set('error', 'access_denied');
      else {
        const code = '4/' + randomBytes(12).toString('base64url');
        codes.set(code, { who: fake.next, nonce: q.nonce, challenge: q.code_challenge, redirectUri: q.redirect_uri });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      fake.tokenCalls += 1;
      let body = '';
      for await (const c of req) body += c;
      const p = Object.fromEntries(new URLSearchParams(body));
      const c = codes.get(p.code);
      codes.delete(p.code); // one use only, like Google's
      const pkce = createHash('sha256').update(p.code_verifier || '').digest('base64url');
      if (p.client_id !== clientId || p.client_secret !== clientSecret) return json(res, 401, { error: 'invalid_client' });
      if (!c || p.grant_type !== 'authorization_code' || p.redirect_uri !== c.redirectUri || pkce !== c.challenge) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: 'https://accounts.google.com', azp: clientId, aud: clientId,
        sub: c.who.sub, email: c.who.email, email_verified: c.who.email_verified ?? true,
        nonce: c.nonce, iat: now, exp: now + 3600, ...fake.claims,
      };
      return json(res, 200, {
        access_token: 'ya29.fake', expires_in: 3599, token_type: 'Bearer', scope: 'openid email',
        id_token: jwt(claims, fake.badSignature ? stranger.privateKey : key.privateKey),
      });
    }
    if (url.pathname === '/oauth2/v1/certs') {
      return json(res, 200, { [KID]: key.publicKey.export({ type: 'spki', format: 'pem' }) }, { 'cache-control': 'public, max-age=3600' });
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fake.base = `http://127.0.0.1:${server.address().port}`;
  fake.close = () => server.close();
  fake.reset = () => Object.assign(fake, { next: null, deny: false, claims: {}, badSignature: false });
  return fake;
}

// The environment that points a dashboard server at the fake.
export const fakeGoogleEnv = (fake, base, allowed) => ({
  NODE_ENV: 'test', GOOGLE_TEST_BASE_URL: fake.base, PUBLIC_URL: base,
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret',
  ALLOWED_EMAILS: allowed,
});

let ipCounter = 0;
// Walks a browser through a sign-in: dashboard -> Google -> dashboard callback. Each call comes
// from its own address (X-Forwarded-For), so the sign-in rate limit doesn't trip across tests.
// Returns where the callback sent the browser and the session cookie it set ('' if none).
export async function googleSignIn(base, fake, who, { ip = `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}` } = {}) {
  fake.next = who;
  const xff = { 'x-forwarded-for': ip };
  const start = await fetch(base + '/auth/google', { redirect: 'manual', headers: xff });
  const oauth = (start.headers.getSetCookie().find((c) => c.startsWith('pd_oauth=')) || '').split(';')[0];
  const atGoogle = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const back = await fetch(atGoogle.headers.get('location'), { redirect: 'manual', headers: { ...xff, cookie: oauth } });
  const set = back.headers.getSetCookie();
  const session = (set.find((c) => c.startsWith('pd_session=') && !/Max-Age=0/.test(c)) || '').split(';')[0];
  return { location: back.headers.get('location'), session, setCookies: set, oauth, callback: atGoogle.headers.get('location') };
}
