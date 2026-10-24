// Sign in with Google (OpenID Connect, authorization code flow with PKCE).
//
// The sign-in page links to /auth/google, which sends the browser to Google. Google sends it
// back to /auth/google/callback with a one-time code; the server swaps that code for an ID
// token directly with Google (with the client secret and the PKCE verifier), checks the token
// with google-auth-library and starts the dashboard's own session. No Google script runs on
// the site, so the Content Security Policy stays at 'self'.
//
// Who may sign in is decided by ALLOWED_EMAILS (server.mjs), not here.

import { OAuth2Client } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { newToken, safeEqual } from './security.mjs';

// Google's two spellings of its issuer. Set explicitly: the library's default list also
// accepts its "universe domain" (googleapis.com), which Google sign-in never uses.
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// How long the round trip to Google may take before the sign-in has to start again.
export const PENDING_MS = 10 * 60e3;

// One failed sign-in. `kind` picks the message the sign-in page shows; `message` is for the
// server log and never contains the token, the code or the email address.
export class SignInError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

// "a@x.com, B@y.com" -> Set {'a@x.com', 'b@y.com'}, in order (the first one is the owner).
export const parseAllowlist = (s) =>
  new Set(String(s || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));

// The address the site is reached at; Google sends the browser back to <it>/auth/google/callback,
// which must be listed in the OAuth client. Never taken from the request's Host header.
export function publicUrl(env = process.env, port = 8080) {
  const raw = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).trim();
  let u;
  try { u = new URL(raw); } catch { throw new Error(`PUBLIC_URL is not a valid address: ${raw}`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    throw new Error(`PUBLIC_URL must start with https:// (http:// only for localhost): ${raw}`);
  }
  return u.origin;
}

const challengeFor = (verifier) => createHash('sha256').update(verifier).digest('base64url');

export function googleSignIn({ clientId, clientSecret, redirectUri, endpoints }) {
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri, issuers: ISSUERS, endpoints });
  return {
    // Where to send the browser, and what to keep (sealed, in a cookie) until it comes back.
    start() {
      const pending = { state: newToken(), nonce: newToken(), verifier: newToken(), at: Date.now() };
      const url = client.generateAuthUrl({
        scope: 'openid email',
        state: pending.state,
        nonce: pending.nonce,
        code_challenge: challengeFor(pending.verifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url, pending };
    },

    // Swaps the code for an ID token and checks it: signature (Google's published keys), aud =
    // our client ID, iss, exp/iat, then the nonce from start() and email_verified.
    // Returns { sub, email }; throws SignInError.
    async finish({ code, pending }) {
      let idToken;
      try {
        const { tokens } = await client.getToken({ code, codeVerifier: pending.verifier });
        idToken = tokens.id_token;
      } catch (e) {
        // Only the status and Google's error code: the request it failed on holds the secret.
        throw new SignInError('failed', `code exchange failed (${e.response?.status || e.code || 'network'} ${e.response?.data?.error || ''})`.trim());
      }
      if (!idToken) throw new SignInError('failed', 'Google sent no ID token');
      let claims;
      try {
        claims = (await client.verifyIdToken({ idToken, audience: clientId })).getPayload();
      } catch (e) {
        // The library's messages quote the whole token, so they are not logged.
        throw new SignInError('failed', /certificates/.test(e.message) ? 'could not fetch Google\'s signing keys' : 'the ID token did not verify');
      }
      if (!claims || typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, pending.nonce)) {
        throw new SignInError('failed', 'the ID token was not issued for this sign-in (nonce)');
      }
      if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email) {
        throw new SignInError('failed', 'the ID token has no account ID or email');
      }
      if (claims.email_verified !== true && claims.email_verified !== 'true') {
        throw new SignInError('unverified', 'the Google account\'s email is not verified');
      }
      return { sub: claims.sub, email: claims.email.trim().toLowerCase() };
    },
  };
}
