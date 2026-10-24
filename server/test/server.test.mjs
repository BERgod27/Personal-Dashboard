// End-to-end: starts the real server on SQLite (or Postgres if TEST_DATABASE_URL is set) with
// a database from before Google sign-in, and walks through Google sign-in (against a fake
// Google), sync of documents, conflicts, uni settings and access rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startFakeSigarra } from './fake-sigarra.mjs';
import { startFakeGoogle, fakeGoogleEnv, googleSignIn } from './fake-google.mjs';
import { syncSigarra } from '../sigarra.mjs';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = 'owner@example.com';
const FRIEND = 'friend@example.com';
const dir = mkdtempSync(join(tmpdir(), 'pd-'));
const SQLITE_PATH = join(dir, 'db.sqlite');
const procs = [];
let fake;
let google;

// The database as the password sign-in left it: one account with a password hash, a session,
// and a saved document.
async function seedOldDatabase() {
  const pg = !!process.env.TEST_DATABASE_URL;
  let q, close;
  if (pg) {
    const { default: { Client } } = await import('pg');
    const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    q = (sql, params) => c.query(sql, params);
    close = () => c.end();
    await q('DROP TABLE IF EXISTS users, sessions, docs, server_data');
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(SQLITE_PATH);
    q = async (sql, params = []) => db.prepare(sql.replace(/\$\d+/g, '?')).run(...params);
    close = () => db.close();
  }
  await q(`CREATE TABLE users (id ${pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'}, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at BIGINT NOT NULL)`);
  await q('CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at BIGINT NOT NULL)');
  await q('CREATE TABLE docs (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, version INTEGER NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, key))');
  await q('INSERT INTO users (username, pass_hash, created_at) VALUES ($1, $2, $3)', ['bernardo', 'scrypt$c2FsdA==$aGFzaA==', Date.now()]);
  await q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, 1, $2)', [createHash('sha256').update('old-token').digest('hex'), Date.now() + 86400e3]);
  await q('INSERT INTO docs (user_id, key, value, version, updated_at) VALUES (1, $1, $2, 3, $3)', ['personal-dashboard.v1', '{"events":["from before"]}', Date.now()]);
  await close();
}

async function startServer(port, extra = {}) {
  const env = {
    ...process.env, PORT: String(port), APP_SECRET: 'x'.repeat(48), CRON_SECRET: 'cron-key', SQLITE_PATH,
    SIGARRA_BASE_URL: fake.base, RENDER_GIT_COMMIT: 'df9fa6d946c8936edc51a6c01154432744a4e4d0',
    ...fakeGoogleEnv(google, `http://127.0.0.1:${port}`, `${OWNER}, ${FRIEND}`), ...extra,
  };
  delete env.DATABASE_URL;
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete env[k];
  if (process.env.TEST_DATABASE_URL) env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(proc);
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('http://localhost')) resolve(); });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
  return proc;
}

before(async () => {
  fake = await startFakeSigarra({ user: 'up202300001', password: 'pw-123', code: '202300001' });
  google = await startFakeGoogle({ clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' });
  await seedOldDatabase();
  await startServer(PORT);
});
after(() => { procs.forEach((p) => p.kill()); fake?.close(); google?.close(); rmSync(dir, { recursive: true, force: true }); });

let cookie = '';
async function call(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('pd_session='));
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const ME = { sub: '110169484474386276334', email: OWNER };
const FRIEND_ID = { sub: '208', email: FRIEND };
// Signs in with Google as `who` and keeps the session cookie for the following calls.
async function signIn(who = ME) {
  const r = await googleSignIn(BASE, google, who);
  assert.equal(r.location, '/', `signed in as ${who.email}`);
  cookie = r.session;
  return r;
}

test('signed-out visitors are sent to the sign-in page', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
  assert.equal((await call('GET', '/login')).status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self';/, 'scripts only from this site');
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.deepEqual((await call('GET', '/api/auth')).json, { user: null, google: true, version: 'df9fa6d' });
  assert.equal((await call('GET', '/api/health')).json.version, 'df9fa6d', 'the deployed commit, to check an update is live');
});

test('password sign-in is gone, and its old sessions are ended', async () => {
  for (const [path, body] of [['/api/login', { username: 'bernardo', password: 'long-password-1' }], ['/api/signup', { username: 'x', password: 'long-password-1', code: 'x' }]]) {
    const r = await call('POST', path, body);
    assert.equal(r.status, 401, path);
    assert.equal(r.headers.get('set-cookie'), null, path);
  }
  cookie = 'pd_session=old-token';
  assert.equal((await call('GET', '/api/state')).status, 401, 'a session from a password sign-in no longer works');
  cookie = '';
  if (!process.env.TEST_DATABASE_URL) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(SQLITE_PATH, { readOnly: true });
    const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name);
    db.close();
    assert.ok(!cols.includes('pass_hash'), 'password hashes are deleted');
    assert.ok(cols.includes('google_sub') && cols.includes('email'));
  }
});

test('the owner\'s first Google sign-in takes over the account from before, with its data', async () => {
  const r = await signIn();
  // The trip to Google: code flow with PKCE, a nonce, and the callback on PUBLIC_URL.
  const q = google.lastAuth;
  assert.equal(q.redirect_uri, BASE + '/auth/google/callback');
  assert.equal(q.scope, 'openid email');
  assert.equal(q.prompt, 'select_account');
  assert.equal(q.code_challenge_method, 'S256');
  assert.match(q.state, /^[\w-]{43}$/);
  assert.match(q.nonce, /^[\w-]{43}$/);
  // The pending sign-in cookie is sealed, short-lived and only sent to /auth/google.
  assert.ok(!r.oauth.includes(q.state) && !r.oauth.includes(q.nonce), 'state and nonce are not readable in the cookie');
  const session = r.setCookies.find((c) => c.startsWith('pd_session='));
  assert.match(session, /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=7776000/);
  assert.ok(r.setCookies.some((c) => /^pd_oauth=; Path=\/auth\/google; HttpOnly; SameSite=Lax; Max-Age=0/.test(c)), 'the pending sign-in is cleared');

  const auth = await call('GET', '/api/auth');
  assert.deepEqual(auth.json.user, { email: OWNER, username: 'bernardo' });
  const docs = (await call('GET', '/api/state')).json.docs;
  assert.equal(docs['personal-dashboard.v1'].value, '{"events":["from before"]}', 'the old account\'s data');
  assert.equal(docs['personal-dashboard.v1'].version, 3);
  assert.equal((await call('GET', '/')).status, 200);
  assert.equal((await call('GET', '/login')).headers.get('location'), '/', 'signed in: the sign-in page sends you on');
  assert.equal((await call('POST', '/api/login', { username: 'bernardo', password: 'x' })).status, 404, 'no password route');

  // Signing in again (another device) finds the same account by its Google ID, even after the
  // Google account's email changed case.
  const again = await googleSignIn(BASE, google, { ...ME, email: 'Owner@Example.com' });
  assert.equal(again.location, '/');
  assert.notEqual(again.session, cookie, 'every sign-in gets its own session');
  cookie = again.session;
  assert.deepEqual((await call('GET', '/api/auth')).json.user, { email: OWNER, username: 'bernardo' });
});

test('Google sign-in refuses what it should, and starts no session', async () => {
  const refused = async (who, error, setup = () => {}) => {
    google.reset();
    setup();
    const r = await googleSignIn(BASE, google, who);
    google.reset();
    assert.equal(r.location, '/login?error=' + error, `${who.email}: ${error}`);
    assert.equal(r.session, '', 'no session cookie');
    return r;
  };
  const now = Math.floor(Date.now() / 1000);
  await refused({ sub: '200', email: 'stranger@example.com' }, 'not_allowed');
  await refused({ sub: '201', email: FRIEND, email_verified: false }, 'unverified');
  await refused({ sub: '202', email: FRIEND }, 'failed', () => { google.claims = { aud: 'another-app.apps.googleusercontent.com' }; });
  await refused({ sub: '203', email: FRIEND }, 'failed', () => { google.claims = { iss: 'https://accounts.example.com' }; });
  await refused({ sub: '204', email: FRIEND }, 'failed', () => { google.claims = { iat: now - 7200, exp: now - 3600 }; });
  await refused({ sub: '205', email: FRIEND }, 'failed', () => { google.badSignature = true; });
  await refused({ sub: '206', email: FRIEND }, 'failed', () => { google.claims = { nonce: 'from-another-sign-in' }; });
  await refused({ sub: '207', email: FRIEND }, 'cancelled', () => { google.deny = true; });

  // The callback only works in the browser that started the sign-in, with its state, once.
  google.next = FRIEND_ID;
  const start = await fetch(BASE + '/auth/google', { redirect: 'manual', headers: { 'x-forwarded-for': '10.8.0.1' } });
  const oauth = start.headers.getSetCookie()[0].split(';')[0];
  const back = new URL((await fetch(start.headers.get('location'), { redirect: 'manual' })).headers.get('location'));
  const callback = (u, c) => fetch(u, { redirect: 'manual', headers: { 'x-forwarded-for': '10.8.0.1', ...(c ? { cookie: c } : {}) } });
  assert.equal((await callback(back.href, '')).headers.get('location'), '/login?error=expired', 'no cookie: another browser');
  const wrongState = new URL(back); wrongState.searchParams.set('state', 'x'.repeat(43));
  assert.equal((await callback(wrongState.href, oauth)).headers.get('location'), '/login?error=expired', 'state mismatch');
  const [name, value] = oauth.split('=');
  const tampered = `${name}=${value.slice(0, -4)}${value.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
  assert.equal((await callback(back.href, tampered)).headers.get('location'), '/login?error=expired', 'tampered cookie');
  const calls = google.tokenCalls;
  const ok = await callback(back.href, oauth);
  assert.equal(ok.headers.get('location'), '/');
  assert.equal(google.tokenCalls, calls + 1, 'only a valid state reaches Google');
  const replay = await callback(back.href, oauth);
  assert.equal(replay.headers.get('location'), '/login?error=failed', 'a code works once');
  google.reset();

  // An error from Google is never shown as it is: only fixed codes go back to the sign-in page.
  const errorBack = new URL(back); errorBack.searchParams.set('error', '<script>alert(1)</script>');
  assert.equal((await callback(errorBack.href, oauth)).headers.get('location'), '/login?error=cancelled');
});

test('the second address on the list gets an account of its own', async () => {
  const mine = cookie;
  const r = await googleSignIn(BASE, google, FRIEND_ID);
  assert.equal(r.location, '/');
  cookie = r.session;
  assert.deepEqual((await call('GET', '/api/auth')).json.user, { email: FRIEND, username: FRIEND });
  assert.deepEqual((await call('GET', '/api/state')).json.docs, {}, 'none of the owner\'s data');
  await call('PUT', '/api/state/pd.meals.v1', { value: '{"friend":1}', baseVersion: 0 });
  // A different Google account that now has the same address (a recycled work address) is a
  // different person: it gets a new, empty account, never this one.
  cookie = (await googleSignIn(BASE, google, { sub: '209', email: FRIEND })).session;
  assert.equal((await call('GET', '/api/auth')).json.user.username, FRIEND + '-209');
  assert.deepEqual((await call('GET', '/api/state')).json.docs, {});
  cookie = mine;
});

test('sign-in is rate limited per address', async () => {
  const hit = () => fetch(BASE + '/auth/google', { redirect: 'manual', headers: { 'x-forwarded-for': '10.7.0.1' } });
  for (let i = 0; i < 30; i++) assert.notEqual((await hit()).headers.get('location'), '/login?error=busy');
  assert.equal((await hit()).headers.get('location'), '/login?error=busy');
});

test('documents save with versions and reject stale writes', async () => {
  const v1 = await call('PUT', '/api/state/pd.meals.v1', { value: '{"events":[1]}', baseVersion: 0 });
  assert.equal(v1.status, 200);
  assert.equal(v1.json.version, 1);
  const v2 = await call('PUT', '/api/state/pd.meals.v1', { value: '{"events":[1,2]}', baseVersion: 1 });
  assert.equal(v2.json.version, 2);
  const stale = await call('PUT', '/api/state/pd.meals.v1', { value: '{"events":[]}', baseVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.current.value, '{"events":[1,2]}');
  const all = await call('GET', '/api/state');
  assert.equal(all.json.docs['pd.meals.v1'].version, 2);
});

test('cross-site writes and non-JSON bodies are refused', async () => {
  assert.equal((await call('PUT', '/api/state/x', { value: '1', baseVersion: 0 }, { origin: 'https://evil.example' })).status, 403);
  const r = await fetch(BASE + '/api/state/x', { method: 'PUT', headers: { cookie, 'content-type': 'text/plain' }, body: '{"value":"1","baseVersion":0}' });
  assert.equal(r.status, 415);
});

test('uni settings encrypt secrets and the manual timetable syncs', async () => {
  const bad = await call('PUT', '/api/uni/settings', { moodleIcsUrl: 'http://169.254.169.254/latest' });
  assert.equal(bad.status, 400);
  const s = await call('PUT', '/api/uni/settings', {
    moodleIcsUrl: 'https://moodle.up.pt/calendar/export_execute.php?userid=1&authtoken=SECRET',
    sigarraUser: 'up202300001', sigarraPassword: 'pw-123', rememberPassword: true,
    scheduleCsv: 'day,start,end,course,type,room\nMon,08:30,10:30,ES,TP,B208',
  });
  assert.equal(s.status, 200);
  assert.equal(s.json.moodleConfigured, true);
  assert.equal(s.json.passwordRemembered, true);
  assert.ok(!JSON.stringify(s.json).includes('SECRET'));
  assert.ok(!JSON.stringify(s.json).includes('pw-123'));

  const sync = await call('POST', '/api/uni/sync', {});
  assert.equal(sync.status, 200);
  assert.ok(sync.json.data.classes.some((c) => c.source === 'manual'));
  assert.equal(sync.json.data.sources.manual.ok, true);
  // Moodle is unreachable from the test sandbox, so it reports an error but doesn't break the sync
  assert.equal(typeof sync.json.data.sources.moodle.ok, 'boolean');
  // SIGARRA is the fake one (SIGARRA_BASE_URL), signed in with the remembered password
  const d = sync.json.data;
  assert.equal(d.sources.sigarra.ok, true, d.sources.sigarra.error);
  assert.deepEqual(d.sources.sigarra.warnings, []);
  assert.equal(d.sources.sigarra.data, undefined, 'raw copies stay on the server');
  assert.ok(d.classes.some((c) => c.source === 'sigarra' && c.course === 'AMAT'));
  assert.deepEqual(d.exams.map((e) => e.course), ['AMAT', 'FIS']);
  assert.equal(d.profile.name, 'Bernardo Teste');
  assert.equal(d.finance.fees.balance, '-697,00 €');
  assert.equal(d.finance.print_balance, '2,35 €');
  assert.ok(!JSON.stringify(d).includes('pw-123'));

  const js = await call('GET', '/modules/uni/data/uni.js');
  assert.match(js.text, /^window\.UNI_DATA = /);
  assert.equal((await call('POST', '/api/uni/sync', { ifStale: true })).json.skipped, 'fresh');
});

test('a saved SIGARRA password that stops working is deleted, and old data stays', async () => {
  fake.opts.password = 'changed-on-sigarra';
  const logins = () => fake.log.filter((r) => r.key.startsWith('POST')).length;
  const before = logins();
  const r = await call('POST', '/api/uni/sync', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.forgotPassword, true);
  assert.equal(r.json.data.sources.sigarra.ok, false);
  assert.match(r.json.data.sources.sigarra.error, /wrong.*saved password was removed/);
  assert.ok(r.json.data.classes.some((c) => c.source === 'sigarra'), 'last good timetable is kept');
  assert.equal((await call('GET', '/api/uni/settings')).json.passwordRemembered, false);
  const again = await call('POST', '/api/uni/sync', {});
  assert.equal(again.json.sigarraSkipped, true);
  assert.equal(logins(), before + 1, 'the bad password was tried once, not again');
  // Typing the new password works, and removing SIGARRA forgets its data.
  fake.opts.password = 'pw-123';
  assert.equal((await call('POST', '/api/uni/sync', { password: 'pw-123' })).json.data.sources.sigarra.ok, true);
  // A mistyped password saved with "Remember" is removed as soon as SIGARRA turns it down.
  assert.equal((await call('PUT', '/api/uni/settings', { rememberPassword: true, sigarraPassword: 'typo' })).json.passwordRemembered, true);
  const typo = await call('POST', '/api/uni/sync', { password: 'typo' });
  assert.equal(typo.json.forgotPassword, true);
  assert.equal((await call('GET', '/api/uni/settings')).json.passwordRemembered, false);
  // A bot screen (SIGARRA's front door turning the server away) is not a wrong password, so the
  // saved password is kept: retrying it can't lock the account, and the block may clear later.
  await call('PUT', '/api/uni/settings', { rememberPassword: true, sigarraPassword: 'pw-123' });
  assert.equal((await call('GET', '/api/uni/settings')).json.passwordRemembered, true);
  fake.opts.loginReply = 'forbidden';
  const away = await call('POST', '/api/uni/sync', {});
  fake.opts.loginReply = null;
  assert.equal(away.json.forgotPassword, false);
  assert.match(away.json.data.sources.sigarra.error, /refused the request from the server/);
  assert.ok(!/was removed/.test(away.json.data.sources.sigarra.error));
  assert.equal((await call('GET', '/api/uni/settings')).json.passwordRemembered, true, 'a bot screen keeps the password');
  const off = await call('PUT', '/api/uni/settings', { sigarraUser: '' });
  assert.equal(off.status, 200);
  const data = (await call('GET', '/api/uni')).json;
  assert.equal(data.sources.sigarra, undefined);
  assert.ok(!data.classes.some((c) => c.source === 'sigarra'));
  assert.equal(data.profile, null);
});

test('local sync: a key pushes SIGARRA data, no server password, surviving settings changes', async () => {
  await signIn();
  // Local sync only: no SIGARRA username or password saved on the server (both stay on the device).
  await call('PUT', '/api/uni/settings', { sigarraUser: '', rememberPassword: false });
  const mk = await call('POST', '/api/uni/sync-key', {});
  assert.equal(mk.status, 200);
  assert.match(mk.json.key, /^[\w-]{20,}$/);
  assert.equal(mk.json.user, 'bernardo', 'the account keeps its old name for the sync tool');
  const key = mk.json.key;
  assert.equal((await call('GET', '/api/uni/settings')).json.localSyncEnabled, true);

  // Build a real SIGARRA payload locally (as tools/local-sync.mjs does), then push it with NO cookie.
  const payload = await syncSigarra({ user: 'up202300001', password: 'pw-123', base: fake.base });
  const push = (k, u, data = payload) => fetch(BASE + '/api/uni/push', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k },
    body: JSON.stringify({ user: u, data }),
  });
  // A wrong key or a wrong user is refused with the same message.
  assert.equal((await push('not-the-key', 'bernardo')).status, 401);
  assert.equal((await push(key, 'nobody')).status, 401);
  // The real key pushes, and the data shows up for the signed-in user.
  const ok = await push(key, 'bernardo');
  const okj = await ok.json();
  assert.equal(ok.status, 200, okj.error);
  assert.ok(okj.classes >= 1 && okj.exams >= 1);
  let uni = (await call('GET', '/api/uni')).json;
  assert.ok(uni.classes.some((c) => c.source === 'sigarra' && c.course === 'AMAT'));
  assert.deepEqual(uni.exams.map((e) => e.course), ['AMAT', 'FIS']);
  assert.equal(uni.sources.sigarra.ok, true);
  // The push never carried or stored the SIGARRA password.
  assert.equal((await call('GET', '/api/uni/settings')).json.passwordRemembered, false);
  assert.ok(!JSON.stringify(uni).includes('pw-123'));

  // An unrelated settings change must NOT drop locally-pushed data: a sync key keeps SIGARRA connected.
  assert.equal((await call('PUT', '/api/uni/settings', { weeksAhead: 3 })).status, 200);
  uni = (await call('GET', '/api/uni')).json;
  assert.ok(uni.classes.some((c) => c.source === 'sigarra'), 'pushed data survives a settings change');

  // Missing data is a 400; malformed data is accepted without a 500 and never breaks reads.
  const noData = await fetch(BASE + '/api/uni/push', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ user: 'bernardo' }) });
  assert.equal(noData.status, 400);
  assert.equal((await push(key, 'bernardo', { classes: [null], exams: 'x' })).status, 200);
  assert.equal((await call('GET', '/api/uni')).status, 200);

  // Turning off local sync stops the key and lets the data be forgotten on the next change.
  assert.equal((await call('DELETE', '/api/uni/sync-key', {})).status, 200);
  assert.equal((await call('GET', '/api/uni/settings')).json.localSyncEnabled, false);
  assert.equal((await push(key, 'bernardo')).status, 401);
  await call('PUT', '/api/uni/settings', { weeksAhead: 2 });
  uni = (await call('GET', '/api/uni')).json;
  assert.ok(!(uni.classes || []).some((c) => c.source === 'sigarra'), 'after turning off local sync, its data is dropped');
});

test('sign out everywhere ends every session', async () => {
  const first = cookie;
  await signIn();
  const second = cookie;
  assert.notEqual(first, second);
  assert.equal((await call('POST', '/api/logout-all', {})).status, 200);
  for (const c of [first, second]) {
    cookie = c;
    assert.equal((await call('GET', '/api/state')).status, 401);
  }
  cookie = '';
  await signIn();
});

test('server files and private data are never served', async () => {
  for (const p of ['/server/server.mjs', '/server/db.mjs', '/modules/uni/sync_uni.py', '/modules/news/server.mjs',
    '/modules/uni/config.json', '/server/data/dashboard.db', '/../etc/passwd', '/%2e%2e/server/db.mjs', '/server/package.json']) {
    const r = await call('GET', p);
    assert.equal(r.status, 404, p);
  }
  assert.equal((await call('GET', '/js/online.js')).status, 200);
  assert.equal((await call('GET', '/modules/uni/panel.js')).status, 200);
  const page = await call('GET', '/index.html');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
});

test('cron needs its key; sign-out ends the session', async () => {
  assert.equal((await call('POST', '/api/cron', {})).status, 401);
  assert.equal((await call('POST', '/api/cron?key=cron-key', {})).status, 401, 'the key is only accepted in the header');
  assert.equal((await call('POST', '/api/logout', {})).status, 200);
  assert.equal((await call('GET', '/api/state')).status, 401);
});

test('taking an address off ALLOWED_EMAILS signs that account out', async () => {
  await signIn();
  const mine = cookie;
  const friend = (await googleSignIn(BASE, google, FRIEND_ID)).session;
  // The same database, served with only the friend left on the list.
  const port = PORT + 2000;
  const proc = await startServer(port, { ALLOWED_EMAILS: FRIEND });
  const get = (c) => fetch(`http://127.0.0.1:${port}/api/state`, { headers: { cookie: c } });
  assert.equal((await get(mine)).status, 401);
  assert.equal((await get(friend)).status, 200);
  const back = await googleSignIn(`http://127.0.0.1:${port}`, google, ME);
  assert.equal(back.location, '/login?error=not_allowed');
  proc.kill();
});

test('without Google settings nobody can sign in', async () => {
  const port = PORT + 2001;
  const proc = await startServer(port, { GOOGLE_CLIENT_ID: '', ALLOWED_EMAILS: OWNER });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(base + '/api/auth')).json()).google, false);
  assert.equal((await fetch(base + '/auth/google', { redirect: 'manual' })).headers.get('location'), '/login?error=setup');
  proc.kill();
});

test('with several old accounts, the owner is not handed a guess', { skip: !!process.env.TEST_DATABASE_URL && 'SQLite only' }, async () => {
  const path = join(dir, 'several.sqlite');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at BIGINT NOT NULL);
    CREATE TABLE docs (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, version INTEGER NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, key));
    INSERT INTO users (username, pass_hash, created_at) VALUES ('alice', 'x', 1), ('${FRIEND}', 'x', 2);
    INSERT INTO docs VALUES (1, 'pd.meals.v1', '"alice''s"', 1, 1), (2, 'pd.meals.v1', '"friend''s"', 1, 1);`);
  db.close();
  const port = PORT + 2002;
  const base = `http://127.0.0.1:${port}`;
  const proc = await startServer(port, { SQLITE_PATH: path });
  const docs = async (session) => (await (await fetch(base + '/api/state', { headers: { cookie: session } })).json()).docs;
  const owner = await googleSignIn(base, google, ME);
  assert.deepEqual(await docs(owner.session), {}, 'the owner gets a new account, not alice\'s');
  const friend = await googleSignIn(base, google, FRIEND_ID);
  assert.equal((await docs(friend.session))['pd.meals.v1'].value, '"friend\'s"', 'an old username that is the email links');
  proc.kill();
});
