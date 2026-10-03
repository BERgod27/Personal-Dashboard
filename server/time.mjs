// Lisbon time helpers shared by the uni sources. Dates are kept as epoch ms and written
// out as ISO 8601 with the Lisbon offset ("2026-10-10T23:59+01:00").

export const LOCAL_TZ = 'Europe/Lisbon';

export function offsetMinutes(ms, zone = LOCAL_TZ) {
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

export const pad = (n) => String(n).padStart(2, '0');

// Like Python's isoformat(timespec="minutes") in Lisbon time.
export function iso(ms) {
  const off = offsetMinutes(ms);
  const t = new Date(ms + off * 60e3);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// "2026-10-06T08:30:00", "2026-10-06 08:30", "2026-10-06T07:30:00Z" or with an offset -> epoch ms.
// Times without a zone are Lisbon wall-clock times, as SIGARRA means them.
export function parseLocal(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return NaN;
  const [y, mo, d, h = 0, mi = 0, sec = 0] = m.slice(1, 7).map((v) => Number(v ?? 0));
  if (!m[7]) return zoned(y, mo, d, h, mi, sec);
  const utc = Date.UTC(y, mo - 1, d, h, mi, sec);
  if (m[7].toUpperCase() === 'Z') return utc;
  const [, sign, oh, om] = m[7].match(/([+-])(\d{2}):?(\d{2})/);
  return utc - (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60e3;
}

// Today's date in Lisbon as {y, m, d}.
export function todayLocal(nowMs = Date.now()) {
  const t = new Date(nowMs + offsetMinutes(nowMs) * 60e3);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Calendar-date arithmetic done in UTC so DST never shifts a day.
const dayKey = ({ y, m, d }) => Date.UTC(y, m - 1, d);
const fromKey = (k) => { const t = new Date(k); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
export const addDays = (date, n) => fromKey(dayKey(date) + n * 86400e3);
export const weekday = (date) => (new Date(dayKey(date)).getUTCDay() + 6) % 7; // Monday = 0
export const mondayOf = (date) => addDays(date, -weekday(date));
export const ymd = ({ y, m, d }) => `${y}${pad(m)}${pad(d)}`;
export const startOfDay = (date) => zoned(date.y, date.m, date.d);

// U.Porto's academic year starts in September; SIGARRA names it by its first calendar year.
export function lectiveYear(nowMs = Date.now()) {
  const t = todayLocal(nowMs);
  return t.m < 8 ? t.y - 1 : t.y;
}
