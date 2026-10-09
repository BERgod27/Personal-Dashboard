/*
 * CSV export and import for the workout tracker, used by the Settings tab in
 * workouts.js. Pure functions: text in, sessions out.
 *
 * Export writes one row per set, the layout every gym app uses, so the file
 * opens in a spreadsheet and comes back in without loss.
 *
 * Import reads that file, and exports from Strong, Hevy and FitNotes. Columns
 * are found by their header name, not position, so a spreadsheet with a date,
 * an exercise and some numbers usually works too. The header-alias approach
 * follows openGym's importer and SparkyFitness's history import; neither
 * project's code is used (openGym is AGPL-3.0, SparkyFitness non-commercial
 * only), the column names below are the apps' published export formats.
 *
 * Load after workouts.js; it exposes DashboardModules.workoutTransfer.
 */
(function (global) {
  'use strict';

  var KG_PER_LB = 0.45359237, KM_PER_MI = 1.609344;

  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function key(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  // ---------- CSV text ----------
  // Quoted fields with commas, newlines and doubled quotes; BOM; CRLF.
  function parseCSV(text) {
    var rows = [], row = [], field = '', quoted = false;
    var s = String(text).replace(/^﻿/, '');
    var sep = detectSeparator(s);
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (quoted) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === sep) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (x) { return x !== ''; })) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(function (x) { return x !== ''; })) rows.push(row);
    return rows;
  }
  // Spreadsheets in comma-decimal locales save with semicolons.
  function detectSeparator(s) {
    var first = s.split(/\r?\n/)[0] || '';
    return (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  }
  // A text cell starting with = + - @ would run as a formula in Excel or Sheets,
  // so it gets a leading apostrophe (numbers like -2.5 are left alone).
  function cell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- export ----------
  function toCSV(data) {
    var unit = data.unit === 'lb' ? 'lb' : 'kg', dist = unit === 'lb' ? 'mi' : 'km';
    var head = ['date', 'workout', 'duration_min', 'exercise', 'set', 'warmup', 'weight_' + unit, 'reps', 'distance_' + dist, 'time_min', 'notes', 'session_id'];
    var lines = [head.join(',')];
    data.sessions.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0); })
      .forEach(function (s) {
        s.exercises.forEach(function (ex) {
          ex.sets.forEach(function (st, i) {
            lines.push([
              s.date, s.title || '', s.duration || '', ex.name, i + 1, st.warmup ? 'yes' : '',
              st.weight != null && st.weight !== '' ? st.weight : '', st.reps != null && st.reps !== '' ? st.reps : '',
              st.km != null && st.km !== '' ? st.km : '', st.min != null && st.min !== '' ? st.min : '',
              s.notes || '', s.id || ''
            ].map(cell).join(','));
          });
        });
      });
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- import ----------
  // Normalised header -> field. Earlier entries win when a file has both.
  // Portuguese names are there for spreadsheets kept by hand.
  var COLUMNS = [
    ['exercise', ['exercise', 'exercise name', 'exercise title', 'exercicio']],
    ['date', ['date', 'workout date', 'entry date', 'start time', 'data']],
    ['end', ['end time']],
    ['workout', ['workout', 'workout name', 'title', 'treino']],
    ['durationMin', ['duration min']],
    ['duration', ['duration']],
    ['setIndex', ['set', 'set order', 'set index']],
    ['setType', ['set type']],
    ['warmup', ['warmup', 'warm up']],
    ['weightKg', ['weight kg', 'weight kgs']],
    ['weightLb', ['weight lb', 'weight lbs']],
    ['weight', ['weight', 'peso', 'carga']],
    ['weightUnit', ['weight unit']],
    ['reps', ['reps', 'repetitions', 'repeticoes']],
    ['distanceKm', ['distance km']],
    ['distanceMi', ['distance mi']],
    ['distance', ['distance']],
    ['distanceUnit', ['distance unit']],
    ['seconds', ['seconds', 'duration seconds']],
    ['minutes', ['time min', 'duration minutes']],
    ['time', ['time']],
    ['notes', ['workout notes', 'notes', 'description', 'comment', 'notas']],
    ['id', ['session id']]
  ];
  function normHeader(h) {
    return String(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function columnMap(header) {
    var map = {}, used = {};
    var norm = header.map(normHeader);
    COLUMNS.forEach(function (c) {
      for (var i = 0; i < c[1].length; i++) {
        var at = norm.indexOf(c[1][i]);
        if (at >= 0 && !used[at]) { map[c[0]] = at; used[at] = 1; return; }
      }
    });
    return map;
  }

  function detectFormat(header) {
    var h = header.map(normHeader).join('|');
    if (/session id/.test(h) && /weight (kg|lb)/.test(h)) return 'Dashboard';
    if (/exercise title/.test(h) && /start time/.test(h)) return 'Hevy';
    if (/workout name/.test(h) && /set order/.test(h)) return 'Strong';
    if (/category/.test(h) && /(weight unit|weight kg|weight lbs)/.test(h)) return 'FitNotes';
    return 'CSV';
  }

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // -> { date: 'YYYY-MM-DD', t: ms timestamp or null } or null
  function parseWhen(v) {
    var s = String(v || '').trim(), m;
    if (!s) return null;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
      return when(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
    }
    // Hevy: "1 Jan 2024, 07:41"
    if ((m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})(?:,? (\d{1,2}):(\d{2}))?/)) && MONTHS[m[2].toLowerCase()]) {
      return when(+m[3], MONTHS[m[2].toLowerCase()], +m[1], m[4], m[5]);
    }
    // "Jan 1, 2024"
    if ((m = s.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})(?:,? (\d{1,2}):(\d{2}))?/)) && MONTHS[m[1].toLowerCase()]) {
      return when(+m[3], MONTHS[m[1].toLowerCase()], +m[2], m[4], m[5]);
    }
    // Day first, as written in Portugal and most of Europe: 31/12/2024 or 31.12.2024
    if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:,? (\d{1,2}):(\d{2}))?/))) {
      var a = +m[1], b = +m[2];
      return b > 12 ? when(+m[3], a, b, m[4], m[5]) : when(+m[3], b, a, m[4], m[5]);
    }
    return null;
  }
  function when(y, mo, d, h, mi, se) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    var hasTime = h != null && h !== '';
    return {
      date: y + '-' + pad(mo) + '-' + pad(d),
      t: hasTime ? new Date(y, mo - 1, d, +h, +mi || 0, +se || 0).getTime() : null
    };
  }

  // "1h 5m", "45m", "1:05:00", "3900" (seconds) or "65" (minutes) -> minutes
  function parseDuration(v, minutesHeader) {
    var s = String(v || '').trim(), m;
    if (!s) return 0;
    if (/[hms]/i.test(s) && /\d/.test(s)) {
      var h = (s.match(/(\d+(?:\.\d+)?)\s*h/i) || [])[1], mi = (s.match(/(\d+(?:\.\d+)?)\s*m(?!s)/i) || [])[1], se = (s.match(/(\d+(?:\.\d+)?)\s*s/i) || [])[1];
      return num(h) * 60 + num(mi) + num(se) / 60;
    }
    if ((m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/))) return m[3] != null ? +m[1] * 60 + +m[2] + +m[3] / 60 : +m[1] + +m[2] / 60;
    var n = num(s);
    return minutesHeader || n < 600 ? n : n / 60;
  }

  /*
   * text -> { sessions, format, rows, skipped }
   * unit: the tracker's current unit ('kg' or 'lb'); weights and distances in
   * the other unit are converted.
   */
  function fromCSV(text, unit) {
    unit = unit === 'lb' ? 'lb' : 'kg';
    var rows = parseCSV(text);
    if (rows.length < 2) throw new Error('No rows found');
    var header = rows[0], col = columnMap(header), format = detectFormat(header);
    if (col.exercise == null || col.date == null) throw new Error('Needs a date column and an exercise column');
    // A leading apostrophe before = + - @ is the one toCSV adds; drop it so the text comes back as it was.
    function get(r, f) { return col[f] != null ? String(r[col[f]] == null ? '' : r[col[f]]).trim().replace(/^'(?=[=+\-@])/, '') : ''; }

    function weightOf(r) {
      var w, from;
      if (get(r, 'weightKg') !== '') { w = num(get(r, 'weightKg')); from = 'kg'; }
      else if (get(r, 'weightLb') !== '') { w = num(get(r, 'weightLb')); from = 'lb'; }
      else if (get(r, 'weight') !== '') { w = num(get(r, 'weight')); from = /lb/i.test(get(r, 'weightUnit')) ? 'lb' : /kg/i.test(get(r, 'weightUnit')) ? 'kg' : unit; }
      else return null;
      if (from !== unit) w = from === 'lb' ? w * KG_PER_LB : w / KG_PER_LB;
      return round2(w);
    }
    function distanceOf(r) {
      var mine = unit === 'lb' ? 'mi' : 'km', d, from;
      if (get(r, 'distanceKm') !== '') { d = num(get(r, 'distanceKm')); from = 'km'; }
      else if (get(r, 'distanceMi') !== '') { d = num(get(r, 'distanceMi')); from = 'mi'; }
      else if (get(r, 'distance') !== '') {
        d = num(get(r, 'distance'));
        var du = get(r, 'distanceUnit').toLowerCase();
        from = /mi/.test(du) ? 'mi' : /^m$|^meters?$|^metres?$/.test(du) ? 'm' : /km/.test(du) ? 'km' : mine;
        if (from === 'm') { d /= 1000; from = 'km'; }
      } else return 0;
      if (from !== mine) d = from === 'mi' ? d * KM_PER_MI : d / KM_PER_MI;
      return round2(d);
    }
    function minutesOf(r) {
      if (get(r, 'minutes') !== '') return num(get(r, 'minutes'));
      if (get(r, 'seconds') !== '') return num(get(r, 'seconds')) / 60;
      if (get(r, 'time') !== '') return parseDuration(get(r, 'time'), false);
      return 0;
    }
    function isWarmup(r) {
      var t = get(r, 'setType').toLowerCase(), so = get(r, 'setIndex').toLowerCase(), w = get(r, 'warmup').toLowerCase();
      return /warm/.test(t) || so === 'w' || /^(yes|true|1|y|x)$/.test(w);
    }

    // No prototype: a session id or exercise named __proto__ in the file is just a key.
    var groups = Object.create(null), order = [], skipped = 0;
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var name = get(r, 'exercise').replace(/\s+/g, ' ');
      var at = parseWhen(get(r, 'date'));
      if (!name || !at) { skipped++; continue; }
      if (/^rest timer$/i.test(get(r, 'setIndex'))) continue; // Strong writes rest timers as rows

      var reps = Math.round(num(get(r, 'reps'))), weight = weightOf(r), km = distanceOf(r), min = round2(minutesOf(r));
      var st;
      if (reps > 0) { st = { reps: reps, weight: weight || 0 }; }
      else if (km > 0 || min > 0) { st = { km: km || null, min: min || null }; if (!st.km) delete st.km; if (!st.min) delete st.min; }
      else { skipped++; continue; }
      if (isWarmup(r)) st.warmup = true;

      var id = get(r, 'id'), title = get(r, 'workout');
      var gk = id || (at.date + '|' + title + '|' + (format === 'Hevy' || format === 'Strong' ? at.t || '' : ''));
      var g = groups[gk];
      if (!g) {
        g = groups[gk] = { id: id || null, date: at.date, title: title, notes: '', start: at.t, end: null, duration: 0, exercises: [], byName: Object.create(null) };
        order.push(gk);
      }
      if (!g.notes && get(r, 'notes')) g.notes = get(r, 'notes');
      var end = parseWhen(get(r, 'end'));
      if (end && end.t) g.end = end.t;
      if (!g.duration) {
        if (get(r, 'durationMin') !== '') g.duration = num(get(r, 'durationMin'));
        else if (get(r, 'duration') !== '') g.duration = parseDuration(get(r, 'duration'), false);
      }
      var ex = g.byName[key(name)];
      if (!ex) { ex = g.byName[key(name)] = { name: name, sets: [] }; g.exercises.push(ex); }
      ex.sets.push(st);
    }

    var sessions = order.map(function (gk) {
      var g = groups[gk];
      var s = { id: g.id || uid() + order.indexOf(gk).toString(36), date: g.date, title: g.title, notes: g.notes, exercises: g.exercises };
      var mins = g.duration || (g.start && g.end ? (g.end - g.start) / 60000 : 0);
      if (mins >= 1 && mins <= 600) s.duration = Math.round(mins);
      return s;
    });
    return { sessions: sessions, format: format, rows: rows.length - 1, skipped: skipped };
  }

  // Same day, same exercises, same number of sets: the same workout imported twice.
  function signature(s) {
    var names = s.exercises.map(function (ex) { return key(ex.name); }).sort().join(',');
    var sets = s.exercises.reduce(function (a, ex) { return a + ex.sets.length; }, 0);
    return s.date + '|' + names + '|' + sets;
  }

  global.DashboardModules = global.DashboardModules || {};
  global.DashboardModules.workoutTransfer = {
    parseCSV: parseCSV,
    toCSV: toCSV,
    fromCSV: fromCSV,
    signature: signature,
    looksLikeCSV: function (text) { var t = String(text || '').replace(/^﻿/, '').trim(); return !!t && t[0] !== '{' && t[0] !== '['; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
