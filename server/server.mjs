#!/usr/bin/env node
// Hosted Personal Dashboard: serves the front end (the folder above this one), keeps each
// user's data in a database, and syncs Moodle, SIGARRA and news on the server.
//
//   npm start                        (see README.md in this folder for env vars and deploy)
//
// Node 22.13+; dependencies are in package.json (pg is loaded only when DATABASE_URL is set).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, store as makeStore } from './db.mjs';
import { newToken, sha256, safeEqual, secretBox, rateLimiter } from './security.mjs';
import { googleSignIn, parseAllowlist, publicUrl, PENDING_MS } from './google.mjs';
import { syncMoodleIcs, manualClasses, build, forClient } from './uni.mjs';
import { syncSigarra, isCredentialError } from './sigarra.mjs';
import { tutorConfig, checkMessages, buildContext, streamAnswer, explainError } from './tutor.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const SESSION_DAYS = 90;
const COOKIE = 'pd_session';
// Holds the state, nonce and PKCE verifier (sealed) while the browser is away at Google.
const OAUTH_COOKIE = 'pd_oauth';
const UNI_STALE_MIN = Number(process.env.UNI_SYNC_MINUTES || 60);
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_DOCS = 30;
// The GitHub commit this copy was built from (Render sets RENDER_GIT_COMMIT). The Account menu
// shows it, so it's easy to see whether an update is live.
const VERSION = (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null;
const MOODLE_HOSTS = (process.env.ALLOWED_MOODLE_HOSTS || '.up.pt').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------- startup

const box = secretBox(process.env.APP_SECRET);
// Google sign-in. Only the addresses in ALLOWED_EMAILS can get in; the first one is the owner,
// who takes over the account made before Google sign-in (see googleUser).
const ALLOWED = parseAllowlist(process.env.ALLOWED_EMAILS);
const OWNER = [...ALLOWED][0] || null;
const GOOGLE_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
// Tests point the library at a fake Google; never honoured outside NODE_ENV=test.
const GOOGLE_TEST_BASE = process.env.NODE_ENV === 'test' ? process.env.GOOGLE_TEST_BASE_URL : '';
const google = GOOGLE_ID && GOOGLE_SECRET ? googleSignIn({
  clientId: GOOGLE_ID,
  clientSecret: GOOGLE_SECRET,
  redirectUri: publicUrl(process.env, PORT) + '/auth/google/callback',
  endpoints: GOOGLE_TEST_BASE ? {
    oauth2AuthBaseUrl: GOOGLE_TEST_BASE + '/o/oauth2/v2/auth',
    oauth2TokenUrl: GOOGLE_TEST_BASE + '/token',
    oauth2FederatedSignonPemCertsUrl: GOOGLE_TEST_BASE + '/oauth2/v1/certs',
  } : undefined,
}) : null;
if (!google) console.warn('[auth] Google sign-in is off: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (server/README.md)');
if (!ALLOWED.size) console.warn('[auth] ALLOWED_EMAILS is empty, so nobody can sign in');
const isAllowed = (email) => !!email && ALLOWED.has(String(email).toLowerCase());

const db = await openDb();
const S = makeStore(db);
const loginLimit = rateLimiter({ max: 30, windowMs: 15 * 60e3 });
const syncLimit = rateLimiter({ max: 20, windowMs: 60 * 60e3 });
const pushLimit = rateLimiter({ max: 30, windowMs: 60 * 60e3 });
const pushIpLimit = rateLimiter({ max: 60, windowMs: 60 * 60e3 });
// Each tutor question costs money on the Anthropic account, so they are capped per user.
const tutorHourLimit = rateLimiter({ max: Number(process.env.TUTOR_PER_HOUR || 40), windowMs: 60 * 60e3 });
const tutorDayLimit = rateLimiter({ max: Number(process.env.TUTOR_PER_DAY || 200), windowMs: 24 * 60 * 60e3 });
// Compared against instead of the real hash when a user or key is absent, so the key check
// takes the same path (and time) whether or not the account exists.
const DUMMY_KEY_HASH = sha256('local-sync-no-such-key');
await S.pruneSessions();

// ---------------------------------------------------------------- http helpers

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};

const CSP = [
  "default-src 'self'",
  // Only this site's own scripts: public CDNs would let anyone's npm package run here.
  "script-src 'self'",
  // Fonts are self-hosted (fonts/), so no font CDN is allowed.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function headers(extra = {}) {
  return {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(process.env.FORCE_SECURE_COOKIE === '1' || process.env.RENDER ? { 'strict-transport-security': 'max-age=31536000' } : {}),
    ...extra,
  };
}

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, headers({ 'content-type': type, 'cache-control': 'no-store', ...extra }));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const fail = (res, code, error) => send(res, code, { error });
// Only ever called with a path on this site or Google's sign-in URL, never with a URL from the request.
const redirect = (res, to, extra = {}) => { res.writeHead(302, headers({ location: to, 'cache-control': 'no-store', ...extra })); res.end(); };
// Thrown from a route: the request handler answers with this status and message.
const httpError = (status, message) => Object.assign(new Error(message), { status });

// The key in an "Authorization: Bearer <key>" header ('' if there is none).
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

function isHttps(req) {
  return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.FORCE_SECURE_COOKIE === '1';
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v));
}

function sessionCookie(req, token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

// Lax, not Strict: Google's redirect back to the callback is a cross-site navigation.
function oauthCookie(req, value, maxAge) {
  return `${OAUTH_COOKIE}=${value}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

async function readJson(req, limit = MAX_DOC_BYTES + 64 * 1024) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw httpError(415, 'expected JSON');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, 'request too large');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw httpError(400, 'bad JSON'); }
}

// Requests that change something must come from this site (cookies are SameSite=Lax too).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  try { return new URL(origin).host === host; } catch { return false; }
}

async function currentUser(req) {
  const token = cookies(req)[COOKIE];
  const user = token ? await S.sessionUser(sha256(token)) : null;
  // Taking an address off ALLOWED_EMAILS signs that account out on every device.
  if (user && !isAllowed(user.email)) { await S.dropUserSessions(user.id); return null; }
  return user;
}

// The account for a Google sign-in (the email is already checked against ALLOWED_EMAILS):
// 1. the account linked to this Google account;
// 2. else an account from before Google sign-in whose username is this email, or, for the
//    owner (first address in ALLOWED_EMAILS), the oldest one. It is linked, so its data stays;
// 3. else a new account, named after the email.
async function googleUser({ sub, email }) {
  const linked = await S.userBySub(sub);
  if (linked) {
    if (linked.email !== email) await S.setEmail(linked.id, email);
    return { ...linked, email };
  }
  const old = await S.unlinkedUsers();
  const claim = old.find((u) => u.username === email) || (email === OWNER ? old[0] : null);
  if (claim && (await S.linkGoogle(claim.id, sub, email))) {
    console.log('[auth] linked an account from before Google sign-in to its Google account');
    return { ...claim, email };
  }
  const username = (await S.userByName(email)) ? `${email}-${sub.slice(-6)}` : email;
  return { id: await S.createUser(username, sub, email), username, email };
}

// ---------------------------------------------------------------- static files

function staticPath(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p === '/') p = '/index.html';
  const segs = p.split('/').filter(Boolean);
  if (!segs.length || segs.some((s) => s.startsWith('.') || s === 'node_modules')) return null;
  // Server-side and private bits of the modules are never served.
  if (segs[0] === 'server') return null;
  if (segs.some((s) => ['tests', 'test', '__pycache__'].includes(s))) return null;
  if (/^(config\.json|server\.mjs|feeds\.json|.*\.py|.*\.csv)$/i.test(segs[segs.length - 1])) return null;
  if (segs.includes('data') && !/\.png$/i.test(p)) return null; // per-user data has its own routes
  if (!TYPES[extname(p).toLowerCase()]) return null;
  const full = normalize(join(WEB_ROOT, ...segs));
  return full.startsWith(WEB_ROOT.endsWith(sep) ? WEB_ROOT : WEB_ROOT + sep) ? full : null;
}

async function serveStatic(req, res, pathname) {
  const full = staticPath(pathname);
  if (!full) return false;
  try {
    const st = await stat(full);
    if (!st.isFile()) return false;
    const type = TYPES[extname(full).toLowerCase()];
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers({ etag })); res.end(); return true; }
    res.writeHead(200, headers({ 'content-type': type, etag, 'cache-control': 'no-cache' }));
    res.end(req.method === 'HEAD' ? undefined : await readFile(full));
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- news

// The news module's own code (modules/news/server.mjs) fetches and filters the headlines; this
// keeps the last result in memory and in the database so a cold start can answer instantly.
const newsModule = () => import('../modules/news/server.mjs');
const news = { data: null, at: 0, running: null };
const NEWS_KEY = 'news.cache';

async function refreshNews() {
  if (news.running) return news.running;
  news.running = (async () => {
    const { refresh } = await newsModule();
    let data = await refresh();
    // If every feed failed this time, keep showing the last headlines (with the new feed errors).
    if (!data.items.length && news.data?.items?.length) data = { ...news.data, feeds: data.feeds, stale: true };
    news.data = data; news.at = Date.now();
    await S.setServer(0, NEWS_KEY, { at: news.at, data }).catch(() => {});
    return data;
  })().finally(() => { news.running = null; });
  return news.running;
}

// After a restart, start from the copy saved in the database.
async function loadSavedNews() {
  if (news.data) return;
  const saved = await S.getServer(0, NEWS_KEY);
  if (saved) { news.data = saved.data; news.at = saved.at; }
}

async function getNews(force) {
  await loadSavedNews();
  const maxAge = (news.data?.refreshMinutes ?? 15) * 60e3;
  if (force || !news.data) return refreshNews();
  if (Date.now() - news.at > maxAge) refreshNews().catch((e) => console.error('[news]', e.message));
  return news.data;
}

// The last headlines, without fetching (for the tutor's context).
async function cachedNews() {
  await loadSavedNews().catch(() => {});
  return news.data;
}

// ---------------------------------------------------------------- uni

const UNI_SETTINGS = 'uni.settings';
const UNI_DATA = 'uni.data';
const uniRunning = new Map();

function publicUniSettings(s) {
  let moodleHost = null;
  try { if (s.moodleIcs) moodleHost = new URL(box.open(s.moodleIcs)).host; } catch { moodleHost = '(unreadable, paste it again)'; }
  return {
    moodleConfigured: !!s.moodleIcs,
    moodleHost,
    faculty: s.faculty || '',
    sigarraUser: s.sigarraUser || '',
    passwordRemembered: !!s.sigarraPassword,
    localSyncEnabled: !!s.localSyncKeyHash,
    scheduleCsv: s.scheduleCsv || '',
    weeksAhead: s.weeksAhead || 2,
  };
}

// Moodle links (and anywhere Moodle redirects) must be https on an allowed host.
function moodleHostOk(u) {
  const host = u.hostname.toLowerCase();
  return u.protocol === 'https:' && MOODLE_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

function checkMoodleUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw httpError(400, 'That Moodle calendar URL is not a valid link.'); }
  if (!moodleHostOk(u)) throw httpError(400, `The Moodle calendar URL must be an https link on ${MOODLE_HOSTS.join(', ')}.`);
  return u.href;
}

// Sources in the saved data that the settings no longer connect. SIGARRA counts as connected
// when a username is saved OR local sync is set up (the student's computer pushes its data).
function disconnected(s, data) {
  const on = { moodle: !!s.moodleIcs, sigarra: !!s.sigarraUser || !!s.localSyncKeyHash, manual: !!s.scheduleCsv };
  return Object.keys(data?.sources || {}).filter((k) => k in on && !on[k]);
}

async function runUniSync(userId, { password } = {}) {
  if (uniRunning.has(userId)) return uniRunning.get(userId);
  const job = (async () => {
    const s = await S.getServer(userId, UNI_SETTINGS, {});
    const results = {};
    const errors = {};
    const attempt = async (name, fn) => {
      try { results[name] = [true, await fn()]; } catch (e) { results[name] = [false, e.message || String(e)]; errors[name] = e; }
    };
    if (s.moodleIcs) await attempt('moodle', () => syncMoodleIcs(box.open(s.moodleIcs), { allowed: moodleHostOk }));
    let forgotPassword = false;
    if (s.sigarraUser && (password || s.sigarraPassword)) {
      let used = password;
      await attempt('sigarra', () => {
        if (!used) {
          try { used = box.open(s.sigarraPassword); } catch { throw new Error('The saved SIGARRA password can\'t be read any more (APP_SECRET changed). Type it again.'); }
        }
        return syncSigarra({ faculty: s.faculty, user: s.sigarraUser, password: used, weeksAhead: s.weeksAhead || 2 });
      });
      // If SIGARRA turned down the password that is saved, delete it, so automatic refreshes
      // can't keep retrying it and get the account blocked.
      if (used && isCredentialError(errors.sigarra)) {
        const cur = await S.getServer(userId, UNI_SETTINGS, {});
        let saved = null;
        try { saved = cur.sigarraPassword ? box.open(cur.sigarraPassword) : null; } catch { /* unreadable: leave it */ }
        if (saved === used) {
          delete cur.sigarraPassword;
          await S.setServer(userId, UNI_SETTINGS, cur);
          results.sigarra[1] += errors.sigarra.kind === 'unconfirmed'
            ? ' The saved password was removed so the server stops retrying it; type it in Uni connections to try again.'
            : ' The saved password was removed; type the right one in Uni connections.';
          forgotPassword = true;
        }
      }
    }
    if (s.scheduleCsv) await attempt('manual', async () => ({ classes: manualClasses(s.scheduleCsv, s.weeksAhead || 2) }));
    if (!Object.keys(results).length) {
      const e = new Error(s.sigarraUser ? 'Type your SIGARRA password to sync.' : 'Nothing is connected yet.');
      e.status = 400; e.needsPassword = !!s.sigarraUser;
      throw e;
    }
    const prev = await S.getServer(userId, UNI_DATA);
    const data = build(prev, results, { drop: disconnected(s, prev) });
    await S.setServer(userId, UNI_DATA, data);
    return {
      data: forClient(data), ran: Object.keys(results),
      sigarraSkipped: !!s.sigarraUser && !results.sigarra, forgotPassword,
    };
  })().finally(() => uniRunning.delete(userId));
  uniRunning.set(userId, job);
  return job;
}

function isStale(data) {
  if (!data?.generated_at) return true;
  return Date.now() - Date.parse(data.generated_at) > UNI_STALE_MIN * 60e3;
}

// ---------------------------------------------------------------- routes

async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const path = url.pathname;
  const method = req.method;

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) return fail(res, 403, 'cross-site request blocked');

  if (path === '/api/health') return send(res, 200, { ok: true, db: db.kind, version: VERSION });

  // --- auth: Sign in with Google (google.mjs); only addresses in ALLOWED_EMAILS get in
  if (path === '/api/auth' && method === 'GET') {
    const user = await currentUser(req);
    return send(res, 200, {
      user: user ? { email: user.email, username: user.username } : null,
      google: !!google && ALLOWED.size > 0,
      version: VERSION,
    });
  }
  if (path === '/auth/google' && method === 'GET') {
    if (loginLimit.tooMany('ip:' + clientIp(req))) return redirect(res, '/login?error=busy');
    if (!google || !ALLOWED.size) return redirect(res, '/login?error=setup');
    const { url: to, pending } = google.start();
    return redirect(res, to, { 'set-cookie': oauthCookie(req, box.seal(JSON.stringify(pending)), PENDING_MS / 1000) });
  }
  if (path === '/auth/google/callback' && method === 'GET') {
    // Every way out clears the pending sign-in, so the browser can't send it twice.
    const back = (error) => redirect(res, '/login?error=' + error, { 'set-cookie': oauthCookie(req, '', 0) });
    if (loginLimit.tooMany('ip:' + clientIp(req))) return back('busy');
    if (!google || !ALLOWED.size) return back('setup');
    if (url.searchParams.has('error')) return back('cancelled'); // e.g. access_denied: the user said no
    let pending = null;
    try { pending = JSON.parse(box.open(cookies(req)[OAUTH_COOKIE])); } catch { /* missing or tampered */ }
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!pending?.state || !code || !(Date.now() - pending.at < PENDING_MS) || !safeEqual(state, pending.state)) return back('expired');
    let who;
    try {
      who = await google.finish({ code, pending });
    } catch (e) {
      console.warn('[auth] Google sign-in failed:', e.kind ? e.message : 'unexpected error');
      if (!e.kind) console.error(e);
      return back(e.kind === 'unverified' ? 'unverified' : 'failed');
    }
    if (!isAllowed(who.email)) {
      console.warn('[auth] refused a Google account that is not in ALLOWED_EMAILS');
      return back('not_allowed');
    }
    const user = await googleUser(who);
    // A fresh session token on every sign-in; the one this browser had before is ended.
    const prior = cookies(req)[COOKIE];
    if (prior) await S.dropSession(sha256(prior));
    const token = newToken();
    await S.addSession(sha256(token), user.id, Date.now() + SESSION_DAYS * 86400e3);
    return redirect(res, '/', { 'set-cookie': [oauthCookie(req, '', 0), sessionCookie(req, token, SESSION_DAYS * 86400)] });
  }
  if (path === '/api/logout-all' && method === 'POST') {
    // Signs out every device, e.g. after using a shared computer.
    const user = await currentUser(req);
    if (!user) return fail(res, 401, 'Sign in first.');
    await S.dropUserSessions(user.id);
    return send(res, 200, { ok: true }, undefined, { 'set-cookie': sessionCookie(req, '', 0) });
  }
  if (path === '/api/logout' && method === 'POST') {
    const token = cookies(req)[COOKIE];
    if (token) await S.dropSession(sha256(token));
    return send(res, 200, { ok: true }, undefined, { 'set-cookie': sessionCookie(req, '', 0) });
  }

  // --- cron (no session; shared secret)
  if (path === '/api/cron' && method === 'POST') {
    const secret = process.env.CRON_SECRET;
    // Header only: a key in the URL would end up in the host's request logs.
    if (!secret || !safeEqual(bearer(req), secret)) return fail(res, 401, 'bad cron key');
    const out = { news: null, uni: {} };
    try { const n = await getNews(false); out.news = n?.items?.length ?? 0; } catch (e) { out.news = e.message; }
    for (const { id } of (await S.users()).filter((u) => isAllowed(u.email))) {
      if (!isStale(await S.getServer(id, UNI_DATA))) { out.uni[id] = 'fresh'; continue; }
      try { out.uni[id] = (await runUniSync(id)).ran; } catch (e) { out.uni[id] = e.message; }
    }
    await S.pruneSessions();
    return send(res, 200, out);
  }

  // --- local SIGARRA sync push (no session; a per-user sync key, not the account password)
  // The student runs tools/local-sync.mjs on their own computer: it signs in to SIGARRA from
  // their own network and posts the result here. Their SIGARRA password never reaches the server.
  if (path === '/api/uni/push' && method === 'POST') {
    // Throttle by IP before any work, so a flood of bad keys can't hammer the database.
    if (pushIpLimit.tooMany('push-ip:' + clientIp(req))) return fail(res, 429, 'Too many requests. Try again later.');
    const key = bearer(req);
    const body = await readJson(req, 512 * 1024);
    const name = String(body.user || '').trim().toLowerCase();
    const found = key && name ? await S.userByName(name) : null;
    // An account taken off ALLOWED_EMAILS can't push either.
    const u = found && isAllowed(found.email) ? found : null;
    const s = u ? await S.getServer(u.id, UNI_SETTINGS, {}) : null;
    // Always run the constant-time compare (against a dummy hash when absent), so a wrong user
    // and a wrong key take the same path. One message for both.
    const stored = (s && s.localSyncKeyHash) || '';
    if (!safeEqual(sha256(key), stored || DUMMY_KEY_HASH) || !stored) {
      return fail(res, 401, 'Unknown user, or the sync key is wrong or turned off. Generate one in Uni connections.');
    }
    if (pushLimit.tooMany('push:' + u.id)) return fail(res, 429, 'Too many pushes this hour. Try again later.');
    const payload = body.data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail(res, 400, 'No SIGARRA data in the request.');
    const prev = await S.getServer(u.id, UNI_DATA);
    const data = build(prev, { sigarra: [true, payload] });
    await S.setServer(u.id, UNI_DATA, data);
    const c = forClient(data);
    return send(res, 200, { ok: true, classes: c.classes.length, exams: c.exams.length, deadlines: c.deadlines.length, synced_at: c.sources.sigarra.synced_at });
  }

  // --- pages
  if (path === '/login' || path === '/login.html') {
    if (await currentUser(req)) return redirect(res, '/');
    if (await serveStatic(req, res, '/login.html')) return;
    return fail(res, 404, 'not found');
  }
  if (path === '/' || path === '/index.html') {
    if (!(await currentUser(req))) return redirect(res, '/login');
    if (await serveStatic(req, res, '/index.html')) return;
    return fail(res, 404, 'not found');
  }

  const needsUser = path.startsWith('/api/') || path.startsWith('/modules/uni/data/');
  if (!needsUser) {
    if ((method === 'GET' || method === 'HEAD') && (await serveStatic(req, res, path))) return;
    return fail(res, 404, 'not found');
  }

  const user = await currentUser(req);
  if (!user) return fail(res, 401, 'Sign in first.');

  // --- synced documents (localStorage keys mirrored by js/online.js)
  if (path === '/api/state' && method === 'GET') {
    const docs = {};
    for (const d of await S.docs(user.id)) docs[d.key] = { value: d.value, version: d.version, updatedAt: d.updated_at };
    return send(res, 200, { docs });
  }
  const docMatch = path.match(/^\/api\/state\/([A-Za-z0-9._-]{1,64})$/);
  if (docMatch && method === 'PUT') {
    const key = docMatch[1];
    const { value, baseVersion } = await readJson(req);
    if (typeof value !== 'string') return fail(res, 400, 'value must be a string');
    if (Buffer.byteLength(value) > MAX_DOC_BYTES) return fail(res, 413, 'This document is too large to save.');
    if (!Number.isInteger(baseVersion) || baseVersion < 0) return fail(res, 400, 'baseVersion must be a whole number');
    if (baseVersion === 0 && (await S.docs(user.id)).length >= MAX_DOCS) return fail(res, 400, 'too many documents');
    const r = await S.putDoc(user.id, key, value, baseVersion);
    if (!r.ok) {
      const cur = await S.doc(user.id, key);
      return send(res, 409, { error: 'changed elsewhere', current: cur && { value: cur.value, version: cur.version, updatedAt: cur.updated_at } });
    }
    return send(res, 200, { version: r.version, updatedAt: r.updated_at });
  }

  // --- news
  if (path === '/api/news' || path === '/api/news/refresh') {
    try {
      const data = await getNews(path.endsWith('/refresh'));
      const { view } = await newsModule();
      return send(res, 200, view(data, url.searchParams));
    } catch (e) { return fail(res, 502, 'News could not be loaded: ' + e.message); }
  }

  // --- tutor (Claude API; ANTHROPIC_API_KEY must be set on the server)
  if (path === '/api/tutor' && method === 'GET') {
    const { configured, model } = tutorConfig();
    return send(res, 200, { configured, model });
  }
  if (path === '/api/tutor' && method === 'POST') {
    const cfg = tutorConfig();
    if (!cfg.configured) return send(res, 503, { error: 'The tutor needs an Anthropic API key. Add ANTHROPIC_API_KEY in Render → Environment (see server/README.md).', setup: true });
    const b = await readJson(req, 128 * 1024);
    const messages = checkMessages(b.messages);
    const view = ['today', 'uni', 'workouts', 'meals', 'news'].includes(b.view) ? b.view : null;
    if (tutorHourLimit.tooMany('tutor:' + user.id) || tutorDayLimit.tooMany('tutor:' + user.id)) {
      return fail(res, 429, 'That\'s a lot of questions for now. The tutor limit resets within the hour.');
    }
    const docs = {};
    for (const d of await S.docs(user.id)) docs[d.key] = d.value;
    const context = buildContext({ docs, uni: forClient(await S.getServer(user.id, UNI_DATA)), news: await cachedNews() });
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    // One JSON object per line: {t:'text'} chunks, {reset:true}, then {done:true} or {error}.
    res.writeHead(200, headers({ 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }));
    const line = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    try {
      for await (const ev of streamAnswer({ apiKey: process.env.ANTHROPIC_API_KEY.trim(), model: cfg.model, effort: cfg.effort, context, messages, view, signal: abort.signal })) {
        if (ev.type === 'text') line({ t: ev.text });
        else if (ev.type === 'reset') line({ reset: true });
        else if (ev.type === 'done') {
          if (ev.stop === 'refusal') line({ error: 'Claude declined to answer that one. Try rephrasing the question.' });
          else line({ done: true, stop: ev.stop });
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        console.error('[tutor]', e.status || '', e.name || 'error'); // no content: questions are private
        line({ error: explainError(e) });
      }
    }
    return res.end();
  }

  // --- uni
  if (path === '/modules/uni/data/uni.js') {
    const data = forClient(await S.getServer(user.id, UNI_DATA));
    return send(res, 200, data ? `window.UNI_DATA = ${JSON.stringify(data)};\n` : '/* not synced yet */\n', 'text/javascript; charset=utf-8');
  }
  if (path === '/modules/uni/data/uni.json' || (path === '/api/uni' && method === 'GET')) {
    const data = forClient(await S.getServer(user.id, UNI_DATA));
    return data ? send(res, 200, data) : fail(res, 404, 'not synced yet');
  }
  if (path === '/api/uni/settings' && method === 'GET') {
    return send(res, 200, publicUniSettings(await S.getServer(user.id, UNI_SETTINGS, {})));
  }
  if (path === '/api/uni/settings' && method === 'PUT') {
    const b = await readJson(req, 64 * 1024);
    const s = await S.getServer(user.id, UNI_SETTINGS, {});
    if (typeof b.moodleIcsUrl === 'string') {
      const v = b.moodleIcsUrl.trim();
      if (v) s.moodleIcs = box.seal(checkMoodleUrl(v)); else delete s.moodleIcs;
    }
    if (typeof b.faculty === 'string') {
      // Empty = found automatically from SIGARRA.
      const f = b.faculty.trim().toLowerCase();
      if (f && !/^[a-z]{2,12}$/.test(f)) return fail(res, 400, 'The faculty code is letters only, like feup or fcup.');
      if (f) s.faculty = f; else delete s.faculty;
    }
    let sigarraUserChanged = false;
    if (typeof b.sigarraUser === 'string') {
      const u = b.sigarraUser.trim();
      if (u && !/^[A-Za-z0-9._@-]{2,64}$/.test(u)) return fail(res, 400, 'That SIGARRA username looks wrong (e.g. up202301234).');
      if (u !== (s.sigarraUser || '')) { delete s.sigarraPassword; sigarraUserChanged = true; }
      if (u) s.sigarraUser = u; else delete s.sigarraUser;
    }
    if (b.rememberPassword === false) delete s.sigarraPassword;
    if (b.rememberPassword === true && typeof b.sigarraPassword === 'string' && b.sigarraPassword) s.sigarraPassword = box.seal(b.sigarraPassword);
    if (typeof b.scheduleCsv === 'string') {
      if (b.scheduleCsv.length > 20000) return fail(res, 400, 'The timetable is too long.');
      if (b.scheduleCsv.trim()) s.scheduleCsv = b.scheduleCsv; else delete s.scheduleCsv;
    }
    if (Number.isInteger(b.weeksAhead) && b.weeksAhead >= 1 && b.weeksAhead <= 8) s.weeksAhead = b.weeksAhead;
    await S.setServer(user.id, UNI_SETTINGS, s);
    // Forget synced data from sources that were disconnected (or another SIGARRA account's).
    const prev = await S.getServer(user.id, UNI_DATA);
    const drop = disconnected(s, prev);
    if (sigarraUserChanged && prev?.sources?.sigarra && !drop.includes('sigarra')) drop.push('sigarra');
    if (drop.length) await S.setServer(user.id, UNI_DATA, build(prev, {}, { drop }));
    return send(res, 200, publicUniSettings(s));
  }
  if (path === '/api/uni/sync' && method === 'POST') {
    const b = await readJson(req, 8192);
    if (b.ifStale && !isStale(await S.getServer(user.id, UNI_DATA))) return send(res, 200, { skipped: 'fresh' });
    if (syncLimit.tooMany('uni:' + user.id)) return fail(res, 429, 'Too many syncs this hour. Try again later.');
    try {
      const pw = typeof b.password === 'string' && b.password ? b.password : undefined;
      return send(res, 200, await runUniSync(user.id, { password: pw }));
    } catch (e) {
      if (b.ifStale && e.status === 400) return send(res, 200, { skipped: 'not connected', needsPassword: !!e.needsPassword });
      return send(res, e.status || 502, { error: e.message, needsPassword: !!e.needsPassword });
    }
  }
  // Create (or replace) the key the local sync script uses to push SIGARRA data. Shown once.
  if (path === '/api/uni/sync-key' && method === 'POST') {
    const key = newToken();
    const s = await S.getServer(user.id, UNI_SETTINGS, {});
    s.localSyncKeyHash = sha256(key);
    await S.setServer(user.id, UNI_SETTINGS, s);
    return send(res, 200, { key, user: user.username });
  }
  if (path === '/api/uni/sync-key' && method === 'DELETE') {
    const s = await S.getServer(user.id, UNI_SETTINGS, {});
    delete s.localSyncKeyHash;
    await S.setServer(user.id, UNI_SETTINGS, s);
    return send(res, 200, { ok: true });
  }

  return fail(res, 404, 'not found');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!e.status) console.error('[server]', e);
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Something went wrong on the server.');
    else res.end();
  });
});

server.listen(PORT, () => console.log(`[dashboard] http://localhost:${PORT}  (database: ${db.kind})`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { server.close(); db.close?.(); process.exit(0); });
}
