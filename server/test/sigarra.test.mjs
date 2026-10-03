// SIGARRA sync: page parsers on SIGARRA-style HTML, then the whole sync against a fake SIGARRA.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml } from '../html.mjs';
import {
  SigarraClient, syncSigarra, isCredentialError, decodeBody, loginResult, parseFaculties, lectureToClass, oldLectureToClass,
  parseExamMap, examsForUnit, parseFees, parseAmount, parsePrintBalance, toProfile, toCourse, validEnrolment, seasonCode,
} from '../sigarra.mjs';
import { todayLocal, mondayOf, addDays, pad } from '../time.mjs';
import { startFakeSigarra } from './fake-sigarra.mjs';

const monday = mondayOf(todayLocal());
const day = (d) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;

test('pages are decoded with their declared charset (SIGARRA uses ISO-8859-15)', () => {
  const bytes = Buffer.from([0x45, 0x70, 0x6f, 0x63, 0x61, 0x20, 0xc9, 0x20, 0xa4]); // "Epoca É €"
  assert.equal(decodeBody(bytes, 'text/html; charset=ISO-8859-15'), 'Epoca É €');
  assert.equal(decodeBody(Buffer.from('Época', 'utf8'), 'application/json'), 'Época');
  assert.equal(decodeBody(Buffer.from([0xc9, 0x70]), 'application/json'), 'Ép', 'invalid UTF-8 falls back to Windows-1252');
});

test('sign-in replies are told apart', () => {
  const doc = (body, head = '') => parseHtml(`<html><head>${head}</head><body>${body}</body></html>`);
  assert.equal(loginResult(doc('', '<meta http-equiv="refresh" content="0;url=x">')).kind, 'ok');
  assert.equal(loginResult(doc('<p class="aviso-invalidado">O conjunto utilizador/senha não é válido.</p>')).kind, 'credentials');
  assert.equal(loginResult(doc('<p class="aviso-invalidado">A sua senha encontra-se expirada.</p>')).kind, 'expired');
  assert.equal(loginResult(doc('<p class="aviso-invalidado">A sua conta encontra-se bloqueada.</p>')).kind, 'blocked');
  assert.equal(loginResult(doc('<p class="aviso-invalidado">Algo novo.</p>')).kind, 'refused');
  assert.equal(loginResult(doc('<p class="erro-nota">Já se encontra autenticado com o utilizador up1.</p>')).kind, 'already');
  assert.equal(loginResult(doc('<p>?</p>')).kind, 'unknown');
  assert.ok(isCredentialError({ kind: 'refused' }) && !isCredentialError({ kind: 'server' }));
});

test('faculties come from the list, or from where SIGARRA sends a one-faculty student', () => {
  const base = new URL('https://sigarra.up.pt');
  const list = parseHtml('<div id="conteudoinner"><ul><li><a href="/feup/pt/x">201906166 (FEUP)</a></li><li><a href="/fcup/pt/x">201906166 (FCUP)</a></li></ul></div>');
  assert.deepEqual(parseFaculties(list, new URL('https://sigarra.up.pt/up/pt/vld_entidades_geral.entidade_pagina'), base), ['feup', 'fcup']);
  const one = parseHtml('<a href="https://www.up.pt/">U.Porto</a><a href="web_page.inicial">Início</a>');
  assert.deepEqual(parseFaculties(one, new URL('https://sigarra.up.pt/fep/pt/web_page.inicial'), base), ['fep']);
  const up = parseHtml('<a href="https://www.up.pt/">U.Porto</a><a href="/flup/pt/web_page.inicial">FLUP</a>');
  assert.deepEqual(parseFaculties(up, new URL('https://sigarra.up.pt/up/pt/vld_entidades_geral.entidade_pagina'), base), ['flup']);
});

test('timetable feed entries become classes in Lisbon time', () => {
  const c = lectureToClass({
    start: '2026-10-06T08:30:00', end: '2026-10-06T10:00:00',
    ucs: [{ acronym: 'AMAT', name: 'L.EIC001 - Análise Matemática (AMAT)', sigarra_id: 5001 }],
    classes: [{ acronym: '1LEIC01' }, { acronym: '1LEIC02' }, { acronym: '1LEIC03' }, { acronym: '1LEIC04' }],
    persons: [{ acronym: 'JMS', name: '211847 - João Silva' }, { acronym: 'AB', name: '2 - Ana B' }],
    rooms: [{ name: 'B208' }, { name: 'B209' }], typology: { acronym: 'TP' },
  });
  assert.equal(c.start, '2026-10-06T08:30+01:00');
  assert.equal(c.end, '2026-10-06T10:00+01:00');
  assert.equal(c.course, 'AMAT');
  assert.equal(c.course_name, 'Análise Matemática');
  assert.equal(c.teacher, 'JMS+AB');
  assert.equal(c.teacher_name, 'João Silva');
  assert.equal(c.room, 'B208+B209');
  assert.equal(c.group, '1LEIC01 1LEIC02 1LEIC03 +1');
  assert.equal(lectureToClass({ start: 'soon' }), null);
  assert.equal(lectureToClass({ start: '2026-12-01T09:00:00', end: '2026-12-01T10:00:00', ucs: [] }).start, '2026-12-01T09:00+00:00');
});

test('older timetable endpoint: SIGARRA weeks start on Sunday', () => {
  const sunday = { y: 2026, m: 10, d: 4 };
  const tue = oldLectureToClass({ dia: 3, hora_inicio: 30600, aula_duracao: '1,5', ucurr_sigla: 'ES', tipo: 'TP', sala_sigla: 'B208', aula_id: 7 }, sunday);
  assert.equal(tue.start, '2026-10-06T08:30+01:00');
  assert.equal(tue.end, '2026-10-06T10:00+01:00');
  assert.equal(oldLectureToClass({ dia: 1, hora_inicio: 36000, aula_duracao: 2 }, sunday).start, '2026-10-04T10:00+01:00');
  assert.equal(oldLectureToClass({ dia: 7, hora_inicio: '09:00', aula_duracao: 1 }, sunday).start, '2026-10-10T09:00+01:00');
  assert.equal(oldLectureToClass({ dia: 0 }, sunday), null);
});

// SIGARRA's own markup style: no <tbody>, <p> left open, an <h3> per season.
const EXAM_MAP = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><html><body>
<h3>Normal - Época Normal (1ºS)</h3>
<table >
<tr><td>
<table  class="dados ">
<tr><th>Segunda<br><span class="exame-data">2026-01-12</span></th><th>Terça<br><span class="exame-data">2026-01-13</span></th><th>Quarta<br><span class="exame-data">2026-01-14</span></th></tr>
<tr>
<td class="l k" valign="top"><p></td>
<td class="l k" valign="top">
<table  class="dados mapa">
<tr class="d"><td class="l exame"><a href="exa_geral.exame_view?p_exa_id=101" title="Análise Matemática" ><b>AMAT1</b></a>(*)<br>9:00-12:00<br><img src="x"><br><span class="exame-sala"><a href="#">B104</a>, <a href="#">B208</a></span></td></tr>
<tr class="d"><td class="l exame"><a href="exa_geral.exame_view?p_exa_id=102" title="Física I" ><b>FIS</b></a><br>14:30-17:30<br><span class="exame-sala"></span></td></tr>
</table>
</td>
<td class="l k" valign="top"><p></td>
</tr>
</table>
<p>
<table  class="dadossz">
<tr><th>Segunda<br><span class="exame-data">2026-01-19</span></th><th>Terça<br><span class="exame-data">2026-01-20</span></th></tr>
<tr><td class="l k" valign="top"><p></td>
<td class="l k" valign="top"><table  class="dados mapa"><tr class="d"><td class="l exame"><a href="exa_geral.exame_view?p_exa_id=103" title="Análise Matemática" ><b>AMAT1</b></a><br>0:00-<br><span class="exame-sala"></span></td></tr></table></td></tr>
</table>
</td></tr>
</table>
<h3>Especial de Conclusão</h3>
<p>Não existem exames.</p>
<h3>Recurso - Época Recurso (1ºS)</h3>
<table><tr><td><table class="dados"><tr><th><span class="exame-data">2026-02-02</span></th></tr>
<tr><td class="l k"><table class="dados mapa"><tr class="d"><td class="l exame"><a href="exa_geral.exame_view?p_exa_id=104" title="Análise Matemática"><b>AMAT1</b></a><br>09:30-12:30<br><span class="exame-sala">B001</span></td></tr></table></td></tr>
</table></td></tr></table>
</body></html>`;

test('exam maps: seasons, days, times and rooms', () => {
  const exams = parseExamMap(parseHtml(EXAM_MAP));
  assert.deepEqual(exams.map((e) => [e.id, e.season, e.course, e.start, e.end, e.all_day, e.rooms.join(',')]), [
    ['sigarra:exam:101', 'EN', 'AMAT1', '2026-01-13T09:00+00:00', '2026-01-13T12:00+00:00', false, 'B104,B208'],
    ['sigarra:exam:102', 'EN', 'FIS', '2026-01-13T14:30+00:00', '2026-01-13T17:30+00:00', false, ''],
    ['sigarra:exam:103', 'EN', 'AMAT1', '2026-01-20T00:00+00:00', '2026-01-21T00:00+00:00', true, ''],
    ['sigarra:exam:104', 'ER', 'AMAT1', '2026-02-02T09:30+00:00', '2026-02-02T12:30+00:00', false, 'B001'],
  ]);
  assert.equal(exams[0].course_name, 'Análise Matemática');
  assert.equal(exams[0].season_name, 'Normal - Época Normal (1ºS)');
  // The map asked for AMAT1 also listed FIS: only AMAT1's are kept.
  assert.deepEqual(examsForUnit(exams, { ucurr_sigla: 'AMAT1', ucurr_nome: 'Análise Matemática' }).map((e) => e.id), ['sigarra:exam:101', 'sigarra:exam:103', 'sigarra:exam:104']);
  // If no exam carries the unit's acronym or name, the map is trusted as the unit's.
  assert.equal(examsForUnit(exams, { ucurr_sigla: 'X' }).length, 4);
  assert.equal(seasonCode('Exames ao abrigo de estatutos especiais - Mini-testes (1ºS)'), 'MT');
  assert.equal(seasonCode('Exames ao abrigo de estatutos especiais - Port.Est.Especiais 2ºS'), 'EE');
});

test('fees, amounts and print balance', () => {
  const fees = parseFees(parseHtml(`<div id="GPAG_CCORRENTE_GERAL_CONTA_CORRENTE_VIEW"><ul><li><a href="#tab0">Extrato Geral</a></li><li><a href="#tab3">Despesas não saldadas</a></li></ul>
    <div id="tab0"><table class="tabela"><tr><th>a</th></tr><tr><td class="data">2026-09-01</td><td class="data">2026-10-31</td></tr></table></div>
    <div id="tab3"><table><tr><th>h</th></tr><tr><td>1</td><td>P</td><td>Propina</td><td>2026-09-01</td><td>2026-10-31</td><td>69,70 €</td><td>0</td><td>69,70 €</td><td></td><td></td></tr>
    <tr><td>short row</td></tr></table></div></div><span id="span_saldo_total">-697,00</span>`));
  assert.deepEqual(fees, {
    balance: '-697,00 €', balance_value: -697, next_due: '2026-10-31',
    unpaid: [{ description: 'Propina', date: '2026-09-01', deadline: '2026-10-31', amount: 69.7, amount_due: 69.7 }],
  });
  assert.throws(() => parseFees(parseHtml('<p>Erro</p>')), /looks different/);
  assert.equal(parseAmount('1.234,56 €'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('-60.00'), -60);
  assert.equal(parseAmount(''), null);
  assert.equal(parsePrintBalance(parseHtml('<div id="conteudoinner"><div class="info">Saldo atual: <b>2,35 €</b></div></div>')), '2,35 €');
});

test('profile and course units', () => {
  const p = toProfile({ nome: 'Ana', email: 'a@up.pt', cursos: [{ fest_tipo_descr: 'Mestrado', cur_sigla: 'M.EIC', ano_curricular: 1, inst_sigla: 'FEUP', fest_id: 9 }] }, '202301234');
  assert.deepEqual(p.programmes[0], { name: 'Mestrado', acronym: 'M.EIC', year: '1', faculty: 'feup', first_year: null, fest_id: 9 });
  assert.throws(() => toProfile('<html>', '1'), /unexpected shape/);
  const u = { ucurr_sigla: 'AMAT', ucurr_nome: 'Análise', ocorr_id: 5, ucurr_codigo: 'L.EIC001', creditos_ects: '4,5', estado: 'V' };
  assert.equal(toCourse(u).id, 'sigarra:uc:5');
  assert.equal(toCourse(u).ects, 4.5);
  assert.ok(validEnrolment(u) && validEnrolment({ estado: 'C' }) && !validEnrolment({ estado: 'A' }));
});

let fake;
before(async () => { fake = await startFakeSigarra(); });
after(() => fake?.close());

test('full sync against a fake SIGARRA: sign-in, timetable feed, units, exams, profile, fees, prints', async () => {
  fake.log.length = 0;
  const out = await syncSigarra({ user: 'up202301234', password: 'right-pass', base: fake.base });
  assert.deepEqual(out.warnings, []);
  assert.deepEqual(out.faculties, ['feup']);
  assert.equal(out.student, '202301234');
  assert.equal(out.timetable_from, 'calendar');

  assert.equal(out.classes.length, 2, 'the class five weeks out is past the window');
  assert.equal(out.classes[0].start.slice(0, 16), `${day(addDays(monday, 1))}T08:30`);
  assert.equal(out.classes[0].course_name, 'Análise Matemática');
  assert.equal(out.classes[1].group, '1LEIC01 1LEIC02 1LEIC03 +2');

  assert.deepEqual(out.courses.map((c) => c.acronym), ['AMAT', 'FIS'], 'cancelled units are left out');
  assert.deepEqual(out.exams.map((e) => [e.course, e.season, e.start.slice(0, 16), e.all_day]), [
    ['AMAT', 'EN', `${day(addDays(monday, 9))}T09:00`, false],
    ['FIS', 'ER', `${day(addDays(monday, 14))}T00:00`, true],
  ], 'past exams and other units\' exams are dropped');
  assert.deepEqual(out.exams[0].rooms, ['B104', 'B208']);

  assert.equal(out.profile.name, 'Bernardo Teste');
  assert.equal(out.profile.programmes[0].acronym, 'L.EIC');
  assert.equal(out.fees.balance, '-697,00 €');
  assert.equal(out.fees.unpaid[0].description, 'Propina - 2026/2027 - Prestação 2');
  assert.equal(out.fees.unpaid[0].amount_due, 69.7);
  assert.equal(out.print_balance, '2,35 €');

  const keys = fake.log.map((r) => r.key);
  assert.ok(!keys.includes('GET /feup/pt/exa_geral.mapa_de_exames') || !fake.log.some((r) => r.query.p_ocorr_id === '5003'), 'no exams fetched for a cancelled unit');
  assert.equal(keys.at(-1), 'GET /feup/pt/vld_validacao.sair', 'signs out at the end');
  assert.equal(fake.sessions.size, 0);
  const facultyList = fake.log.find((r) => r.key.startsWith('GET /up/'));
  assert.match(facultyList.cookie, /SI_SESSION=/);
  assert.doesNotMatch(facultyList.cookie, /SI_SECURITY/, 'a cookie set for /feup/ stays on /feup/');
  const login = fake.log.find((r) => r.key.startsWith('POST'));
  assert.equal(login.cookie, '');
});

test('older timetable endpoint is used when the calendar page is missing', async () => {
  fake.opts.calendar = false;
  try {
    const out = await syncSigarra({ user: 'up202301234', password: 'right-pass', base: fake.base });
    assert.equal(out.timetable_from, 'mobile');
    assert.deepEqual(out.classes.map((c) => [c.course, c.start.slice(0, 16)]), [
      ['AMAT', `${day(addDays(monday, 1))}T08:30`],
      ['FIS', `${day(addDays(monday, 6))}T10:00`],
    ]);
    const weeks = fake.log.filter((r) => r.key.includes('mob_hor_geral')).map((r) => r.query.pv_semana_ini);
    assert.equal(weeks[0], day(addDays(monday, -1)).replaceAll('-', ''), 'weeks are asked from Sunday');
  } finally { fake.opts.calendar = true; }
});

test('a wrong, expired or blocked password stops the sync with a clear reason', async () => {
  await assert.rejects(syncSigarra({ user: 'up202301234', password: 'nope', base: fake.base }), (e) => e.kind === 'credentials' && /username or password is wrong/.test(e.message));
  fake.opts.loginReply = 'expired';
  await assert.rejects(syncSigarra({ user: 'up202301234', password: 'right-pass', base: fake.base }), (e) => e.kind === 'expired');
  fake.opts.loginReply = 'blocked';
  await assert.rejects(syncSigarra({ user: 'up202301234', password: 'right-pass', base: fake.base }), (e) => e.kind === 'blocked');
  fake.opts.loginReply = null;
  await assert.rejects(syncSigarra({ user: 'up202301234', password: '', base: fake.base }), /password needed/);
});

test('requests never leave U.Porto: a redirect elsewhere is refused before it is followed', async () => {
  const s = new SigarraClient({ base: fake.base });
  await assert.rejects(s.request(`${fake.base}/feup/pt/leave`), /only U\.Porto sites/);
  await assert.rejects(s.request('https://example.com/'), /only U\.Porto sites/);
  assert.ok(s.trusted(new URL('https://sigarra.up.pt/feup/')) && s.trusted(new URL('https://moodle2425.up.pt/')));
  assert.ok(!s.trusted(new URL('http://sigarra.up.pt/')) && !s.trusted(new URL('https://up.pt.evil.example/')));
});
