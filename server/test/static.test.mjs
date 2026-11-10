// Which request paths map to a file that may be served. The rules have to hold on macOS and
// Windows too, where a file answers to more than one spelling of its name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { staticPath } from '../static.mjs';

const ROOT = join(sep, 'srv', 'app') + sep;
const at = (...segs) => join(ROOT, ...segs);

test('the front end is served', () => {
  assert.equal(staticPath(ROOT, '/'), at('index.html'));
  assert.equal(staticPath(ROOT, '/js/online.js'), at('js', 'online.js'));
  assert.equal(staticPath(ROOT, '/fonts/Geist-Variable.woff2'), at('fonts', 'Geist-Variable.woff2'));
  assert.equal(staticPath(ROOT, '/modules/news/data/preview.png'), at('modules', 'news', 'data', 'preview.png'));
  assert.equal(staticPath(ROOT, '/manifest.webmanifest'), at('manifest.webmanifest'));
  assert.equal(staticPath(ROOT, '/docs/screenshots/today-dark.png'), at('docs', 'screenshots', 'today-dark.png'));
});

test('server code, settings, per-user data and unknown file types are not', () => {
  for (const p of [
    '/server/server.mjs', '/server/tools/local-sync.config.json', '/server/data/dashboard.db',
    '/modules/uni/config.json', '/modules/uni/sync_uni.py', '/modules/uni/schedule.csv', '/modules/uni/data/uni.json',
    '/modules/news/server.mjs', '/modules/news/feeds.json', '/modules/news/test/fixtures.mjs', '/modules/uni/tests/test_sync.py',
    '/node_modules/pg/package.json', '/.env', '/.git/config', '/js/.hidden.js', '/README.md', '/Dockerfile', '/render.yaml',
  ]) assert.equal(staticPath(ROOT, p), null, p);
});

test('nothing climbs out of the folder', () => {
  for (const p of ['/../etc/passwd', '/js/../../etc/passwd', '/%2e%2e/server/db.mjs', '/js/%2e%2e/%2e%2e/secret.json', '/%252e%252e/server/db.mjs', '/%'])
    assert.equal(staticPath(ROOT, p), null, p);
});

test('another spelling of a protected name is refused as well', () => {
  for (const p of [
    '/SERVER/db.mjs', '/Server/tools/local-sync.config.json',          // file names ignore case on macOS and Windows
    '/modules/uni/CONFIG.JSON', '/modules/uni/Data/uni.json', '/modules/news/Feeds.json', '/modules/uni/Sync_Uni.PY',
    '/Node_Modules/pg/package.json', '/modules/uni/TESTS/x.js',
    '/css%5c..%5cserver%5cdb.mjs', '/server%5ctools%5clocal-sync.config.json', // a backslash separates folders on Windows
    '/server./tools/local-sync.config.json', '/server%20/db.mjs',      // Windows drops a trailing dot or space
    '/SERVER~1/db.mjs', '/modules/uni/config.json::$DATA',             // short names and alternate streams
    '/%C5%BFerver/db.mjs',                                             // "ſerver": a letter that upper-cases to S
    '/js/online.js%00.png',
  ]) assert.equal(staticPath(ROOT, p), null, p);
});
