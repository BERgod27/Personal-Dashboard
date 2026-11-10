// Feed fetching, merging and the /api/news view, against the local sample feeds: node --test modules/news/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { fetchFeed, fetchText, redirectAllowed, merge, view, FORMAT, isCurrent } from '../server.mjs';
import { decodeEntities, parseFeed } from '../lib/parse.mjs';
import { start } from './fixtures.mjs';

const server = await start(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

const cfg = JSON.parse(await readFile(new URL('./feeds.test.json', import.meta.url), 'utf8'));
const feeds = cfg.feeds.filter((f) => f.enabled !== false).map((f) => ({ ...f, url: f.url.replace('http://localhost:9911', base) }));
const results = await Promise.all(feeds.map((f) => fetchFeed(f, cfg)));
const byName = Object.fromEntries(feeds.map((f, i) => [f.name, results[i]]));

test('each feed reports its status, and broken ones say why', () => {
  assert.equal(byName['Sample RSS'].status.ok, true);
  assert.equal(byName['Sample RSS'].status.topic, 'world');
  assert.equal(byName['Sample RDF'].status.topic, 'world', 'the old "category" key still works');
  assert.match(byName['Not a feed'].status.error, /no items/);
  assert.equal(byName.Down.status.error, 'HTTP 500');
  assert.ok(byName['Sample RSS'].items.every((i) => /^https?:/.test(i.link)), 'javascript: links are dropped');
});

test('Google News headlines are credited to their own outlet', () => {
  const [quake, dup, derby] = byName['Sample GN'].items;
  assert.equal(quake.title, 'Chile earthquake: tsunami warning issued after strong quake strikes');
  assert.equal(quake.source, 'Reuters');
  assert.equal(quake.via, 'Sample GN');
  assert.equal(quake.summary, '', 'the summary only repeated the title');
  assert.equal(dup.source, 'Sample RSS');
  assert.equal(derby.title, 'Benfica - Sporting: dérbi termina empatado', 'only the " - Outlet" suffix is cut');
  const atom = byName['Sample Atom'].items[0];
  assert.equal(atom.source, 'Sample Atom', "Atom's <source> is not an outlet");
  assert.equal(atom.via, undefined);
});

test('merging drops repeats and stale headlines and groups the rest into stories', () => {
  const { items, stories, top } = merge(cfg, results);
  const titles = items.map((i) => i.title);
  assert.ok(!titles.includes('Old story'));
  assert.equal(titles.filter((t) => t.startsWith('Leaders meet in Lisbon')).length, 1);
  const quakeCopies = items.filter((i) => i.title === 'Earthquake strikes central Chile, tsunami warning issued');
  assert.equal(quakeCopies.length, 1);
  assert.equal(quakeCopies[0].source, 'Sample RSS', "the outlet's own copy beats the Google News one");
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'ids are unique');

  const quake = stories.find((s) => s.lead === quakeCopies[0].id);
  assert.equal(quake.related.length, 1, 'the Reuters headline joins the quake story');
  assert.equal(quake.sources, 2);
  const lisbon = stories.find((s) => items.find((i) => i.id === s.lead).title.startsWith('Leaders meet'));
  assert.equal(lisbon.sources, 2, 'the RDF headline about the Lisbon deal joins it');
  assert.deepEqual(new Set(top), new Set(stories.map((s) => s.id).slice(0, top.length)));
  for (const s of stories) for (const id of [s.lead, ...s.related]) assert.ok(items.some((i) => i.id === id));
});

test('the view filters by topic and keeps every headline its stories point to', () => {
  const merged = merge(cfg, results);
  const data = { updatedAt: 'x', topics: cfg.topics, feeds: [], ...merged };
  const pt = view(data, new URLSearchParams('topic=portugal'));
  assert.ok(pt.stories.length > 0);
  assert.ok(pt.stories.every((s) => s.topics.includes('portugal')));
  for (const s of pt.stories) for (const id of [s.lead, ...s.related]) assert.ok(pt.items.some((i) => i.id === id), 'related headlines from other topics come along');

  assert.deepEqual(view(data, new URLSearchParams('category=portugal')).stories, pt.stories, '?category= still works');
  const one = view(data, new URLSearchParams('limit=1'));
  assert.equal(one.items.filter((i) => i === data.items[0]).length, 1);
  assert.ok(one.stories.length >= 1);
  assert.equal(view(data, new URLSearchParams('topic=top')).stories.length, data.stories.length);

  // A snapshot from before stories existed passes through untouched.
  const old = { items: [{ title: 'a', category: 'world' }, { title: 'b', category: 'portugal' }] };
  assert.deepEqual(view(old, new URLSearchParams('category=world')).items, [old.items[0]]);
});

test('the helper refetches instead of serving a snapshot an older version saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'news-'));
  const snapshot = join(dir, 'news.json');
  const feedsFile = join(dir, 'feeds.json');
  // What the version before topics wrote: World and Portugal only, no stories.
  await writeFile(snapshot, JSON.stringify({ updatedAt: new Date().toISOString(), categories: [{ id: 'world', label: 'World' }], feeds: [], items: [{ title: 'Old', link: 'https://example.com/old', category: 'world', source: 'Old' }] }));
  await writeFile(feedsFile, JSON.stringify({ ...cfg, feeds }));
  const port = 19000 + Math.floor(Math.random() * 1000);
  const env = { ...process.env, NEWS_PORT: String(port), NEWS_FEEDS: feedsFile, NEWS_SNAPSHOT: snapshot };
  const proc = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((resolve, reject) => {
      proc.stdout.on('data', (d) => { if (String(d).includes('serving on')) resolve(); });
      proc.on('exit', (c) => reject(new Error('helper exited ' + c)));
    });
    const data = await (await fetch(`http://127.0.0.1:${port}/api/news`)).json();
    assert.equal(data.format, FORMAT);
    assert.ok(isCurrent(data));
    assert.deepEqual(data.topics.map((t) => t.id), ['portugal', 'world', 'sports']);
    assert.ok(data.stories.length > 0);
    assert.ok(!data.items.some((i) => i.title === 'Old'), 'the old snapshot was not served');
    assert.ok(isCurrent(JSON.parse(await readFile(snapshot, 'utf8'))), 'the snapshot on disk is rewritten');
  } finally {
    proc.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test('only data in the current format counts as current', () => {
  assert.equal(isCurrent({ format: FORMAT, items: [] }), true);
  assert.equal(isCurrent({ items: [] }), false);
  assert.equal(isCurrent(null), false);
});

test('a feed may only redirect to its own address or to a public https one', () => {
  const from = new URL('https://feeds.example.com/rss');
  const ok = (to) => redirectAllowed(from, new URL(to, from));
  assert.equal(ok('/rss.xml'), true);
  assert.equal(ok('https://www.example.org/feed'), true);
  for (const to of ['http://www.example.org/feed', 'http://10.0.0.5:8080/admin', 'https://127.0.0.1/', 'https://2130706433/',
    'https://[::1]/', 'https://169.254.169.254/latest/meta-data/', 'https://localhost/', 'https://printer/',
    'https://db.internal/', 'https://nas.local./', 'ftp://example.org/feed']) assert.equal(ok(to), false, to);
  const plain = new URL('http://localhost:9911/rss');
  assert.equal(redirectAllowed(plain, new URL('http://localhost:9911/feed')), true, 'a move on the same site is fine');
  assert.equal(redirectAllowed(plain, new URL('http://localhost:9912/feed')), false);
});

test('redirects are checked hop by hop, and an oversized feed is refused', async () => {
  const asked = [];
  const srv = http.createServer((req, res) => {
    asked.push(req.url);
    if (req.url === '/moved') { res.writeHead(301, { location: '/rss' }); return res.end(); }
    if (req.url === '/inside') { res.writeHead(302, { location: `http://127.0.0.1:${inner.address().port}/admin` }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (req.url === '/declared') { res.writeHead(200, { 'content-length': String(50 * 1024 * 1024) }); return res.write('<rss>'); }
    if (req.url === '/endless') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      const chunk = 'x'.repeat(64 * 1024);
      const more = () => { if (!res.destroyed) res.write(chunk, () => setImmediate(more)); };
      return more();
    }
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end('\ufeff<rss><channel><item><title>Olá</title><link>https://example.com/x</link></item></channel></rss>');
  });
  // Stands for something on the server's own network that a feed must not be able to reach.
  const inner = http.createServer((req, res) => { asked.push('inner' + req.url); res.end('secret'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await new Promise((r) => inner.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.match(await fetchText(at + '/moved'), /^<rss>.*Olá/, 'followed, and read as UTF-8 without the byte-order mark');
    await assert.rejects(fetchText(at + '/inside'), /redirect to http:\/\/127\.0\.0\.1:\d+ refused/);
    assert.ok(!asked.includes('inner/admin'), 'the address it pointed at was never contacted');
    await assert.rejects(fetchText(at + '/loop'), /too many redirects/);
    await assert.rejects(fetchText(at + '/declared'), /feed too large/);
    await assert.rejects(fetchText(at + '/endless', { limit: 1024 * 1024 }), /feed too large/);

    const refused = await fetchFeed({ name: 'Moved inside', topic: 'world', url: at + '/inside' }, cfg);
    assert.equal(refused.status.ok, false);
    assert.match(refused.status.error, /refused/, 'the sources list says why');
    const moved = await fetchFeed({ name: 'Moved', topic: 'world', url: at + '/moved' }, cfg);
    assert.deepEqual(moved.items.map((i) => i.title), ['Olá']);
  } finally {
    srv.closeAllConnections(); srv.close();
    inner.closeAllConnections(); inner.close();
  }
});

test('a character reference past the end of Unicode does not lose the feed', () => {
  assert.equal(decodeEntities('a &#99999999; b &#x110000; c &#128512; &amp;'), 'a &#99999999; b &#x110000; c \u{1F600} &');
  const { items } = parseFeed('<rss><channel><item><title>Bad &#4294967296; ref</title><link>https://example.com/1</link></item></channel></rss>');
  assert.deepEqual(items.map((i) => i.title), ['Bad &#4294967296; ref']);
});
