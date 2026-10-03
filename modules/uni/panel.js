// Uni panel, laid out like NIAEFEUP's uni app: a profile card, a week timetable with
// coloured class blocks (a day picker and lecture cards on phones), exams, Moodle deadlines,
// course units, and fees and printing as cards.
// Framework-free. Mount it anywhere:
//
//   import { mountUniPanel } from "./modules/uni/panel.js";
//   mountUniPanel(document.querySelector("#uni"), { dataUrl: "./modules/uni/data/uni.json" });
//
// or pass the data directly: mountUniPanel(el, { data }).
// With a plain <script src="data/uni.js">, window.UNI_DATA is used when no option is given.
// It reads the dashboard's tokens (--surface, --ink, --line, --uni, ...) and falls back to
// its own light/dark values when used on its own.

const STYLE = `
.uni-panel{--u-surface:var(--surface,#fff);--u-surface-2:var(--surface-2,#eff2f6);--u-ink:var(--ink,#0f1b2d);
  --u-ink-2:var(--ink-2,#34435a);--u-muted:var(--muted,#607089);--u-line:var(--line,#e1e6ed);
  --u-accent:var(--uni,#1e4fd6);--u-tint:var(--uni-bg,#e8eefc);--u-now:var(--now,#e5484d);
  --u-warn:var(--meal,#c9601a);--u-bad:var(--danger,#d1343b);--u-good:var(--workout,#0b8a5f);
  --u-r:var(--radius-lg,14px);--u-r-sm:var(--radius-sm,8px);--u-hour:52px;
  --cc0:#1e4fd6;--cc1:#0b7f86;--cc2:#2f8a3a;--cc3:#a8700d;--cc4:#c9601a;--cc5:#c2364b;--cc6:#a83672;--cc7:#6a4fd1;
  color:var(--u-ink);font:14px/1.45 var(--f-body,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
  display:grid;gap:20px;min-width:0;container-type:inline-size}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .uni-panel{--u-surface:var(--surface,#0f1929);
  --u-surface-2:var(--surface-2,#152238);--u-ink:var(--ink,#e7edf6);--u-ink-2:var(--ink-2,#b9c5d6);
  --u-muted:var(--muted,#8494ad);--u-line:var(--line,#1d2a40);--u-accent:var(--uni,#7096ff);
  --u-tint:var(--uni-bg,rgb(112 150 255/.14));--u-now:var(--now,#ff6369);--u-warn:var(--meal,#f29a57);
  --u-bad:var(--danger,#ff6b70);--u-good:var(--workout,#3ccb91);
  --cc0:#7096ff;--cc1:#4cc3c9;--cc2:#6ccf78;--cc3:#e5b754;--cc4:#f29a57;--cc5:#ff7a8c;--cc6:#e77bb4;--cc7:#a993ff}}
:root[data-theme=dark] .uni-panel{--cc0:#7096ff;--cc1:#4cc3c9;--cc2:#6ccf78;--cc3:#e5b754;--cc4:#f29a57;--cc5:#ff7a8c;--cc6:#e77bb4;--cc7:#a993ff}
.uni-panel *{box-sizing:border-box}
.uni-panel .cc-0{--cc:var(--cc0)}.uni-panel .cc-1{--cc:var(--cc1)}.uni-panel .cc-2{--cc:var(--cc2)}.uni-panel .cc-3{--cc:var(--cc3)}
.uni-panel .cc-4{--cc:var(--cc4)}.uni-panel .cc-5{--cc:var(--cc5)}.uni-panel .cc-6{--cc:var(--cc6)}.uni-panel .cc-7{--cc:var(--cc7)}
.uni-panel a{color:inherit;text-decoration:none}.uni-panel a:hover{text-decoration:underline}
.uni-panel button{font:inherit;color:inherit;cursor:pointer}
.uni-panel button:focus-visible{outline:2px solid var(--u-accent);outline-offset:2px}
.uni-panel h3{margin:0;font-size:15px;font-weight:650;letter-spacing:-.01em;color:var(--u-ink)}
.uni-panel .u-card{background:var(--u-surface);border:1px solid var(--u-line);border-radius:var(--u-r)}
.uni-panel .u-muted{color:var(--u-muted)}
.uni-panel .u-sec{display:grid;gap:12px;min-width:0}
.uni-panel .u-sec-head{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;min-height:32px}
.uni-panel .u-sec-head .u-muted{font-size:13px}
.uni-panel .u-empty{color:var(--u-muted);padding:18px 16px;text-align:center;font-size:13px}
.uni-panel .err,.uni-panel .warn{font-size:13px;padding:10px 14px;border-radius:var(--u-r-sm)}
.uni-panel .err{color:var(--u-bad);background:color-mix(in srgb,var(--u-bad) 10%,transparent)}
.uni-panel .warn{color:var(--u-ink-2);background:color-mix(in srgb,var(--u-warn) 12%,transparent)}

/* profile */
.uni-panel .u-profile{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px 16px;align-items:center;padding:18px;
  background:linear-gradient(135deg,color-mix(in srgb,var(--u-accent) 12%,var(--u-surface)),var(--u-surface) 70%)}
.uni-panel .u-avatar{width:60px;height:60px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:21px;
  color:#fff;background:linear-gradient(140deg,var(--u-accent),color-mix(in srgb,var(--u-accent) 55%,#0a1a3a));letter-spacing:.02em;
  box-shadow:0 0 0 4px var(--u-surface),0 0 0 5px color-mix(in srgb,var(--u-accent) 30%,transparent)}
.uni-panel .u-who{display:grid;gap:2px;min-width:0}
.uni-panel .u-name{font-size:19px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
.uni-panel .u-prog{color:var(--u-ink-2);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.uni-panel .u-tag{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--u-surface);
  border:1px solid var(--u-line);color:var(--u-ink-2);font-variant-numeric:tabular-nums}
.uni-panel .u-stats{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.uni-panel .u-stat{background:var(--u-surface);border:1px solid var(--u-line);border-radius:12px;padding:10px 12px;min-width:0}
.uni-panel .u-stat b{display:block;font-size:20px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.2;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-stat span{font-size:12px;color:var(--u-muted);display:block;line-height:1.3}
.uni-panel .u-synced{grid-column:1/-1;font-size:12px;color:var(--u-muted)}

/* timetable */
.uni-panel .u-range{font-size:13px;color:var(--u-muted);font-variant-numeric:tabular-nums}
.uni-panel .u-nav{margin-left:auto;display:inline-flex;gap:2px;padding:3px;border:1px solid var(--u-line);border-radius:12px;background:var(--u-surface)}
.uni-panel .u-nav button{border:0;background:transparent;height:30px;min-width:32px;padding:0 10px;border-radius:9px;font-size:13px;font-weight:500;color:var(--u-ink-2)}
.uni-panel .u-nav button:hover{background:var(--u-surface-2);color:var(--u-ink)}
.uni-panel .u-days{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px}
.uni-panel .u-day{border:1px solid var(--u-line);background:var(--u-surface);border-radius:12px;padding:7px 2px 6px;display:grid;justify-items:center;gap:1px;position:relative}
.uni-panel .u-day span{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--u-muted)}
.uni-panel .u-day b{font-size:17px;font-weight:650;font-variant-numeric:tabular-nums}
.uni-panel .u-day i{width:5px;height:5px;border-radius:50%;background:var(--u-accent);opacity:.8}
.uni-panel .u-day i.none{opacity:0}
.uni-panel .u-day.is-today b{color:var(--u-accent)}
.uni-panel .u-day[aria-selected=true]{background:var(--u-accent);border-color:var(--u-accent);color:#fff}
.uni-panel .u-day[aria-selected=true] span,.uni-panel .u-day[aria-selected=true] b{color:inherit}
.uni-panel .u-day[aria-selected=true] i{background:currentColor}
.uni-panel .u-daylist{display:grid;gap:8px}
.uni-panel .u-lec{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px 12px 12px;
  border-left:4px solid var(--cc);position:relative}
.uni-panel .u-lec.is-past{opacity:.55}
.uni-panel .u-lec.is-now{background:color-mix(in srgb,var(--cc) 9%,var(--u-surface));border-color:color-mix(in srgb,var(--cc) 40%,var(--u-line));border-left-color:var(--cc)}
.uni-panel .u-lec-time{display:grid;font-variant-numeric:tabular-nums;line-height:1.25}
.uni-panel .u-lec-time b{font-weight:650;font-size:15px}
.uni-panel .u-lec-time span{color:var(--u-muted);font-size:13px}
.uni-panel .u-lec-body{min-width:0;display:grid;gap:1px}
.uni-panel .u-lec-title{display:flex;align-items:center;gap:6px;min-width:0}
.uni-panel .u-lec-title b{font-size:15px;font-weight:650;color:var(--cc)}
.uni-panel .u-type{font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px;background:color-mix(in srgb,var(--cc) 14%,transparent);color:var(--cc)}
.uni-panel .u-live{font-size:11px;font-weight:700;color:var(--u-now);display:inline-flex;align-items:center;gap:4px}
.uni-panel .u-live::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.uni-panel .u-lec-name,.uni-panel .u-lec-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-lec-name{color:var(--u-ink-2);font-size:13px}
.uni-panel .u-lec-meta{color:var(--u-muted);font-size:12px}
.uni-panel .u-room{display:grid;justify-items:end;font-variant-numeric:tabular-nums}
.uni-panel .u-room b{font-size:15px;font-weight:650}
.uni-panel .u-room span{font-size:11px;color:var(--u-muted);text-transform:uppercase;letter-spacing:.04em}
.uni-panel .u-week{display:none;overflow:hidden}
.uni-panel .u-wk-head,.uni-panel .u-wk-body{display:grid;grid-template-columns:48px repeat(var(--cols),minmax(0,1fr))}
.uni-panel .u-wk-head{border-bottom:1px solid var(--u-line)}
.uni-panel .u-wk-head div{padding:10px 8px;display:flex;align-items:baseline;gap:6px;font-size:13px;color:var(--u-muted);border-left:1px solid var(--u-line)}
.uni-panel .u-wk-head div:first-child{border-left:0}
.uni-panel .u-wk-head b{font-size:16px;color:var(--u-ink);font-weight:650;font-variant-numeric:tabular-nums}
.uni-panel .u-wk-head .is-today{color:var(--u-accent)}
.uni-panel .u-wk-head .is-today b{color:#fff;background:var(--u-accent);border-radius:999px;padding:0 7px}
.uni-panel .u-wk-hours{position:relative;height:calc(var(--u-hour)*var(--rows))}
.uni-panel .u-wk-hours span{position:absolute;right:8px;transform:translateY(-50%);font-size:11px;color:var(--u-muted);font-variant-numeric:tabular-nums}
.uni-panel .u-wk-hours span:first-child{transform:none;top:4px!important}
.uni-panel .u-wk-col{position:relative;border-left:1px solid var(--u-line);height:calc(var(--u-hour)*var(--rows));
  background:repeating-linear-gradient(to bottom,transparent 0 calc(var(--u-hour) - 1px),var(--u-line) calc(var(--u-hour) - 1px) var(--u-hour))}
.uni-panel .u-wk-col.is-today{background-color:color-mix(in srgb,var(--u-accent) 4%,transparent)}
.uni-panel .u-blk{position:absolute;margin:2px 3px;padding:5px 7px;border-radius:8px;overflow:hidden;display:grid;align-content:start;gap:0;
  background:color-mix(in srgb,var(--cc) 14%,var(--u-surface));border-left:3px solid var(--cc);font-size:12px;line-height:1.3;min-height:0}
.uni-panel .u-blk b{color:var(--cc);font-size:13px;font-weight:700}
.uni-panel .u-blk b small{font-size:11px;font-weight:600;opacity:.85;margin-left:4px}
.uni-panel .u-blk span{color:var(--u-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-blk.is-past{opacity:.55}
.uni-panel .u-blk.is-now{box-shadow:0 0 0 2px var(--cc)}
.uni-panel .u-nowline{position:absolute;left:-1px;right:0;height:2px;background:var(--u-now);z-index:2;pointer-events:none}
.uni-panel .u-nowline::before{content:"";position:absolute;left:-4px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--u-now)}
@container (min-width:720px){
  .uni-panel .u-days,.uni-panel .u-daylist{display:none}
  .uni-panel .u-week{display:block}
}

/* two columns on wide screens */
.uni-panel .u-cols{display:grid;gap:20px;grid-template-columns:minmax(0,1fr)}
@container (min-width:720px){.uni-panel .u-cols{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}}

/* exams */
.uni-panel .u-list{display:grid;gap:8px}
.uni-panel .u-exam{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;padding:12px 14px 12px 12px;align-items:center}
.uni-panel .u-date{width:52px;border-radius:12px;overflow:hidden;text-align:center;background:var(--u-surface-2);display:grid;line-height:1.15}
.uni-panel .u-date span:first-child{background:var(--cc);color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;padding:3px 0}
.uni-panel .u-date b{font-size:21px;font-weight:700;padding-top:3px;font-variant-numeric:tabular-nums}
.uni-panel .u-date span:last-child{font-size:11px;color:var(--u-muted);padding-bottom:5px}
.uni-panel .u-exam-body{display:grid;gap:3px;min-width:0}
.uni-panel .u-exam-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.uni-panel .u-exam-top b{color:var(--cc);font-weight:700}
.uni-panel .u-season{font-size:11px;font-weight:700;padding:1px 7px;border-radius:999px;color:var(--sc);background:color-mix(in srgb,var(--sc) 13%,transparent)}
.uni-panel .u-exam-name{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-exam .u-lec-meta{white-space:normal}
.uni-panel .u-count{margin-left:auto;font-size:12px;font-weight:650;color:var(--u-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.uni-panel .is-soon .u-count,.uni-panel .u-count.is-soon{color:var(--u-warn)}
.uni-panel .is-late .u-count,.uni-panel .u-count.is-late{color:var(--u-bad)}

/* deadlines */
.uni-panel .u-dl{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 14px}
.uni-panel .u-dl-course{font-size:11px;font-weight:700;color:var(--cc);background:color-mix(in srgb,var(--cc) 13%,transparent);
  border-radius:8px;min-width:46px;text-align:center;padding:5px 6px}
.uni-panel .u-dl-body{display:grid;min-width:0}
.uni-panel .u-dl-body a,.uni-panel .u-dl-body > span:first-child{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-dl-body small{font-size:12px;color:var(--u-muted)}
.uni-panel .u-pill{font-size:12px;font-weight:650;padding:3px 9px;border-radius:999px;background:var(--u-surface-2);color:var(--u-ink-2);white-space:nowrap}
.uni-panel .is-soon .u-pill{background:color-mix(in srgb,var(--u-warn) 14%,transparent);color:var(--u-warn)}
.uni-panel .is-late .u-pill{background:color-mix(in srgb,var(--u-bad) 12%,transparent);color:var(--u-bad)}

/* course units */
.uni-panel .u-units{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.uni-panel .u-unit{padding:14px;display:grid;gap:4px;border-top:4px solid var(--cc);align-content:start}
.uni-panel .u-unit-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.uni-panel .u-unit-top b{font-size:17px;font-weight:700;color:var(--cc);letter-spacing:-.01em}
.uni-panel .u-grade{font-size:13px;font-weight:700;padding:2px 8px;border-radius:8px;background:color-mix(in srgb,var(--u-good) 14%,transparent);color:var(--u-good)}
.uni-panel .u-unit-name{font-size:13px;color:var(--u-ink-2);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.uni-panel .u-unit-meta{font-size:12px;color:var(--u-muted)}

/* money */
.uni-panel .u-money{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}
.uni-panel .u-money-card{padding:16px;display:grid;gap:6px;align-content:start}
.uni-panel .u-money-label{font-size:12px;font-weight:600;color:var(--u-muted);text-transform:uppercase;letter-spacing:.05em}
.uni-panel .u-big{font-size:28px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.15}
.uni-panel .u-big.owed{color:var(--u-bad)}
.uni-panel .u-big.ok{color:var(--u-good)}
.uni-panel .u-money-note{font-size:13px;color:var(--u-ink-2)}
.uni-panel .u-unpaid{display:grid;gap:0;margin-top:6px;border-top:1px solid var(--u-line)}
.uni-panel .u-unpaid div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--u-line);font-size:13px}
.uni-panel .u-unpaid div:last-child{border-bottom:0;padding-bottom:0}
.uni-panel .u-unpaid span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-unpaid span small{display:block;color:var(--u-muted);font-size:12px}
.uni-panel .u-unpaid b{font-variant-numeric:tabular-nums;white-space:nowrap}
.uni-panel .is-late b{color:var(--u-bad)}
`;

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = (d) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
const fmtShort = (d) => d.toLocaleDateString([], { day: "numeric", month: "short" });
const wd = (d) => d.toLocaleDateString([], { weekday: "short" });
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const hours = (d) => d.getHours() + d.getMinutes() / 60;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

function relDue(due, now) {
  const h = (due - now) / 36e5;
  if (h < 0) return "overdue";
  if (h < 1) return `in ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `in ${Math.round(h)}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "tomorrow" : `in ${d} days`;
}

const SEASONS = { MT: "Mini-test", EN: "Normal season", ER: "Resit season", EC: "Completion season", EE: "Special season", EAE: "Special season" };
const SEASON_COLOR = { MT: 3, EN: 0, ER: 5, EC: 7, EE: 1, EAE: 1 };
const TYPES = { T: "Lecture", TP: "Theory-practical", PL: "Lab", P: "Practical", OT: "Tutorial", S: "Seminar", E: "Internship" };

// One colour per course, the same everywhere on the page.
function palette(data) {
  const map = new Map();
  const add = (code) => { if (code && !map.has(code)) map.set(code, map.size % 8); };
  (data.courses || []).forEach((c) => add(c.acronym));
  (data.classes || []).forEach((c) => add(c.course));
  (data.exams || []).forEach((x) => add(x.course));
  (data.deadlines || []).forEach((d) => add(d.course));
  return (code) => `cc-${map.has(code) ? map.get(code) : 0}`;
}

function courseNames(data) {
  const names = new Map();
  (data.courses || []).forEach((c) => c.acronym && c.name && names.set(c.acronym, c.name));
  (data.exams || []).forEach((x) => x.course && x.course_name && !names.has(x.course) && names.set(x.course, x.course_name));
  (data.classes || []).forEach((c) => c.course && c.course_name && !names.has(c.course) && names.set(c.course, c.course_name));
  return names;
}

// Where the timetable opens: today, or next Monday on a weekend with no classes.
export function defaultTimetableState(data, now = new Date()) {
  let day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  if (weekend && !(data.classes || []).some((c) => dayKey(new Date(c.start)) === dayKey(day))) day = addDays(mondayOf(day), 7);
  return { week: dayKey(mondayOf(day)), day: dayKey(day) };
}

function profileCard(data, now, ctx) {
  const p = data.profile || {};
  const prog = (p.programmes || [])[0] || {};
  const name = p.name || "Uni";
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).filter((c) => /\p{Lu}/u.test(c));
  const ini = initials.length > 1 ? initials[0] + initials[initials.length - 1] : (initials[0] || "U");
  const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const tags = [
    prog.acronym,
    prog.year && /^\d+$/.test(prog.year) ? `${ord(+prog.year)} year` : prog.year,
    (p.faculties || []).join(", ").toUpperCase(),
    p.number && `up${String(p.number).replace(/^up/i, "")}`,
  ].filter(Boolean);

  const todayLeft = ctx.classes.filter((c) => dayKey(c._s) === dayKey(now) && c._e > now).length;
  const weekEnd = addDays(now, 7);
  const dueSoon = (data.deadlines || []).filter((d) => { const t = new Date(d.due); return t >= now && t <= weekEnd; }).length;
  const nextExam = (data.exams || []).map((x) => ({ ...x, _s: new Date(x.start) })).filter((x) => new Date(x.end) > now).sort((a, b) => a._s - b._s)[0];
  const examDays = nextExam ? Math.max(0, Math.ceil((fromKey(dayKey(nextExam._s)) - fromKey(dayKey(now))) / 864e5)) : null;

  const sources = Object.keys(data.sources || {});
  const synced = data.generated_at ? new Date(data.generated_at) : null;
  const srcNames = { sigarra: "SIGARRA", moodle: "Moodle", manual: "your timetable" };
  return `<section class="u-card u-profile">
    <div class="u-avatar" aria-hidden="true">${esc(ini.toUpperCase())}</div>
    <div class="u-who"><div class="u-name">${esc(name)}</div>
      ${prog.name ? `<div class="u-prog" title="${esc(prog.name)}">${esc(prog.name)}</div>` : ""}
      ${tags.length ? `<div class="u-tags">${tags.map((t) => `<span class="u-tag">${esc(t)}</span>`).join("")}</div>` : ""}</div>
    <div class="u-stats">
      <div class="u-stat"><b>${todayLeft}</b><span>${todayLeft === 1 ? "class" : "classes"} left today</span></div>
      <div class="u-stat"><b>${dueSoon}</b><span>due in 7 days</span></div>
      <div class="u-stat"><b>${examDays == null ? "–" : examDays === 0 ? "Today" : `${examDays}d`}</b><span>${nextExam ? `to ${esc(nextExam.course || "next exam")} exam` : "no exams set"}</span></div>
    </div>
    <div class="u-synced">${synced ? `Synced ${esc(fmtDay(synced))}, ${fmtTime(synced)}` : "Not synced yet"}${sources.length ? ` from ${sources.map((s) => esc(srcNames[s] || s)).join(" and ")}` : ""}</div>
  </section>`;
}

function lectureCard(c, now, ctx) {
  const cls = now >= c._s && now < c._e ? "is-now" : c._e <= now ? "is-past" : "";
  const full = ctx.names.get(c.course);
  const meta = [TYPES[c.type] || c.type, c.teacher_name || c.teacher, c.group].filter(Boolean).join(" · ");
  const live = cls === "is-now" ? `<span class="u-live">Now · ends in ${Math.max(1, Math.round((c._e - now) / 6e4))} min</span>` : "";
  return `<article class="u-card u-lec ${ctx.color(c.course)} ${cls}">
    <div class="u-lec-time"><b>${fmtTime(c._s)}</b><span>${fmtTime(c._e)}</span></div>
    <div class="u-lec-body"><div class="u-lec-title"><b>${esc(c.course)}</b>${c.type ? `<span class="u-type">${esc(c.type)}</span>` : ""}${live}</div>
      ${full ? `<div class="u-lec-name">${esc(full)}</div>` : ""}
      ${meta ? `<div class="u-lec-meta">${esc(meta)}</div>` : ""}</div>
    ${c.room ? `<div class="u-room"><span>Room</span><b>${esc(c.room)}</b></div>` : "<span></span>"}
  </article>`;
}

// Side-by-side lanes for classes that overlap in time.
function lanes(list) {
  const out = [];
  let group = [], groupEnd = 0;
  const flush = () => { const n = Math.max(...group.map((g) => g.lane)) + 1; group.forEach((g) => out.push({ ...g, n })); group = []; };
  for (const c of [...list].sort((a, b) => a._s - b._s)) {
    if (group.length && c._s >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.c._e > c._s).map((g) => g.lane));
    let lane = 0; while (used.has(lane)) lane++;
    group.push({ c, lane });
    groupEnd = Math.max(groupEnd, +c._e);
  }
  if (group.length) flush();
  return out;
}

function timetable(now, ctx, state) {
  const monday = fromKey(state.week);
  const sunday = addDays(monday, 7);
  const week = ctx.classes.filter((c) => c._s >= monday && c._s < sunday);
  const byDay = new Map();
  for (const c of week) { const k = dayKey(c._s); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(c); }
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i), k = dayKey(d);
    if (i < 5 || byDay.has(k) || k === state.day) days.push({ d, k, list: (byDay.get(k) || []).sort((a, b) => a._s - b._s) });
  }
  const todayK = dayKey(now);
  const sel = days.find((x) => x.k === state.day) || days[0];

  const picker = days.map((x) => `<button type="button" role="tab" class="u-day${x.k === todayK ? " is-today" : ""}" data-act="day" data-day="${x.k}"
      aria-selected="${x.k === sel.k}" aria-label="${esc(fmtDay(x.d))}, ${x.list.length} ${x.list.length === 1 ? "class" : "classes"}">
      <span>${esc(wd(x.d))}</span><b>${x.d.getDate()}</b><i class="${x.list.length ? "" : "none"}"></i></button>`).join("");
  const dayList = sel.list.length
    ? sel.list.map((c) => lectureCard(c, now, ctx)).join("")
    : `<div class="u-card u-empty">No classes on ${esc(fmtDay(sel.d))}.</div>`;

  // Week grid: hours from the earliest start to the latest end (at least 8:00 to 18:00).
  let first = 8, last = 18;
  for (const c of week) { first = Math.min(first, Math.floor(hours(c._s))); last = Math.max(last, Math.ceil(hours(c._e) || 24)); }
  const rows = last - first;
  const hourLabels = Array.from({ length: rows }, (_, i) => `<span style="top:calc(var(--u-hour)*${i})">${pad(first + i)}:00</span>`).join("");
  const cols = days.map((x) => {
    const blocks = lanes(x.list).map(({ c, lane, n }) => {
      const top = hours(c._s) - first, h = Math.max(0.5, (c._e - c._s) / 36e5);
      const cls = now >= c._s && now < c._e ? "is-now" : c._e <= now ? "is-past" : "";
      return `<div class="u-blk ${ctx.color(c.course)} ${cls}" title="${esc([ctx.names.get(c.course) || c.course, TYPES[c.type] || c.type, c.room, c.teacher_name || c.teacher].filter(Boolean).join(" · "))}"
        style="top:calc(var(--u-hour)*${top.toFixed(3)});height:calc(var(--u-hour)*${h.toFixed(3)} - 4px);left:calc(${(100 * lane / n).toFixed(2)}%);width:calc(${(100 / n).toFixed(2)}% - 6px)">
        <b>${esc(c.course)}${c.type ? `<small>${esc(c.type)}</small>` : ""}</b>
        <span>${fmtTime(c._s)}–${fmtTime(c._e)}</span>${c.room ? `<span>${esc(c.room)}</span>` : ""}</div>`;
    }).join("");
    const nowLine = x.k === todayK && hours(now) >= first && hours(now) <= last
      ? `<div class="u-nowline" style="top:calc(var(--u-hour)*${(hours(now) - first).toFixed(3)})"></div>` : "";
    return `<div class="u-wk-col${x.k === todayK ? " is-today" : ""}">${blocks}${nowLine}</div>`;
  }).join("");
  const heads = days.map((x) => `<div class="${x.k === todayK ? "is-today" : ""}">${esc(wd(x.d))} <b>${x.d.getDate()}</b></div>`).join("");

  const thisWeek = dayKey(mondayOf(now)) === state.week;
  return `<section class="u-sec u-tt">
    <div class="u-sec-head"><h3>Timetable</h3>
      <span class="u-range">${esc(fmtShort(monday))} – ${esc(fmtShort(addDays(monday, 6)))} · ${week.length} ${week.length === 1 ? "class" : "classes"}</span>
      <div class="u-nav"><button type="button" data-act="week" data-step="-1" aria-label="Previous week">‹</button>
        <button type="button" data-act="today"${thisWeek ? ' aria-pressed="true"' : ""}>Today</button>
        <button type="button" data-act="week" data-step="1" aria-label="Next week">›</button></div></div>
    <div class="u-days" role="tablist" aria-label="Day">${picker}</div>
    <div class="u-daylist" role="tabpanel">${dayList}</div>
    <div class="u-card u-week" style="--cols:${days.length};--rows:${rows}">
      <div class="u-wk-head"><div></div>${heads}</div>
      <div class="u-wk-body"><div class="u-wk-hours">${hourLabels}</div>${cols}</div>
    </div>
  </section>`;
}

function examCard(x, now, ctx) {
  const s = new Date(x.start), e = new Date(x.end);
  const days = Math.ceil((fromKey(dayKey(s)) - fromKey(dayKey(now))) / 864e5);
  const count = now >= s ? "now" : days <= 0 ? relDue(s, now) : days === 1 ? "tomorrow" : `in ${days} days`;
  const meta = [x.all_day ? "Time not set yet" : `${fmtTime(s)}–${fmtTime(e)}`, (x.rooms || []).length ? `Rooms ${x.rooms.join(", ")}` : ""].filter(Boolean).join(" · ");
  const season = SEASONS[x.season] || x.season_name;
  return `<article class="u-card u-exam ${ctx.color(x.course)}${days <= 2 ? " is-soon" : ""}">
    <div class="u-date"><span>${esc(s.toLocaleDateString([], { month: "short" }).toUpperCase().replace(".", ""))}</span><b>${s.getDate()}</b><span>${esc(wd(s))}</span></div>
    <div class="u-exam-body">
      <div class="u-exam-top"><b>${esc(x.course || "")}</b>${season ? `<span class="u-season" style="--sc:var(--cc${SEASON_COLOR[x.season] ?? 0})">${esc(season)}</span>` : ""}<span class="u-count">${esc(count)}</span></div>
      <div class="u-exam-name">${esc(x.course_name || ctx.names.get(x.course) || x.course)}</div>
      <div class="u-lec-meta">${esc(meta)}</div></div>
  </article>`;
}

function deadlineRow(d, now, ctx) {
  const due = new Date(d.due);
  const h = (due - now) / 36e5;
  const cls = h < 0 ? "is-late" : h < 48 ? "is-soon" : "";
  // Only web links: a javascript: link in synced data must never become clickable.
  const title = /^https?:\/\//i.test(d.url || "") ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>` : `<span>${esc(d.title)}</span>`;
  return `<article class="u-card u-dl ${ctx.color(d.course)} ${cls}">
    <span class="u-dl-course">${esc(d.course || "·")}</span>
    <div class="u-dl-body">${title}<small>${esc(fmtDay(due))}, ${fmtTime(due)}</small></div>
    <span class="u-pill">${relDue(due, now)}</span></article>`;
}

function unitCard(u, ctx) {
  const grade = u.grade != null && u.grade !== "" ? String(u.grade) : "";
  const meta = [u.ects != null ? `${u.ects} ECTS` : "", u.semester, u.year && `Year ${u.year}`].filter(Boolean).join(" · ");
  return `<article class="u-card u-unit ${ctx.color(u.acronym)}">
    <div class="u-unit-top"><b>${esc(u.acronym || u.code || "")}</b>${grade ? `<span class="u-grade" title="Grade">${esc(grade)}</span>` : ""}</div>
    <div class="u-unit-name" title="${esc(u.name)}">${esc(u.name || "")}</div>
    ${meta ? `<div class="u-unit-meta">${esc(meta)}</div>` : ""}</article>`;
}

function moneyCards(f, now) {
  const fees = f && f.fees;
  const cards = [];
  if (fees) {
    const v = fees.balance_value;
    const unpaid = fees.unpaid || [];
    const owed = typeof v === "number" ? v < 0 : unpaid.length > 0;
    const big = fees.balance || (typeof v === "number" ? eur(v) : "");
    const rows = unpaid.slice(0, 4).map((u) => {
      const due = u.deadline ? new Date(u.deadline + "T23:59") : null;
      const late = due && due < now;
      return `<div class="${late ? "is-late" : ""}"><span>${esc(u.description)}${due ? `<small>${late ? "was due" : "due"} ${esc(fmtDay(due))}</small>` : ""}</span>
        <b>${u.amount_due != null ? esc(eur(u.amount_due)) : ""}</b></div>`;
    }).join("");
    cards.push(`<div class="u-card u-money-card"><div class="u-money-label">Tuition fees</div>
      <div class="u-big ${owed ? "owed" : "ok"}">${esc(big || "Nothing owed")}</div>
      <div class="u-money-note">${owed ? (fees.next_due ? `Next payment by ${esc(fmtDay(new Date(fees.next_due + "T12:00")))}` : "Payment pending") : "All paid up"}</div>
      ${rows ? `<div class="u-unpaid">${rows}</div>` : ""}</div>`);
  }
  if (f && f.print_balance) {
    cards.push(`<div class="u-card u-money-card"><div class="u-money-label">Printing balance</div>
      <div class="u-big">${esc(f.print_balance)}</div><div class="u-money-note">Credit left for the faculty printers</div></div>`);
  }
  if (!cards.length) return "";
  return `<section class="u-sec"><div class="u-sec-head"><h3>Fees and printing</h3></div><div class="u-money">${cards.join("")}</div></section>`;
}

export function renderUni(data, { now = new Date(), deadlineDays = 14, examLimit = 6, state } = {}) {
  const classes = (data.classes || []).map((c) => ({ ...c, _s: new Date(c.start), _e: new Date(c.end) })).filter((c) => !isNaN(c._s));
  const ctx = { classes, color: palette(data), names: courseNames(data) };
  state = state || defaultTimetableState(data, now);

  const horizon = new Date(now.getTime() + deadlineDays * 864e5);
  const recentCutoff = new Date(now.getTime() - 2 * 864e5); // keep just-missed items visible
  const deadlines = (data.deadlines || []).filter((d) => {
    const due = new Date(d.due);
    return due >= recentCutoff && due <= horizon;
  }).sort((a, b) => new Date(a.due) - new Date(b.due));
  const exams = (data.exams || []).filter((x) => new Date(x.end) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, examLimit);
  const units = data.courses || [];

  const sources = Object.entries(data.sources || {});
  const errors = sources.filter(([, s]) => !s.ok);
  const warnings = sources.filter(([, s]) => s.ok && s.warnings && s.warnings.length);

  return `
    ${profileCard(data, now, ctx)}
    ${errors.map(([n, s]) => `<div class="err">${esc(n)}: ${esc(s.error)}${s.synced_at ? " (showing last good data)" : ""}</div>`).join("")}
    ${warnings.map(([n, s]) => `<div class="warn">${esc(n)}, not refreshed this time: ${esc(s.warnings.join("; "))} (showing last good data)</div>`).join("")}
    ${timetable(now, ctx, state)}
    <div class="u-cols">
      <section class="u-sec"><div class="u-sec-head"><h3>Exams</h3><span class="u-muted">${exams.length ? `${exams.length} coming up` : ""}</span></div>
        ${exams.length ? `<div class="u-list">${exams.map((x) => examCard(x, now, ctx)).join("")}</div>` : `<div class="u-card u-empty">No exams scheduled.</div>`}</section>
      <section class="u-sec"><div class="u-sec-head"><h3>Deadlines</h3><span class="u-muted">next ${deadlineDays} days</span></div>
        ${deadlines.length ? `<div class="u-list">${deadlines.map((d) => deadlineRow(d, now, ctx)).join("")}</div>` : `<div class="u-card u-empty">Nothing due.</div>`}</section>
    </div>
    ${units.length ? `<section class="u-sec"><div class="u-sec-head"><h3>Course units</h3>
      <span class="u-muted">${units.length} this year${units.some((u) => u.ects) ? ` · ${units.reduce((s, u) => s + (+u.ects || 0), 0)} ECTS` : ""}</span></div>
      <div class="u-units">${units.map((u) => unitCard(u, ctx)).join("")}</div></section>` : ""}
    ${moneyCards(data.finance, now)}`;
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
  let state = null;
  const now = () => opts.now || new Date();
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
  // Redraws keep keyboard focus on the same control.
  const keyOf = (b) => b && b.dataset && b.dataset.act ? `button[data-act="${b.dataset.act}"]${b.dataset.day ? `[data-day="${b.dataset.day}"]` : ""}${b.dataset.step ? `[data-step="${b.dataset.step}"]` : ""}` : null;
  const draw = (focus) => {
    if (!state) state = defaultTimetableState(data, now());
    const keep = focus || (el.contains(document.activeElement) ? keyOf(document.activeElement) : null);
    el.innerHTML = renderUni(data, { ...opts, now: now(), state });
    if (keep) el.querySelector(keep)?.focus();
  };

  // Timetable controls: week arrows, Today, and the day picker (phones).
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b || !data) return;
    const act = b.dataset.act;
    if (act === "day") state = { ...state, day: b.dataset.day };
    else if (act === "today") state = defaultTimetableState(data, now());
    else if (act === "week") {
      const step = Number(b.dataset.step) || 0;
      const week = addDays(fromKey(state.week), 7 * step);
      const offset = (fromKey(state.day) - fromKey(state.week)) / 864e5;
      state = { week: dayKey(week), day: dayKey(addDays(week, Math.min(4, Math.max(0, Math.round(offset))))) };
    } else return;
    draw(act === "day" ? `button[data-act="day"][data-day="${state.day}"]` : keyOf(b));
  });

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
