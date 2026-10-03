// End-to-end: starts the real server on SQLite (or Postgres if TEST_DATABASE_URL is set)
// and walks through sign-up, sync of documents, conflicts, uni settings and access rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'pd-'));
let proc;

before(async () => {
  const env = { ...process.env, PORT: String(PORT), APP_SECRET: 'x'.repeat(48), SIGNUP_CODE: 'letmein', CRON_SECRET: 'cron-key', SQLITE_PATH: join(dir, 'db.sqlite') };
  delete env.DATABASE_URL;
  if (process.env.TEST_DATABASE_URL) env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('http://localhost')) resolve(); });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }); });

let cookie = '';
async function call(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

test('signed-out visitors are sent to the sign-in page', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
  assert.equal((await call('GET', '/login')).status, 200);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self';/, 'scripts only from this site');
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.deepEqual((await call('GET', '/api/auth')).json, { user: null, needsSetup: true });
});

test('sign-up needs the setup code and only works once', async () => {
  assert.equal((await call('POST', '/api/signup', { username: 'bernardo', password: 'long-password-1', code: 'nope' })).status, 403);
  const ok = await call('POST', '/api/signup', { username: 'Bernardo', password: 'long-password-1', code: 'letmein' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const saved = cookie; cookie = '';
  assert.equal((await call('POST', '/api/signup', { username: 'other', password: 'long-password-2', code: 'letmein' })).status, 403);
  assert.equal((await call('POST', '/api/login', { username: 'bernardo', password: 'wrong-password' })).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'bernardo', password: 'long-password-1' })).status, 200);
  assert.notEqual(cookie, saved);
  assert.equal((await call('GET', '/')).status, 200);
});

test('documents save with versions and reject stale writes', async () => {
  const v1 = await call('PUT', '/api/state/personal-dashboard.v1', { value: '{"events":[1]}', baseVersion: 0 });
  assert.equal(v1.status, 200);
  assert.equal(v1.json.version, 1);
  const v2 = await call('PUT', '/api/state/personal-dashboard.v1', { value: '{"events":[1,2]}', baseVersion: 1 });
  assert.equal(v2.json.version, 2);
  const stale = await call('PUT', '/api/state/personal-dashboard.v1', { value: '{"events":[]}', baseVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.current.value, '{"events":[1,2]}');
  const all = await call('GET', '/api/state');
  assert.equal(all.json.docs['personal-dashboard.v1'].version, 2);
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
  // moodle/sigarra are unreachable from the test sandbox, so they report errors but don't break the sync
  assert.equal(typeof sync.json.data.sources.moodle.ok, 'boolean');

  const js = await call('GET', '/modules/uni/data/uni.js');
  assert.match(js.text, /^window\.UNI_DATA = /);
  assert.equal((await call('POST', '/api/uni/sync', { ifStale: true })).json.skipped, 'fresh');
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
