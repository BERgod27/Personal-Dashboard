// A pretend SIGARRA for the tests: just enough of the pages and JSON the sync reads, in
// SIGARRA's style (ISO-8859-15 pages, loose HTML without <tbody> or closing </p>).
import http from 'node:http';
import { todayLocal, addDays, mondayOf, pad } from '../time.mjs';

// ISO-8859-15 differs from Latin-1 only in a few characters, like the euro sign.
const EXTRA = { '€': 0xa4, 'Š': 0xa6, 'š': 0xa8, 'Ž': 0xb4, 'ž': 0xb8, 'Œ': 0xbc, 'œ': 0xbd, 'Ÿ': 0xbe };
const latin9 = (s) => Buffer.from([...s].map((c) => EXTRA[c] ?? (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 0x3f)));

const day = (d) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;
const at = (d, hm) => `${day(d)}T${hm}:00`;

export function startFakeSigarra(opts = {}) {
  const o = {
    user: 'up202301234', password: 'right-pass', code: '202301234', faculties: ['feup'],
    calendar: true, // false: SIGARRA's new timetable page is missing, so the older endpoint is used
    loginReply: null, // 'expired', 'blocked', 'forbidden'/'botwall' (the front door turns the server away) or 'unknown' (a page we can't read)
    ...opts,
  };
  const monday = mondayOf(todayLocal());
  const log = [];
  const sessions = new Set();
  let n = 0;

  const page = (body, head = '', title = 'SIGARRA U.Porto') => latin9(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-15">${head}<title>${title}</title></head>
<body><div id="conteudoinner">${body}</div></body></html>`);

  const weekTable = (cls, mon, exams) => `<table  class="${cls}">
<tr>${['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((w, i) => `<th width="15%">${w}<br><span class="exame-data">${day(addDays(mon, i))}</span></th>`).join('\n')}</tr>
<tr>${[0, 1, 2, 3, 4, 5].map((i) => {
    const todays = exams.filter((e) => e.offset === i);
    if (!todays.length) return '<td class="l k" valign="top"><p></td>';
    return `<td class="l k" valign="top">\n<table  class="dados mapa">\n${todays.map((e) => `<tr class="d">
<td class="l exame"><a href="exa_geral.exame_view?p_exa_id=${e.id}" title="${e.name}" ><b>${e.acr}</b></a><br>${e.time}<br><img src="/feup/pt/imagens/Spacer" alt=""  class="border0" height="6"><br><span class="exame-sala">${e.rooms.map((r) => `<a href="instal_geral.espaco_view?pv_id=1" title="${r}" target="_blank" >${r}</a>`).join(', ')}</span></td>
</tr>`).join('\n')}\n</table>\n</td>`;
  }).join('\n')}</tr>
</table>`;

  // Exam maps per course unit occurrence. 5002's map also lists another unit's exam.
  const nextMon = addDays(monday, 7);
  const examMaps = {
    5001: [
      { season: 'Normal - Época Normal (1ºS)', mon: nextMon, exams: [{ id: 9001, offset: 2, acr: 'AMAT', name: 'Análise Matemática', time: '09:00-12:00', rooms: ['B104', 'B208'] }] },
      { season: 'Mini-testes (1ºS)', mon: addDays(monday, -7), exams: [{ id: 9000, offset: 1, acr: 'AMAT', name: 'Análise Matemática', time: '18:00-19:00', rooms: [] }] },
    ],
    5002: [
      { season: 'Recurso - Época Recurso (1ºS)', mon: addDays(monday, 14), exams: [
        { id: 9002, offset: 0, acr: 'FIS', name: 'Física I', time: '0:00-', rooms: [] },
        { id: 9003, offset: 3, acr: 'XYZ', name: 'Outra Cadeira', time: '14:00-17:00', rooms: ['B001'] },
      ] },
    ],
  };

  const routes = {
    'POST /feup/pt/vld_validacao.validacao': ({ form }) => {
      if (o.loginReply === 'expired') return { body: page('<p class="aviso-invalidado">A sua senha encontra-se expirada.</p>') };
      if (o.loginReply === 'blocked') return { body: page('<p class="aviso-invalidado">A sua conta encontra-se bloqueada.</p>') };
      if (o.loginReply === 'forbidden') return { status: 403, body: page('<h1>Acesso negado</h1>', '', 'Acesso negado') };
      if (o.loginReply === 'botwall') return { status: 403, body: page('<h1>Just a moment...</h1><p>Enable JavaScript and cookies to continue</p>', '', 'Just a moment...') };
      if (o.loginReply === 'unknown') return { body: page('<p>Estamos em manutenção.</p>', '', 'Manutenção') };
      if (form.get('p_user') !== o.user || form.get('p_pass') !== o.password) {
        return { body: page('<p class="aviso-invalidado">O conjunto utilizador/senha não é válido.</p>') };
      }
      const token = `s${++n}`;
      sessions.add(token);
      return {
        cookies: [`SI_SESSION=${token}; Path=/; HttpOnly`, 'SI_SECURITY=feup-only; Path=/feup/'],
        body: page('<p>A carregar...</p>', '<meta http-equiv="Refresh" content="0;url=web_page.inicial">'),
      };
    },
    'GET /feup/pt/web_page.inicial': ({ signedIn }) => (o.loginReply === 'forbidden' || o.loginReply === 'botwall' ? { status: 403, body: page('<h1>Just a moment...</h1>', '', 'Just a moment...') } : {
      body: page(signedIn
        ? `<div class="autenticado"><div class="fotografia"><img src="fotografias_service.foto?pct_cod=${o.code}" alt=""></div></div>`
        : '<form action="vld_validacao.validacao"><input name="p_user"></form>'),
    }),
    'GET /up/pt/vld_entidades_geral.entidade_pagina': ({ q }) => {
      if (q.get('pct_codigo') !== o.code) return { status: 404, body: page('') };
      return { body: page(`<ul>${o.faculties.map((f) => `<li><a href="/${f}/pt/web_page.inicial">${o.code} (${f.toUpperCase()})</a></li>`).join('')}</ul>`) };
    },
    'GET /feup/pt/hor_geral.estudantes_view': ({ q, origin }) => {
      if (!o.calendar) return { body: page('<p>Horário</p>') };
      if (q.get('pv_num_unico') !== o.code || q.get('pv_periodos') !== '1') return { body: page('') };
      return { body: page(`<div id="cal-shadow-container" data-evt-source-url="${origin}/feup/pt/hor_geral.lista_turmas_aulas?pv_ano_lectivo=${q.get('pv_ano_lectivo')}&amp;pv_num_unico=${o.code}"></div>`) };
    },
    'GET /feup/pt/hor_geral.lista_turmas_aulas': () => ({
      json: { data: [
        { start: at(addDays(monday, 1), '08:30'), end: at(addDays(monday, 1), '10:00'),
          ucs: [{ acronym: 'AMAT', name: 'L.EIC001 - Análise Matemática (AMAT)', sigarra_id: 5001 }], classes: [{ acronym: '1LEIC05' }],
          persons: [{ acronym: 'JMS', name: '211847 - João Silva' }], rooms: [{ name: 'B208' }], typology: { acronym: 'TP' } },
        { start: at(addDays(monday, 10), '14:00'), end: at(addDays(monday, 10), '16:00'),
          ucs: [{ acronym: 'FIS', name: 'L.EIC002 - Física I', sigarra_id: 5002 }],
          classes: ['1LEIC01', '1LEIC02', '1LEIC03', '1LEIC04', '1LEIC05'].map((acronym) => ({ acronym })),
          persons: [{ acronym: 'AB', name: '1 - Ana B' }, { acronym: 'CD', name: '2 - Carlos D' }], rooms: [{ name: 'B001' }, { name: 'B002' }], typology: { acronym: 'T' } },
        { start: at(addDays(monday, 35), '10:00'), end: at(addDays(monday, 35), '12:00'), // past the sync window
          ucs: [{ acronym: 'AMAT', name: 'Análise Matemática', sigarra_id: 5001 }], classes: [], persons: [], rooms: [], typology: { acronym: 'T' } },
      ] },
    }),
    'GET /feup/pt/mob_hor_geral.estudante': ({ q }) => {
      const sunday = day(addDays(monday, -1)).replaceAll('-', '');
      const nextSunday = day(addDays(monday, 6)).replaceAll('-', '');
      const horario = q.get('pv_semana_ini') === sunday
        ? [{ dia: 3, hora_inicio: 30600, aula_duracao: 1.5, ucurr_sigla: 'AMAT', tipo: 'TP', sala_sigla: 'B208', doc_sigla: 'JMS', turma_sigla: '1LEIC05', aula_id: 1 }]
        : q.get('pv_semana_ini') === nextSunday
          ? [{ dia: 1, hora_inicio: 36000, aula_duracao: 2, ucurr_sigla: 'FIS', tipo: 'T', sala_sigla: 'B001', doc_sigla: 'AB', turma_sigla: '1LEIC01', aula_id: 2 }]
          : [];
      return { json: { horario } };
    },
    'GET /feup/pt/mob_fest_geral.ucurr_inscricoes_corrente': () => ({
      json: [{ fest_id: 777, inscricoes: [
        { ucurr_sigla: 'AMAT', ucurr_nome: 'Análise Matemática', ocorr_id: 5001, ucurr_id: 11, ucurr_codigo: 'L.EIC001', ano: 1, per_codigo: '1S', per_nome: '1º Semestre', estado: 'V', creditos_ects: 6 },
        { ucurr_sigla: 'FIS', ucurr_nome: 'Física I', ocorr_id: 5002, ucurr_id: 12, ucurr_codigo: 'L.EIC002', ano: 1, per_codigo: '1S', estado: 'V', creditos_ects: 4.5 },
        { ucurr_sigla: 'OLD', ucurr_nome: 'Cadeira Anulada', ocorr_id: 5003, ucurr_id: 13, estado: 'A' },
      ] }],
    }),
    'GET /feup/pt/mob_fest_geral.perfil': () => ({
      json: { nome: 'Bernardo Teste', email: `up${o.code}@up.pt`, cursos: [{ cur_nome: 'Licenciatura em Engenharia Informática e Computação', cur_sigla: 'L.EIC', ano_curricular: '2', inst_sigla: 'FEUP', fest_id: 777, fest_a_lect_1_insc: 2024 }] },
    }),
    'GET /feup/pt/exa_geral.mapa_de_exames': ({ q }) => {
      const seasons = examMaps[q.get('p_ocorr_id')];
      if (!seasons) return { status: 500, body: page('<p>Erro</p>') };
      return { body: page(`${seasons.map((s) => `<h3>${s.season}</h3>\n<table >\n<tr><td>\n${weekTable('dados ', s.mon, s.exams)}\n<p>\n${weekTable('dadossz', addDays(s.mon, 7), [])}\n</td></tr>\n</table>`).join('\n')}
<h3>Especial de Conclusão</h3>\n<p>Não existem exames marcados.</p>`) };
    },
    'GET /feup/pt/gpag_ccorrente_geral.conta_corrente_view': () => ({
      body: page(`<div id="GPAG_CCORRENTE_GERAL_CONTA_CORRENTE_VIEW"><ul><li><a href="#tab0">Extrato Geral</a></li><li><a href="#tab1">Despesas não saldadas</a></li></ul>
<div id="tab0"><table class="tabela"><tr><th>Data</th><th>Limite</th></tr><tr><td class="data">2026-09-01</td><td class="data">2026-10-31</td></tr></table></div>
<div id="tab1"><table class="dadossz"><tr>${'<th>x</th>'.repeat(10)}</tr>
<tr><td>1</td><td>P</td><td>Propina - 2026/2027 - Prestação 2</td><td>2026-09-01</td><td>2026-10-31</td><td>69,70 €</td><td>0,00 €</td><td>69,70 €</td><td><a href="gpag_referencias.gerar?x=1">Pagar</a></td><td></td></tr>
</table></div></div>
<p>Saldo: <span id="span_saldo_total">-697,00</span></p>`),
    }),
    'GET /feup/pt/imp4_impressoes.atribs': () => ({ body: page('<div class="info">Saldo atual: 2,35 €</div>') }),
    'GET /feup/pt/vld_validacao.sair': ({ token }) => {
      sessions.delete(token);
      return { cookies: ['SI_SESSION=; Max-Age=0; Path=/'], body: page('<p>Sessão terminada</p>') };
    },
    'GET /feup/pt/leave': () => ({ status: 302, headers: { location: 'http://evil.example/steal' } }),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k));
    const token = cookies.SI_SESSION;
    const signedIn = sessions.has(token);
    const key = `${req.method} ${url.pathname}`;
    log.push({ key, query: Object.fromEntries(url.searchParams), cookie: req.headers.cookie || '' });
    const route = routes[key];
    const open = key.startsWith('POST /feup/pt/vld_validacao') || key === 'GET /feup/pt/web_page.inicial' || key === 'GET /feup/pt/leave';
    let r;
    if (!route) r = { status: 404, body: page('<p>Página não encontrada</p>') };
    else if (!open && !signedIn) r = { body: page('<p class="aviso">Tem de efetuar o login.</p>') };
    else if (url.pathname.startsWith('/feup/') && !open && cookies.SI_SECURITY !== 'feup-only') r = { status: 403, body: page('') };
    else {
      const origin = `http://${req.headers.host}`;
      r = await route({ q: url.searchParams, form: new URLSearchParams(Buffer.concat(chunks).toString()), signedIn, token, origin });
    }
    const headers = { ...(r.headers || {}) };
    if (r.cookies) headers['set-cookie'] = r.cookies;
    if (r.json) {
      headers['content-type'] = 'application/json; charset=utf-8';
      res.writeHead(r.status || 200, headers);
      res.end(JSON.stringify(r.json));
    } else {
      headers['content-type'] = 'text/html; charset=iso-8859-15';
      res.writeHead(r.status || 200, headers);
      res.end(r.body || '');
    }
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, log, opts: o, sessions, close: () => new Promise((r) => server.close(r)) });
  }));
}
