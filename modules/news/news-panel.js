// <news-panel> web component: the Personal Dashboard's news page, laid out like Google News.
// Headlines are grouped into stories (the same event from several outlets) and divided by topic.
//
// Usage in any page or dashboard shell:
//   <script type="module" src="modules/news/news-panel.js"></script>
//   <news-panel api="http://localhost:8787"></news-panel>
//
// or programmatically:
//   import { mount } from './modules/news/news-panel.js';
//   mount(document.querySelector('#news'), { api: 'http://localhost:8787' });
//
// Attributes
//   api       base URL of server.mjs (default: http://localhost:8787)
//   topic     tab to open: top (Top stories) or any topic id in feeds.json (default: the last one
//             picked on this device, else top). `category` is still read as an older name for it.
//   limit     stories shown per topic before "Show more" (default 20); in compact mode, headlines
//   compact   present = a plain list of the top stories for a small tile
//
// If the server is unreachable the panel falls back to the last snapshot at data/news.json
// next to this script (written by `node server.mjs --once`).
// Styles read the dashboard's design tokens (css/tokens.css), so a page that hosts the panel links that file.
// CSS hooks: --news-title-display: none hides the panel's own "News" title; --news-sticky-top is
// where the topic bar sticks (below a fixed app bar, for example).

const SNAPSHOT_URL = new URL('./data/news.json', import.meta.url).href;
const TOPIC_KEY = 'pd.news.topic';
const TOP = 'top';
const TOP_SHOWN = 7;   // the featured story plus six: full rows when wide screens use two columns
const LATEST = 10;
const PER_SECTION = 4;

// Lucide icons (lucide.dev)
const svg = (body) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  warn: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  search: svg('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'),
  news: svg('<path d="M15 18h-5"/><path d="M18 14h-8"/><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="10" y="6" rx="1"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  layers: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>'),
  chevron: svg('<path d="m9 18 6-6-6-6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
};

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u = '') => (/^https?:\/\//i.test(u) ? u : '');

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const time = (iso) => (iso ? `<time class="t" datetime="${esc(iso)}">${esc(ago(iso))}</time>` : '');
const link = (item, cls, body) =>
  `<a class="${cls}" href="${esc(safeUrl(item.link) || '#')}" target="_blank" rel="noopener noreferrer">${body}</a>`;
// The outlet's initial in a small tile, where Google News shows a favicon (no third-party requests here).
const initial = (name = '') => (name.replace(/^the\s+/i, '').match(/\p{L}|\d/u) || ['?'])[0].toUpperCase();
const source = (name) => `<span class="src"><span class="mono" aria-hidden="true">${esc(initial(name))}</span><span class="src-name">${esc(name)}</span></span>`;
const dot = (topic) => `<span class="dot" data-t="${esc(topic)}" aria-hidden="true"></span>`;

// Whatever the server sent, in one shape. A snapshot from before stories existed gets one story per headline.
function normalize(data) {
  const items = data.items || [];
  items.forEach((it, i) => {
    it.id ??= 'i' + i;
    it.topic ??= it.category;
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const stories = data.stories
    ? data.stories.filter((s) => byId.has(s.lead)).map((s) => ({ ...s, related: (s.related || []).filter((id) => byId.has(id)), topics: s.topics || [s.topic] }))
    : items.map((i) => ({ id: 's' + i.id, topic: i.topic, topics: [i.topic], lead: i.id, related: [], sources: 1, published: i.published }));
  const storyById = new Map(stories.map((s) => [s.id, s]));
  let top = (data.top || []).filter((id) => storyById.has(id));
  if (!top.length) top = stories.slice(0, 10).map((s) => s.id);
  return { items, byId, stories, storyById, top, topics: data.topics || data.categories || [] };
}

const CSS = `
:host { display:block; container-type:inline-size; color:var(--text-1); font:var(--fw-regular) var(--fs-14)/var(--lh-body) var(--font-sans);
  scroll-margin-top:var(--news-sticky-top, 0px); }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
.ic { width:var(--icon); height:var(--icon); flex:none; fill:none; stroke:currentColor; stroke-width:var(--icon-stroke); stroke-linecap:round; stroke-linejoin:round; }
.ic * { vector-effect:non-scaling-stroke; }
button { font:inherit; color:inherit; cursor:pointer; }
button:focus-visible, input:focus-visible, a:focus-visible, summary:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
a { color:inherit; text-decoration:none; border-radius:var(--radius-xs); }
a:hover { text-decoration:underline; text-decoration-color:var(--text-3); text-underline-offset:2px; }
h2, h3, h4, p, ol, ul { margin:0; }
ol, ul { list-style:none; padding:0; }

/* ---------- topic bar ---------- */
.bar { position:sticky; top:var(--news-sticky-top, 0px); z-index:5; display:flex; align-items:center; gap:var(--space-2);
  margin-bottom:var(--space-3); background:var(--bg); border-bottom:1px solid var(--border); }
h2 { display:var(--news-title-display, block); flex:none; padding-right:var(--space-2); font-size:var(--fs-16); font-weight:var(--fw-semibold); letter-spacing:var(--tracking-tight); }
.chips { flex:1; min-width:0; display:flex; overflow-x:auto; scrollbar-width:none; overscroll-behavior-x:contain;
  -webkit-mask-image:linear-gradient(to right, #000 calc(100% - 24px), transparent); mask-image:linear-gradient(to right, #000 calc(100% - 24px), transparent); }
.chips::-webkit-scrollbar { display:none; }
.chip { position:relative; flex:none; height:44px; padding:0 var(--space-3); border:0; background:transparent; white-space:nowrap;
  color:var(--text-2); font-size:var(--fs-14); font-weight:var(--fw-medium); transition:color var(--dur-fast) var(--ease-out); }
.chip:first-child { padding-left:0; }
.chip:last-child { margin-right:var(--space-6); }
.chip:hover { color:var(--text-1); }
.chip[aria-pressed="true"] { color:var(--text-1); }
.chip[aria-pressed="true"]::after { content:""; position:absolute; left:var(--space-3); right:var(--space-3); bottom:0; height:2px; border-radius:2px 2px 0 0; background:var(--accent); }
.chip:first-child[aria-pressed="true"]::after { left:0; }
.chip:focus-visible { outline-offset:-2px; }
.tool { flex:none; width:var(--control-h); height:var(--control-h); display:inline-grid; place-items:center; padding:0; border:0;
  border-radius:var(--radius-sm); background:transparent; color:var(--text-3); transition:background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
.tool:hover { background:var(--surface-3); color:var(--text-1); }
.tool:disabled { opacity:.5; cursor:default; background:transparent; }
.search { display:none; align-items:center; gap:var(--space-2); height:var(--control-h); padding:0 10px; min-width:0;
  background:var(--input-bg); border:1px solid var(--border-strong); border-radius:var(--radius-sm); color:var(--text-3);
  transition:border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out); }
.search:hover { border-color:var(--border-hover); }
.search:focus-within { border-color:var(--focus); box-shadow:0 0 0 3px var(--focus-soft); }
.search input { flex:1; min-width:0; height:100%; border:0; padding:0; background:transparent; color:var(--text-1); font:inherit; font-size:var(--fs-13); outline:none; }
.search input::placeholder { color:var(--text-3); }
.search input::-webkit-search-cancel-button { display:none; }
.search-close { display:none; }
.bar.searching .chips, .bar.searching .search-open, .bar.searching h2 { display:none; }
.bar.searching .search { display:flex; flex:1; }
.bar.searching .search-close { display:inline-grid; }
.bar.searching { padding:6px 0; }

/* ---------- status line and sources ---------- */
.status-row { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-1) var(--space-3); margin-bottom:var(--space-3); color:var(--text-3); font-size:var(--fs-12); }
.status { font-variant-numeric:tabular-nums; }
.warn { color:var(--warning); }
.feeds summary { display:inline-flex; align-items:center; gap:4px; color:var(--text-2); cursor:pointer; list-style:none; border-radius:var(--radius-xs); }
.feeds summary::-webkit-details-marker { display:none; }
.feeds summary:hover { color:var(--text-1); }
.feeds summary .ic { width:14px; height:14px; transition:transform var(--dur) var(--ease-out); }
.feeds[open] { flex-basis:100%; }
.feeds[open] summary .ic { transform:rotate(180deg); }
.feed-list { display:flex; flex-wrap:wrap; gap:6px; padding-top:var(--space-2); }
.feed-list button { display:inline-flex; align-items:center; gap:4px; height:24px; padding:0 8px; font-size:var(--fs-12); font-weight:var(--fw-medium);
  color:var(--text-2); background:transparent; border:1px solid var(--border-strong); border-radius:var(--radius-sm);
  transition:background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
.feed-list button:hover { color:var(--text-1); background:var(--surface-2); }
.feed-list button[aria-pressed="true"] { color:var(--text-1); background:var(--surface-3); border-color:var(--border-hover); }
.feed-list button.bad { color:var(--warning); }
.feed-list .ic { width:12px; height:12px; }

/* ---------- page layout ---------- */
.page { display:grid; grid-template-columns:minmax(0, 1fr); gap:var(--space-4); align-items:start; }
.col { display:grid; gap:var(--space-4); min-width:0; }
.card { min-width:0; background:var(--surface-1); border:1px solid var(--border); border-radius:var(--radius); }
.sec-h { display:flex; align-items:center; gap:var(--space-2) var(--space-3); flex-wrap:wrap; padding:var(--space-4) var(--space-4) var(--space-1); }
.sec-h h3 { display:flex; align-items:center; gap:var(--space-2); font-size:var(--fs-16); font-weight:var(--fw-semibold); letter-spacing:var(--tracking-tight); line-height:var(--lh-tight); }
.sec-sub { color:var(--text-3); font:var(--fs-12) var(--font-mono); font-variant-numeric:tabular-nums; }
.more { margin-left:auto; display:inline-flex; align-items:center; gap:2px; height:var(--control-h-sm); padding:0 var(--space-2); margin-right:calc(-1 * var(--space-2));
  border:0; border-radius:var(--radius-sm); background:transparent; color:var(--accent-text); font-size:var(--fs-13); font-weight:var(--fw-medium); }
.more:hover { background:var(--surface-2); }
.more .ic { width:14px; height:14px; }
.show-more { display:flex; align-items:center; justify-content:center; gap:4px; width:100%; height:40px; border:0; border-top:1px solid var(--border);
  border-radius:0 0 var(--radius) var(--radius); background:transparent; color:var(--accent-text); font-size:var(--fs-13); font-weight:var(--fw-medium);
  transition:background-color var(--dur-fast) var(--ease-out); }
.show-more:hover { background:var(--surface-2); }
.show-more:focus-visible { outline-offset:-2px; }
.dot { width:8px; height:8px; flex:none; border-radius:50%; background:var(--text-3); }
.dot[data-t="portugal"] { background:var(--course-3); }
.dot[data-t="world"] { background:var(--course-0); }
.dot[data-t="business"] { background:var(--course-2); }
.dot[data-t="tech"] { background:var(--course-5); }
.dot[data-t="science"] { background:var(--course-6); }
.dot[data-t="health"] { background:var(--course-1); }
.dot[data-t="sports"] { background:var(--course-4); }
.dot[data-t="culture"] { background:var(--course-7); }

/* ---------- shared bits ---------- */
.src { display:inline-flex; align-items:center; gap:6px; min-width:0; color:var(--text-2); font-size:var(--fs-12); font-weight:var(--fw-medium); }
.src-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mono { width:16px; height:16px; flex:none; display:inline-grid; place-items:center; border-radius:var(--radius-xs);
  background:var(--surface-3); border:1px solid var(--border); color:var(--text-1); font-size:10px; font-weight:var(--fw-semibold); line-height:1; }
.byline { display:flex; align-items:center; gap:var(--space-2); min-width:0; }
.tag { display:inline-flex; align-items:center; gap:6px; color:var(--text-3); font-size:var(--fs-12); white-space:nowrap; }
.tag::before { content:"·"; margin-right:2px; }
.meta { display:flex; flex-wrap:wrap; align-items:center; gap:0 var(--space-2); margin-top:var(--space-1); color:var(--text-3); font-size:var(--fs-12); }
.meta > * + *::before { content:"·"; margin-right:var(--space-2); }
.t { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.thumb { display:block; flex:none; border-radius:var(--radius-sm); }
.thumb img { display:block; object-fit:cover; border-radius:var(--radius-sm); background:var(--surface-2); }

/* ---------- story: lead headline, picture, related coverage ---------- */
.stories { padding:0 var(--space-4); }
.story { display:grid; grid-template-columns:minmax(0, 1fr) auto; grid-template-areas:"main thumb" "rel rel" "cov cov"; column-gap:var(--space-4);
  padding:var(--space-4) 0; border-top:1px solid var(--border); }
.story:first-child { border-top:0; padding-top:var(--space-2); }
.story.no-img { grid-template-columns:minmax(0, 1fr); grid-template-areas:"main" "rel" "cov"; }
.s-main { grid-area:main; min-width:0; }
.story .thumb { grid-area:thumb; align-self:start; }
.story .thumb img { width:88px; height:88px; }
.hl { margin-top:6px; font-size:var(--fs-16); font-weight:var(--fw-semibold); line-height:var(--lh-tight); letter-spacing:var(--tracking-tight); text-wrap:pretty; }
.sum { margin-top:6px; color:var(--text-2); font-size:var(--fs-13); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.rel, .all { grid-area:rel; display:grid; gap:var(--space-3); margin-top:var(--space-3); padding-left:var(--space-3); border-left:2px solid var(--border-strong); }
.rel a, .all a { display:block; margin-top:2px; font-size:var(--fs-14); font-weight:var(--fw-medium); line-height:var(--lh-tight); text-wrap:pretty; }
.rel .meta, .all .meta { margin-top:2px; }
.rel li:nth-child(n+3) { display:none; }
.cov { grid-area:cov; justify-self:start; display:inline-flex; align-items:center; gap:6px; height:var(--control-h-sm); margin-top:var(--space-3); padding:0 10px;
  border:1px solid var(--border-strong); border-radius:var(--radius-sm); background:transparent; color:var(--text-2); font-size:var(--fs-12); font-weight:var(--fw-medium);
  transition:background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
.cov:hover { background:var(--surface-2); border-color:var(--border-hover); color:var(--text-1); }
.cov[aria-expanded="true"] { background:var(--surface-3); color:var(--text-1); }
.cov .ic { width:14px; height:14px; color:var(--accent-text); }

/* ---------- rows: Latest, topic sections, search results ---------- */
.rows { padding:0 var(--space-4) var(--space-2); }
.row { display:flex; gap:var(--space-3); padding:var(--space-3) 0; border-top:1px solid var(--border); }
.row:first-child { border-top:0; }
.r-main { flex:1; min-width:0; }
.r-title { display:block; margin-top:4px; font-weight:var(--fw-medium); line-height:var(--lh-tight); text-wrap:pretty; }
.row .thumb img { width:64px; height:64px; }
.rows.sections { display:grid; grid-template-columns:minmax(0, 1fr); column-gap:var(--space-6); }
.latest .row { padding:10px 0; }
.latest .r-title { font-size:var(--fs-13); }
.latest .meta { margin-top:2px; }

/* ---------- states ---------- */
.state { display:flex; gap:var(--space-3); align-items:flex-start; padding:var(--space-5) var(--space-4); }
.state .tile { width:32px; height:32px; flex:none; display:grid; place-items:center; border-radius:var(--radius-sm); background:var(--surface-2); border:1px solid var(--border); color:var(--text-2); }
.state.error .tile { color:var(--danger); }
.state b { display:block; font-weight:var(--fw-medium); }
.state span { display:block; color:var(--text-2); font-size:var(--fs-13); margin-top:2px; }
.state code { font:var(--fs-12) var(--font-mono); color:var(--text-1); background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-xs); padding:1px 5px; }
.retry { margin-top:var(--space-3); height:var(--control-h-sm); padding:0 10px; font-size:var(--fs-12); font-weight:var(--fw-medium);
  background:var(--surface-2); border:1px solid var(--border-strong); border-radius:var(--radius-sm); }
.retry:hover { background:var(--surface-3); border-color:var(--border-hover); }
.skel { display:grid; gap:10px; padding:var(--space-4) 0; border-top:1px solid var(--border); }
.skel:first-child { border-top:0; }
.skel span { display:block; height:12px; border-radius:var(--radius-xs); background:var(--surface-2); }
.skel span:nth-child(1) { width:28%; } .skel span:nth-child(2) { width:82%; height:16px; } .skel span:nth-child(3) { width:64%; height:16px; } .skel span:nth-child(4) { width:18%; }

/* ---------- wider panels ---------- */
@container (min-width: 640px) {
  .story { grid-template-areas:"main thumb" "rel thumb" "cov thumb"; grid-template-rows:auto auto 1fr; }
  .story.no-img { grid-template-areas:"main" "rel" "cov"; grid-template-rows:auto; }
  .story .thumb img { width:176px; height:118px; }
  .rel li:nth-child(n+3) { display:block; }
  .cov.narrow-only[aria-expanded="false"] { display:none; }
  .story.feature .thumb img { width:248px; height:166px; }
  .story.feature .hl { font-size:var(--fs-20); letter-spacing:var(--tracking-tighter); }
  .rows.sections { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .rows.sections .row:nth-child(2) { border-top:0; }
  .row .thumb img { width:72px; height:72px; }
}
@container (min-width: 720px) {
  .search { display:flex; width:240px; }
  .search-open, .search-close { display:none !important; }
  .bar.searching .chips, .bar.searching h2 { display:flex; }
  .bar.searching .search { flex:none; }
  .bar.searching { padding:0; }
}
@container (min-width: 960px) {
  .page { grid-template-columns:minmax(0, 1fr) 300px; }
  .page > .latest { position:sticky; top:calc(var(--news-sticky-top, 0px) + 60px); }
}
/* Wide screens: stories side by side, the featured one across the top with its related
   headlines in a row, and each topic section's four stories in one row. */
@container (min-width: 1400px) {
  .page { grid-template-columns:minmax(0, 1fr) 340px; gap:var(--space-5); }
  .col { gap:var(--space-5); }
  .search { width:320px; }
  .stories { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); column-gap:var(--space-8); align-items:start; }
  .story.feature { grid-column:1 / -1; }
  .story.feature .thumb img { width:400px; height:266px; }
  .story.feature .hl { font-size:var(--fs-28); letter-spacing:var(--tracking-tighter); }
  .story.feature .sum { font-size:var(--fs-14); -webkit-line-clamp:3; max-width:72ch; }
  .story.feature .rel, .story.feature .all { grid-template-columns:repeat(3, minmax(0, 1fr)); column-gap:var(--space-6); }
  .rows.sections { grid-template-columns:repeat(4, minmax(0, 1fr)); }
  .rows.sections .row:nth-child(-n+4) { border-top:0; }
  .results .rows { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); column-gap:var(--space-8); }
  .results .row:nth-child(2) { border-top:0; }
}

/* ---------- compact tile ---------- */
:host([compact]) { height:100%; container-type:normal; }
.tile-wrap { display:flex; flex-direction:column; height:100%; background:var(--surface-1); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
.tile-head { display:flex; align-items:center; gap:var(--space-3); padding:var(--space-3) var(--space-3) var(--space-2) var(--space-4); }
.tile-head .status { margin-right:auto; color:var(--text-3); font-size:var(--fs-12); }
.tile-wrap .rows { flex:1; overflow:auto; }

@media (pointer: coarse) { .search input { font-size:var(--fs-16); } }
@media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
`;

const SKELETON = `<div class="card"><div class="stories">${'<div class="skel" aria-hidden="true"><span></span><span></span><span></span><span></span></div>'.repeat(4)}</div></div>`;

class NewsPanel extends HTMLElement {
  static observedAttributes = ['api', 'topic', 'category', 'limit', 'compact'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = null;
    this.view = null;      // normalize(this.data)
    this.source = null;    // outlet picked in the sources list
    this.query = '';
    this.offline = false;
    this.open = new Set(); // stories with full coverage expanded
    this.more = new Set(); // lists expanded with "Show more"
    const root = this.shadowRoot;
    root.addEventListener('click', (e) => this.onClick(e));
    // Broken pictures disappear (a capture listener, since the page's CSP blocks inline onerror).
    root.addEventListener('error', (e) => {
      if (e.target.tagName !== 'IMG') return;
      e.target.closest('.story')?.classList.add('no-img');
      (e.target.closest('.thumb') || e.target).remove();
    }, true);
  }

  get api() { return (this.getAttribute('api') || 'http://localhost:8787').replace(/\/$/, ''); }
  get limit() { return Number(this.getAttribute('limit')) || (this.compact ? 12 : 21); }
  get compact() { return this.hasAttribute('compact'); }
  get topic() {
    const t = this.getAttribute('topic') || this.getAttribute('category');
    if (t && t !== 'all') return t;
    if (this.remembered === undefined) {
      try { this.remembered = localStorage.getItem(TOPIC_KEY) || null; } catch { this.remembered = null; }
    }
    return this.remembered || TOP;
  }

  connectedCallback() {
    if (this.built) return;
    this.built = true;
    this.build();
    this.load();
    this.tick = setInterval(() => this.renderStatus(), 60e3);
  }

  disconnectedCallback() {
    clearInterval(this.tick);
    clearTimeout(this.poll);
    this.built = false;
  }

  attributeChangedCallback(name, before, after) {
    if (!this.built || before === after) return;
    if (name === 'compact') { this.build(); this.render(); return; }
    if (name === 'api') { this.load(); return; }
    if (this.data) this.render();
  }

  build() {
    const root = this.shadowRoot;
    if (this.compact) {
      root.innerHTML = `<style>${CSS}</style><div class="tile-wrap" part="panel">
        <div class="tile-head"><h2>News</h2><span class="status"></span>
          <button class="tool refresh" type="button" title="Refresh now" aria-label="Refresh now">${ICON.refresh}</button></div>
        <ol class="rows body" aria-live="polite" aria-busy="true"></ol></div>`;
      return;
    }
    root.innerHTML = `<style>${CSS}</style><div part="panel">
      <div class="bar">
        <h2>News</h2>
        <div class="chips" role="group" aria-label="Topics"></div>
        <label class="search">${ICON.search}<input type="search" placeholder="Search headlines" aria-label="Search headlines"></label>
        <button class="tool search-open" type="button" title="Search" aria-label="Search headlines">${ICON.search}</button>
        <button class="tool search-close" type="button" title="Close search" aria-label="Close search">${ICON.x}</button>
        <button class="tool refresh" type="button" title="Refresh now" aria-label="Refresh now">${ICON.refresh}</button>
      </div>
      <div class="status-row"><span class="status"></span><details class="feeds"><summary></summary><div class="feed-list" role="group" aria-label="Sources"></div></details></div>
      <div class="body" aria-live="polite" aria-busy="true">${SKELETON}</div>
    </div>`;
    const input = root.querySelector('input');
    input.value = this.query;
    input.addEventListener('input', () => { this.query = input.value.trim().toLowerCase(); this.renderBody(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); this.clearSearch(); } });
  }

  async load(force = false) {
    clearTimeout(this.poll);
    const btn = this.shadowRoot.querySelector('.refresh');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`${this.api}/api/news${force ? '/refresh' : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      this.data = await res.json();
      this.offline = false;
    } catch {
      try {
        const res = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        this.data = await res.json();
      } catch { /* keep whatever we had */ }
      this.offline = true;
    }
    this.view = this.data ? normalize(this.data) : null;
    if (btn) btn.disabled = false;
    this.render();
    const minutes = this.data?.refreshMinutes ?? 15;
    this.poll = setTimeout(() => this.load(), minutes * 60e3);
    this.dispatchEvent(new CustomEvent('news-updated', { detail: this.data, bubbles: true, composed: true }));
  }

  setTopic(id) {
    try { localStorage.setItem(TOPIC_KEY, id); } catch { /* private mode: just not remembered */ }
    this.remembered = id;
    this.source = null;
    this.more.clear();
    if (this.query) this.clearSearch(false);
    // Clicking a chip changes `topic`; an attribute set by the host would otherwise win.
    if (this.hasAttribute('topic') || this.hasAttribute('category')) {
      this.removeAttribute('category');
      this.setAttribute('topic', id);
    } else {
      this.render();
    }
    // Scrolled down the last topic? Start the new one from its top.
    if (this.getBoundingClientRect().top < (parseFloat(getComputedStyle(this).scrollMarginTop) || 0)) this.scrollIntoView({ block: 'start' });
  }

  onClick(e) {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.classList.contains('refresh')) return this.load(true);
    if (el.classList.contains('retry')) return this.load();
    if (el.dataset.topic) return this.setTopic(el.dataset.topic);
    if (el.classList.contains('cov')) return this.toggleCoverage(el);
    if (el.dataset.more) { this.more.add(el.dataset.more); return this.renderBody(); }
    if (el.dataset.src) {
      this.source = this.source === el.dataset.src ? null : el.dataset.src;
      this.renderFeeds();
      return this.renderBody();
    }
    if (el.classList.contains('clear')) return this.clearFilters();
    if (el.classList.contains('search-open')) {
      this.shadowRoot.querySelector('.bar').classList.add('searching');
      return this.shadowRoot.querySelector('input').focus();
    }
    if (el.classList.contains('search-close')) return this.clearSearch();
  }

  toggleCoverage(btn) {
    const story = btn.closest('.story');
    const id = story.dataset.story;
    const opening = !this.open.has(id);
    if (opening) this.open.add(id); else this.open.delete(id);
    btn.setAttribute('aria-expanded', String(opening));
    btn.querySelector('.cov-label').textContent = opening ? 'Hide full coverage' : btn.dataset.label;
    story.querySelector('.all').hidden = !opening;
    const rel = story.querySelector('.rel');
    if (rel) rel.hidden = opening;
  }

  clearSearch(render = true) {
    const input = this.shadowRoot.querySelector('input');
    this.query = '';
    if (input) input.value = '';
    this.shadowRoot.querySelector('.bar')?.classList.remove('searching');
    if (render) this.renderBody();
  }

  // Back to the page as it was: no search and no source picked.
  clearFilters() {
    this.source = null;
    this.clearSearch(false);
    this.renderFeeds();
    this.renderBody();
    this.shadowRoot.querySelector('.chip[aria-pressed="true"]')?.focus();
  }

  render() {
    if (this.compact) return this.renderTile();
    this.renderChips();
    this.renderStatus();
    this.renderFeeds();
    this.renderBody();
  }

  topicList() {
    return [{ id: TOP, label: 'Top stories' }, ...(this.view?.topics || [])];
  }

  // The topic in use: one the data knows, else Top stories.
  current() {
    const t = this.topic;
    return this.topicList().find((x) => x.id === t) || this.topicList()[0];
  }

  renderChips() {
    const chips = this.shadowRoot.querySelector('.chips');
    if (!chips) return;
    const cur = this.current().id;
    chips.innerHTML = this.topicList().map((t) =>
      `<button class="chip" type="button" data-topic="${esc(t.id)}" aria-pressed="${t.id === cur}">${esc(t.label)}</button>`).join('');
    // Keep the picked topic in view when the chips scroll sideways (phones).
    const active = chips.querySelector('[aria-pressed="true"]');
    if (active) {
      const x = active.getBoundingClientRect().left - chips.getBoundingClientRect().left;
      if (x < 0 || x + active.offsetWidth > chips.clientWidth - 24) chips.scrollLeft += x - 16;
    }
  }

  renderStatus() {
    const el = this.shadowRoot.querySelector('.status');
    if (!el || !this.data) return;
    const failed = (this.data.feeds || []).filter((f) => !f.ok).length;
    el.innerHTML = `Updated ${esc(ago(this.data.updatedAt))}` +
      (this.compact && failed ? ` · <span class="warn">${failed} feed${failed > 1 ? 's' : ''} failed</span>` : '') +
      (this.offline ? ' · <span class="warn">offline snapshot</span>' : '');
  }

  // The outlets, with any that failed this time; picking one lists just its headlines.
  renderFeeds() {
    const details = this.shadowRoot.querySelector('.feeds');
    if (!details || !this.data) return;
    const feeds = this.data.feeds || [];
    const failed = feeds.filter((f) => !f.ok).length;
    details.hidden = !feeds.length;
    details.querySelector('summary').innerHTML = `<span>${feeds.length} sources</span>${failed ? `<span class="warn">· ${failed} failed</span>` : ''}${ICON.down}`;
    details.querySelector('.feed-list').innerHTML = feeds.map((f) =>
      `<button type="button" data-src="${esc(f.name)}" aria-pressed="${f.name === this.source}" class="${f.ok ? '' : 'bad'}"
        title="${esc(f.ok ? `${f.count} headlines` : `Did not load this time (${f.error || 'error'}). The other sources still update.`)}">${f.ok ? '' : ICON.warn}${esc(f.name)}</button>`).join('');
  }

  renderBody() {
    const body = this.shadowRoot.querySelector('.body');
    if (!body) return;
    body.removeAttribute('aria-busy');
    if (!this.view) {
      body.innerHTML = `<div class="card">${this.errorState()}</div>`;
      return;
    }
    if (this.query || this.source) {
      body.innerHTML = this.resultsPage();
      return;
    }
    const t = this.current();
    body.innerHTML = t.id === TOP ? this.homePage() : this.topicPage(t);
  }

  errorState() {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(this.api);
    return `<div class="state error"><span class="tile">${ICON.warn}</span><div>
      <b>Headlines could not load</b>
      <span>${local ? `The news helper at ${esc(this.api)} did not answer. Start it with <code>node server.mjs</code> in modules/news.` : 'The server did not answer. Try again in a moment.'}</span>
      <button class="retry" type="button">Try again</button></div></div>`;
  }

  labelOf(topic) {
    return (this.view.topics.find((t) => t.id === topic) || {}).label || topic || '';
  }

  // ---------- pages ----------

  homePage() {
    const { top, storyById, stories, topics } = this.view;
    const all = top.map((id) => storyById.get(id));
    const shown = this.more.has('top') ? all : all.slice(0, TOP_SHOWN);
    const used = new Set(shown.map((s) => s.id));
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const sections = topics.map((t) => {
      const list = stories.filter((s) => s.topic === t.id && !used.has(s.id)).slice(0, PER_SECTION);
      if (!list.length) return '';
      return `<section class="card topic-sec" aria-label="${esc(t.label)}">
        <header class="sec-h"><h3>${dot(t.id)}${esc(t.label)}</h3>
          <button class="more" type="button" data-topic="${esc(t.id)}">More ${esc(t.label)}${ICON.chevron}</button></header>
        <ol class="rows sections">${list.map((s) => this.storyRow(s)).join('')}</ol></section>`;
    }).join('');
    return `<div class="page">
      <div class="col">
        <section class="card" aria-labelledby="news-top">
          <header class="sec-h"><h3 id="news-top">Top stories</h3><span class="sec-sub">${esc(date)}</span></header>
          ${shown.length ? `<div class="stories">${shown.map((s, i) => this.storyBlock(s, { feature: i === 0, showTopic: true })).join('')}</div>` : this.emptyState('No stories yet', 'The feeds have not returned any headlines in the last two days.')}
          ${all.length > shown.length ? `<button class="show-more" type="button" data-more="top">More top stories${ICON.down}</button>` : ''}
        </section>
        ${sections}
      </div>
      ${this.latestCard(this.view.items, 'Latest')}
    </div>`;
  }

  topicPage(t) {
    const all = this.view.stories.filter((s) => s.topics.includes(t.id));
    const shown = this.more.has(t.id) ? all : all.slice(0, this.limit);
    const items = this.view.items.filter((i) => i.topic === t.id);
    return `<div class="page">
      <section class="card" aria-labelledby="news-topic">
        <header class="sec-h"><h3 id="news-topic">${dot(t.id)}${esc(t.label)}</h3>
          <span class="sec-sub">${all.length} ${all.length === 1 ? 'story' : 'stories'}</span></header>
        ${shown.length
          ? `<div class="stories">${shown.map((s, i) => this.storyBlock(s, { feature: i === 0 })).join('')}</div>`
          : this.emptyState(`No ${esc(t.label)} stories right now`, 'Nothing from the last two days. Check back later or see the top stories.', true)}
        ${all.length > shown.length ? `<button class="show-more" type="button" data-more="${esc(t.id)}">Show ${all.length - shown.length} more${ICON.down}</button>` : ''}
      </section>
      ${items.length ? this.latestCard(items, `Latest in ${t.label}`) : ''}
    </div>`;
  }

  resultsPage() {
    const q = this.query;
    const list = this.view.items
      .filter((i) => !this.source || i.source === this.source || i.via === this.source)
      .filter((i) => !q || `${i.title} ${i.summary || ''} ${i.source}`.toLowerCase().includes(q));
    const what = q ? `“${esc(q)}”` : esc(this.source);
    const head = q
      ? `${list.length} ${list.length === 1 ? 'headline matches' : 'headlines match'} ${what}${this.source ? ` from ${esc(this.source)}` : ''}`
      : `${list.length} ${list.length === 1 ? 'headline' : 'headlines'} from ${what}`;
    return `<section class="card results" aria-labelledby="news-results">
      <header class="sec-h"><h3 id="news-results">${head}</h3><button class="more clear" type="button">Clear</button></header>
      ${list.length
        ? `<ol class="rows">${list.slice(0, 100).map((i) => this.itemRow(i, { summary: true, topic: true })).join('')}</ol>`
        : `<div class="state"><span class="tile">${ICON.news}</span><div><b>No headlines match</b><span>Try a different search, or clear it to see everything.</span></div></div>`}
    </section>`;
  }

  emptyState(title, text, back = false) {
    return `<div class="state"><span class="tile">${ICON.news}</span><div><b>${title}</b><span>${text}</span>
      ${back ? `<button class="retry" type="button" data-topic="${TOP}">See top stories</button>` : ''}</div></div>`;
  }

  latestCard(items, title) {
    const newest = [...items].sort((a, b) => (b.published ? Date.parse(b.published) : 0) - (a.published ? Date.parse(a.published) : 0)).slice(0, LATEST);
    return `<aside class="card latest" aria-label="${esc(title)}">
      <header class="sec-h"><h3>${esc(title)}</h3></header>
      <ol class="rows">${newest.map((i) => this.itemRow(i, { thumb: false })).join('')}</ol></aside>`;
  }

  // ---------- pieces ----------

  storyBlock(s, { feature = false, showTopic = false } = {}) {
    const { byId } = this.view;
    const lead = byId.get(s.lead);
    const related = s.related.map((id) => byId.get(id));
    const relShown = related.slice(0, feature ? 3 : 2);
    const img = safeUrl(lead.image);
    const open = this.open.has(s.id);
    const newestFirst = [...related].sort((a, b) => (b.published ? Date.parse(b.published) : 0) - (a.published ? Date.parse(a.published) : 0));
    const covLabel = `Full coverage · ${s.sources > 1 ? `${s.sources} sources` : `${related.length + 1} articles`}`;
    // Phones show two related headlines, so a feature story with three needs the button there only.
    const cov = related.length > relShown.length ? 'cov' : feature && related.length > 2 ? 'cov narrow-only' : '';
    const relItem = (r) => `<li>${source(r.source)}${link(r, '', esc(r.title))}<div class="meta">${time(r.published)}</div></li>`;
    return `<article class="story${feature ? ' feature' : ''}${img ? '' : ' no-img'}" data-story="${esc(s.id)}">
      <div class="s-main">
        <div class="byline">${source(lead.source)}${showTopic && s.topic ? `<span class="tag">${dot(s.topic)}${esc(this.labelOf(s.topic))}</span>` : ''}</div>
        <h4 class="hl">${link(lead, '', esc(lead.title))}</h4>
        ${feature && lead.summary ? `<p class="sum">${esc(lead.summary)}</p>` : ''}
        <div class="meta">${time(lead.published)}</div>
      </div>
      ${img ? `<a class="thumb" href="${esc(safeUrl(lead.link) || '#')}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
      ${relShown.length ? `<ul class="rel"${open ? ' hidden' : ''}>${relShown.map(relItem).join('')}</ul>` : ''}
      ${cov ? `<button class="${cov}" type="button" aria-expanded="${open}" aria-controls="cov-${esc(s.id)}" data-label="${esc(covLabel)}">${ICON.layers}<span class="cov-label">${open ? 'Hide full coverage' : esc(covLabel)}</span></button>
        <ol class="all" id="cov-${esc(s.id)}"${open ? '' : ' hidden'}>${newestFirst.map(relItem).join('')}</ol>` : ''}
    </article>`;
  }

  // A story as one line: its lead headline, how many outlets cover it, and a small picture.
  storyRow(s) {
    const lead = this.view.byId.get(s.lead);
    return this.itemRow(lead, { sources: s.sources });
  }

  itemRow(i, { sources = 0, summary = false, topic = false, thumb = true } = {}) {
    const img = thumb && safeUrl(i.image);
    return `<li class="row"><div class="r-main">
        <div class="byline">${source(i.source)}${topic && i.topic ? `<span class="tag">${dot(i.topic)}${esc(this.labelOf(i.topic))}</span>` : ''}</div>
        ${link(i, 'r-title', esc(i.title))}
        ${summary && i.summary ? `<p class="sum">${esc(i.summary)}</p>` : ''}
        <div class="meta">${time(i.published)}${sources > 1 ? `<span>${sources} sources</span>` : ''}</div></div>
      ${img ? `<a class="thumb" href="${esc(safeUrl(i.link) || '#')}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>` : ''}
    </li>`;
  }

  // Compact tile: the top stories as a plain list.
  renderTile() {
    const list = this.shadowRoot.querySelector('.body');
    if (!list) return;
    list.removeAttribute('aria-busy');
    this.renderStatus();
    if (!this.view) {
      list.innerHTML = `<li>${this.errorState()}</li>`;
      return;
    }
    const { top, storyById, stories } = this.view;
    const ordered = [...top.map((id) => storyById.get(id)), ...stories.filter((s) => !top.includes(s.id))].slice(0, this.limit);
    list.innerHTML = ordered.map((s) => this.itemRow(this.view.byId.get(s.lead), { sources: s.sources, thumb: false })).join('');
  }
}

if (!customElements.get('news-panel')) customElements.define('news-panel', NewsPanel);

export function mount(target, { api, topic, category, limit, compact } = {}) {
  const el = document.createElement('news-panel');
  if (api) el.setAttribute('api', api);
  if (topic || category) el.setAttribute('topic', topic || category);
  if (limit) el.setAttribute('limit', String(limit));
  if (compact) el.setAttribute('compact', '');
  target.replaceChildren(el);
  return el;
}

export default NewsPanel;
