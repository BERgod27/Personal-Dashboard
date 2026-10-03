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
// Theme: honours --dash-bg, --dash-fg, --dash-muted, --dash-accent, --dash-border, --dash-radius if the shell sets them.

const SNAPSHOT_URL = new URL('./data/news.json', import.meta.url).href;

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
:host { display:block; height:100%; font: 14px/1.45 var(--dash-font, system-ui, -apple-system, "Segoe UI", sans-serif);
  --bg: var(--dash-bg, #ffffff); --fg: var(--dash-fg, #1b1d21); --muted: var(--dash-muted, #6b7079);
  --accent: var(--dash-accent, #2f6fde); --border: var(--dash-border, #e3e5e9); --radius: var(--dash-radius, 12px);
  --chip: color-mix(in srgb, var(--fg) 6%, transparent); --bad: #c0392b; }
@media (prefers-color-scheme: dark) { :host { --bg: var(--dash-bg, #17191d); --fg: var(--dash-fg, #e8eaed);
  --muted: var(--dash-muted, #9aa0a8); --accent: var(--dash-accent, #7aa7ff); --border: var(--dash-border, #2c3036); --bad: #ff7b6b; } }
.wrap { display:flex; flex-direction:column; height:100%; background:var(--bg); color:var(--fg);
  border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
header { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:12px 14px 8px; }
h2 { margin:0; font-size:16px; font-weight:650; margin-right:auto; }
h2 { display:var(--dash-title-display, block); }
.tabs { margin-right:var(--dash-tabs-push, 0); }
.tabs { display:flex; gap:4px; }
button { font:inherit; color:inherit; background:var(--chip); border:0; border-radius:999px; padding:4px 10px; cursor:pointer; }
button[aria-pressed="true"] { background:var(--accent); color:var(--dash-accent-ink, #fff); }
button:focus-visible, input:focus-visible, a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.bar { display:flex; gap:8px; align-items:center; padding:0 14px 8px; color:var(--muted); font-size:12px; flex-wrap:wrap; }
.bar input { flex:1; min-width:120px; font:inherit; font-size:13px; color:var(--fg); background:var(--chip);
  border:0; border-radius:8px; padding:6px 10px; }
.sources { display:flex; gap:4px; flex-wrap:wrap; padding:0 14px 8px; }
.sources button { font-size:12px; padding:2px 8px; }
.sources button.bad { color:var(--bad); }
ul { list-style:none; margin:0; padding:0 14px 12px; overflow:auto; flex:1; }
li { display:flex; gap:10px; padding:10px 0; border-top:1px solid var(--border); }
li:first-child { border-top:0; }
li img { width:72px; height:54px; object-fit:cover; border-radius:6px; flex:none; background:var(--chip); }
a { color:inherit; text-decoration:none; font-weight:560; }
a:hover { color:var(--accent); text-decoration:underline; }
.meta { color:var(--muted); font-size:12px; margin-top:2px; }
.meta b { font-weight:600; color:var(--fg); opacity:.8; }
p { margin:4px 0 0; color:var(--muted); font-size:13px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.empty { display:block; padding:24px 14px; color:var(--muted); text-align:center; }
.warn { color:var(--bad); }
:host([compact]) li img, :host([compact]) p { display:none; }
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
        <button class="refresh" title="Refresh now" aria-label="Refresh now">↻</button></header>
      <div class="bar"><input type="search" placeholder="Search headlines" aria-label="Search headlines"><span class="status"></span></div>
      <div class="sources" role="group" aria-label="Sources"></div>
      <ul aria-live="polite"><li class="empty">Loading headlines…</li></ul></div>`;
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
    if (!this.data) {
      root.querySelector('ul').innerHTML = `<li class="empty">Couldn't reach the news helper at ${esc(this.api)}.<br>Start it with <code>node server.mjs</code> in modules/news.</li>`;
      return;
    }
    const cats = [{ id: 'all', label: 'All' }, ...(this.data.categories || [])];
    root.querySelector('.tabs').innerHTML = cats.map((c) =>
      `<button data-cat="${esc(c.id)}" aria-pressed="${c.id === this.category}">${esc(c.label)}</button>`).join('');
    root.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => this.setCategory(b.dataset.cat)));

    const feeds = (this.data.feeds || []).filter((f) => this.category === 'all' || f.category === this.category);
    root.querySelector('.sources').innerHTML = feeds.map((f) =>
      `<button data-src="${esc(f.name)}" aria-pressed="${f.name === this.source}" class="${f.ok ? '' : 'bad'}"
        title="${esc(f.ok ? `${f.count} headlines` : `Failed: ${f.error}`)}">${esc(f.name)}${f.ok ? '' : ' ⚠'}</button>`).join('');
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
      : '<li class="empty">No headlines match.</li>';
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
