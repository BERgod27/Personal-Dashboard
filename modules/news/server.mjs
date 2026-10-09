#!/usr/bin/env node
// News feed helper: fetches the RSS/Atom feeds in feeds.json server-side (browsers block
// cross-origin feed requests), merges them, and serves JSON plus the panel files.
//
//   node server.mjs           serve on http://localhost:8787 and refresh on a timer
//   node server.mjs --once    refresh once, write data/news.json, exit (cron-friendly)
//
// Env: NEWS_PORT (default 8787), NEWS_FEEDS (path to feeds file, default ./feeds.json)
// Requires Node 18+ (built-in fetch). No npm install needed.

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { extname, join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed } from './lib/parse.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FEEDS_FILE = process.env.NEWS_FEEDS || join(ROOT, 'feeds.json');
const SNAPSHOT = join(ROOT, 'data', 'news.json');
const PORT = Number(process.env.NEWS_PORT || 8787);
const UA = 'Mozilla/5.0 (PersonalDashboard NewsPanel; +https://localhost)';

let cache = null;
let inflight = null;

async function loadConfig() {
  return JSON.parse(await readFile(FEEDS_FILE, 'utf8'));
}

async function fetchFeed(feed, cfg) {
  const started = Date.now();
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
    const out = items.filter((i) => /^https?:\/\//i.test(i.link)).slice(0, cfg.maxItemsPerFeed ?? 15).map((i) => ({
      ...i,
      // Google News appends " - Outlet" to every title
      title: isGoogleNews ? i.title.replace(/\s+-\s+[^-]+$/, '') : i.title,
      source: feed.name,
      category: feed.category,
    }));
    return { status: { name: feed.name, category: feed.category, ok: true, count: out.length, ms: Date.now() - started }, items: out };
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code || err.message;
    return { status: { name: feed.name, category: feed.category, ok: false, error: msg, count: 0 }, items: [] };
  }
}

export async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    const cfg = await loadConfig();
    const feeds = cfg.feeds.filter((f) => f.enabled !== false);
    const results = await Promise.all(feeds.map((f) => fetchFeed(f, cfg)));

    const cutoff = cfg.maxAgeHours ? Date.now() - cfg.maxAgeHours * 3600e3 : 0;
    const seen = new Set();
    const items = [];
    for (const it of results.flatMap((r) => r.items)) {
      const key = it.title.toLowerCase().replace(/\W+/g, '');
      if (seen.has(it.link) || seen.has(key)) continue;
      seen.add(it.link).add(key);
      if (it.published && Date.parse(it.published) < cutoff) continue;
      items.push(it);
    }
    items.sort((a, b) => (b.published ? Date.parse(b.published) : 0) - (a.published ? Date.parse(a.published) : 0));

    cache = {
      updatedAt: new Date().toISOString(),
      refreshMinutes: cfg.refreshMinutes ?? 15,
      categories: cfg.categories,
      feeds: results.map((r) => r.status),
      items,
    };
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(cache, null, 1));
    const bad = cache.feeds.filter((f) => !f.ok);
    console.log(`[news] ${cache.updatedAt}: ${items.length} items from ${cache.feeds.length - bad.length}/${cache.feeds.length} feeds` +
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

// The headlines one request asked for: ?category= and ?limit=. server/server.mjs uses it too.
export function view(data, params) {
  const cat = params.get('category');
  const limit = Number(params.get('limit')) || 0;
  let items = cat && cat !== 'all' ? data.items.filter((i) => i.category === cat) : data.items;
  if (limit) items = items.slice(0, limit);
  return { ...data, items };
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
