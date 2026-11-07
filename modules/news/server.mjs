#!/usr/bin/env node
// News feed helper: fetches the RSS/Atom feeds in feeds.json server-side (browsers block
// cross-origin feed requests), merges them, and serves JSON plus the panel files.
//
//   node server.mjs           serve on http://localhost:8787 and refresh on a timer
//   node server.mjs --once    refresh once, write data/news.json, exit (cron-friendly)
//
// Env: NEWS_PORT (default 8787), NEWS_FEEDS (path to feeds file, default ./feeds.json),
//      NEWS_SNAPSHOT (where --once writes, default ./data/news.json)
// Requires Node 18+ (built-in fetch). No npm install needed.

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { extname, join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseFeed } from './lib/parse.mjs';
import { clusterStories, pickTopStories } from './lib/cluster.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FEEDS_FILE = process.env.NEWS_FEEDS || join(ROOT, 'feeds.json');
const SNAPSHOT = process.env.NEWS_SNAPSHOT || join(ROOT, 'data', 'news.json');
const PORT = Number(process.env.NEWS_PORT || 8787);
const UA = 'Mozilla/5.0 (PersonalDashboard NewsPanel; +https://localhost)';

let cache = null;
let inflight = null;

async function loadConfig() {
  return JSON.parse(await readFile(FEEDS_FILE, 'utf8'));
}

// feeds.json used to say `categories` / `category`; both spellings still work.
const topicsOf = (cfg) => cfg.topics || cfg.categories || [];
const topicOf = (feed) => feed.topic || feed.category || 'world';
const idOf = (link) => createHash('sha1').update(link).digest('base64url').slice(0, 12);

export async function fetchFeed(feed, cfg) {
  const started = Date.now();
  const topic = topicOf(feed);
  try {
    const res = await fetch(feed.url, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items } = parseFeed(await res.text());
    if (!items.length) throw new Error('no items found (not an RSS/Atom feed?)');
    const isGoogleNews = feed.url.includes('news.google.com');
    const max = feed.maxItems ?? cfg.maxItemsPerFeed ?? 15;
    const out = items.filter((i) => /^https?:\/\//i.test(i.link)).slice(0, max).map(({ outlet, ...i }) => {
      const item = {
        id: idOf(i.link),
        ...i,
        source: feed.name,
        topic,
        category: topic,
      };
      if (isGoogleNews) {
        // Google News appends " - Outlet" to every title, names the outlet in <source>, and its
        // summary is just the title again, so credit the real outlet and drop the summary.
        item.title = outlet && i.title.endsWith(` - ${outlet}`) ? i.title.slice(0, -(outlet.length + 3)) : i.title.replace(/\s+-\s+[^-]+$/, '');
        item.summary = '';
        if (outlet) { item.source = outlet; item.via = feed.name; }
      }
      return item;
    });
    return { status: { name: feed.name, topic, category: topic, ok: true, count: out.length, ms: Date.now() - started }, items: out };
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code || err.message;
    return { status: { name: feed.name, topic, category: topic, ok: false, error: msg, count: 0 }, items: [] };
  }
}

// Merge the feeds' headlines: drop repeats and stale ones, newest first, then group them into stories.
export function merge(cfg, results, now = Date.now()) {
  const cutoff = cfg.maxAgeHours ? now - cfg.maxAgeHours * 3600e3 : 0;
  const seen = new Set();
  const items = [];
  const rank = new Map();
  // Outlets' own feeds go first, so a repeat seen through Google News is the copy that's dropped
  // (the outlet's own copy has the picture and the summary).
  const queue = results.flatMap((r, feedIndex) => r.items.map((it) => ({ it, rank: it.via ? results.length + feedIndex : feedIndex })))
    .sort((a, b) => a.rank - b.rank);
  for (const { it, rank: r } of queue) {
    const key = it.title.toLowerCase().replace(/\W+/g, '');
    if (seen.has(it.link) || seen.has(key)) continue;
    seen.add(it.link).add(key);
    if (it.published && Date.parse(it.published) < cutoff) continue;
    items.push(it);
    rank.set(it, r); // the lead of a story comes from the outlet listed first in feeds.json
  }
  items.sort((a, b) => (b.published ? Date.parse(b.published) : 0) - (a.published ? Date.parse(a.published) : 0));
  const stories = clusterStories(items, { now, rankOf: (i) => rank.get(i) ?? 0 });
  return { items, stories, top: pickTopStories(stories, { count: cfg.topStories ?? 10, perTopic: 3 }) };
}

export async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    const cfg = await loadConfig();
    const feeds = cfg.feeds.filter((f) => f.enabled !== false);
    const results = await Promise.all(feeds.map((f) => fetchFeed(f, cfg)));
    const { items, stories, top } = merge(cfg, results);
    const topics = topicsOf(cfg);

    cache = {
      updatedAt: new Date().toISOString(),
      refreshMinutes: cfg.refreshMinutes ?? 15,
      topics,
      categories: topics,
      feeds: results.map((r) => r.status),
      top,
      stories,
      items,
    };
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(cache));
    const bad = cache.feeds.filter((f) => !f.ok);
    console.log(`[news] ${cache.updatedAt}: ${items.length} items in ${stories.length} stories from ${cache.feeds.length - bad.length}/${cache.feeds.length} feeds` +
      (bad.length ? `; failed: ${bad.map((f) => `${f.name} (${f.error})`).join(', ')}` : ''));
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
const STATIC = new Set(['/index.html', '/news-panel.js', '/feeds.json', '/data/news.json']);
// The dashboard's design tokens and fonts, so the panel page looks the same when opened from this helper.
const SHARED = new Map([
  ['/css/tokens.css', '../../css/tokens.css'],
  ['/fonts/Geist-Variable.woff2', '../../fonts/Geist-Variable.woff2'],
  ['/fonts/GeistMono-Variable.woff2', '../../fonts/GeistMono-Variable.woff2'],
]);

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// What one request asked for. ?topic= (or the older ?category=) keeps one topic's headlines and
// the stories filed under it; ?limit= caps both lists. server/server.mjs uses it too.
export function view(data, params) {
  const topic = params.get('topic') || params.get('category');
  const limit = Number(params.get('limit')) || 0;
  const one = topic && topic !== 'all' && topic !== 'top';
  let items = one ? data.items.filter((i) => (i.topic || i.category) === topic) : data.items;
  let stories = data.stories;
  if (stories && one) stories = stories.filter((s) => s.topics.includes(topic));
  if (limit) {
    items = items.slice(0, limit);
    if (stories) {
      const top = new Set(one ? [] : data.top || []);
      stories = stories.filter((s, i) => i < limit || top.has(s.id));
    }
  }
  if (!stories) return { ...data, items };
  // Keep every headline a returned story points to, even past the limit or outside the topic.
  const have = new Set(items.map((i) => i.id));
  const need = new Set(stories.flatMap((s) => [s.lead, ...s.related]).filter((id) => !have.has(id)));
  if (need.size) items = items.concat(data.items.filter((i) => need.has(i.id)));
  return { ...data, items, stories };
}

async function serve() {
  // Serve last snapshot immediately if one exists, then refresh.
  try { cache = JSON.parse(await readFile(SNAPSHOT, 'utf8')); } catch {}
  refresh().catch((e) => console.error('[news] refresh failed:', e.message));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      if (url.pathname === '/api/news') {
        const data = cache ?? (await refresh());
        return send(res, 200, view(data, url.searchParams));
      }
      if (url.pathname === '/api/news/refresh') return send(res, 200, view(await refresh(), url.searchParams));
      const path = url.pathname === '/' ? '/index.html' : normalize(url.pathname);
      if (STATIC.has(path)) return send(res, 200, await readFile(join(ROOT, path)), TYPES[extname(path)]);
      if (SHARED.has(path)) return send(res, 200, await readFile(join(ROOT, SHARED.get(path))), TYPES[extname(path)]);
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });
  server.listen(PORT, () => console.log(`[news] serving on http://localhost:${PORT}  (panel: /, data: /api/news)`));

  const schedule = async () => {
    let minutes = 15;
    try { minutes = (await loadConfig()).refreshMinutes ?? 15; } catch {}
    setTimeout(() => refresh().catch((e) => console.error('[news]', e.message)).finally(schedule), minutes * 60e3);
  };
  schedule();
}

if (process.argv.includes('--once')) {
  refresh().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))) {
  serve();
}
