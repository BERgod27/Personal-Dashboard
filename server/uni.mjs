// Server-side uni sync: a Node port of modules/uni/sync_uni.py.
// Same sources, same output contract (schema "uni/1"), so modules/uni/panel.js renders it.
//   Moodle  : calendar export URL (ICS)
//   SIGARRA : sign-in and pages the U.Porto "uni" app uses (sigarra.mjs)
//   Manual  : a pasted schedule.csv (day,start,end,course,type,room,teacher)

import { LOCAL_TZ, offsetMinutes, zoned, iso, todayLocal, addDays, mondayOf } from './time.mjs';

const UA = 'personal-dashboard-uni/1.0';

// ---------------------------------------------------------------- ICS (Moodle calendar export)

function unfold(text) {
  const lines = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length) lines[lines.length - 1] += raw.slice(1);
    else lines.push(raw);
  }
  return lines;
}

const unescape = (v) => v.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

function parseIcsDate(value, params) {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    return { ms: zoned(+value.slice(0, 4), +value.slice(4, 6), +value.slice(6, 8)), allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
  if (!m) throw new Error(`bad date ${value}`);
  const parts = m.slice(1, 7).map(Number);
  if (m[7]) return { ms: Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]), allDay: false };
  let zone = LOCAL_TZ;
  if (params.TZID) { try { offsetMinutes(0, params.TZID); zone = params.TZID; } catch { /* unknown zone: Lisbon */ } }
  return { ms: zoned(...parts, zone), allDay: false };
}

export function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur || !line.includes(':')) continue;
    const i = line.indexOf(':');
    const [name, ...pp] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const params = Object.fromEntries(pp.filter((p) => p.includes('=')).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
    const key = name.toUpperCase();
    if (key === 'DTSTART' || key === 'DTEND') {
      const { ms, allDay } = parseIcsDate(value, params);
      cur[key.toLowerCase()] = ms;
      if (key === 'DTSTART') cur.all_day = allDay;
    } else if (['SUMMARY', 'DESCRIPTION', 'CATEGORIES', 'UID', 'LOCATION', 'URL'].includes(key)) {
      cur[key.toLowerCase()] = unescape(value);
    }
  }
  return events;
}

// Moodle titles end with these (English and Portuguese site languages).
const DUE = /(is due|closes|due date|deadline|termina|fecha|data limite|prazo|encerra|entrega)/i;

export function moodleEventsToItems(events) {
  const deadlines = [], others = [];
  for (const e of events) {
    if (e.dtstart == null) continue;
    const title = (e.summary || '(untitled)').trim();
    const item = {
      id: 'moodle:' + (e.uid || title + iso(e.dtstart)),
      title,
      course: (e.categories || '').trim() || null,
      source: 'moodle',
    };
    if (DUE.test(title)) deadlines.push({ ...item, kind: 'deadline', due: iso(e.dtstart) });
    else others.push({ ...item, kind: 'event', start: iso(e.dtstart), end: iso(e.dtend ?? e.dtstart), all_day: !!e.all_day });
  }
  return { deadlines, events: others };
}

// Redirects are followed by hand so each hop can be checked against `allowed` (by default any
// https link; the server limits it to the university's hosts).
export async function syncMoodleIcs(icsUrl, { allowed = (u) => u.protocol === 'https:' } = {}) {
  if (!icsUrl) throw new Error('no Moodle calendar URL saved');
  let u;
  try { u = new URL(icsUrl); } catch { throw new Error('the Moodle calendar URL is not a valid link'); }
  let res;
  for (let hop = 0; ; hop++) {
    if (!allowed(u)) throw new Error(`not following the Moodle link to ${u.host}: only the university's own sites are allowed`);
    res = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const loc = res.headers.get('location');
    if (!(res.status >= 300 && res.status < 400 && loc)) break;
    await res.body?.cancel().catch(() => {});
    if (hop >= 5) throw new Error('Moodle redirected too many times');
    u = new URL(loc, u);
  }
  if (!res.ok) throw new Error(`Moodle answered HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Moodle did not return a calendar; the export URL may have expired');
  return moodleEventsToItems(parseIcs(text));
}

// ---------------------------------------------------------------- manual timetable (CSV)

const DAY_NAMES = { mon: 0, seg: 0, tue: 1, ter: 1, wed: 2, qua: 2, thu: 3, qui: 3, fri: 4, sex: 4, sat: 5, sab: 5, 'sáb': 5, sun: 6, dom: 6 };

export function manualClasses(csv, weeks = 2, today = todayLocal()) {
  const lines = String(csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const hasHead = head.includes('day');
  const cols = hasHead ? head : ['day', 'start', 'end', 'course', 'type', 'room', 'teacher'];
  const rows = (hasHead ? lines.slice(1) : lines).map((l) => {
    const cells = l.split(',').map((c) => c.trim());
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] || '']));
  });
  const first = mondayOf(today);
  const out = [];
  for (const row of rows) {
    const d = row.day.toLowerCase();
    const wd = /^\d+$/.test(d) ? Number(d) - 1 : DAY_NAMES[d.slice(0, 3)];
    if (wd == null || wd < 0 || wd > 6) continue;
    const [sh, sm] = row.start.split(':').map(Number);
    const [eh, em] = row.end.split(':').map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n)) || !row.course) continue;
    for (let w = 0; w < weeks; w++) {
      const day = addDays(first, 7 * w + wd);
      const start = zoned(day.y, day.m, day.d, sh, sm);
      const end = zoned(day.y, day.m, day.d, eh, em);
      out.push({
        id: `manual:${row.course}:${iso(start)}`,
        course: row.course, type: row.type || null, room: row.room || null, teacher: row.teacher || null,
        start: iso(start), end: iso(end), source: 'manual',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- merge

// Merge per-source results; a source that failed keeps its last good data. Within a source
// that worked, a part it could not fetch this time (left undefined, with a warning) keeps its
// last good copy too. `drop` lists sources to forget (no longer connected).
export function build(prev, results, { drop = [], now = Date.now() } = {}) {
  const sources = structuredClone(prev?.sources || {});
  const bySource = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.data || {}]));
  for (const name of drop) { delete sources[name]; delete bySource[name]; }
  for (const [name, [ok, payload]] of Object.entries(results)) {
    if (ok) {
      const { warnings = [], ...fresh } = payload;
      const kept = Object.entries(bySource[name] || {}).filter(([k]) => fresh[k] === undefined);
      bySource[name] = Object.fromEntries([...kept, ...Object.entries(fresh).filter(([, v]) => v !== undefined)]);
      sources[name] = { ok: true, synced_at: iso(now), error: null, warnings };
    } else {
      sources[name] = { ok: false, synced_at: sources[name]?.synced_at ?? null, error: payload, warnings: [] };
    }
  }
  for (const name of Object.keys(sources)) sources[name].data = bySource[name] || {};

  const collect = (key) => {
    const seen = new Set();
    return Object.values(bySource).flatMap((v) => v[key] || [])
      // Ignore anything that isn't a record (a malformed or hand-edited source could hold junk).
      .filter((i) => i && typeof i === 'object' && !Array.isArray(i))
      .filter((i) => {
        const k = i.id ?? JSON.stringify(i);
        return !seen.has(k) && seen.add(k);
      });
  };
  const first = (key) => Object.values(bySource).map((v) => v[key]).find((v) => v != null) ?? null;
  const by = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));
  const fees = first('fees');
  const prints = first('print_balance');
  return {
    schema: 'uni/1',
    generated_at: Object.keys(results).length || !prev?.generated_at ? iso(now) : prev.generated_at,
    classes: collect('classes').sort(by('start')),
    deadlines: collect('deadlines').sort(by('due')),
    events: collect('events').sort(by('start')),
    exams: collect('exams').sort(by('start')),
    courses: collect('courses'),
    profile: first('profile'),
    finance: fees || prints != null ? { fees, print_balance: prints } : null,
    sources,
  };
}

// What the browser gets: the same data without each source's raw copy.
export function forClient(data) {
  if (!data) return null;
  const sources = Object.fromEntries(Object.entries(data.sources || {}).map(([k, { data: _drop, ...v }]) => [k, v]));
  return { ...data, sources };
}
