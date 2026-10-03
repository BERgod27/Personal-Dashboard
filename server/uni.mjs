// Server-side uni sync: a Node port of modules/uni/sync_uni.py.
// Same sources, same output contract (schema "uni/1"), so modules/uni/panel.js renders it unchanged.
//   Moodle  : calendar export URL (ICS)
//   SIGARRA : the unofficial mobile JSON endpoints used by the U.Porto "uni" app
//   Manual  : a pasted schedule.csv (day,start,end,course,type,room,teacher)

const LOCAL_TZ = 'Europe/Lisbon';
const UA = 'personal-dashboard-uni/1.0';

// ---------------------------------------------------------------- time zones

function offsetMinutes(ms, zone = LOCAL_TZ) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName').value; // "GMT+01:00" or "GMT"
  const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}

// Wall-clock time in a zone -> epoch ms.
export function zoned(y, mo, d, h = 0, mi = 0, s = 0, zone = LOCAL_TZ) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = naive - offsetMinutes(naive, zone) * 60e3;
  ms = naive - offsetMinutes(ms, zone) * 60e3; // second pass settles DST edges
  return ms;
}

const pad = (n) => String(n).padStart(2, '0');

// "2026-10-10T23:59+01:00", like Python's isoformat(timespec="minutes") in Lisbon time.
export function iso(ms) {
  const off = offsetMinutes(ms);
  const t = new Date(ms + off * 60e3);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// Today's date in Lisbon as {y, m, d}.
function todayLocal(nowMs = Date.now()) {
  const t = new Date(nowMs + offsetMinutes(nowMs) * 60e3);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Calendar-date arithmetic done in UTC so DST never shifts a day.
const dayKey = ({ y, m, d }) => Date.UTC(y, m - 1, d);
const fromKey = (k) => { const t = new Date(k); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const addDays = (date, n) => fromKey(dayKey(date) + n * 86400e3);
const weekday = (date) => (new Date(dayKey(date)).getUTCDay() + 6) % 7; // Monday = 0
export const mondayOf = (date) => addDays(date, -weekday(date));
const ymd = ({ y, m, d }) => `${y}${pad(m)}${pad(d)}`;

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

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
  return res;
}

export async function syncMoodleIcs(icsUrl) {
  if (!icsUrl) throw new Error('no Moodle calendar URL saved');
  if (!/^https:\/\//i.test(icsUrl)) throw new Error('the Moodle calendar URL must start with https://');
  const res = await get(icsUrl);
  if (!res.ok) throw new Error(`Moodle answered HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Moodle did not return a calendar; the export URL may have expired');
  return moodleEventsToItems(parseIcs(text));
}

// ---------------------------------------------------------------- SIGARRA

// fetch() drops cookies set on redirects, so this follows redirects by hand and keeps a jar.
class Session {
  constructor() { this.jar = new Map(); }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  keep(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  async fetch(url, init = {}) {
    for (let hop = 0; hop < 6; hop++) {
      const res = await get(url, { ...init, redirect: 'manual', headers: { ...(init.headers || {}), cookie: this.cookieHeader() } });
      this.keep(res);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url).href;
        init = { method: 'GET' };
        continue;
      }
      return res;
    }
    throw new Error('too many redirects');
  }
}

export function sigarraLectureToClass(l, monday) {
  // 'dia' uses the Portuguese convention: 2 = Monday (segunda-feira) ... 7 = Saturday, 1 = Sunday.
  const day = addDays(monday, (((Number(l.dia) - 2) % 7) + 7) % 7);
  const secs = typeof l.hora_inicio === 'string' && l.hora_inicio.includes(':')
    ? l.hora_inicio.split(':').slice(0, 2).reduce((h, m) => Number(h) * 3600 + Number(m) * 60)
    : Math.trunc(Number(l.hora_inicio));
  const start = zoned(day.y, day.m, day.d) + secs * 1000;
  const hours = parseFloat(String(l.aula_duracao ?? 1).replace(',', '.'));
  const end = start + hours * 3600e3;
  return {
    id: `sigarra:${l.aula_id || l.ocorrencia_id || ''}:${iso(start)}`,
    course: l.ucurr_sigla ?? null,
    type: l.tipo ?? null,
    room: l.sala_sigla ?? null,
    teacher: l.doc_sigla ?? null,
    group: l.turma_sigla ?? null,
    start: iso(start),
    end: iso(end),
    source: 'sigarra',
  };
}

export async function syncSigarra({ faculty, user, password, weeksAhead = 2 }) {
  if (!user) throw new Error('no SIGARRA username saved');
  if (!password) throw new Error('SIGARRA password needed');
  const base = `https://sigarra.up.pt/${String(faculty || 'feup').trim().toLowerCase()}/pt/`;
  const s = new Session();
  const json = async (res, what) => {
    const raw = await res.text();
    try { return JSON.parse(raw); } catch { throw new Error(`SIGARRA returned non-JSON for ${what} (session expired or endpoint changed)`); }
  };

  const login = await s.fetch(base + 'mob_val_geral.autentica', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pv_login: user, pv_password: password }).toString(),
  });
  const auth = await json(login, 'login');
  if (!auth.authenticated) throw new Error('SIGARRA login failed (check username and password)');
  const code = String(auth.codigo || user.replace(/\D/g, ''));

  const first = mondayOf(todayLocal());
  const classes = [];
  for (let w = 0; w < weeksAhead; w++) {
    const monday = addDays(first, 7 * w);
    const q = new URLSearchParams({ pv_codigo: code, pv_semana_ini: ymd(monday), pv_semana_fim: ymd(addDays(monday, 6)) });
    const res = await json(await s.fetch(`${base}mob_hor_geral.estudante?${q}`), 'timetable');
    for (const l of res.horario || []) classes.push(sigarraLectureToClass(l, monday));
  }
  const out = { classes };
  try {
    const res = await json(await s.fetch(`${base}mob_fest_geral.ucurr_inscricoes_corrente?pv_codigo=${encodeURIComponent(code)}`), 'courses');
    out.courses = (res.inscricoes || []).map((c) => ({
      code: c.ucurr_codigo || c.ucurr_sigla, acronym: c.ucurr_sigla, name: c.ucurr_nome, source: 'sigarra',
    }));
  } catch (e) {
    out.courses_error = e.message; // courses are nice to have; the timetable is what matters
  }
  return out;
}

// ---------------------------------------------------------------- manual timetable (CSV)

const DAY_NAMES = { mon: 0, seg: 0, tue: 1, ter: 1, wed: 2, qua: 2, thu: 3, qui: 3, fri: 4, sex: 4, sat: 5, sab: 5, 'sáb': 5, sun: 6, dom: 6 };

export function manualClasses(csv, weeks = 2, today = todayLocal()) {
  const lines = String(csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const rows = (head.includes('day') ? lines.slice(1) : lines).map((l) => {
    const cells = l.split(',').map((c) => c.trim());
    const cols = head.includes('day') ? head : ['day', 'start', 'end', 'course', 'type', 'room', 'teacher'];
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

// Merge per-source results; a source that failed keeps its last good data.
export function build(prev, results) {
  const sources = structuredClone(prev?.sources || {});
  const bySource = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, v.data || {}]));
  for (const [name, [ok, payload]] of Object.entries(results)) {
    if (ok) {
      bySource[name] = payload;
      sources[name] = { ok: true, synced_at: iso(Date.now()), error: null };
    } else {
      sources[name] = { ok: false, synced_at: sources[name]?.synced_at ?? null, error: payload };
    }
  }
  for (const name of Object.keys(sources)) sources[name].data = bySource[name] || {};

  const collect = (key) => {
    const seen = new Set();
    return Object.values(bySource).flatMap((v) => v[key] || []).filter((i) => !seen.has(i.id) && seen.add(i.id));
  };
  const by = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));
  return {
    schema: 'uni/1',
    generated_at: iso(Date.now()),
    classes: collect('classes').sort(by('start')),
    deadlines: collect('deadlines').sort(by('due')),
    events: collect('events').sort(by('start')),
    courses: collect('courses'),
    sources,
  };
}

// What the browser gets: the same data without each source's raw copy.
export function forClient(data) {
  if (!data) return null;
  const sources = Object.fromEntries(Object.entries(data.sources || {}).map(([k, { data: _drop, ...v }]) => [k, v]));
  return { ...data, sources };
}
