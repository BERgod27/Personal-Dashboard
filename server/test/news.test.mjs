// News on the hosted server: after an update, a copy of the headlines that the previous version
// saved in the database is fetched again rather than served (it has the old tabs and no stories).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, store } from '../db.mjs';
import { start as startFeeds } from '../../modules/news/test/fixtures.mjs';
import { FORMAT } from '../../modules/news/server.mjs';

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'pd-news-'));
let proc;
let feeds;

before(async () => {
  feeds = await startFeeds(0);
  const sample = JSON.parse(readFileSync(new URL('../../modules/news/test/feeds.test.json', import.meta.url), 'utf8'));
  const feedsFile = join(dir, 'feeds.json');
  writeFileSync(feedsFile, JSON.stringify(sample).replaceAll('http://localhost:9911', `http://localhost:${feeds.address().port}`));

  // What the version before topics and stories saved, fetched a minute ago.
  const sqlitePath = join(dir, 'db.sqlite');
  const db = await openDb({ url: '', sqlitePath });
  await store(db).setServer(0, 'news.cache', {
    at: Date.now() - 60e3,
    data: { updatedAt: new Date().toISOString(), categories: [{ id: 'world', label: 'World' }, { id: 'portugal', label: 'Portugal' }], feeds: [], items: [{ title: 'Old headline', link: 'https://example.com/old', source: 'Old', category: 'world' }] },
  });
  db.close();

  const env = { ...process.env, PORT: String(PORT), APP_SECRET: 'x'.repeat(48), SIGNUP_CODE: 'letmein', SQLITE_PATH: sqlitePath, NEWS_FEEDS: feedsFile };
  delete env.DATABASE_URL;
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../server.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('http://localhost')) resolve(); });
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => { proc?.kill(); feeds?.close(); rmSync(dir, { recursive: true, force: true }); });

test('headlines saved by an older version are fetched again, with topics and stories', async () => {
  const signup = await fetch(BASE + '/api/signup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'reader', password: 'long-password-1', code: 'letmein' }),
  });
  assert.equal(signup.status, 200);
  const cookie = signup.headers.get('set-cookie').split(';')[0];

  const res = await fetch(BASE + '/api/news', { headers: { cookie } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.format, FORMAT);
  assert.deepEqual(data.topics.map((t) => t.id), ['portugal', 'world', 'sports']);
  assert.ok(data.stories.length > 0);
  assert.ok(!data.items.some((i) => i.title === 'Old headline'), 'the old copy was not served');

  const again = await (await fetch(BASE + '/api/news?topic=portugal', { headers: { cookie } })).json();
  assert.equal(again.updatedAt, data.updatedAt, 'the fresh copy is reused, not fetched on every request');
  assert.ok(again.stories.every((s) => s.topics.includes('portugal')));
});
