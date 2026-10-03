#!/usr/bin/env node
// Hosted Personal Dashboard: serves the front end (the folder above this one), keeps each
// user's data in a database, and syncs Moodle, SIGARRA and news on the server.
//
//   npm start                        (see README.md in this folder for env vars and deploy)
//
// Node 22.13+; one dependency (pg) and only when DATABASE_URL is set.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, store as makeStore } from './db.mjs';
import { hashPassword, verifyPassword, verifyDummy, newToken, sha256, safeEqual, secretBox, rateLimiter } from './security.mjs';
import { syncMoodleIcs, syncSigarra, manualClasses, build, forClient } from './uni.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const SESSION_DAYS = 90;
const COOKIE = 'pd_session';
const UNI_STALE_MIN = Number(process.env.UNI_SYNC_MINUTES || 60);
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_DOCS = 30;
const MOODLE_HOSTS = (process.env.ALLOWED_MOODLE_HOSTS || '.up.pt').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------- startup

const box = secretBox(process.env.APP_SECRET);
const db = await openDb();
const S = makeStore(db);
const loginLimit = rateLimiter({ max: 10, windowMs: 15 * 60e3 });
const syncLimit = rateLimiter({ max: 20, windowMs: 60 * 60e3 });
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
  "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
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
    ...extra,
  };
}

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, headers({ 'content-type': type, 'cache-control': 'no-store', ...extra }));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const fail = (res, code, error) => send(res, code, { error });
const redirect = (res, to) => { res.writeHead(302, headers({ location: to, 'cache-control': 'no-store' })); res.end(); };

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

async function readJson(req, limit = MAX_DOC_BYTES + 64 * 1024) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('expected JSON'), { status: 415 });
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); }
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
  return token ? S.sessionUser(sha256(token)) : null;
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

// The news module's own fetcher (modules/news/server.mjs) does the work; this keeps the
// last result in memory and in the database so a cold start can answer instantly.
const news = { data: null, at: 0, running: null };
const NEWS_KEY = 'news.cache';

async function refreshNews() {
  if (news.running) return news.running;
  news.running = (async () => {
    const { refresh } = await import('../modules/news/server.mjs');
    let data = await refresh();
    // If every feed failed this time, keep showing the last headlines (with the new feed errors).
    if (!data.items.length && news.data?.items?.length) data = { ...news.data, feeds: data.feeds, stale: true };
    news.data = data; news.at = Date.now();
    await S.setServer(0, NEWS_KEY, { at: news.at, data }).catch(() => {});
    return data;
  })().finally(() => { news.running = null; });
  return news.running;
}

async function getNews(force) {
  if (!news.data) {
    const saved = await S.getServer(0, NEWS_KEY);
    if (saved) { news.data = saved.data; news.at = saved.at; }
  }
  const maxAge = (news.data?.refreshMinutes ?? 15) * 60e3;
  if (force || !news.data) return refreshNews();
  if (Date.now() - news.at > maxAge) refreshNews().catch((e) => console.error('[news]', e.message));
  return news.data;
}

function newsView(data, params) {
  const cat = params.get('category');
  const limit = Number(params.get('limit')) || 0;
  let items = cat && cat !== 'all' ? data.items.filter((i) => i.category === cat) : data.items;
  if (limit) items = items.slice(0, limit);
  return { ...data, items };
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
    faculty: s.faculty || 'feup',
    sigarraUser: s.sigarraUser || '',
    passwordRemembered: !!s.sigarraPassword,
    scheduleCsv: s.scheduleCsv || '',
    weeksAhead: s.weeksAhead || 2,
  };
}

function checkMoodleUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('That Moodle calendar URL is not a valid link.'), { status: 400 }); }
  const host = u.hostname.toLowerCase();
  const ok = u.protocol === 'https:' && MOODLE_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
  if (!ok) throw Object.assign(new Error(`The Moodle calendar URL must be an https link on ${MOODLE_HOSTS.join(', ')}.`), { status: 400 });
  return u.href;
}

async function runUniSync(userId, { password } = {}) {
  if (uniRunning.has(userId)) return uniRunning.get(userId);
  const job = (async () => {
    const s = await S.getServer(userId, UNI_SETTINGS, {});
    const results = {};
    const attempt = async (name, fn) => {
      try { results[name] = [true, await fn()]; } catch (e) { results[name] = [false, e.message || String(e)]; }
    };
    if (s.moodleIcs) await attempt('moodle', () => syncMoodleIcs(box.open(s.moodleIcs)));
    let usedPassword = false;
    if (s.sigarraUser) {
      const pw = password || (s.sigarraPassword ? box.open(s.sigarraPassword) : null);
      if (pw) {
        usedPassword = true;
        await attempt('sigarra', () => syncSigarra({ faculty: s.faculty, user: s.sigarraUser, password: pw, weeksAhead: s.weeksAhead || 2 }));
      }
    }
    if (s.scheduleCsv) await attempt('manual', async () => ({ classes: manualClasses(s.scheduleCsv, s.weeksAhead || 2) }));
    if (!Object.keys(results).length) {
      const e = new Error(s.sigarraUser ? 'Type your SIGARRA password to sync.' : 'Nothing is connected yet.');
      e.status = 400; e.needsPassword = !!s.sigarraUser;
      throw e;
    }
    const data = build(await S.getServer(userId, UNI_DATA), results);
    await S.setServer(userId, UNI_DATA, data);
    return { data: forClient(data), ran: Object.keys(results), sigarraSkipped: !!s.sigarraUser && !usedPassword };
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

  if (path === '/api/health') return send(res, 200, { ok: true, db: db.kind });

  // --- auth
  if (path === '/api/auth' && method === 'GET') {
    const user = await currentUser(req);
    return send(res, 200, { user: user ? { username: user.username } : null, needsSetup: (await S.countUsers()) === 0 });
  }
  if (path === '/api/signup' && method === 'POST') {
    if (loginLimit.tooMany('ip:' + clientIp(req))) return fail(res, 429, 'Too many attempts. Wait a few minutes.');
    const { username = '', password = '', code = '' } = await readJson(req, 4096);
    const want = process.env.SIGNUP_CODE || '';
    if (!want) return fail(res, 403, 'Sign-up is closed. Set SIGNUP_CODE on the server to open it.');
    if (!safeEqual(code, want)) return fail(res, 403, 'That setup code is wrong.');
    if ((await S.countUsers()) > 0 && process.env.ALLOW_MORE_USERS !== '1') return fail(res, 403, 'An account already exists. Sign in instead.');
    const name = String(username).trim().toLowerCase();
    if (!/^[a-z0-9._@-]{3,64}$/.test(name)) return fail(res, 400, 'Pick a username of 3 to 64 letters, numbers, dots or dashes.');
    if (String(password).length < 10) return fail(res, 400, 'Use a password of at least 10 characters.');
    if (await S.userByName(name)) return fail(res, 409, 'That username is taken.');
    const id = await S.createUser(name, hashPassword(String(password)));
    return startSession(req, res, id, name);
  }
  if (path === '/api/login' && method === 'POST') {
    const { username = '', password = '' } = await readJson(req, 4096);
    const name = String(username).trim().toLowerCase();
    if (loginLimit.tooMany('ip:' + clientIp(req)) || loginLimit.tooMany('user:' + name)) return fail(res, 429, 'Too many attempts. Wait a few minutes.');
    const u = await S.userByName(name);
    const ok = u ? verifyPassword(String(password), u.pass_hash) : verifyDummy(String(password));
    if (!ok) return fail(res, 401, 'Wrong username or password.');
    loginLimit.clear('user:' + name);
    return startSession(req, res, u.id, u.username);
  }
  if (path === '/api/logout' && method === 'POST') {
    const token = cookies(req)[COOKIE];
    if (token) await S.dropSession(sha256(token));
    return send(res, 200, { ok: true }, undefined, { 'set-cookie': sessionCookie(req, '', 0) });
  }

  // --- cron (no session; shared secret)
  if (path === '/api/cron' && method === 'POST') {
    const secret = process.env.CRON_SECRET;
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('key') || '';
    if (!secret || !safeEqual(given, secret)) return fail(res, 401, 'bad cron key');
    const out = { news: null, uni: {} };
    try { const n = await getNews(false); out.news = n?.items?.length ?? 0; } catch (e) { out.news = e.message; }
    for (const id of await S.userIds()) {
      if (!isStale(await S.getServer(id, UNI_DATA))) { out.uni[id] = 'fresh'; continue; }
      try { out.uni[id] = (await runUniSync(id)).ran; } catch (e) { out.uni[id] = e.message; }
    }
    await S.pruneSessions();
    return send(res, 200, out);
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
      return send(res, 200, newsView(data, url.searchParams));
    } catch (e) { return fail(res, 502, 'News could not be loaded: ' + e.message); }
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
      const f = b.faculty.trim().toLowerCase() || 'feup';
      if (!/^[a-z]{2,12}$/.test(f)) return fail(res, 400, 'The faculty code is letters only, like feup or fcup.');
      s.faculty = f;
    }
    if (typeof b.sigarraUser === 'string') {
      const u = b.sigarraUser.trim();
      if (u && !/^[A-Za-z0-9._@-]{2,64}$/.test(u)) return fail(res, 400, 'That SIGARRA username looks wrong (e.g. up202301234).');
      if (u !== (s.sigarraUser || '')) delete s.sigarraPassword;
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

  return fail(res, 404, 'not found');
}

async function startSession(req, res, userId, username) {
  const token = newToken();
  await S.addSession(sha256(token), userId, Date.now() + SESSION_DAYS * 86400e3);
  return send(res, 200, { user: { username } }, undefined, { 'set-cookie': sessionCookie(req, token, SESSION_DAYS * 86400) });
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
