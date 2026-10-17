// <news-panel> web component: a self-contained headlines panel for the Personal Dashboard.
//
// Usage in any page or dashboard shell:
//   <script type="module" src="modules/news/news-panel.js"></script>
//   <news-panel api="http://localhost:8787" category="all" limit="60"></news-panel>
//
// or programmatically:
//   import { mount } from './modules/news/news-panel.js';
//   mount(document.querySelector('#news'), { api: 'http://localhost:8787' });
//
// Attributes
//   api       base URL of server.mjs (default: http://localhost:8787)
//   category  initial tab: all | world | portugal (default: all)
//   limit     max headlines shown (default: 60)
//   compact   present = hide summaries and images (for small dashboard tiles)
//
// If the server is unreachable the panel falls back to the last snapshot at data/news.json
// next to this script (written by `node server.mjs --once`).
// Styles read the dashboard's design tokens (css/tokens.css), so a page that hosts the panel links that file.
// A shell that names the panel itself can hide its title with --news-title-display: none.

const SNAPSHOT_URL = new URL('./data/news.json', import.meta.url).href;

// Lucide icons (lucide.dev)
const ICON = {
  refresh: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  search: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
  news: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18h-5"/><path d="M18 14h-8"/><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="10" y="6" rx="1"/></svg>',
};
const SKELETON = '<li class="skel" aria-hidden="true"><span></span><span></span></li>'.repeat(6);

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

const CSS = `
:host { display:block; height:100%; color:var(--text-1); font:var(--fw-regular) var(--fs-14)/var(--lh-body) var(--font-sans); }
* { box-sizing:border-box; }
.wrap { display:flex; flex-direction:column; height:100%; background:var(--surface-1); color:var(--text-1);
  border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
.ic { width:var(--icon); height:var(--icon); flex:none; fill:none; stroke:currentColor; stroke-width:var(--icon-stroke); stroke-linecap:round; stroke-linejoin:round; }
.ic * { vector-effect:non-scaling-stroke; }
header { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-3); padding:var(--space-3) var(--space-3) var(--space-3) var(--space-4); }
h2 { margin:0; font-size:var(--fs-16); font-weight:var(--fw-semibold); letter-spacing:var(--tracking-tight); display:var(--news-title-display, block); }
button { font:inherit; color:inherit; cursor:pointer; }
button:focus-visible, input:focus-visible, a:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
.tabs { display:inline-flex; gap:2px; padding:2px; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-sm); }
.tabs button { height:26px; padding:0 10px; border:1px solid transparent; border-radius:var(--radius-xs); background:transparent;
  font-size:var(--fs-13); font-weight:var(--fw-medium); color:var(--text-2); transition:background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
.tabs button:hover { color:var(--text-1); }
.tabs button[aria-pressed="true"] { background:var(--surface-4); border-color:var(--border-strong); color:var(--text-1); }
.refresh { margin-left:auto; width:var(--control-h); height:var(--control-h); display:inline-grid; place-items:center; padding:0;
  border:0; border-radius:var(--radius-sm); background:transparent; color:var(--text-3); transition:background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
.refresh:hover { background:var(--surface-3); color:var(--text-1); }
.refresh:disabled { opacity:.5; cursor:default; background:transparent; }
.bar { display:flex; gap:var(--space-3); align-items:center; padding:0 var(--space-4) var(--space-3); color:var(--text-3); font-size:var(--fs-12); flex-wrap:wrap; }
.search { flex:1; min-width:160px; display:flex; align-items:center; gap:var(--space-2); height:var(--control-h); padding:0 10px;
  background:var(--input-bg); border:1px solid var(--border-strong); border-radius:var(--radius-sm); color:var(--text-3);
  transition:border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out); }
.search:hover { border-color:var(--border-hover); }
.search:focus-within { border-color:var(--focus); box-shadow:0 0 0 3px var(--focus-soft); }
.search input { flex:1; min-width:0; height:100%; border:0; padding:0; background:transparent; color:var(--text-1); font:inherit; font-size:var(--fs-13); outline:none; }
.search input::placeholder { color:var(--text-3); }
.status { font-variant-numeric:tabular-nums; }
.sources { display:flex; gap:6px; flex-wrap:wrap; padding:0 var(--space-4) var(--space-3); }
.sources:empty { display:none; }
.sources button { display:inline-flex; align-items:center; gap:4px; height:24px; padding:0 8px; font-size:var(--fs-12); font-weight:var(--fw-medium);
  color:var(--text-2); background:transparent; border:1px solid var(--border-strong); border-radius:var(--radius-sm);
  transition:background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
.sources button:hover { color:var(--text-1); background:var(--surface-2); }
.sources button[aria-pressed="true"] { color:var(--text-1); background:var(--surface-3); border-color:var(--border-hover); }
.sources button.bad { color:var(--warning); }
.sources .ic { width:12px; height:12px; }
ul { list-style:none; margin:0; padding:0; overflow:auto; flex:1; border-top:1px solid var(--border); }
li { display:flex; gap:var(--space-3); padding:var(--space-3) var(--space-4); border-top:1px solid var(--border); transition:background-color var(--dur-fast) var(--ease-out); }
li:first-child { border-top:0; }
li:not(.state):not(.skel):hover { background:var(--surface-2); }
li img { width:72px; height:54px; object-fit:cover; border-radius:var(--radius-sm); flex:none; background:var(--surface-2); }
a { color:var(--text-1); text-decoration:none; font-weight:var(--fw-medium); border-radius:var(--radius-xs); }
a:hover { text-decoration:underline; text-decoration-color:var(--text-3); text-underline-offset:2px; }
.meta { color:var(--text-3); font-size:var(--fs-12); margin-top:2px; }
.meta b { font-weight:var(--fw-medium); color:var(--text-2); }
p { margin:4px 0 0; color:var(--text-2); font-size:var(--fs-13); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.warn { color:var(--warning); }
.skel { display:grid; gap:8px; }
.skel span { display:block; height:12px; border-radius:var(--radius-xs); background:var(--surface-2); }
.skel span:first-child { width:70%; height:14px; } .skel span:last-child { width:22%; }
li.skel:nth-child(even) span:first-child { width:56%; }
.state { display:flex; gap:var(--space-3); align-items:flex-start; padding:var(--space-5) var(--space-4); }
.state .tile { width:32px; height:32px; flex:none; display:grid; place-items:center; border-radius:var(--radius-sm); background:var(--surface-2); border:1px solid var(--border); color:var(--text-2); }
.state.error .tile { color:var(--danger); }
.state b { display:block; font-weight:var(--fw-medium); }
.state span { display:block; color:var(--text-2); font-size:var(--fs-13); margin-top:2px; }
.state code { font:var(--fs-12) var(--font-mono); color:var(--text-1); background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-xs); padding:1px 5px; }
.retry { margin-top:var(--space-3); height:var(--control-h-sm); padding:0 10px; font-size:var(--fs-12); font-weight:var(--fw-medium);
  background:var(--surface-2); border:1px solid var(--border-strong); border-radius:var(--radius-sm); }
.retry:hover { background:var(--surface-3); border-color:var(--border-hover); }
:host([compact]) li img, :host([compact]) p { display:none; }
@media (pointer: coarse) { .search input { font-size:var(--fs-16); } }
@media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
`;

class NewsPanel extends HTMLElement {
  static observedAttributes = ['api', 'category', 'limit'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = null;
    this.source = null;   // selected source filter
    this.query = '';
    this.offline = false;
  }

  get api() { return (this.getAttribute('api') || 'http://localhost:8787').replace(/\/$/, ''); }
  get category() { return this.getAttribute('category') || 'all'; }
  get limit() { return Number(this.getAttribute('limit')) || 60; }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="wrap" part="panel">
      <header><h2>News</h2><div class="tabs" role="group" aria-label="Category"></div>
        <button class="refresh" title="Refresh now" aria-label="Refresh now">${ICON.refresh}</button></header>
      <div class="bar"><label class="search">${ICON.search}<input type="search" placeholder="Search headlines" aria-label="Search headlines"></label><span class="status"></span></div>
      <div class="sources" role="group" aria-label="Sources"></div>
      <ul aria-live="polite" aria-busy="true">${SKELETON}</ul></div>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    $('.refresh').onclick = () => this.load(true);
    $('input').oninput = (e) => { this.query = e.target.value.trim().toLowerCase(); this.renderList(); };
    this.load();
    this.tick = setInterval(() => this.renderStatus(), 60e3);
  }

  disconnectedCallback() { clearInterval(this.tick); clearTimeout(this.poll); }

  attributeChangedCallback() { if (this.data) this.render(); }

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
    if (btn) btn.disabled = false;
    this.render();
    const minutes = this.data?.refreshMinutes ?? 15;
    this.poll = setTimeout(() => this.load(), minutes * 60e3);
    this.dispatchEvent(new CustomEvent('news-updated', { detail: this.data, bubbles: true, composed: true }));
  }

  setCategory(c) { this.setAttribute('category', c); this.source = null; }

  render() {
    const root = this.shadowRoot;
    root.querySelector('ul').removeAttribute('aria-busy');
    if (!this.data) {
      const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(this.api);
      root.querySelector('ul').innerHTML = `<li class="state error"><span class="tile">${ICON.warn}</span><div>
        <b>Headlines could not load</b>
        <span>${local ? `The news helper at ${esc(this.api)} did not answer. Start it with <code>node server.mjs</code> in modules/news.` : 'The server did not answer. Try again in a moment.'}</span>
        <button class="retry" type="button">Try again</button></div></li>`;
      root.querySelector('.retry').onclick = () => this.load();
      return;
    }
    const cats = [{ id: 'all', label: 'All' }, ...(this.data.categories || [])];
    root.querySelector('.tabs').innerHTML = cats.map((c) =>
      `<button data-cat="${esc(c.id)}" aria-pressed="${c.id === this.category}">${esc(c.label)}</button>`).join('');
    root.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => this.setCategory(b.dataset.cat)));

    const feeds = (this.data.feeds || []).filter((f) => this.category === 'all' || f.category === this.category);
    root.querySelector('.sources').innerHTML = feeds.map((f) =>
      `<button data-src="${esc(f.name)}" aria-pressed="${f.name === this.source}" class="${f.ok ? '' : 'bad'}"
        title="${esc(f.ok ? `${f.count} headlines` : 'This feed did not load this time. The other sources still update.')}">${f.ok ? '' : ICON.warn}${esc(f.name)}</button>`).join('');
    root.querySelectorAll('.sources button').forEach((b) => (b.onclick = () => {
      this.source = this.source === b.dataset.src ? null : b.dataset.src;
      this.render();
    }));
    this.renderStatus();
    this.renderList();
  }

  renderStatus() {
    const el = this.shadowRoot.querySelector('.status');
    if (!el || !this.data) return;
    const failed = (this.data.feeds || []).filter((f) => !f.ok).length;
    el.innerHTML = `Updated ${esc(ago(this.data.updatedAt))}` +
      (failed ? ` · <span class="warn">${failed} feed${failed > 1 ? 's' : ''} failed</span>` : '') +
      (this.offline ? ' · <span class="warn">offline snapshot</span>' : '');
  }

  renderList() {
    if (!this.data) return;
    const q = this.query;
    const items = this.data.items
      .filter((i) => this.category === 'all' || i.category === this.category)
      .filter((i) => !this.source || i.source === this.source)
      .filter((i) => !q || `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(q))
      .slice(0, this.limit);
    this.shadowRoot.querySelector('ul').innerHTML = items.length ? items.map((i) => `<li>
        ${safeUrl(i.image) ? `<img src="${esc(safeUrl(i.image))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div><a href="${esc(safeUrl(i.link) || '#')}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>
          <div class="meta"><b>${esc(i.source)}</b>${i.published ? ` · <time datetime="${esc(i.published)}">${esc(ago(i.published))}</time>` : ''}</div>
          ${i.summary ? `<p>${esc(i.summary)}</p>` : ''}</div></li>`).join('')
      : `<li class="state"><span class="tile">${ICON.news}</span><div><b>No headlines match</b><span>${q ? 'Try a different search, or clear it to see everything.' : 'Pick another category or source.'}</span>
          <button class="retry clear" type="button">Clear filters</button></div></li>`;
    const clear = this.shadowRoot.querySelector('.clear');
    if (clear) clear.onclick = () => this.clearFilters();
  }

  // Back to every headline: no search, no source, the All category. Focus lands on the search box.
  clearFilters() {
    const input = this.shadowRoot.querySelector('input');
    this.query = '';
    input.value = '';
    this.source = null;
    if (this.category !== 'all') this.setAttribute('category', 'all');
    else this.render();
    input.focus();
  }
}

if (!customElements.get('news-panel')) customElements.define('news-panel', NewsPanel);

export function mount(target, { api, category, limit, compact } = {}) {
  const el = document.createElement('news-panel');
  if (api) el.setAttribute('api', api);
  if (category) el.setAttribute('category', category);
  if (limit) el.setAttribute('limit', String(limit));
  if (compact) el.setAttribute('compact', '');
  target.replaceChildren(el);
  return el;
}

export default NewsPanel;
