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
// It reads the dashboard's design tokens (css/tokens.css), so a page that mounts it links that file.

const STYLE = `
.uni-panel{--u-hour:48px;color:var(--text-1);font:var(--fs-14)/var(--lh-body) var(--font-sans);display:grid;gap:var(--space-6);min-width:0;container-type:inline-size}
.uni-panel *{box-sizing:border-box}
.uni-panel .cc-0{--cc:var(--course-0)}.uni-panel .cc-1{--cc:var(--course-1)}.uni-panel .cc-2{--cc:var(--course-2)}.uni-panel .cc-3{--cc:var(--course-3)}
.uni-panel .cc-4{--cc:var(--course-4)}.uni-panel .cc-5{--cc:var(--course-5)}.uni-panel .cc-6{--cc:var(--course-6)}.uni-panel .cc-7{--cc:var(--course-7)}
.uni-panel a{color:inherit;text-decoration:none;border-radius:var(--radius-xs)}.uni-panel a:hover{text-decoration:underline;text-decoration-color:var(--text-3);text-underline-offset:2px}
.uni-panel button{font:inherit;color:inherit;cursor:pointer}
.uni-panel :focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.uni-panel h3{margin:0;font-size:var(--fs-14);font-weight:var(--fw-semibold);color:var(--text-1)}
.uni-panel .ic{width:var(--icon);height:var(--icon);flex:none;fill:none;stroke:currentColor;stroke-width:var(--icon-stroke);stroke-linecap:round;stroke-linejoin:round}
.uni-panel .ic *{vector-effect:non-scaling-stroke}
.uni-panel .u-card{background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius)}
.uni-panel .u-muted{color:var(--text-3)}
.uni-panel .u-sec{display:grid;gap:var(--space-3);min-width:0}
.uni-panel .u-sec-head{display:flex;align-items:center;gap:var(--space-2) var(--space-3);flex-wrap:wrap;min-height:32px}
.uni-panel .u-sec-head .u-muted{font-size:var(--fs-13);font-variant-numeric:tabular-nums}
.uni-panel .u-dot{width:6px;height:6px;border-radius:50%;background:var(--cc);flex:none;display:inline-block}
.uni-panel .u-empty{color:var(--text-2);padding:var(--space-4);font-size:var(--fs-13)}
.uni-panel .err,.uni-panel .warn{display:flex;gap:10px;align-items:flex-start;font-size:var(--fs-13);color:var(--text-2);padding:10px var(--space-3);
  background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius)}
.uni-panel .err{border-color:rgb(224 115 107 / .3)}.uni-panel .err .ic{color:var(--danger)}
.uni-panel .warn{border-color:rgb(207 162 87 / .3)}.uni-panel .warn .ic{color:var(--warning)}
.uni-panel .err b,.uni-panel .warn b{font-weight:var(--fw-medium);color:var(--text-1)}

/* loading */
.uni-panel .u-skel{display:block;background:var(--surface-2);border-radius:var(--radius-xs);height:12px}
.uni-panel .u-skel-card{padding:var(--space-4);display:grid;gap:var(--space-3)}

/* profile */
.uni-panel .u-profile{display:grid;gap:var(--space-4);padding:var(--space-4)}
.uni-panel .u-id{display:flex;align-items:center;gap:var(--space-3);min-width:0}
.uni-panel .u-avatar{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;flex:none;
  background:var(--surface-3);border:1px solid var(--border-strong);color:var(--text-2);font-size:var(--fs-13);font-weight:var(--fw-semibold);letter-spacing:.02em}
.uni-panel .u-who{display:grid;gap:1px;min-width:0}
.uni-panel .u-name{font-size:var(--fs-16);font-weight:var(--fw-semibold);letter-spacing:var(--tracking-tight);line-height:var(--lh-tight)}
.uni-panel .u-prog{color:var(--text-2);font-size:var(--fs-13);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-tags{color:var(--text-3);font-size:var(--fs-12);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;border-top:1px solid var(--border);padding-top:var(--space-4)}
.uni-panel .u-stat{min-width:0;display:grid;gap:2px;padding:0 var(--space-4)}
.uni-panel .u-stat:first-child{padding-left:0}
.uni-panel .u-stat + .u-stat{border-left:1px solid var(--border)}
.uni-panel .u-stat dt{font-size:var(--fs-12);color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uni-panel .u-stat dd{margin:0;font-size:var(--fs-20);font-weight:var(--fw-semibold);letter-spacing:var(--tracking-tighter);font-variant-numeric:tabular-nums;line-height:1.3;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-stat small{font-size:var(--fs-12);color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uni-panel .u-synced{font-size:var(--fs-12);color:var(--text-3)}
@container (min-width:720px){
  .uni-panel .u-profile{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:center;column-gap:var(--space-6)}
  .uni-panel .u-stats{border-top:0;padding-top:0}
  .uni-panel .u-stat:first-child{padding-left:var(--space-4);border-left:1px solid var(--border)}
  .uni-panel .u-synced{grid-column:1/-1;padding-top:var(--space-3);border-top:1px solid var(--border)}
}

/* timetable */
.uni-panel .u-range{font-size:var(--fs-13);color:var(--text-3);font-variant-numeric:tabular-nums}
.uni-panel .u-nav{margin-left:auto;display:inline-flex;background:var(--surface-1);border:1px solid var(--border-strong);border-radius:var(--radius-sm)}
.uni-panel .u-nav button{border:0;background:transparent;height:calc(var(--control-h) - 2px);min-width:calc(var(--control-h) - 2px);padding:0 10px;
  display:inline-grid;place-items:center;font-size:var(--fs-13);font-weight:var(--fw-medium);color:var(--text-2);border-radius:0}
.uni-panel .u-nav button:first-child{padding:0;border-radius:5px 0 0 5px}.uni-panel .u-nav button:last-child{padding:0;border-radius:0 5px 5px 0}
.uni-panel .u-nav button + button{border-left:1px solid var(--border)}
.uni-panel .u-nav button:hover{background:var(--surface-2);color:var(--text-1)}
.uni-panel .u-nav button:focus-visible{outline-offset:-2px}
.uni-panel .u-days{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:2px;padding:3px;
  background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius)}
.uni-panel .u-day{border:1px solid transparent;background:transparent;border-radius:var(--radius-sm);height:52px;padding:0;display:grid;justify-items:center;align-content:center;gap:2px;color:var(--text-2)}
.uni-panel .u-day:hover{background:var(--surface-2)}
.uni-panel .u-day span{font-size:var(--fs-12);color:var(--text-3);line-height:1.2}
.uni-panel .u-day b{font-size:var(--fs-14);font-weight:var(--fw-medium);font-variant-numeric:tabular-nums;line-height:1.3}
.uni-panel .u-day i{width:4px;height:4px;border-radius:50%;background:var(--text-3)}
.uni-panel .u-day i.none{visibility:hidden}
.uni-panel .u-day.is-today b{color:var(--accent-text)}
.uni-panel .u-day[aria-selected=true]{background:var(--surface-3);border-color:var(--border-strong);color:var(--text-1)}
.uni-panel .u-day[aria-selected=true] b{font-weight:var(--fw-semibold)}
.uni-panel .u-daylist{overflow:hidden}
.uni-panel .u-lec{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:var(--space-3);align-items:center;padding:var(--space-3) var(--space-4)}
.uni-panel .u-lec + .u-lec{border-top:1px solid var(--border)}
.uni-panel .u-lec.is-now{background:var(--surface-2)}
.uni-panel .u-lec-time{display:grid;font-variant-numeric:tabular-nums;line-height:1.35}
.uni-panel .u-lec-time b{font-weight:var(--fw-medium);font-size:var(--fs-13)}
.uni-panel .u-lec-time span{color:var(--text-3);font-size:var(--fs-12)}
.uni-panel .u-lec.is-past .u-lec-time b,.uni-panel .u-lec.is-past .u-lec-title b{color:var(--text-3)}
.uni-panel .u-lec-body{min-width:0;display:grid;gap:1px}
.uni-panel .u-lec-title{display:flex;align-items:center;gap:var(--space-2);min-width:0}
.uni-panel .u-lec-title b{font-size:var(--fs-14);font-weight:var(--fw-semibold)}
.uni-panel .u-type{font-size:var(--fs-12);color:var(--text-3)}
.uni-panel .u-live{font-size:var(--fs-12);font-weight:var(--fw-medium);color:var(--accent-text)}
.uni-panel .u-lec-name,.uni-panel .u-lec-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-lec-name{color:var(--text-2);font-size:var(--fs-13)}
.uni-panel .u-lec-meta{color:var(--text-3);font-size:var(--fs-12)}
.uni-panel .u-room{display:grid;justify-items:end;font-variant-numeric:tabular-nums;line-height:1.35}
.uni-panel .u-room b{font-size:var(--fs-13);font-weight:var(--fw-medium)}
.uni-panel .u-room span{font-size:var(--fs-12);color:var(--text-3)}
.uni-panel .u-week{display:none;overflow:hidden}
.uni-panel .u-wk-head,.uni-panel .u-wk-body{display:grid;grid-template-columns:52px repeat(var(--cols),minmax(0,1fr))}
.uni-panel .u-wk-head{border-bottom:1px solid var(--border)}
.uni-panel .u-wk-head div{padding:var(--space-2) var(--space-3);display:flex;align-items:baseline;gap:6px;font-size:var(--fs-12);color:var(--text-3);border-left:1px solid var(--border)}
.uni-panel .u-wk-head div:first-child{border-left:0}
.uni-panel .u-wk-head b{font-size:var(--fs-14);color:var(--text-1);font-weight:var(--fw-medium);font-variant-numeric:tabular-nums}
.uni-panel .u-wk-head .is-today,.uni-panel .u-wk-head .is-today b{color:var(--accent-text)}
.uni-panel .u-wk-hours{position:relative;height:calc(var(--u-hour)*var(--rows))}
.uni-panel .u-wk-hours span{position:absolute;right:var(--space-2);transform:translateY(-50%);font-size:var(--fs-12);color:var(--text-3);font-variant-numeric:tabular-nums}
.uni-panel .u-wk-hours span:first-child{transform:none;top:4px!important}
.uni-panel .u-wk-col{position:relative;border-left:1px solid var(--border);height:calc(var(--u-hour)*var(--rows));
  background:repeating-linear-gradient(to bottom,transparent 0 calc(var(--u-hour) - 1px),rgb(255 255 255 / .05) calc(var(--u-hour) - 1px) var(--u-hour))}
.uni-panel .u-wk-col.is-today{background-color:rgb(255 255 255 / .015)}
.uni-panel .u-blk{position:absolute;margin:2px 3px;padding:4px 6px 4px 8px;border-radius:var(--radius-sm);overflow:hidden;display:grid;align-content:start;gap:0;
  background:var(--surface-2);border:1px solid var(--border);box-shadow:inset 2px 0 0 var(--cc);font-size:var(--fs-12);line-height:1.35;min-height:0}
.uni-panel .u-blk b{color:var(--text-1);font-size:var(--fs-12);font-weight:var(--fw-semibold)}
.uni-panel .u-blk b small{font-size:var(--fs-12);font-weight:var(--fw-regular);color:var(--text-3);margin-left:4px}
.uni-panel .u-blk span{color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.uni-panel .u-blk span + span{color:var(--text-3)}
.uni-panel .u-blk.is-past{box-shadow:inset 2px 0 0 color-mix(in srgb,var(--cc) 45%,transparent)}
.uni-panel .u-blk.is-past b,.uni-panel .u-blk.is-past span{color:var(--text-3)}
.uni-panel .u-blk.is-now{border-color:var(--focus)}
.uni-panel .u-nowline{position:absolute;left:-1px;right:0;height:1px;background:var(--accent);z-index:2;pointer-events:none}
.uni-panel .u-nowline::before{content:"";position:absolute;left:-3px;top:-3px;width:7px;height:7px;border-radius:50%;background:var(--accent)}
@container (min-width:720px){
  .uni-panel .u-days,.uni-panel .u-daylist{display:none}
  .uni-panel .u-week{display:block}
}

/* two columns on wide screens */
.uni-panel .u-cols{display:grid;gap:var(--space-6);grid-template-columns:minmax(0,1fr)}
@container (min-width:720px){.uni-panel .u-cols{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}}

/* lists: exams and deadlines */
.uni-panel .u-list{overflow:hidden}
.uni-panel .u-list > * + *{border-top:1px solid var(--border)}
.uni-panel .u-exam{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--space-3);padding:var(--space-3) var(--space-4);align-items:center}
.uni-panel .u-date{width:40px;padding:4px 0;border-radius:var(--radius-sm);text-align:center;background:var(--surface-2);border:1px solid var(--border);display:grid;line-height:1.2}
.uni-panel .u-date span{font-size:var(--fs-12);color:var(--text-3)}
.uni-panel .u-date b{font-size:var(--fs-16);font-weight:var(--fw-semibold);font-variant-numeric:tabular-nums}
.uni-panel .u-exam-body{display:grid;gap:1px;min-width:0}
.uni-panel .u-exam-top{display:flex;align-items:center;gap:var(--space-2);min-width:0}
.uni-panel .u-exam-top b{font-size:var(--fs-13);font-weight:var(--fw-semibold)}
.uni-panel .u-season{font-size:var(--fs-12);color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uni-panel .u-exam-name{font-size:var(--fs-14);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-exam .u-lec-meta{white-space:normal}
.uni-panel .u-count{font-size:var(--fs-13);color:var(--text-2);font-variant-numeric:tabular-nums;white-space:nowrap;align-self:start}
.uni-panel .is-soon .u-count{color:var(--warning)}
.uni-panel .is-late .u-count{color:var(--danger)}
.uni-panel .u-dl{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:var(--space-3);align-items:center;padding:10px var(--space-4)}
.uni-panel .u-dl-course{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-12);font-weight:var(--fw-semibold);color:var(--text-2);min-width:0;overflow:hidden}
.uni-panel .u-dl-body{display:grid;min-width:0}
.uni-panel .u-dl-body a,.uni-panel .u-dl-body > span:first-child{font-size:var(--fs-14);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-dl-body small{font-size:var(--fs-12);color:var(--text-3)}
.uni-panel .u-due{font-size:var(--fs-13);color:var(--text-2);white-space:nowrap;font-variant-numeric:tabular-nums}
.uni-panel .is-soon .u-due{color:var(--warning)}
.uni-panel .is-late .u-due{color:var(--danger)}

/* course units */
.uni-panel .u-units{display:grid;gap:var(--space-3);grid-template-columns:repeat(auto-fill,minmax(min(100%,148px),1fr))}
@container (min-width:720px){.uni-panel .u-units{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}}
.uni-panel .u-unit{padding:var(--space-3) var(--space-4) var(--space-4);display:grid;gap:2px;align-content:start}
.uni-panel .u-unit-top{display:flex;align-items:center;gap:var(--space-2)}
.uni-panel .u-unit-top b{font-size:var(--fs-14);font-weight:var(--fw-semibold)}
.uni-panel .u-grade{margin-left:auto;font-size:var(--fs-13);font-weight:var(--fw-medium);font-variant-numeric:tabular-nums;color:var(--text-1)}
.uni-panel .u-grade small{font-size:var(--fs-12);font-weight:var(--fw-regular);color:var(--text-3);margin-right:4px}
.uni-panel .u-unit-name{font-size:var(--fs-13);color:var(--text-2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.uni-panel .u-unit-meta{font-size:var(--fs-12);color:var(--text-3);margin-top:var(--space-1)}

/* money */
.uni-panel .u-money{display:grid;gap:var(--space-3);grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.uni-panel .u-money-card{padding:var(--space-4);display:grid;gap:2px;align-content:start}
.uni-panel .u-money-label{font-size:var(--fs-12);color:var(--text-3)}
.uni-panel .u-big{font-size:var(--fs-20);font-weight:var(--fw-semibold);letter-spacing:var(--tracking-tighter);font-variant-numeric:tabular-nums;line-height:1.3}
.uni-panel .u-big.owed{color:var(--danger)}
.uni-panel .u-money-note{font-size:var(--fs-13);color:var(--text-2)}
.uni-panel .u-unpaid{display:grid;margin-top:var(--space-3);border-top:1px solid var(--border)}
.uni-panel .u-unpaid div{display:flex;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--border);font-size:var(--fs-13)}
.uni-panel .u-unpaid div:last-child{border-bottom:0;padding-bottom:0}
.uni-panel .u-unpaid span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uni-panel .u-unpaid span small{display:block;color:var(--text-3);font-size:var(--fs-12)}
.uni-panel .u-unpaid b{font-weight:var(--fw-medium);font-variant-numeric:tabular-nums;white-space:nowrap}
.uni-panel .u-unpaid .is-late small{color:var(--danger)}
`;

// Lucide icons (lucide.dev)
const ICON = {
  left: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  alert: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};

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
const SOURCE_NAMES = { sigarra: "SIGARRA", moodle: "Moodle", manual: "Your timetable" };
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
    <div class="u-id"><div class="u-avatar" aria-hidden="true">${esc(ini.toUpperCase())}</div>
      <div class="u-who"><div class="u-name">${esc(name)}</div>
        ${prog.name ? `<div class="u-prog" title="${esc(prog.name)}">${esc(prog.name)}</div>` : ""}
        ${tags.length ? `<div class="u-tags">${tags.map(esc).join(" · ")}</div>` : ""}</div></div>
    <dl class="u-stats">
      <div class="u-stat"><dt>Today</dt><dd>${todayLeft}</dd><small>${todayLeft === 1 ? "class" : "classes"} left</small></div>
      <div class="u-stat"><dt>Next 7 days</dt><dd>${dueSoon}</dd><small>due</small></div>
      <div class="u-stat"><dt>Next exam</dt><dd>${examDays == null ? "–" : examDays === 0 ? "Today" : `${examDays} ${examDays === 1 ? "day" : "days"}`}</dd><small>${nextExam ? esc(nextExam.course || "Exam") : "None scheduled"}</small></div>
    </dl>
    <div class="u-synced">${synced ? `Synced ${esc(fmtDay(synced))}, ${fmtTime(synced)}` : "Not synced yet"}${sources.length ? ` from ${sources.map((s) => esc(srcNames[s] || s)).join(" and ")}` : ""}</div>
  </section>`;
}

function lectureCard(c, now, ctx) {
  const cls = now >= c._s && now < c._e ? "is-now" : c._e <= now ? "is-past" : "";
  const full = ctx.names.get(c.course);
  const meta = [TYPES[c.type] || c.type, c.teacher_name || c.teacher, c.group].filter(Boolean).join(" · ");
  const live = cls === "is-now" ? `<span class="u-live">Now · ends in ${Math.max(1, Math.round((c._e - now) / 6e4))} min</span>` : "";
  return `<article class="u-lec ${ctx.color(c.course)} ${cls}">
    <div class="u-lec-time"><b>${fmtTime(c._s)}</b><span>${fmtTime(c._e)}</span></div>
    <div class="u-lec-body"><div class="u-lec-title"><span class="u-dot"></span><b>${esc(c.course)}</b>${c.type ? `<span class="u-type">${esc(c.type)}</span>` : ""}${live}</div>
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
    : `<div class="u-empty">No classes on ${esc(fmtDay(sel.d))}.</div>`;

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
      <div class="u-nav"><button type="button" data-act="week" data-step="-1" aria-label="Previous week" title="Previous week">${ICON.left}</button>
        <button type="button" data-act="today"${thisWeek ? ' aria-pressed="true"' : ""}>Today</button>
        <button type="button" data-act="week" data-step="1" aria-label="Next week" title="Next week">${ICON.right}</button></div></div>
    <div class="u-days" role="tablist" aria-label="Day">${picker}</div>
    <div class="u-card u-daylist" role="tabpanel">${dayList}</div>
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
  return `<article class="u-exam ${ctx.color(x.course)}${days <= 2 ? " is-soon" : ""}">
    <div class="u-date"><span>${esc(s.toLocaleDateString([], { month: "short" }).replace(".", ""))}</span><b>${s.getDate()}</b></div>
    <div class="u-exam-body">
      <div class="u-exam-top"><span class="u-dot"></span><b>${esc(x.course || "")}</b>${season ? `<span class="u-season">${esc(season)}</span>` : ""}</div>
      <div class="u-exam-name">${esc(x.course_name || ctx.names.get(x.course) || x.course)}</div>
      <div class="u-lec-meta">${esc([wd(s), meta].filter(Boolean).join(" · "))}</div></div>
    <span class="u-count">${esc(count)}</span>
  </article>`;
}

function deadlineRow(d, now, ctx) {
  const due = new Date(d.due);
  const h = (due - now) / 36e5;
  const cls = h < 0 ? "is-late" : h < 48 ? "is-soon" : "";
  // Only web links: a javascript: link in synced data must never become clickable.
  const title = /^https?:\/\//i.test(d.url || "") ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>` : `<span>${esc(d.title)}</span>`;
  return `<article class="u-dl ${ctx.color(d.course)} ${cls}">
    <span class="u-dl-course"><span class="u-dot"></span>${esc(d.course || "–")}</span>
    <div class="u-dl-body">${title}<small>${esc(fmtDay(due))}, ${fmtTime(due)}</small></div>
    <span class="u-due">${relDue(due, now)}</span></article>`;
}

function unitCard(u, ctx) {
  const grade = u.grade != null && u.grade !== "" ? String(u.grade) : "";
  const meta = [u.ects != null ? `${u.ects} ECTS` : "", u.semester, u.year && `Year ${u.year}`].filter(Boolean).join(" · ");
  return `<article class="u-card u-unit ${ctx.color(u.acronym)}">
    <div class="u-unit-top"><span class="u-dot"></span><b>${esc(u.acronym || u.code || "")}</b>${grade ? `<span class="u-grade"><small>Grade</small>${esc(grade)}</span>` : ""}</div>
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

// Shown while the data loads: the profile card and one list, as grey bars.
function skeleton() {
  const bar = (w, h = 12) => `<span class="u-skel" style="width:${w};height:${h}px"></span>`;
  return `<div aria-busy="true" aria-label="Loading uni data" style="display:grid;gap:var(--space-6)">
    <div class="u-card u-skel-card"><div class="u-id"><span class="u-skel" style="width:40px;height:40px;border-radius:50%"></span>
      <div style="display:grid;gap:8px;flex:1">${bar("40%", 14)}${bar("60%")}</div></div>${bar("100%", 1)}${bar("70%")}</div>
    <div class="u-card u-skel-card">${bar("30%", 14)}${bar("90%")}${bar("80%")}${bar("85%")}</div>
  </div>`;
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
    ${errors.map(([n, s]) => `<div class="err" role="status">${ICON.alert}<span><b>${esc(SOURCE_NAMES[n] || n)} did not sync.</b> ${esc(s.error)}${s.synced_at ? " Showing the last good data." : ""}</span></div>`).join("")}
    ${warnings.map(([n, s]) => `<div class="warn" role="status">${ICON.warn}<span><b>Part of ${esc(SOURCE_NAMES[n] || n)} was not refreshed.</b> ${esc(s.warnings.join("; "))}. Showing the last good data.</span></div>`).join("")}
    ${timetable(now, ctx, state)}
    <div class="u-cols">
      <section class="u-sec"><div class="u-sec-head"><h3>Exams</h3><span class="u-muted">${exams.length ? `${exams.length} coming up` : ""}</span></div>
        ${exams.length ? `<div class="u-card u-list">${exams.map((x) => examCard(x, now, ctx)).join("")}</div>` : `<div class="u-card u-empty">No exams scheduled.</div>`}</section>
      <section class="u-sec"><div class="u-sec-head"><h3>Deadlines</h3><span class="u-muted">Next ${deadlineDays} days</span></div>
        ${deadlines.length ? `<div class="u-card u-list">${deadlines.map((d) => deadlineRow(d, now, ctx)).join("")}</div>` : `<div class="u-card u-empty">Nothing due in the next ${deadlineDays} days.</div>`}</section>
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
  if (!opts.data) el.innerHTML = skeleton();
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
    el.innerHTML = `<div class="err" role="alert">${ICON.alert}<span><b>Uni data could not load.</b> ${esc(e.message)}</span></div>`;
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
