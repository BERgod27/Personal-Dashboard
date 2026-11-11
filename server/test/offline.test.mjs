// In a real browser: the installed app opens with no connection, keeps what is typed offline,
// and asks instead of overwriting when two devices changed the same data.
// Needs Playwright with a browser; skipped where that is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* not installed */ }

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const DOC = 'personal-dashboard.v1';
const dir = mkdtempSync(join(tmpdir(), 'pd-offline-'));
let proc, browser, ctx, page;

before(async () => {
  if (!chromium) return;
  const env = { ...process.env, PORT: String(PORT), APP_SECRET: 'x'.repeat(48), SIGNUP_CODE: 'letmein', SQLITE_PATH: join(dir, 'db.sqlite') };
  delete env.DATABASE_URL;
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('http://localhost')) resolve(); });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
  page = await ctx.newPage();
});
after(async () => { await browser?.close(); proc?.kill(); rmSync(dir, { recursive: true, force: true }); });

// The server as another device sees it (not through the page, so it works while the page is offline).
async function server(method, path, body) {
  const cookie = (await ctx.cookies(BASE)).map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}
const serverDoc = async (key = DOC) => (await server('GET', '/api/state')).docs[key];
// "Another device" adds a task to the planner document.
async function otherDeviceAdds(title) {
  const cur = await serverDoc();
  const data = JSON.parse(cur.value);
  data.tasks.push({ id: 'other-' + title, title, done: false });
  await server('PUT', '/api/state/' + DOC, { value: JSON.stringify(data), baseVersion: cur.version });
}
async function until(check, what, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('timed out waiting for: ' + what);
}
async function signIn() {
  await page.fill('#auth-user', 'bernardo');
  await page.fill('#auth-pass', 'correct horse battery');
  if (await page.isVisible('#auth-code')) await page.fill('#auth-code', 'letmein');
  await page.click('#auth-submit');
  await page.waitForSelector('#quickadd-input');
}
const addTask = async (title) => { await page.fill('#quickadd-input', title); await page.press('#quickadd-input', 'Enter'); await page.locator('#quickadd-input').blur(); };
const local = (key = DOC) => page.evaluate((k) => localStorage.getItem(k), key);
const pageCached = () => page.evaluate(async () => !!(await (await caches.open('pd-shell')).match('/')));
const status = () => page.getAttribute('#sync-status', 'data-state');
const opts = { skip: !chromium && 'Playwright is not installed' };

test('signs in and keeps the app on the device', opts, async () => {
  await page.goto(BASE + '/login');
  await signIn();
  await until(pageCached, 'the page in the cache');
  assert.equal(JSON.parse(await local('pd.online.meta')).user, 'bernardo');
});

test('opens with no connection, every late-loaded file included', opts, async () => {
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#quickadd-input');
  assert.equal(await status(), 'offline');
  for (const view of ['uni', 'workouts', 'meals', 'news', 'today']) await page.click(`.tab[data-view="${view}"]`);
  const missing = await page.evaluate(async () => {
    const out = [];
    for (const f of ['/modules/workouts/exercise-howto.js', '/modules/uni/panel.js', '/modules/news/news-panel.js', '/fonts/GeistMono-Variable.woff2']) {
      try { if (!(await fetch(f)).ok) out.push(f); } catch { out.push(f); }
    }
    return out;
  });
  assert.deepEqual(missing, []);
});

test('an edit made offline survives a second offline start and reaches the server', opts, async () => {
  await addTask('buy oats offline');
  await page.reload(); // still offline: a new session with nothing edited in it
  await page.waitForSelector('#quickadd-input');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(async () => (await serverDoc())?.value.includes('buy oats offline'), 'the offline task on the server');
  await until(async () => (await status()) === 'saved', 'the Saved label');
});

test('a server error at start changes nothing on the device', opts, async () => {
  const before = await local();
  await page.route('**/api/state', (r) => r.fulfill({ status: 502, body: 'Bad gateway' }));
  await page.reload();
  await page.waitForSelector('#quickadd-input');
  await page.waitForTimeout(500);
  assert.equal(await local(), before);
  // A device that has no data of this account yet stops instead of starting empty.
  await page.evaluate(() => localStorage.removeItem('pd.online.meta'));
  await page.reload({ waitUntil: 'commit' }); // the page stops itself, so it never finishes loading
  await page.waitForSelector('.unreachable');
  assert.equal(await local(), before);
  await page.unroute('**/api/state');
  await page.reload();
  await page.waitForSelector('#quickadd-input');
});

test('a change on two devices asks which to keep, and keeps asking after a reload', opts, async () => {
  for (const keep of ['mine', 'theirs']) {
    await ctx.setOffline(true);
    await otherDeviceAdds('laptop task ' + keep);
    await addTask('phone task ' + keep);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('#online-conflict');
    assert.equal(await status(), 'conflict');
    assert.ok((await local()).includes('phone task ' + keep), 'the edit made here is still here');

    if (keep === 'mine') {
      // While the planner waits for an answer, other data still syncs.
      await page.evaluate(() => localStorage.setItem('pd.meals.v1', '{"e2e":1}'));
      await until(async () => (await serverDoc('pd.meals.v1'))?.value === '{"e2e":1}', 'the meals document on the server');
      assert.equal(await status(), 'conflict');
    }
    await page.reload();
    await page.waitForSelector('#online-conflict');

    await page.click(`#online-conflict [data-act="${keep}"]`);
    if (keep === 'mine') {
      await until(async () => (await serverDoc()).value.includes('phone task mine'), 'this device’s version on the server');
      await page.waitForSelector('#online-conflict', { state: 'detached' });
      assert.ok(!(await serverDoc()).value.includes('laptop task mine'));
    } else {
      await until(async () => (await local()).includes('laptop task theirs'), 'the other device’s version here');
      await page.waitForSelector('#quickadd-input');
      assert.ok(!(await local()).includes('phone task theirs'));
      assert.equal(await page.locator('#online-conflict').count(), 0);
    }
    await until(async () => (await status()) === 'saved', 'the Saved label');
  }
});

test('newer data does not reload the page while something is being typed', opts, async () => {
  await page.waitForTimeout(5200); // pulls are spaced 5 s apart
  await page.evaluate(() => { window.__sameLoad = true; });
  await page.focus('#quickadd-input');
  await otherDeviceAdds('arrived while typing');
  const pulled = page.waitForResponse('**/api/state');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pulled;
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__sameLoad), true);
  assert.ok(!(await local()).includes('arrived while typing'));
  await page.locator('#quickadd-input').blur();
  await page.waitForTimeout(5200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await until(async () => (await local()).includes('arrived while typing'), 'the newer data once the field is left');
});

test('signing out asks first when something is not saved yet', opts, async () => {
  await page.waitForSelector('#quickadd-input');
  await ctx.setOffline(true);
  await addTask('not sent yet');
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.click('.account-menu summary');
  await page.click('[data-act="out"]');
  await until(() => asked !== '', 'the question');
  assert.match(asked, /not saved/);
  assert.ok((await local()).includes('not sent yet'));
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(async () => (await serverDoc()).value.includes('not sent yet'), 'the task on the server');
});

test('after signing out and in again the app still opens offline', opts, async () => {
  await until(async () => (await status()) === 'saved', 'the Saved label');
  await page.click('.account-menu summary');
  await page.click('[data-act="out"]');
  await page.waitForSelector('#auth-user');
  assert.equal(await local(), null);
  assert.equal(await pageCached(), false);
  await signIn();
  await until(pageCached, 'the page in the cache again');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#quickadd-input');
  assert.ok((await local()).includes('not sent yet'));
  await ctx.setOffline(false);
});
