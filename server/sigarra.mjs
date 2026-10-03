// SIGARRA (sigarra.up.pt) for the server-side uni sync.
//
// SIGARRA has no public student API. This signs in and reads the same pages and JSON as
// U.Porto's student app "uni" (github.com/NIAEFEUP/uni): the web sign-in form, the home page
// for the student number, the faculty list, the timetable's calendar feed, current course
// units, exam maps, profile, fees and print balance. The requests and page layouts are the
// ones that app relies on; the code is our own.
//
// SIGARRA_BASE_URL points it at another server (the tests run a fake SIGARRA).

import { parseHtml } from './html.mjs';
import { iso, parseLocal, zoned, todayLocal, addDays, mondayOf, ymd, startOfDay, lectiveYear } from './time.mjs';

const DEFAULT_BASE = 'https://sigarra.up.pt';
// Like the uni app, the session is opened at FEUP whatever the student's faculty: it is valid
// on every faculty, and FEUP's home page shows the student's photo, whose link has the number.
const LOGIN_FACULTY = 'feup';
// A plain browser User-Agent. A bot screen that runs a JavaScript challenge still won't let a
// non-browser client through, but a lighter filter that only checks the User-Agent might.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_BYTES = 8 * 1024 * 1024;

export class SigarraError extends Error {
  constructor(message, kind = 'failed') {
    super(message);
    this.name = 'SigarraError';
    this.kind = kind;
  }
}

// SIGARRA turned the password down, or the sign-in failed in a way we can't read (so it may
// have). Trying the same one again won't help, and repeated failed sign-ins can get the
// account blocked.
export const isCredentialError = (e) => ['credentials', 'expired', 'blocked', 'refused', 'unconfirmed'].includes(e?.kind);

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const numberOf = (user) => /^(?:up)?(\d{5,})$/i.exec(String(user || '').trim())?.[1] ?? null;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(s || '');

// ---------------------------------------------------------------- HTTP

// Node builds without full ICU only know a few encodings; Latin-1 is the closest stand-in.
const decode = (label, buf) => { try { return new TextDecoder(label).decode(buf); } catch { return buf.toString('latin1'); } };

// SIGARRA pages are ISO-8859-15 and say so in the Content-Type; JSON is usually UTF-8.
export function decodeBody(buf, contentType = '') {
  let charset = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '')?.[1];
  if (!charset && /html/i.test(contentType || '')) {
    charset = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'))?.[1];
  }
  if (/^latin-?9$/i.test(charset || '')) charset = 'iso-8859-15';
  if (!charset) {
    const text = decode('utf-8', buf);
    return text.includes('\uFFFD') ? decode('windows-1252', buf) : text;
  }
  return decode(charset.toLowerCase(), buf);
}

async function readCapped(res) {
  const chunks = [];
  let size = 0;
  if (res.body) {
    for await (const c of res.body) {
      size += c.length;
      if (size > MAX_BYTES) throw new SigarraError('SIGARRA sent an unexpectedly large page.', 'changed');
      chunks.push(c);
    }
  }
  return Buffer.concat(chunks);
}

// What SIGARRA sent, in a few words for error messages: HTTP 403 "Acesso negado".
function answered(r) {
  const title = clean(parseHtml(r.text).querySelector('title')?.text).slice(0, 80);
  const to = r.location ? URL.parse(r.location, r.url) : null;
  return `HTTP ${r.status}${title ? ` "${title}"` : ''}${to ? ` to ${to.host}${to.pathname}` : ''}`;
}

// SIGARRA's sign-in reports a bad password with a 200 page and a warning, never a 403 or 503.
// A 403/503 — often a bot screen like Cloudflare's "Just a moment..." — is the site's front
// door turning the request away before SIGARRA sees it. Servers get this far more than phones
// do. So it is an infrastructure block, not a credential problem: the password was never
// checked, retrying it can't lock the account, and the saved one should be kept.
const EDGE_STATUS = new Set([403, 503]);
const looksLikeBotScreen = (r) =>
  /just a moment|attention required|enable javascript and cookies|cf-chl|cloudflare/i
    .test(`${parseHtml(r.text).querySelector('title')?.text || ''} ${r.text.slice(0, 2000)}`);

function edgeBlock(r, what) {
  const who = looksLikeBotScreen(r) ? "SIGARRA's bot screen (Cloudflare)" : 'SIGARRA';
  return Object.assign(
    new SigarraError(`${who} refused the request from the server (${answered(r)}) while loading the ${what}. It does this to servers even when the U.Porto app works on your phone, so it is not your password.`, 'edge'),
    { answered: answered(r) });
}

function check(r, what) {
  const fail = (message, kind) => Object.assign(new SigarraError(message, kind), { answered: answered(r) });
  if (EDGE_STATUS.has(r.status)) throw edgeBlock(r, what);
  if (r.status >= 500) throw fail(`SIGARRA had an error loading the ${what} (HTTP ${r.status}).`, 'server');
  if (r.status === 401) throw fail(`SIGARRA refused access to the ${what} (HTTP ${r.status}).`, 'session');
  if (r.status !== 200) throw fail(`SIGARRA answered HTTP ${r.status} for the ${what}.`, 'changed');
}

export class SigarraClient {
  constructor({ base = process.env.SIGARRA_BASE_URL || DEFAULT_BASE, timeoutMs = 25000 } = {}) {
    this.base = new URL(base);
    this.timeoutMs = timeoutMs;
    this.jar = new Map();
    this.code = null;
  }

  url(faculty, page, query = {}) {
    const u = new URL(`/${faculty}/pt/${page}`, this.base);
    for (const [k, v] of Object.entries(query)) if (v != null) u.searchParams.set(k, String(v));
    return u;
  }

  // Requests (and so the session cookie) only ever go to SIGARRA or other https U.Porto hosts.
  trusted(u) {
    return u.origin === this.base.origin || (u.protocol === 'https:' && /(^|\.)up\.pt$/i.test(u.hostname));
  }

  // A small browser-like cookie jar: cookies are kept per host and path, and a request gets
  // the ones whose path covers it, most specific first.
  keepCookies(res, u) {
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      let path = u.pathname.slice(0, u.pathname.lastIndexOf('/')) || '/';
      let domain = null;
      let gone = !value;
      for (const a of attrs) {
        const j = a.indexOf('=');
        const k = (j < 0 ? a : a.slice(0, j)).trim().toLowerCase();
        const v = j < 0 ? '' : a.slice(j + 1).trim();
        if (k === 'path' && v.startsWith('/')) path = v;
        else if (k === 'domain' && v) domain = v.replace(/^\./, '').toLowerCase();
        else if (k === 'max-age') gone ||= !(Number(v) > 0);
        else if (k === 'expires') gone ||= Date.parse(v) < Date.now();
      }
      if (domain && u.hostname !== domain && !u.hostname.endsWith('.' + domain)) continue; // not this site's to set
      const host = domain || u.hostname;
      const key = `${name}\n${host}\n${path}`;
      if (gone) this.jar.delete(key);
      else this.jar.set(key, { name, value, host, hostOnly: !domain, path });
    }
  }

  cookiesFor(u) {
    const dir = (p) => (p.endsWith('/') ? p : p + '/');
    return [...this.jar.values()]
      .filter((c) => (c.hostOnly ? u.hostname === c.host : u.hostname === c.host || u.hostname.endsWith('.' + c.host)))
      .filter((c) => u.pathname === c.path || u.pathname.startsWith(dir(c.path)))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  // Follows redirects by hand so cookies set along the way are kept (fetch() would drop them)
  // and so a redirect can never take the session cookie to another site.
  async request(target, { method = 'GET', form = null, follow = true } = {}) {
    let u = new URL(target);
    let body = form ? new URLSearchParams(form).toString() : undefined;
    for (let hop = 0; hop < 8; hop++) {
      if (!this.trusted(u)) throw new SigarraError(`Not following SIGARRA to ${u.host}: only U.Porto sites are allowed.`, 'changed');
      const headers = {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pt-PT,pt;q=0.9,en;q=0.5',
      };
      const cookie = this.cookiesFor(u);
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
      let res;
      try {
        res = await fetch(u, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        throw new SigarraError(e.name === 'TimeoutError' ? 'SIGARRA took too long to answer.'
          : `Could not reach SIGARRA (${e.cause?.code || e.cause?.message || e.message}).`, 'unreachable');
      }
      this.keepCookies(res, u);
      const loc = res.headers.get('location');
      if (follow && res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel().catch(() => {});
        if (res.status !== 307 && res.status !== 308) { method = 'GET'; body = undefined; }
        u = new URL(loc, u);
        continue;
      }
      const buf = await readCapped(res);
      return { status: res.status, url: u, location: loc, text: decodeBody(buf, res.headers.get('content-type')) };
    }
    throw new SigarraError('SIGARRA redirected too many times.', 'changed');
  }

  async page(u, what) {
    const r = await this.request(u);
    check(r, what);
    return { ...r, doc: parseHtml(r.text) };
  }

  async json(u, what) {
    const r = await this.request(u);
    check(r, what);
    try { return JSON.parse(r.text); } catch {
      throw new SigarraError(`SIGARRA sent a web page instead of the ${what} (signed out, or SIGARRA changed).`, 'changed');
    }
  }

  // ---------------------------------------------------------------- session

  async login(user, password) {
    const r = await this.request(this.url(LOGIN_FACULTY, 'vld_validacao.validacao'),
      { method: 'POST', form: { p_user: user, p_pass: password }, follow: false });
    if (EDGE_STATUS.has(r.status)) throw edgeBlock(r, 'sign-in');
    if (r.status >= 500) throw new SigarraError(`SIGARRA's sign-in is having problems (HTTP ${r.status}). Try again later.`, 'server');
    const result = r.status === 200 ? loginResult(parseHtml(r.text)) : { kind: 'unknown' };
    if (result.kind === 'credentials') throw new SigarraError('SIGARRA says the username or password is wrong.', 'credentials');
    if (result.kind === 'expired') throw new SigarraError('Your SIGARRA password has expired. Change it on sigarra.up.pt, then sync with the new one.', 'expired');
    if (result.kind === 'blocked') throw new SigarraError('SIGARRA says your account is blocked. Sort it out on sigarra.up.pt first.', 'blocked');
    if (result.kind === 'refused') throw new SigarraError(`SIGARRA refused the sign-in: "${result.text}"`, 'refused');

    // Signed in, or SIGARRA answered something unfamiliar: the home page tells for sure.
    let homeSaid = 'showed no one signed in';
    const home = await this.home().catch((e) => {
      if (e.kind === 'edge') throw e; // the front door blocked us: that is the real reason
      homeSaid = e.answered ? `answered ${e.answered}` : `could not be read (${e.message.replace(/\.$/, '')})`;
      return { signedIn: false, code: null };
    });
    if (home.signedIn) {
      if (home.code || numberOf(user)) return (this.code = home.code || numberOf(user));
      throw new SigarraError('Signed in, but SIGARRA did not show your student number. Use your up number as the username.', 'changed');
    }
    if ((result.kind === 'ok' || result.kind === 'already') && numberOf(user)) return (this.code = numberOf(user));
    // No second sign-in with the same password: an unreadable answer may still have been a
    // failed attempt. Say what SIGARRA sent instead, so the cause can be found.
    const note = result.text ? `, saying "${result.text.slice(0, 120)}"` : '';
    throw new SigarraError(`SIGARRA did not confirm the sign-in. The sign-in answered ${answered(r)}${note}, and the home page ${homeSaid}.`, 'unconfirmed');
  }

  async home() {
    const { doc } = await this.page(this.url(LOGIN_FACULTY, 'web_page.inicial'), 'home page');
    const header = doc.querySelector('.autenticado');
    if (!header) return { signedIn: false, code: null };
    const src = header.querySelector('.fotografia img')?.getAttribute('src') || '';
    return { signedIn: true, code: /[?&]pct_cod=(\d+)/.exec(src)?.[1] ?? null };
  }

  async logout() {
    try { await this.request(this.url(LOGIN_FACULTY, 'vld_validacao.sair')); } catch { /* the session expires on its own */ }
    this.jar.clear();
  }

  // ---------------------------------------------------------------- data

  // Faculties the student is enrolled in, like ['feup'] or ['feup', 'fcup'].
  async faculties(code) {
    const r = await this.page(new URL(`/up/pt/vld_entidades_geral.entidade_pagina?pct_codigo=${encodeURIComponent(code)}`, this.base), 'faculty list');
    return parseFaculties(r.doc, r.url, this.base);
  }

  // Classes from this week's Monday for `weeks` weeks.
  async timetable(faculties, code, { weeks = 2, now = Date.now() } = {}) {
    const monday = mondayOf(todayLocal(now));
    const from = startOfDay(monday);
    const to = startOfDay(addDays(monday, 7 * Math.max(1, weeks)));
    const inWindow = (c) => c && Date.parse(c.end) > from && Date.parse(c.start) < to;
    const problems = [];
    const classes = [];
    let found = false;
    // SIGARRA's current timetable page loads its classes from a calendar feed.
    for (const fac of faculties) {
      try {
        const page = await this.page(this.url(fac, 'hor_geral.estudantes_view',
          { pv_num_unico: code, pv_ano_lectivo: lectiveYear(now), pv_periodos: 1 }), 'timetable');
        const src = page.doc.querySelector('#cal-shadow-container')?.getAttribute('data-evt-source-url');
        if (!src) continue;
        const json = await this.json(new URL(src, page.url), 'timetable');
        if (!Array.isArray(json?.data)) throw new SigarraError('the timetable feed has an unexpected shape', 'changed');
        found = true;
        classes.push(...json.data.map(lectureToClass).filter(inWindow));
      } catch (e) { problems.push(`${fac.toUpperCase()}: ${e.message}`); }
    }
    if (found) return { classes: dedupe(classes), via: 'calendar', problems };

    // Older JSON endpoint, one SIGARRA week (Sunday to Saturday) at a time.
    for (const fac of faculties) {
      try {
        const out = [];
        let sunday = addDays(monday, -1);
        for (let w = 0; w <= weeks; w++, sunday = addDays(sunday, 7)) {
          const json = await this.json(this.url(fac, 'mob_hor_geral.estudante',
            { pv_codigo: code, pv_semana_ini: ymd(sunday), pv_semana_fim: ymd(addDays(sunday, 6)) }), 'timetable');
          out.push(...(json?.horario || []).map((l) => oldLectureToClass(l, sunday)).filter(inWindow));
        }
        return { classes: dedupe(out), via: 'mobile', problems };
      } catch (e) { problems.push(`${fac.toUpperCase()} (older timetable): ${e.message}`); }
    }
    throw new SigarraError(`Could not load the timetable. ${problems.join(' ')}`.trim(), 'changed');
  }

  // Current enrolments, one entry per course unit (all programmes).
  async courseUnits(faculty, code) {
    const json = await this.json(this.url(faculty, 'mob_fest_geral.ucurr_inscricoes_corrente', { pv_codigo: code }), 'course units');
    const programmes = Array.isArray(json) ? json : Array.isArray(json?.inscricoes) ? [json] : null;
    if (!programmes) throw new SigarraError('SIGARRA\'s course unit list has an unexpected shape.', 'changed');
    return programmes.flatMap((p) => (p?.inscricoes || []).map((u) => ({ ...u, fest_id: p.fest_id ?? u.fest_id ?? null })));
  }

  async profile(faculty, code) {
    const p = await this.json(this.url(faculty, 'mob_fest_geral.perfil', { pv_codigo: code }), 'profile');
    return toProfile(p, code);
  }

  async exams(units, facultyOf, { now = Date.now(), concurrency = 4 } = {}) {
    const seen = new Set();
    const targets = units.filter((u) => u.ocorr_id != null && !seen.has(u.ocorr_id) && seen.add(u.ocorr_id));
    const problems = [];
    const lists = await mapLimit(targets, concurrency, async (u) => {
      try {
        const { doc } = await this.page(this.url(facultyOf(u), 'exa_geral.mapa_de_exames', { p_ocorr_id: u.ocorr_id }), `${u.ucurr_sigla || 'course'} exam map`);
        return examsForUnit(parseExamMap(doc), u);
      } catch (e) { problems.push(`${u.ucurr_sigla || u.ocorr_id}: ${e.message}`); return []; }
    });
    if (targets.length && problems.length === targets.length) throw new SigarraError(`No exam map could be loaded (${problems[0]}).`, 'changed');
    const exams = dedupe(lists.flat()).filter((e) => Date.parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start));
    return { exams, problems };
  }

  async fees(faculty, code) {
    const { doc } = await this.page(this.url(faculty, 'gpag_ccorrente_geral.conta_corrente_view', { pct_cod: code }), 'current account');
    return parseFees(doc);
  }

  // Only FEUP has print accounts in SIGARRA.
  async printBalance(code) {
    const { doc } = await this.page(this.url('feup', 'imp4_impressoes.atribs', { p_codigo: code }), 'print balance');
    return parsePrintBalance(doc);
  }
}

// ---------------------------------------------------------------- parsers

export function loginResult(doc) {
  const refresh = doc.querySelectorAll('meta[http-equiv]').some((m) => (m.getAttribute('http-equiv') || '').toLowerCase() === 'refresh');
  if (refresh) return { kind: 'ok' };
  const warning = clean(doc.querySelector('p.aviso-invalidado')?.text);
  if (warning) {
    if (/expirad/i.test(warning)) return { kind: 'expired', text: warning };
    if (/bloquead/i.test(warning)) return { kind: 'blocked', text: warning };
    if (/utilizador\/senha/i.test(warning)) return { kind: 'credentials', text: warning };
    return { kind: 'refused', text: warning };
  }
  const note = clean(doc.querySelector('p.erro-nota')?.text);
  if (/^Já se encontra autenticado/i.test(note)) return { kind: 'already', text: note };
  return { kind: 'unknown', text: note };
}

export function parseFaculties(doc, pageUrl, base) {
  const listed = doc.querySelectorAll('#conteudoinner > ul a')
    .map((a) => /\(([A-Za-z]+)\)\s*$/.exec(clean(a.text))?.[1]?.toLowerCase())
    .filter(Boolean);
  if (listed.length) return [...new Set(listed)];
  // One faculty: SIGARRA skips the list and goes straight to that faculty's pages.
  const facultyIn = (u) => {
    if (u.origin !== base.origin) return null;
    const seg = u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return seg && seg !== 'up' && /^[a-z]{2,12}$/.test(seg) ? seg : null;
  };
  let fac = facultyIn(pageUrl);
  for (const a of doc.querySelectorAll('a[href]')) {
    if (fac) break;
    try { fac = facultyIn(new URL(a.getAttribute('href'), pageUrl)); } catch { /* skip */ }
  }
  return fac ? [fac] : [];
}

// "L.EIC001 - Álgebra Linear (ALGA)" -> "Álgebra Linear"
const subjectName = (s) => / - ([^()]*)(?: \(|$)/.exec(s)?.[1]?.trim() || s;
// "232323 - Ana Silva" -> "Ana Silva"
const personName = (s) => / - (.+)$/.exec(s)?.[1]?.trim() || s;

// One class from the calendar feed: { start, end, ucs, classes, persons, rooms, typology }.
export function lectureToClass(l) {
  const start = parseLocal(l?.start);
  const end = parseLocal(l?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const unit = l.ucs?.[0] || {};
  const persons = (l.persons || []).filter(Boolean);
  const groups = (l.classes || []).map((c) => c?.acronym).filter(Boolean);
  return {
    id: `sigarra:${unit.sigarra_id ?? unit.acronym ?? ''}:${l.typology?.acronym ?? ''}:${iso(start)}`,
    course: unit.acronym ?? null,
    course_name: unit.name ? subjectName(unit.name) : null,
    type: l.typology?.acronym ?? null,
    room: (l.rooms || []).map((r) => r?.name).filter(Boolean).join('+') || null,
    teacher: persons.map((p) => p.acronym).filter(Boolean).join('+') || null,
    teacher_name: persons[0]?.name ? personName(persons[0].name) : null,
    group: (groups.length > 3 ? [...groups.slice(0, 3), `+${groups.length - 3}`] : groups).join(' ') || null,
    start: iso(start),
    end: iso(end),
    source: 'sigarra',
  };
}

// One class from the older endpoint. SIGARRA weeks start on Sunday: dia 1 = Sunday ... 7 = Saturday.
export function oldLectureToClass(l, sunday) {
  const dia = Number(l?.dia);
  if (!(dia >= 1 && dia <= 7)) return null;
  const day = addDays(sunday, dia - 1);
  const secs = typeof l.hora_inicio === 'string' && l.hora_inicio.includes(':')
    ? l.hora_inicio.split(':').slice(0, 2).reduce((h, m) => Number(h) * 3600 + Number(m) * 60)
    : Math.trunc(Number(l.hora_inicio));
  const hours = parseFloat(String(l.aula_duracao ?? 1).replace(',', '.'));
  if (!Number.isFinite(secs) || !Number.isFinite(hours)) return null;
  const start = zoned(day.y, day.m, day.d) + secs * 1000;
  return {
    id: `sigarra:${l.aula_id || l.ocorrencia_id || l.ucurr_sigla || ''}:${iso(start)}`,
    course: l.ucurr_sigla ?? null,
    course_name: null,
    type: l.tipo ?? null,
    room: l.sala_sigla ?? null,
    teacher: l.doc_sigla ?? null,
    teacher_name: l.docentes?.[0]?.doc_nome ?? null,
    group: l.turma_sigla ?? null,
    start: iso(start),
    end: iso(start + hours * 3600e3),
    source: 'sigarra',
  };
}

// Valid ('V') or completed ('C') enrolments; others were cancelled.
export const validEnrolment = (u) => !u.estado || u.estado === 'V' || u.estado === 'C';

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function toCourse(u) {
  return {
    id: `sigarra:uc:${u.ocorr_id ?? u.ucurr_id ?? u.ucurr_sigla}`,
    code: u.ucurr_codigo || null,
    acronym: u.ucurr_sigla || null,
    name: u.ucurr_nome || null,
    ects: num(u.creditos_ects),
    semester: u.per_nome || u.per_codigo || null,
    year: u.ano ?? null,
    status: u.estado ?? null,
    grade: u.resultado_melhor ?? null,
    occurrence: u.ocorr_id ?? null,
    source: 'sigarra',
  };
}

export function toProfile(p, code) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new SigarraError('SIGARRA\'s profile has an unexpected shape.', 'changed');
  return {
    name: p.nome || null,
    email: p.email || null,
    number: code ?? null,
    programmes: (Array.isArray(p.cursos) ? p.cursos : []).map((c) => ({
      name: c.cur_nome || c.fest_tipo_descr || null,
      acronym: c.cur_sigla || null,
      year: c.ano_curricular != null ? String(c.ano_curricular) : null,
      faculty: c.inst_sigla ? String(c.inst_sigla).toLowerCase() : null,
      first_year: c.fest_a_lect_1_insc ?? null,
      fest_id: c.fest_id ?? null,
    })),
  };
}

// Exam seasons by the words in each section heading, checked in this order.
const SEASONS = [
  ['Mini-testes', 'MT'], ['Normal', 'EN'], ['Recurso', 'ER'], ['Especial de Conclusão', 'EC'],
  ['Port.Est.Especiais', 'EE'], ['Exames ao abrigo de estatutos especiais', 'EAE'],
];
export const seasonCode = (title) => SEASONS.find(([words]) => title.includes(words))?.[1] ?? '?';

// Exam map: per season an <h3> and a table holding week tables. Each week table has a row of
// dates (<span class="exame-data">) and a row of day cells (td.l.k) with the exams of that day.
export function parseExamMap(doc) {
  const out = [];
  for (const h3 of doc.querySelectorAll('h3')) {
    let box = h3.nextElementSibling;
    while (box && box.tagName !== 'TABLE' && box.tagName !== 'H3') box = box.nextElementSibling;
    if (!box || box.tagName !== 'TABLE') continue;
    const seasonName = clean(h3.text);
    const season = seasonCode(seasonName);
    for (const week of [box, ...box.querySelectorAll('table')]) {
      if (week.hasClass('mapa')) continue;
      const own = (el) => el.closest('table') === week;
      const dates = week.querySelectorAll('span.exame-data').filter(own).map((s) => clean(s.text));
      week.querySelectorAll('td.l.k').filter(own).forEach((cell, i) => {
        if (!isDate(dates[i])) return;
        for (const ex of cell.querySelectorAll('td.exame')) out.push(examFromCell(ex, dates[i].slice(0, 10), season, seasonName));
      });
    }
  }
  return out;
}

function examFromCell(ex, date, season, seasonName) {
  const link = ex.querySelector('a[href*="p_exa_id"]') || ex.querySelector('a');
  const id = /[?&]p_exa_id=(\d+)/.exec(link?.getAttribute('href') || '')?.[1] ?? null;
  const course = clean(ex.querySelector('b')?.text) || null;
  const rooms = clean(ex.querySelector('span.exame-sala')?.text).split(',').map((s) => s.trim()).filter(Boolean);
  const [y, m, d] = date.split('-').map(Number);
  const t = /(?<![\d:])(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(ex.spacedText);
  const start = t ? zoned(y, m, d, +t[1], +t[2]) : zoned(y, m, d);
  const end = t ? Math.max(start, zoned(y, m, d, +t[3], +t[4])) : startOfDay(addDays({ y, m, d }, 1));
  return {
    id: `sigarra:exam:${id ?? `${course}:${date}:${season}`}`,
    course,
    course_name: clean(link?.getAttribute('title')) || null,
    season,
    season_name: seasonName,
    start: iso(start),
    end: iso(end),
    all_day: !t,
    rooms,
    source: 'sigarra',
  };
}

// The exam map asked for one course unit. If it also lists other units, keep this one's.
export function examsForUnit(exams, u) {
  const norm = (s) => clean(s).toLowerCase();
  const mine = exams.filter((e) => (e.course && norm(e.course) === norm(u.ucurr_sigla)) || (e.course_name && norm(e.course_name) === norm(u.ucurr_nome)));
  return (mine.length ? mine : exams).map((e) => ({ ...e, course: e.course || u.ucurr_sigla || null, course_name: e.course_name || u.ucurr_nome || null }));
}

// "1.234,56 €", "697,00", "-60.00" -> number
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[€\s\u00a0]/g, '');
  if (!s) return null;
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma > -1 && dot > -1) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (comma > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
}

const UNPAID_TABS = ['Despesas não saldadas', 'Unpaid expenses'];

export function parseFees(doc) {
  const balanceEl = doc.querySelector('#span_saldo_total');
  const tabLink = doc.querySelectorAll('#GPAG_CCORRENTE_GERAL_CONTA_CORRENTE_VIEW ul li a').find((a) => UNPAID_TABS.includes(clean(a.text)));
  const tabId = (tabLink?.getAttribute('href') || '').replace(/^#/, '');
  const tab = tabId ? doc.getElementById(tabId) : null;
  if (!balanceEl && !tab) throw new SigarraError('SIGARRA\'s current account page looks different than expected.', 'changed');
  const unpaid = [];
  for (const row of (tab?.querySelectorAll('tr') || []).slice(1)) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 10) continue;
    const date = clean(cells[3].text);
    if (!isDate(date)) continue;
    const deadline = clean(cells[4].text);
    unpaid.push({
      description: clean(cells[2].text),
      date: date.slice(0, 10),
      deadline: isDate(deadline) ? deadline.slice(0, 10) : null,
      amount: parseAmount(cells[5].text),
      amount_due: parseAmount(cells[7].text),
    });
  }
  // The uni app's "next payment limit": second date of the first row on the first tab.
  const firstRow = doc.querySelectorAll('#tab0 .tabela tr')[1];
  const limit = clean(firstRow?.querySelectorAll('.data')[1]?.text);
  const balance = clean(balanceEl?.text);
  return {
    balance: balance ? (balance.includes('€') ? balance : `${balance} €`) : null,
    balance_value: parseAmount(balance),
    next_due: isDate(limit) ? limit.slice(0, 10) : unpaid.map((u) => u.deadline).filter(Boolean).sort()[0] ?? null,
    unpaid,
  };
}

export function parsePrintBalance(doc) {
  const text = clean(doc.querySelector('div#conteudoinner > .info')?.text);
  if (!text) throw new SigarraError('SIGARRA\'s print page looks different than expected.', 'changed');
  const value = text.includes(':') ? text.slice(text.indexOf(':') + 1).trim() : '';
  return value || null;
}

// ---------------------------------------------------------------- the sync

function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => i && !seen.has(i.id) && seen.add(i.id));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Signs in, fetches everything, signs out. Only a failed sign-in fails the whole sync; any other
// part that fails is left out of the result (the dashboard keeps its last good copy) and is
// listed in `warnings`.
export async function syncSigarra({ user, password, faculty = '', weeksAhead = 2, base, now = Date.now() } = {}) {
  if (!user) throw new SigarraError('No SIGARRA username saved.', 'setup');
  if (!password) throw new SigarraError('SIGARRA password needed.', 'setup');
  const s = new SigarraClient({ base });
  const warnings = [];
  const part = async (label, fn) => {
    try { return await fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); return undefined; }
  };
  try {
    const code = await s.login(String(user).trim(), password);

    const preferred = String(faculty || '').trim().toLowerCase();
    let faculties = (await part('Faculties', () => s.faculties(code))) || [];
    if (!faculties.length) faculties = [preferred || LOGIN_FACULTY];
    else if (faculties.includes(preferred)) faculties = [preferred, ...faculties.filter((f) => f !== preferred)];
    const main = faculties[0];

    const [timetable, units, profile, fees, prints] = await Promise.all([
      part('Timetable', () => s.timetable(faculties, code, { weeks: weeksAhead, now })),
      part('Course units', () => s.courseUnits(main, code)),
      part('Profile', () => s.profile(main, code)),
      part('Fees', () => s.fees(main, code)),
      faculties.includes('feup') ? part('Print balance', () => s.printBalance(code)) : Promise.resolve(undefined),
    ]);

    const out = { warnings, faculties, student: code };
    if (timetable) {
      out.classes = timetable.classes;
      out.timetable_from = timetable.via;
      if (timetable.via === 'mobile' && timetable.problems.length) warnings.push(`Timetable: used the older endpoint (${timetable.problems.join(' ')})`);
    }
    if (profile) out.profile = { ...profile, faculties };
    if (fees) out.fees = fees;
    if (prints !== undefined) out.print_balance = prints;
    if (units) {
      const current = units.filter(validEnrolment);
      out.courses = current.map(toCourse);
      const facultyOf = (u) => {
        const f = profile?.programmes.find((p) => p.fest_id != null && p.fest_id === u.fest_id)?.faculty;
        return f && faculties.includes(f) ? f : main;
      };
      const exams = await part('Exams', () => s.exams(current, facultyOf, { now }));
      if (exams) {
        out.exams = exams.exams;
        if (exams.problems.length) warnings.push(`Exams: ${exams.problems.length} exam map(s) failed (${exams.problems[0]})`);
      }
    }
    return out;
  } finally {
    await s.logout();
  }
}
