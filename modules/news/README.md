# News panel

A news page laid out like Google News: headlines from about 40 feeds are grouped into **stories** (the same
event from several outlets becomes one story) and divided by **topic**: Top stories, Portugal, World,
Business, Tech, Science, Health, Sports and Culture. Refreshed automatically.
Zero dependencies: needs only Node 18 or newer.

## Run it

```bash
cd personal-dashboard/modules/news
node server.mjs
```

Open http://localhost:8787 for the standalone page. JSON lives at http://localhost:8787/api/news.
The helper re-fetches every `refreshMinutes` (15 by default) and the panel polls on the same cadence;
the ↻ button forces a refresh.

The helper listens on this computer only. To reach it from another device on your network, start it with
`NEWS_HOST=0.0.0.0 node server.mjs`.

Why a helper: browsers block cross-origin requests to news sites' RSS feeds, so `server.mjs` fetches them
server-side and serves the merged result with CORS enabled. A feed may only redirect to its own address or
to a public https one, and at most 5 MB of a feed is read.

No server running all the time? `node server.mjs --once` writes `data/news.json`; schedule it with cron
(`*/15 * * * * cd /path/to/modules/news && node server.mjs --once`) and the panel falls back to that file
whenever the API is unreachable.

## What the page shows

- **Top stories**: the ten best-ranked stories, at most three from any one topic. The first one is shown
  large. Below them, each topic gets a short section with its four best stories and a **More** link.
  A **Latest** column lists the newest headlines.
- **A topic tab**: every story filed under that topic, best first, and the latest headlines in it.
- **A story**: the lead headline with its picture, two or three headlines from other outlets, and
  **Full coverage**, which lists every headline in the story.
- **Search** and the **sources** list (under "N sources" by the update time) switch to a plain list of
  matching headlines. A feed that broke this time shows in amber with ⚠; hover it for the error.

Phones get one column, topic tabs that scroll sideways and stick under the app bar, and a search button
that opens the search field. Colours come from the dashboard's tokens, so dark and light both work.

## How stories are made (`lib/cluster.mjs`)

Each headline's title words (plus the start of its summary, at half weight) become a TF-IDF vector, after
folding accents, dropping filler words in English and Portuguese, and cutting words to five letters so
"fecha", "fecham" and "fechadas" match. Names (capitalised mid-sentence, or acronyms like ECB) count
extra. Going from newest to oldest, a headline joins the most similar story when the cosine similarity is
at least 0.39, they share at least two title words, and they are within 36 hours of each other;
otherwise it starts a new story. English and Portuguese coverage of the same event stays apart.

- The **lead** is the headline with a picture and a summary, from the outlet listed first in `feeds.json`.
- The **topic** is the one most of the story's headlines come from; `topics` lists all of them, and the
  story shows up in each of those tabs.
- The **score** is `(1 + 1.5 ln outlets) × 0.5^(age in hours / 16)`, so a story five outlets cover beats a
  fresher one-outlet story for most of a day.

## Mount it in the dashboard

```html
<script type="module" src="modules/news/news-panel.js"></script>
<news-panel api="http://localhost:8787"></news-panel>
```

or from JS: `import { mount } from './modules/news/news-panel.js'; mount(el, { api: 'http://localhost:8787' });`

| Attribute | Default | Meaning |
|---|---|---|
| `api` | `http://localhost:8787` | Where `server.mjs` runs |
| `topic` | last one picked on this device, else `top` | Tab to open: `top` or any topic id in feeds.json (`category` still works) |
| `limit` | `20` | Stories shown in a topic tab before **Show more** (headlines, in compact mode) |
| `compact` | off | A plain list of the top stories, for a small tile |

The panel uses shadow DOM and reads the dashboard's design tokens (`css/tokens.css`), which reach inside
because CSS variables inherit; a page that hosts it links that file (`node server.mjs` serves it for the
standalone page). Two CSS hooks: `--news-title-display: none` hides the panel's own "News" title, and
`--news-sticky-top` sets where the topic bar sticks (the dashboard puts it under the phone's app bar).
It fires a `news-updated` event (detail = the JSON payload) after each load.

## The API

`GET /api/news` (and `/api/news/refresh` to fetch the feeds first) returns:

```js
{
  updatedAt, refreshMinutes,
  topics: [{ id, label }],                 // also sent as `categories`, the older name
  feeds:  [{ name, topic, ok, count, error? }],
  top:    ['s…'],                          // ids of the top stories, in order
  stories: [{ id, topic, topics, lead, related: ['…'], sources, published, score }],
  items:  [{ id, title, link, published, summary, image, source, via?, topic, category }],
}
```

Stories point to headlines by `id`. `?topic=business` keeps that topic's headlines and the stories filed
under it (with every headline they point to); `?category=` is the older name. `?limit=` caps both lists.
Headlines found through Google News carry their real outlet in `source` and the Google News feed in `via`.

## Edit the outlets

Everything is in `feeds.json`; edits apply on the next refresh, no restart needed.

- Add an outlet: `{ "name": "Le Monde", "topic": "world", "url": "https://…/rss.xml" }`
- Turn one off: add `"enabled": false`
- Add a topic: add `{ "id": "climate", "label": "Climate" }` to `topics` and use `"topic": "climate"` on feeds
  (new topics get a grey dot; the eight built-in ones have colours)
- Order matters: outlets listed first are preferred as a story's lead
- `maxAgeHours` drops stale stories, `maxItemsPerFeed` caps each source (`maxItems` on one feed overrides it),
  `topStories` sets how many stories Top stories holds

Default sources:

| Topic | Feeds |
|---|---|
| Portugal | Público, RTP, Observador, Expresso, JN, DN |
| World | BBC, Reuters, AP, NYT, Guardian, The Economist, Al Jazeera, Le Monde (EN), DW, NPR |
| Business | Financial Times, BBC Business, Guardian Business, ECO, Jornal de Negócios |
| Tech | The Verge, Ars Technica, BBC Technology |
| Science | BBC Science, Guardian Science |
| Health | BBC Health, Guardian Health |
| Sports | Record, BBC Sport, Guardian Sport |
| Culture | Público Cultura, Guardian Culture |

Each topic except Portugal and World also reads the matching Google News section from the Portuguese
edition, so the Portuguese side of a topic isn't empty; those headlines are credited to their own outlets.
Reuters and AP stopped publishing public RSS, so those two use a Google News search limited to their sites.
FT and The Economist feeds show headlines and teasers; full articles stay behind their paywalls.

## Test it

```bash
node --test modules/news/test/*.test.mjs   # from the repo root
```

The tests cover story grouping on a set of realistic headlines (`test/stories.sample.mjs`), and fetching,
merging and the API view against local sample feeds. To try the page offline, run `node test/fixtures.mjs`,
then `NEWS_FEEDS=test/feeds.test.json node server.mjs`.

## Files

- `server.mjs`: fetch, merge, de-duplicate, group into stories, cache, serve
- `lib/cluster.mjs`: story grouping and ranking
- `lib/parse.mjs`: small RSS 2.0 / RSS 1.0 / Atom parser
- `news-panel.js`: the `<news-panel>` web component
- `index.html`: standalone page
- `feeds.json`: topics and outlets
- `test/`: tests, sample headlines and offline sample feeds
