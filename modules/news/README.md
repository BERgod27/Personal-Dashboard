# News panel

World headlines from major outlets plus Portuguese news, merged into one feed and refreshed automatically.
Zero dependencies: needs only Node 18 or newer.

## Run it

```bash
cd personal-dashboard/modules/news
node server.mjs
```

Open http://localhost:8787 for the standalone panel. JSON lives at http://localhost:8787/api/news.
The helper re-fetches every `refreshMinutes` (15 by default) and the panel polls on the same cadence;
the ↻ button forces a refresh.

Why a helper: browsers block cross-origin requests to news sites' RSS feeds, so `server.mjs` fetches them
server-side and serves the merged result with CORS enabled.

No server running all the time? `node server.mjs --once` writes `data/news.json`; schedule it with cron
(`*/15 * * * * cd /path/to/modules/news && node server.mjs --once`) and the panel falls back to that file
whenever the API is unreachable.

## Mount it in the dashboard

```html
<script type="module" src="modules/news/news-panel.js"></script>
<news-panel api="http://localhost:8787" category="all" limit="60"></news-panel>
```

or from JS: `import { mount } from './modules/news/news-panel.js'; mount(el, { api: 'http://localhost:8787', compact: true });`

| Attribute | Default | Meaning |
|---|---|---|
| `api` | `http://localhost:8787` | Where `server.mjs` runs |
| `category` | `all` | Initial tab: `all`, `world`, `portugal` (any id in feeds.json) |
| `limit` | `60` | Max headlines shown |
| `compact` | off | Hide images and summaries for a small tile |

The panel uses shadow DOM and reads the dashboard's design tokens (`css/tokens.css`), which reach inside
because CSS variables inherit; a page that hosts it links that file (`node server.mjs` serves it for the
standalone page). A shell that names the panel itself can hide its title with `--news-title-display: none`.
It fires a `news-updated` event (detail = the JSON payload) after each load.

## Edit the outlets

Everything is in `feeds.json`; edits apply on the next refresh, no restart needed.

- Add an outlet: `{ "name": "Le Monde", "category": "world", "url": "https://…/rss.xml" }`
- Turn one off: add `"enabled": false`
- Add a tab: add `{ "id": "tech", "label": "Tech" }` to `categories` and use `"category": "tech"` on feeds
- `maxAgeHours` drops stale stories, `maxItemsPerFeed` caps each source

Default sources. World: BBC, Reuters, AP, NYT, Guardian, Financial Times, The Economist, Al Jazeera,
Le Monde (EN), DW, NPR. Portugal: Público, RTP, Observador, Expresso, ECO, JN, DN.
Reuters and AP stopped publishing public RSS, so those two use a Google News search limited to their sites.
FT and The Economist feeds show headlines and teasers; full articles stay behind their paywalls.

A feed that breaks shows in red with ⚠ in the source chips (hover for the error), and the server log names it.

## Files

- `server.mjs`: fetch, merge, de-duplicate, cache, serve
- `lib/parse.mjs`: small RSS 2.0 / RSS 1.0 / Atom parser
- `news-panel.js`: the `<news-panel>` web component
- `index.html`: standalone page
- `feeds.json`: outlet list
- `test/`: offline sample feeds (`node test/fixtures.mjs`, then `NEWS_FEEDS=test/feeds.test.json node server.mjs`)
