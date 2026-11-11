// Which request paths map to a file that may be served. The rules have to hold on macOS and
// Windows too, where a file answers to more than one spelling of its name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// sw.js installs only if every file on its list is fetched: one wrong name and the app never
// works offline, with nothing on screen to say so.
test('every file the service worker keeps offline exists and is served', () => {
  const web = fileURLToPath(new URL('../..', import.meta.url));
  const sw = readFileSync(join(web, 'sw.js'), 'utf8');
  const files = sw.slice(sw.indexOf('var FILES = ['), sw.indexOf('];')).match(/'\/[^']+'/g).map((f) => f.slice(1, -1));
  assert.ok(files.length > 20, 'the list was not found in sw.js');
  for (const f of files) {
    const full = staticPath(web, f);
    assert.ok(full && existsSync(full), f);
  }
  // And nothing the page loads is missing from it.
  const html = readFileSync(join(web, 'index.html'), 'utf8');
  for (const [, ref] of html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)) assert.ok(files.includes('/' + ref), ref);
  assert.equal(staticPath(web, '/sw.js'), join(web, 'sw.js'));
});
