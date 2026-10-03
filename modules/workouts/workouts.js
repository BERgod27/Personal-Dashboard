/*
 * Workout tracker module for the Personal Dashboard.
 *
 * Mount it into any element:
 *   <link rel="stylesheet" href="modules/workouts/workouts.css">
 *   <script src="modules/workouts/workouts.js"></script>
 *   DashboardModules.workouts.mount(document.getElementById('panel'));
 *
 * Plain script (no ES modules) so it also works when opened from file://.
 * Data lives in localStorage under STORAGE_KEY; export/import JSON for backups.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'pd.workouts.v1';

  // ---------- storage ----------
  // Default storage is this module's own localStorage key. The dashboard
  // adapter (register.js) swaps in the shell's Store instead.
  function emptyData() { return { version: 1, unit: 'kg', sessions: [] }; }

  function normalize(d) {
    if (!d || !Array.isArray(d.sessions)) return emptyData();
    d.version = 1;
    d.unit = d.unit === 'lb' ? 'lb' : 'kg';
    return d;
  }

  var localStorageAdapter = {
    load: function () {
      try { return normalize(JSON.parse(global.localStorage.getItem(STORAGE_KEY))); }
      catch (e) { return emptyData(); }
    },
    save: function (data) {
      try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
      catch (e) { return false; }
    }
  };

  // ---------- helpers ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtDate(s) {
    return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function startOfWeek(d) { // Monday
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round1(n) { return Math.round(n * 10) / 10; }
  function e1rm(weight, reps) { return reps > 0 && weight > 0 ? weight * (1 + reps / 30) : 0; } // Epley
  function normName(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
  function key(s) { return normName(s).toLowerCase(); }

  function sessionVolume(s) {
    var v = 0;
    s.exercises.forEach(function (ex) { ex.sets.forEach(function (st) { v += num(st.reps) * num(st.weight); }); });
    return v;
  }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0); }

  function summarizeSets(sets, unit) {
    // "3×8 @ 60kg, 1×6 @ 65kg" – groups consecutive identical sets
    var out = [], i = 0;
    while (i < sets.length) {
      var j = i;
      while (j + 1 < sets.length && num(sets[j + 1].reps) === num(sets[i].reps) && num(sets[j + 1].weight) === num(sets[i].weight)) j++;
      var w = num(sets[i].weight);
      out.push((j - i + 1) + '×' + num(sets[i].reps) + (w ? ' @ ' + w + unit : ' (bodyweight)'));
      i = j + 1;
    }
    return out.join(', ');
  }

  // exerciseName -> [{date, top, e1rm, volume}] sorted by date
  function exerciseHistory(data) {
    var map = {};
    data.sessions.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (s) {
        s.exercises.forEach(function (ex) {
          var k = key(ex.name);
          if (!k) return;
          var top = 0, best = 0, vol = 0, maxReps = 0;
          ex.sets.forEach(function (st) {
            var w = num(st.weight), r = num(st.reps);
            if (w > top) top = w;
            if (r > maxReps) maxReps = r;
            best = Math.max(best, e1rm(w, r));
            vol += w * r;
          });
          map[k] = map[k] || { name: normName(ex.name), points: [] };
          map[k].name = normName(ex.name);
          map[k].points.push({ date: s.date, top: top, e1rm: best, volume: vol, maxReps: maxReps });
        });
      });
    return map;
  }

  // ---------- chart ----------
  function lineChart(points, unit) {
    var W = 640, H = 240, L = 44, R = 12, T = 12, B = 28;
    var bw = points.every(function (p) { return p.top === 0; });
    var s1 = points.map(function (p) { return bw ? p.maxReps : p.top; });
    var s2 = bw ? null : points.map(function (p) { return round1(p.e1rm); });
    var all = s1.concat(s2 || []);
    var max = Math.max.apply(null, all), min = Math.min.apply(null, all);
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    var pad = (max - min) * 0.1; max += pad; min = Math.max(0, min - pad);
    var t0 = parseDate(points[0].date).getTime(), t1 = parseDate(points[points.length - 1].date).getTime();
    function x(i) {
      if (t1 === t0) return L + (W - L - R) / 2;
      return L + (parseDate(points[i].date).getTime() - t0) / (t1 - t0) * (W - L - R);
    }
    function y(v) { return T + (1 - (v - min) / (max - min)) * (H - T - B); }
    function path(series) { return series.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(''); }

    var svg = '<svg class="wt-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Progress chart">';
    for (var g = 0; g <= 4; g++) {
      var v = min + (max - min) * g / 4, yy = y(v);
      svg += '<line class="wt-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      svg += '<text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + round1(v) + '</text>';
    }
    var labelIdx = points.length <= 2 ? points.map(function (_, i) { return i; }) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
    labelIdx.forEach(function (i) {
      var d = parseDate(points[i].date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      var anchor = points.length > 1 && i === 0 ? 'start' : points.length > 1 && i === points.length - 1 ? 'end' : 'middle';
      svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + esc(d) + '</text>';
    });
    if (s2) svg += '<path class="wt-l2" d="' + path(s2) + '"/>';
    svg += '<path class="wt-l1" d="' + path(s1) + '"/>';
    s1.forEach(function (v, i) {
      svg += '<circle class="wt-p1" cx="' + x(i) + '" cy="' + y(v) + '" r="3.5"><title>' +
        esc(points[i].date + ': ' + v + (bw ? ' reps' : unit) + (s2 ? ' (est. 1RM ' + s2[i] + unit + ')' : '')) + '</title></circle>';
    });
    svg += '</svg>';
    svg += '<div class="wt-legend"><span><i></i>' + (bw ? 'Max reps' : 'Top set (' + unit + ')') + '</span>' +
      (s2 ? '<span><i class="wt-l2i"></i>Estimated 1RM</span>' : '') + '</div>';
    return svg;
  }

  // ---------- module ----------
  /*
   * opts.storage: { load() -> data, save(data) -> bool }   (default: localStorage)
   * opts.state:   object kept by the caller so the open tab and an unsaved
   *               draft survive being re-mounted
   * opts.date:    'YYYY-MM-DD' to use as the default date for a new workout
   * opts.embedded: true inside a host panel that already shows a title
   */
  function mount(el, opts) {
    opts = opts || {};
    var storage = opts.storage || localStorageAdapter;
    var data = normalize(storage.load());
    var state = opts.state || {};
    if (!state.tab) state.tab = 'log';
    var defaultDate = opts.date || today();

    el.classList.add('wt-root');
    if (opts.embedded) el.classList.add('wt-embedded');
    el.innerHTML = '';

    function newDraft() {
      return { date: defaultDate, title: '', notes: '', exercises: [{ name: '', sets: [{ reps: '', weight: '' }] }] };
    }
    function isPristine(d) {
      return !d.title && !d.notes && d.exercises.length === 1 && !d.exercises[0].name &&
        d.exercises[0].sets.length === 1 && !d.exercises[0].sets[0].reps && !d.exercises[0].sets[0].weight;
    }
    if (!state.draft || (!state.editingId && isPristine(state.draft))) state.draft = newDraft();

    function persist() {
      if (storage.save(data) === false) toast('Could not save – browser storage is unavailable');
    }

    function toast(msg) {
      var t = document.createElement('div');
      t.className = 'wt-toast'; t.textContent = msg;
      el.appendChild(t);
      setTimeout(function () { t.remove(); }, 2200);
    }

    function knownExercises() {
      var seen = {}, out = [];
      data.sessions.slice().sort(byDateDesc).forEach(function (s) {
        s.exercises.forEach(function (ex) { var k = key(ex.name); if (k && !seen[k]) { seen[k] = 1; out.push(normName(ex.name)); } });
      });
      return out;
    }

    function lastFor(name) {
      var k = key(name);
      var sorted = data.sessions.slice().sort(byDateDesc);
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].id === state.editingId) continue;
        for (var j = 0; j < sorted[i].exercises.length; j++) {
          if (key(sorted[i].exercises[j].name) === k) return { date: sorted[i].date, ex: sorted[i].exercises[j] };
        }
      }
      return null;
    }

    // ----- stats strip -----
    function renderStats() {
      var now = new Date(), wk = startOfWeek(now).getTime();
      var thisWeek = data.sessions.filter(function (s) { return parseDate(s.date).getTime() >= wk; });
      var vol = thisWeek.reduce(function (a, s) { return a + sessionVolume(s); }, 0);
      // consecutive weeks (ending this or last week) with at least one session
      var weeks = {};
      data.sessions.forEach(function (s) { weeks[startOfWeek(parseDate(s.date)).getTime()] = 1; });
      var streak = 0, cur = new Date(wk);
      if (!weeks[cur.getTime()]) cur.setDate(cur.getDate() - 7);
      while (weeks[cur.getTime()]) { streak++; cur.setDate(cur.getDate() - 7); }
      var last = data.sessions.slice().sort(byDateDesc)[0];
      var daysSince = last ? Math.round((parseDate(today()) - parseDate(last.date)) / 864e5) : null;
      return '<div class="wt-stats">' +
        stat(thisWeek.length, 'workouts this week') +
        stat(Math.round(vol).toLocaleString() + ' ' + data.unit, 'volume this week') +
        stat(streak + (streak === 1 ? ' week' : ' weeks'), 'training streak') +
        stat(last ? (daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : daysSince + ' days ago') : '–', 'last workout') +
        '</div>';
    }
    function stat(v, l) { return '<div class="wt-stat"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>'; }

    // ----- log tab -----
    function renderLog() {
      var d = state.draft;
      var h = '<div class="wt-card"><div class="wt-row">' +
        '<label class="wt-field">Date<input type="date" data-f="date" value="' + esc(d.date) + '"></label>' +
        '<label class="wt-field wt-grow">Session name<input data-f="title" placeholder="e.g. Push day, Legs, 5k run" value="' + esc(d.title) + '"></label>' +
        '</div>';
      if (!state.editingId && data.sessions.length) {
        h += '<div class="wt-actions"><button data-a="repeat">Repeat last session</button>';
        var titles = {};
        data.sessions.slice().sort(byDateDesc).forEach(function (s) { if (s.title && !titles[key(s.title)]) titles[key(s.title)] = s; });
        var tk = Object.keys(titles).slice(0, 6);
        if (tk.length) {
          h += '<select data-a="template"><option value="">Start from a past session…</option>' +
            tk.map(function (k) { return '<option value="' + esc(titles[k].id) + '">' + esc(titles[k].title) + '</option>'; }).join('') + '</select>';
        }
        h += '</div>';
      }
      h += '</div>';

      d.exercises.forEach(function (ex, ei) {
        var last = ex.name ? lastFor(ex.name) : null;
        h += '<div class="wt-card wt-ex"><div class="wt-row">' +
          '<label class="wt-field wt-grow">Exercise<input list="wt-ex-list" data-ex="' + ei + '" data-f="name" placeholder="e.g. Bench press" value="' + esc(ex.name) + '"></label>' +
          '<button class="wt-icon wt-danger" data-a="del-ex" data-ex="' + ei + '" title="Remove exercise" aria-label="Remove exercise">✕</button></div>';
        h += '<div class="wt-muted" data-hint="' + ei + '" style="font-size:12px;margin-top:4px">' + lastHint(last) + '</div>';
        h += '<div class="wt-sets"><span class="wt-head">Set</span><span class="wt-head">Reps</span><span class="wt-head">Weight (' + data.unit + ')</span><span></span>';
        ex.sets.forEach(function (st, si) {
          h += '<span class="wt-muted">' + (si + 1) + '</span>' +
            '<input type="number" inputmode="numeric" min="0" step="1" data-ex="' + ei + '" data-set="' + si + '" data-f="reps" value="' + esc(st.reps) + '">' +
            '<input type="number" inputmode="decimal" min="0" step="0.5" data-ex="' + ei + '" data-set="' + si + '" data-f="weight" placeholder="0 = bodyweight" value="' + esc(st.weight) + '">' +
            '<button class="wt-icon" data-a="del-set" data-ex="' + ei + '" data-set="' + si + '" title="Remove set" aria-label="Remove set">−</button>';
        });
        h += '</div><button data-a="add-set" data-ex="' + ei + '">+ Add set</button></div>';
      });

      h += '<datalist id="wt-ex-list">' + knownExercises().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
      h += '<div class="wt-card"><label class="wt-field">Notes<textarea data-f="notes" rows="2" placeholder="How did it feel?">' + esc(d.notes) + '</textarea></label>' +
        '<div class="wt-actions"><button data-a="add-ex">+ Add exercise</button>' +
        '<button class="wt-primary" data-a="save">' + (state.editingId ? 'Save changes' : 'Save workout') + '</button>' +
        (state.editingId ? '<button data-a="cancel">Cancel</button>' : '<button data-a="clear">Clear</button>') + '</div></div>';
      return h;
    }

    function lastHint(last) {
      return last ? 'Last time (' + esc(last.date) + '): ' + esc(summarizeSets(last.ex.sets, data.unit)) : '';
    }

    // ----- history tab -----
    function renderHistory() {
      if (!data.sessions.length) return '<div class="wt-empty">No workouts yet. Log your first one in the Log tab.</div>';
      return data.sessions.slice().sort(byDateDesc).map(function (s) {
        return '<div class="wt-card wt-hist"><div class="wt-hist-head"><h3>' + esc(s.title || 'Workout') +
          ' <span class="wt-muted" style="font-weight:400">· ' + esc(fmtDate(s.date)) + '</span></h3>' +
          '<span class="wt-muted">' + Math.round(sessionVolume(s)).toLocaleString() + ' ' + data.unit + ' volume</span></div>' +
          '<ul>' + s.exercises.map(function (ex) { return '<li><b>' + esc(ex.name) + '</b>: ' + esc(summarizeSets(ex.sets, data.unit)) + '</li>'; }).join('') + '</ul>' +
          (s.notes ? '<div class="wt-muted" style="margin-top:6px">' + esc(s.notes) + '</div>' : '') +
          '<div class="wt-actions"><button data-a="edit" data-id="' + esc(s.id) + '">Edit</button>' +
          (state.confirmDelete === s.id
            ? '<span class="wt-muted">Delete this workout?</span><button class="wt-danger" data-a="delete-yes" data-id="' + esc(s.id) + '">Delete</button><button data-a="delete-no">Keep</button>'
            : '<button class="wt-danger" data-a="delete" data-id="' + esc(s.id) + '">Delete</button>') + '</div></div>';
      }).join('');
    }

    // ----- progress tab -----
    function renderProgress() {
      var hist = exerciseHistory(data), keys = Object.keys(hist);
      if (!keys.length) return '<div class="wt-empty">Progress charts appear once you have logged some exercises.</div>';
      keys.sort(function (a, b) { return hist[b].points.length - hist[a].points.length || a.localeCompare(b); });
      if (!state.progressEx || !hist[state.progressEx]) state.progressEx = keys[0];
      var cur = hist[state.progressEx];
      var h = '<div class="wt-card"><div class="wt-row"><label class="wt-field wt-grow">Exercise<select data-a="pick-ex">' +
        keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === state.progressEx ? ' selected' : '') + '>' + esc(hist[k].name) + ' (' + hist[k].points.length + ')</option>'; }).join('') +
        '</select></label></div><div style="margin-top:10px">' + lineChart(cur.points, data.unit) + '</div>' +
        (cur.points.length < 2 ? '<p class="wt-muted" style="margin:6px 0 0">Log this exercise again to see a trend.</p>' : '') + '</div>';

      h += '<div class="wt-card"><h3>Personal records</h3><div class="wt-table-wrap"><table class="wt-table"><thead><tr>' +
        '<th>Exercise</th><th>Heaviest</th><th>Est. 1RM</th><th>Best volume</th><th>Sessions</th><th>Last done</th></tr></thead><tbody>';
      keys.slice().sort().forEach(function (k) {
        var p = hist[k].points;
        var top = Math.max.apply(null, p.map(function (x) { return x.top; }));
        var e = Math.max.apply(null, p.map(function (x) { return x.e1rm; }));
        var v = Math.max.apply(null, p.map(function (x) { return x.volume; }));
        var reps = Math.max.apply(null, p.map(function (x) { return x.maxReps; }));
        h += '<tr><td>' + esc(hist[k].name) + '</td><td>' + (top ? round1(top) + data.unit : reps + ' reps') + '</td><td>' +
          (e ? round1(e) + data.unit : '–') + '</td><td>' + (v ? Math.round(v).toLocaleString() + data.unit : '–') + '</td><td>' +
          p.length + '</td><td>' + esc(p[p.length - 1].date) + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
      return h;
    }

    // ----- settings / data -----
    function renderData() {
      return '<div class="wt-card"><h3>Units</h3><div class="wt-row"><select data-a="unit">' +
        '<option value="kg"' + (data.unit === 'kg' ? ' selected' : '') + '>Kilograms (kg)</option>' +
        '<option value="lb"' + (data.unit === 'lb' ? ' selected' : '') + '>Pounds (lb)</option></select>' +
        '<span class="wt-muted">Changes the label only; logged numbers are not converted.</span></div></div>' +
        '<div class="wt-card"><h3>Backup</h3><p class="wt-muted" style="margin:0 0 8px">Your workouts are saved in this browser. Export a file to back them up or move them to another device.</p>' +
        '<div class="wt-actions"><button data-a="export">Download file</button>' +
        '<button data-a="import-pick">Import file</button>' +
        '<input type="file" accept="application/json,.json" data-a="import" hidden></div>' +
        '<p class="wt-muted" style="margin:12px 0 6px">Or copy and paste the backup as text:</p>' +
        '<textarea data-a="backup-text" rows="3" style="width:100%;font-family:ui-monospace,monospace;font-size:12px" placeholder="Paste a backup here to import it"></textarea>' +
        '<div class="wt-actions"><button data-a="copy">Copy backup</button><button data-a="paste-import">Import pasted text</button></div></div>';
    }

    function render() {
      var tabs = [['log', state.editingId ? 'Edit workout' : 'Log'], ['history', 'History'], ['progress', 'Progress'], ['data', 'Settings']];
      var body = state.tab === 'log' ? renderLog() : state.tab === 'history' ? renderHistory() : state.tab === 'progress' ? renderProgress() : renderData();
      el.innerHTML = (opts.embedded ? '' : '<h2>Workouts</h2>') + renderStats() +
        '<div class="wt-tabs" role="tablist">' + tabs.map(function (t) {
          return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '">' + t[1] + '</button>';
        }).join('') + '</div><div class="wt-body">' + body + '</div>';
      if (state.flash && el.isConnected) { toast(state.flash); state.flash = null; }
    }

    // ----- actions -----
    function cloneSession(s) {
      return {
        date: defaultDate, title: s.title, notes: '',
        exercises: s.exercises.map(function (ex) { return { name: ex.name, sets: ex.sets.map(function (st) { return { reps: st.reps, weight: st.weight }; }) }; })
      };
    }

    function cleanDraft() {
      var d = state.draft;
      var exercises = d.exercises.map(function (ex) {
        return {
          name: normName(ex.name),
          sets: ex.sets.filter(function (st) { return String(st.reps) !== '' && num(st.reps) > 0; })
            .map(function (st) { return { reps: num(st.reps), weight: num(st.weight) }; })
        };
      }).filter(function (ex) { return ex.name && ex.sets.length; });
      return { date: d.date || defaultDate, title: normName(d.title), notes: String(d.notes || '').trim(), exercises: exercises };
    }

    function onClick(e) {
      var t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      if (t.dataset.tab) { state.tab = t.dataset.tab; render(); return; }
      var a = t.dataset.a, d = state.draft, ei = +t.dataset.ex, si = +t.dataset.set;
      switch (a) {
        case 'add-ex': d.exercises.push({ name: '', sets: [{ reps: '', weight: '' }] }); break;
        case 'del-ex': d.exercises.splice(ei, 1); if (!d.exercises.length) d.exercises.push({ name: '', sets: [{ reps: '', weight: '' }] }); break;
        case 'add-set':
          var sets = d.exercises[ei].sets, prev = sets[sets.length - 1];
          sets.push({ reps: prev ? prev.reps : '', weight: prev ? prev.weight : '' }); break;
        case 'del-set': d.exercises[ei].sets.splice(si, 1); if (!d.exercises[ei].sets.length) d.exercises[ei].sets.push({ reps: '', weight: '' }); break;
        case 'repeat': state.draft = cloneSession(data.sessions.slice().sort(byDateDesc)[0]); break;
        case 'clear': state.draft = newDraft(); break;
        case 'cancel': state.editingId = null; state.draft = newDraft(); state.tab = 'history'; break;
        case 'save':
          var s = cleanDraft();
          if (!s.exercises.length) { toast('Add at least one exercise with a set'); return; }
          if (state.editingId) {
            var idx = data.sessions.findIndex(function (x) { return x.id === state.editingId; });
            if (idx >= 0) { s.id = state.editingId; s.createdAt = data.sessions[idx].createdAt; data.sessions[idx] = s; }
            state.editingId = null; state.tab = 'history';
          } else {
            s.id = uid(); s.createdAt = Date.now(); data.sessions.push(s);
          }
          // Update UI state before persisting: in the dashboard a save re-mounts the panel.
          state.draft = newDraft(); state.flash = 'Workout saved'; persist(); break;
        case 'edit':
          var found = data.sessions.find(function (x) { return x.id === t.dataset.id; });
          if (!found) return;
          state.editingId = found.id;
          state.draft = cloneSession(found); state.draft.date = found.date; state.draft.notes = found.notes || '';
          state.tab = 'log'; break;
        // confirm() is blocked in sandboxed frames, so deletes are confirmed in the panel.
        case 'delete': state.confirmDelete = t.dataset.id; break;
        case 'delete-no': state.confirmDelete = null; break;
        case 'delete-yes':
          state.confirmDelete = null;
          data.sessions = data.sessions.filter(function (x) { return x.id !== t.dataset.id; });
          state.flash = 'Workout deleted'; persist(); break;
        case 'export':
          // Downloads are blocked in some frames; the copy box below always works.
          try {
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob); link.download = 'workouts-' + today() + '.json';
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
          } catch (err) { /* fall through to the copy box */ }
          return;
        case 'copy':
          var box = el.querySelector('textarea[data-a="backup-text"]');
          box.value = JSON.stringify(data);
          box.select();
          var done = function () { toast('Backup copied'); };
          var fallback = function () {
            try { if (document.execCommand('copy')) return done(); } catch (err) { /* ignore */ }
            toast('Select the text and copy it');
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(done, fallback);
          else fallback();
          return;
        case 'paste-import':
          importText(el.querySelector('textarea[data-a="backup-text"]').value);
          return;
        case 'import-pick': el.querySelector('input[data-a="import"]').click(); return;
        default: return;
      }
      render();
    }

    function onInput(e) {
      var t = e.target, f = t.dataset.f;
      if (!f || state.tab !== 'log') return;
      var d = state.draft;
      if (t.dataset.set != null) d.exercises[+t.dataset.ex].sets[+t.dataset.set][f] = t.value;
      else if (t.dataset.ex != null) d.exercises[+t.dataset.ex][f] = t.value;
      else d[f] = t.value;
    }

    function onChange(e) {
      var t = e.target, a = t.dataset.a;
      if (t.dataset.f === 'name') { // refresh the "last time" hint in place so a pending click isn't lost
        var hint = el.querySelector('[data-hint="' + t.dataset.ex + '"]');
        if (hint) hint.innerHTML = lastHint(t.value ? lastFor(t.value) : null);
        return;
      }
      if (a === 'template' && t.value) {
        var s = data.sessions.find(function (x) { return x.id === t.value; });
        if (s) { state.draft = cloneSession(s); render(); }
      } else if (a === 'pick-ex') { state.progressEx = t.value; render(); }
      else if (a === 'unit') { data.unit = t.value; persist(); render(); }
      else if (a === 'import' && t.files && t.files[0]) {
        var reader = new FileReader();
        reader.onload = function () { importText(reader.result); };
        reader.readAsText(t.files[0]);
      }
    }

    function importText(text) {
      try {
        var incoming = JSON.parse(text);
        // Also accept a full dashboard backup, which nests workouts under modules.workout.
        if (incoming && !incoming.sessions && incoming.modules && incoming.modules.workout) incoming = incoming.modules.workout;
        if (!incoming || !Array.isArray(incoming.sessions)) throw new Error('bad backup');
        var ids = {}; data.sessions.forEach(function (s) { ids[s.id] = 1; });
        var added = 0;
        incoming.sessions.forEach(function (s) {
          if (!s || !s.date || !Array.isArray(s.exercises)) return;
          if (s.id && ids[s.id]) return; // already have it
          if (!s.id) s.id = uid();
          data.sessions.push(s); ids[s.id] = 1; added++;
        });
        state.flash = 'Imported ' + added + ' workout' + (added === 1 ? '' : 's');
        persist(); render();
      } catch (err) { toast('That is not a workouts backup'); }
    }

    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    render();

    return {
      // Re-read storage and redraw (e.g. after the shell restored a backup).
      refresh: function (newOpts) {
        if (newOpts && newOpts.date && newOpts.date !== defaultDate) {
          defaultDate = newOpts.date;
          if (!state.editingId && isPristine(state.draft)) state.draft = newDraft();
        }
        data = normalize(storage.load());
        render();
      },
      unmount: function () {
        el.removeEventListener('click', onClick);
        el.removeEventListener('input', onInput);
        el.removeEventListener('change', onChange);
        el.classList.remove('wt-root', 'wt-embedded');
        el.innerHTML = '';
      },
      // For a dashboard home/summary card.
      summary: function () {
        var wk = startOfWeek(new Date()).getTime();
        var last = data.sessions.slice().sort(byDateDesc)[0] || null;
        return {
          workoutsThisWeek: data.sessions.filter(function (s) { return parseDate(s.date).getTime() >= wk; }).length,
          lastWorkout: last ? { date: last.date, title: last.title } : null
        };
      }
    };
  }

  global.DashboardModules = global.DashboardModules || {};
  global.DashboardModules.workouts = {
    id: 'workouts',
    title: 'Workouts',
    storageKey: STORAGE_KEY,
    mount: mount,
    localStorage: localStorageAdapter,
    normalize: normalize
  };
})(window);
