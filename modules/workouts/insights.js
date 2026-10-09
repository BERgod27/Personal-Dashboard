/*
 * Progress insights for the workout tracker: pure functions over the logged
 * sessions, used by the Progress tab in workouts.js. Nothing here touches the
 * DOM or storage.
 *
 * The ideas (week streak, training heatmap, recent records, muscle recovery,
 * best set per rep range) follow the reports in SparkyFitness and openGym.
 * Neither project's code is used: SparkyFitness is licensed for non-commercial
 * use only and openGym is AGPL-3.0, so this is an independent implementation.
 *
 * Load after workouts.js; it exposes DashboardModules.workoutInsights.
 */
(function (global) {
  'use strict';

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function e1rm(w, r) { return r > 0 && w > 0 ? w * (1 + r / 30) : 0; } // Epley, as in workouts.js
  function key(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2] || 1); }
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0); }
  function working(sets) { return (sets || []).filter(function (st) { return st && !st.warmup; }); }
  function volume(s) {
    var v = 0;
    s.exercises.forEach(function (ex) { working(ex.sets).forEach(function (st) { v += num(st.reps) * num(st.weight); }); });
    return v;
  }
  function setCount(s) { return s.exercises.reduce(function (a, ex) { return a + working(ex.sets).length; }, 0); }

  /*
   * Week-by-week consistency, Monday to Sunday.
   * streak: weeks in a row with at least one workout, ending this week (or last
   * week, so an empty Monday doesn't break it). longest: best run ever.
   * week / prev: totals for this week and last week, for the summary tiles.
   */
  function consistency(sessions, todayStr) {
    var now = parseDate(todayStr), thisMon = monday(now);
    var weeks = {};
    sessions.forEach(function (s) {
      if (s.date > todayStr) return;
      var k = ymd(monday(parseDate(s.date)));
      var w = weeks[k] || (weeks[k] = { workouts: 0, volume: 0, sets: 0, minutes: 0, days: {} });
      w.workouts++; w.volume += volume(s); w.sets += setCount(s); w.minutes += num(s.duration); w.days[s.date] = 1;
    });
    function at(n) { return weeks[ymd(addDays(thisMon, -7 * n))]; }
    var streak = 0, i = at(0) ? 0 : 1;
    while (at(i)) { streak++; i++; }
    var longest = 0, run = 0, keys = Object.keys(weeks).sort(), prev = null;
    keys.forEach(function (k) {
      run = prev && ymd(addDays(parseDate(prev), 7)) === k ? run + 1 : 1;
      longest = Math.max(longest, run); prev = k;
    });
    function totals(w) { return w ? { workouts: w.workouts, volume: w.volume, sets: w.sets, minutes: w.minutes, days: Object.keys(w.days).length } : { workouts: 0, volume: 0, sets: 0, minutes: 0, days: 0 }; }
    return { streak: streak, longest: longest, week: totals(at(0)), prev: totals(at(1)) };
  }

  /*
   * Calendar heatmap for the last `weeks` weeks: columns are weeks (oldest
   * first), rows Monday..Sunday. level 0..4 scales with working sets that day;
   * a day with only cardio still shows as level 1.
   */
  function heatmap(sessions, todayStr, weeks) {
    var start = addDays(monday(parseDate(todayStr)), -7 * (weeks - 1));
    var from = ymd(start), per = {};
    sessions.forEach(function (s) {
      if (s.date < from || s.date > todayStr) return;
      var d = per[s.date] || (per[s.date] = { workouts: 0, sets: 0, titles: [] });
      d.workouts++; d.sets += setCount(s); if (s.title) d.titles.push(s.title);
    });
    var max = 1;
    Object.keys(per).forEach(function (k) { max = Math.max(max, per[k].sets); });
    var cols = [];
    for (var w = 0; w < weeks; w++) {
      var col = [];
      for (var d = 0; d < 7; d++) {
        var date = ymd(addDays(start, w * 7 + d)), info = per[date];
        col.push({
          date: date, future: date > todayStr,
          workouts: info ? info.workouts : 0, sets: info ? info.sets : 0, titles: info ? info.titles : [],
          level: info ? Math.max(1, Math.ceil(info.sets / max * 4)) : 0
        });
      }
      cols.push(col);
    }
    return { cols: cols, activeDays: Object.keys(per).length };
  }

  /*
   * Every time an exercise beat its own earlier best, newest first.
   * kind: 'e1rm' (estimated one-rep max), 'weight' (heaviest set), 'reps'
   * (bodyweight), 'km' (distance). The first session of an exercise is a
   * baseline, not a record. One entry per exercise per session, the most
   * telling kind first.
   */
  function records(sessions, limit) {
    var best = {}, out = [];
    sessions.slice().sort(byDate).forEach(function (s) {
      s.exercises.forEach(function (ex) {
        var k = key(ex.name); if (!k) return;
        var cur = { e: 0, w: 0, r: 0, km: 0, set: null };
        working(ex.sets).forEach(function (st) {
          var w = num(st.weight), r = num(st.reps), e = e1rm(w, r);
          if (e > cur.e) { cur.e = e; cur.set = { weight: w, reps: r }; }
          cur.w = Math.max(cur.w, w);
          if (!w) cur.r = Math.max(cur.r, r);
          cur.km = Math.max(cur.km, num(st.km));
        });
        var b = best[k];
        if (b) {
          var rec = null;
          if (cur.e > b.e + 1e-9) rec = { kind: 'e1rm', value: cur.e, prev: b.e, set: cur.set };
          else if (cur.w > b.w) rec = { kind: 'weight', value: cur.w, prev: b.w };
          else if (!cur.w && !b.w && cur.r > b.r) rec = { kind: 'reps', value: cur.r, prev: b.r };
          else if (cur.km > b.km) rec = { kind: 'km', value: cur.km, prev: b.km };
          if (rec) { rec.date = s.date; rec.name = ex.name; rec.key = k; rec.sid = s.id; out.push(rec); }
        }
        best[k] = b ? { e: Math.max(b.e, cur.e), w: Math.max(b.w, cur.w), r: Math.max(b.r, cur.r), km: Math.max(b.km, cur.km) } : cur;
      });
    });
    out.reverse();
    return limit ? out.slice(0, limit) : out;
  }

  /*
   * Days since each muscle group last had a working set, most recently
   * trained first. muscleOf maps an exercise name to a muscle id.
   */
  function recovery(sessions, todayStr, muscleOf) {
    var last = {}, sets = {};
    sessions.forEach(function (s) {
      if (s.date > todayStr) return;
      s.exercises.forEach(function (ex) {
        var n = working(ex.sets).length; if (!n) return;
        var m = muscleOf(ex.name);
        if (!last[m] || s.date > last[m]) { last[m] = s.date; sets[m] = 0; }
        if (s.date === last[m]) sets[m] += n;
      });
    });
    var t = parseDate(todayStr);
    return Object.keys(last).map(function (m) {
      return { muscle: m, date: last[m], days: Math.round((t - parseDate(last[m])) / 864e5), sets: sets[m] };
    }).sort(function (a, b) { return a.days - b.days || b.sets - a.sets; });
  }

  /*
   * Heaviest working set in each rep range for one exercise, from the points
   * exerciseHistory() builds (each point carries its session's sets).
   */
  var REP_RANGES = [[1, 1, '1 rep'], [2, 3, '2–3 reps'], [4, 6, '4–6 reps'], [7, 10, '7–10 reps'], [11, 15, '11–15 reps'], [16, Infinity, '16+ reps']];
  function repRangeBests(points) {
    return REP_RANGES.map(function (r) {
      var best = null;
      points.forEach(function (p) {
        working(p.sets).forEach(function (st) {
          var w = num(st.weight), n = num(st.reps);
          if (!w || n < r[0] || n > r[1]) return;
          if (!best || w > best.weight || (w === best.weight && n > best.reps)) best = { weight: w, reps: n, date: p.date };
        });
      });
      return { label: r[2], best: best };
    }).filter(function (r) { return r.best; });
  }

  global.DashboardModules = global.DashboardModules || {};
  global.DashboardModules.workoutInsights = {
    consistency: consistency,
    heatmap: heatmap,
    records: records,
    recovery: recovery,
    repRangeBests: repRangeBests
  };
})(typeof window !== 'undefined' ? window : globalThis);
