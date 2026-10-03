// Uni panel: today's classes, upcoming deadlines and exams, the week ahead, fees.
// Framework-free. Mount it anywhere:
//
//   import { mountUniPanel } from "./modules/uni/panel.js";
//   mountUniPanel(document.querySelector("#uni"), { dataUrl: "./modules/uni/data/uni.json" });
//
// or pass the data directly: mountUniPanel(el, { data }).
// With a plain <script src="data/uni.js">, window.UNI_DATA is used when no option is given.
// Theme it from the host page with --uni-* CSS variables (see STYLE below).

const STYLE = `
.uni-panel{--_bg:var(--uni-bg,var(--panel-bg,#fff));--_fg:var(--uni-fg,var(--text,#1b1d21));
  --_muted:var(--uni-muted,var(--text-muted,#6b7280));--_line:var(--uni-line,var(--border,#e5e7eb));
  --_accent:var(--uni-accent,var(--accent,#2563eb));--_warn:var(--uni-warn,#b45309);--_bad:var(--uni-bad,#b91c1c);
  --_chip:var(--uni-chip,rgba(37,99,235,.10));
  background:var(--_bg);color:var(--_fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  border:1px solid var(--_line);border-radius:12px;padding:16px;display:grid;gap:16px;min-width:0}
@media (prefers-color-scheme:dark){.uni-panel:not([data-theme=light]){--_bg:var(--uni-bg,var(--panel-bg,#16181d));
  --_fg:var(--uni-fg,var(--text,#e8e9ec));--_muted:var(--uni-muted,var(--text-muted,#9aa0aa));
  --_line:var(--uni-line,var(--border,#2a2e36));--_accent:var(--uni-accent,var(--accent,#7aa2ff));
  --_warn:var(--uni-warn,#f0b45a);--_bad:var(--uni-bad,#f27a7a);--_chip:var(--uni-chip,rgba(122,162,255,.14))}}
.uni-panel h3{margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--_muted);font-weight:600}
.uni-panel header{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
.uni-panel header strong{font-size:16px}
.uni-panel .uni-meta{font-size:12px;color:var(--_muted)}
.uni-panel ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.uni-panel li{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 10px;
  border:1px solid var(--_line);border-radius:8px;min-width:0}
.uni-panel li.now{border-color:var(--_accent);box-shadow:inset 3px 0 0 var(--_accent)}
.uni-panel li.past{opacity:.55}
.uni-panel .t{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.uni-panel .what{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .what small{color:var(--_muted);margin-left:6px}
.uni-panel .what.wrap{white-space:normal}.uni-panel .what.wrap small{display:block;margin-left:0}
.uni-panel .chip{font-size:11px;padding:2px 6px;border-radius:999px;background:var(--_chip);color:var(--_accent);white-space:nowrap}
.uni-panel .soon .t{color:var(--_warn)} .uni-panel .late .t{color:var(--_bad)}
.uni-panel a{color:inherit;text-decoration:none} .uni-panel a:hover{text-decoration:underline}
.uni-panel .empty{color:var(--_muted);font-style:italic;padding:4px 0}
.uni-panel .day{margin-top:10px;font-weight:600;font-size:13px}
.uni-panel .err{font-size:12px;color:var(--_bad)}
.uni-panel .warn{font-size:12px;color:var(--_warn)}
.uni-panel .money{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px}
.uni-panel .money b{font-variant-numeric:tabular-nums}
.uni-panel .unpaid{margin-top:8px}
.uni-panel details summary{cursor:pointer;color:var(--_muted);font-size:12px}
`;

const fmtTime = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function relDue(due, now) {
  const h = (due - now) / 36e5;
  if (h < 0) return "overdue";
  if (h < 24) return `in ${Math.max(1, Math.round(h))}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "tomorrow" : `in ${d} days`;
}

function classRow(c, now) {
  const s = new Date(c.start), e = new Date(c.end);
  const cls = now >= s && now < e ? "now" : e <= now ? "past" : "";
  const sub = [c.room, c.teacher].filter(Boolean).join(" · ");
  return `<li class="${cls}"><span class="t">${fmtTime(s)}–${fmtTime(e)}</span>
    <span class="what">${esc(c.course)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    ${c.type ? `<span class="chip">${esc(c.type)}</span>` : "<span></span>"}</li>`;
}

const SEASONS = { MT: "Mini-test", EN: "Normal season", ER: "Resit season", EC: "Completion season", EE: "Special season", EAE: "Special season" };

function examRow(x, now) {
  const s = new Date(x.start), e = new Date(x.end);
  const h = (s - now) / 36e5;
  const cls = h < 48 ? "soon" : "";
  const when = x.all_day ? fmtDay(s) : `${fmtDay(s)} ${fmtTime(s)}–${fmtTime(e)}`;
  const sub = [when, (x.rooms || []).join(", "), SEASONS[x.season] || x.season_name].filter(Boolean).join(" · ");
  return `<li class="${cls}"><span class="t">${now >= s ? "now" : relDue(x.all_day ? new Date(Math.max(+s, +now)) : s, now)}</span>
    <span class="what wrap">${esc(x.course_name || x.course)}<small>${esc(sub)}</small></span>
    ${x.course ? `<span class="chip">${esc(x.course)}</span>` : "<span></span>"}</li>`;
}

function moneyLine(f, now) {
  const fees = f && f.fees;
  const parts = [];
  if (fees && fees.balance) parts.push(`<span>Fees balance <b>${esc(fees.balance)}</b></span>`);
  if (fees && fees.next_due) parts.push(`<span>Next payment <b>${esc(fmtDay(new Date(fees.next_due + "T12:00")))}</b></span>`);
  if (f && f.print_balance) parts.push(`<span>Printing <b>${esc(f.print_balance)}</b></span>`);
  const unpaid = (fees && fees.unpaid) || [];
  const rows = unpaid.slice(0, 3).map((u) => {
    const due = u.deadline ? new Date(u.deadline + "T23:59") : null;
    const cls = due && due < now ? "late" : due && due - now < 7 * 864e5 ? "soon" : "";
    const amount = u.amount_due != null ? u.amount_due.toLocaleString([], { style: "currency", currency: "EUR" }) : "";
    return `<li class="${cls}"><span class="t">${esc(amount)}</span>
      <span class="what wrap">${esc(u.description)}${due ? `<small>due ${esc(fmtDay(due))}</small>` : ""}</span><span></span></li>`;
  });
  if (!parts.length && !rows.length) return "";
  return `<section><h3>Fees and printing</h3>${parts.length ? `<div class="money">${parts.join("")}</div>` : ""}
    ${rows.length ? `<ul class="unpaid">${rows.join("")}</ul>` : ""}</section>`;
}

function deadlineRow(d, now) {
  const due = new Date(d.due);
  const h = (due - now) / 36e5;
  const cls = h < 0 ? "late" : h < 48 ? "soon" : "";
  const title = d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>` : esc(d.title);
  return `<li class="${cls}"><span class="t">${relDue(due, now)}</span>
    <span class="what wrap">${title}<small>${esc(fmtDay(due))} ${fmtTime(due)}</small></span>
    ${d.course ? `<span class="chip">${esc(d.course)}</span>` : "<span></span>"}</li>`;
}

export function renderUni(data, { now = new Date(), deadlineDays = 14, weekDays = 7, examLimit = 6 } = {}) {
  const classes = (data.classes || []).map((c) => ({ ...c, _s: new Date(c.start) }));
  const today = classes.filter((c) => sameDay(c._s, now));
  const tomorrow0 = new Date(now); tomorrow0.setHours(24, 0, 0, 0);
  const weekEnd = new Date(tomorrow0.getTime() + (weekDays - 1) * 864e5);
  const upcoming = classes.filter((c) => c._s >= tomorrow0 && c._s < weekEnd);

  const horizon = new Date(now.getTime() + deadlineDays * 864e5);
  const recentCutoff = new Date(now.getTime() - 2 * 864e5); // keep just-missed items visible
  const deadlines = (data.deadlines || []).filter((d) => {
    const due = new Date(d.due);
    return due >= recentCutoff && due <= horizon;
  });

  const exams = (data.exams || []).filter((x) => new Date(x.end) > now).slice(0, examLimit);
  const p = data.profile;
  const prog = p && p.programmes && p.programmes[0];
  const who = p ? [p.name, prog && prog.acronym, prog && prog.year && `year ${prog.year}`, (p.faculties || []).join(", ").toUpperCase()].filter(Boolean).join(" · ") : "";

  const byDay = new Map();
  for (const c of upcoming) {
    const k = c._s.toDateString();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(c);
  }

  const sources = Object.entries(data.sources || {});
  const errors = sources.filter(([, s]) => !s.ok);
  const warnings = sources.filter(([, s]) => s.ok && s.warnings && s.warnings.length);
  const synced = data.generated_at ? new Date(data.generated_at) : null;

  return `
    <header><strong>Uni</strong>
      <span class="uni-meta">${synced ? `synced ${esc(fmtDay(synced))} ${fmtTime(synced)}` : "not synced yet"}
      ${sources.length ? ` · ${sources.map(([n]) => esc(n)).join(", ")}` : ""}</span></header>
    ${who ? `<div class="uni-meta">${esc(who)}</div>` : ""}
    ${errors.map(([n, s]) => `<div class="err">${esc(n)}: ${esc(s.error)}${s.synced_at ? " (showing last good data)" : ""}</div>`).join("")}
    ${warnings.map(([n, s]) => `<div class="warn">${esc(n)}, not refreshed this time: ${esc(s.warnings.join("; "))} (showing last good data)</div>`).join("")}
    <section><h3>Today</h3>
      ${today.length ? `<ul>${today.map((c) => classRow(c, now)).join("")}</ul>` : `<div class="empty">No classes today.</div>`}
    </section>
    <section><h3>Deadlines · next ${deadlineDays} days</h3>
      ${deadlines.length ? `<ul>${deadlines.map((d) => deadlineRow(d, now)).join("")}</ul>` : `<div class="empty">Nothing due.</div>`}
    </section>
    ${exams.length ? `<section><h3>Exams</h3><ul>${exams.map((x) => examRow(x, now)).join("")}</ul></section>` : ""}
    <section><details><summary>This week (${upcoming.length} ${upcoming.length === 1 ? "class" : "classes"})</summary>
      ${[...byDay.values()].map((list) => `<div class="day">${esc(fmtDay(list[0]._s))}</div>
        <ul>${list.map((c) => classRow(c, now)).join("")}</ul>`).join("") || `<div class="empty">No more classes this week.</div>`}
    </details></section>
    ${moneyLine(data.finance, now)}`;
}

export async function mountUniPanel(el, opts = {}) {
  if (!document.getElementById("uni-panel-style")) {
    const st = document.createElement("style");
    st.id = "uni-panel-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  el.classList.add("uni-panel");
  let data = opts.data || null;
  const load = async () => {
    if (opts.data) return opts.data;
    if (opts.dataUrl) {
      const r = await fetch(opts.dataUrl + (opts.dataUrl.includes("?") ? "&" : "?") + "t=" + Date.now());
      if (!r.ok) throw new Error(`could not load ${opts.dataUrl} (${r.status})`);
      return r.json();
    }
    if (window.UNI_DATA) return window.UNI_DATA;
    throw new Error("no uni data; run sync_uni.py first");
  };
  const draw = () => { el.innerHTML = renderUni(data, opts); };
  try {
    data = await load();
    draw();
  } catch (e) {
    el.innerHTML = `<header><strong>Uni</strong></header><div class="err">${esc(e.message)}</div>`;
  }
  // Re-render every minute so the "now" highlight and countdowns move; reload data every 15 min.
  let ticks = 0;
  const timer = setInterval(async () => {
    ticks++;
    if (ticks % 15 === 0) { try { data = await load(); } catch {} }
    if (data) draw();
  }, 60_000);
  return { refresh: async () => { data = await load(); draw(); }, destroy: () => clearInterval(timer) };
}

if (typeof window !== "undefined") window.mountUniPanel = mountUniPanel;
