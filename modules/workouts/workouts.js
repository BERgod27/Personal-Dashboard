/*
 * Workout tracker module for the Personal Dashboard.
 *
 * Mount it into any element:
 *   <link rel="stylesheet" href="modules/workouts/workouts.css">
 *   <script src="modules/workouts/exercises.js"></script>   (optional: the full exercise library)
 *   <script src="modules/workouts/workouts.js"></script>
 *   DashboardModules.workouts.mount(document.getElementById('panel'));
 *
 * Plain script (no ES modules) so it also works when opened from file://.
 * Saved workouts live in localStorage under STORAGE_KEY (or the shell's Store);
 * the workout in progress is kept per device under DRAFT_KEY so a reload
 * mid-session doesn't lose it.
 *
 * Screens: Workout (start screen, then the live log with set rows, checkmarks
 * and a rest timer), History (calendar + session cards), Progress (muscle map,
 * weekly chart, per-exercise records and charts) and Settings.
 * The body figures and icons are drawn here as inline SVG.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'pd.workouts.v1';
  var DRAFT_KEY = 'pd.workouts.draft.v1';
  var REST_CHOICES = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];
  var PICK_PAGE = 60; // library rows drawn at once in the picker

  // ---------- storage ----------
  // Default storage is this module's own localStorage key. The dashboard
  // adapter (register.js) swaps in the shell's Store instead.
  function emptyData() { return { version: 1, unit: 'kg', sessions: [] }; }

  function normalize(d) {
    if (!d || !Array.isArray(d.sessions)) return emptyData();
    d.version = 1;
    d.unit = d.unit === 'lb' ? 'lb' : 'kg';
    if (d.muscles && typeof d.muscles !== 'object') delete d.muscles;
    if (d.rest != null && !(REST_CHOICES.indexOf(+d.rest) >= 0)) delete d.rest;
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

  // ---------- exercise library ----------
  var MUSCLES = {
    chest: { label: 'Chest', view: 'front' },
    back: { label: 'Back', view: 'back' },
    shoulders: { label: 'Shoulders', view: 'front' },
    biceps: { label: 'Biceps', view: 'front' },
    triceps: { label: 'Triceps', view: 'back' },
    forearms: { label: 'Forearms', view: 'front' },
    core: { label: 'Core', view: 'front' },
    quads: { label: 'Quads', view: 'front' },
    hamstrings: { label: 'Hamstrings', view: 'back' },
    glutes: { label: 'Glutes', view: 'back' },
    calves: { label: 'Calves', view: 'back' },
    cardio: { label: 'Cardio' },
    other: { label: 'Other' }
  };
  var MUSCLE_ORDER = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'quads', 'hamstrings', 'glutes', 'calves', 'cardio', 'other'];

  // [name, muscle, equipment]
  var LIBRARY = [
    ['Bench press', 'chest', 'Barbell'], ['Incline bench press', 'chest', 'Barbell'], ['Dumbbell bench press', 'chest', 'Dumbbell'],
    ['Incline dumbbell press', 'chest', 'Dumbbell'], ['Chest fly', 'chest', 'Machine'], ['Cable crossover', 'chest', 'Cable'],
    ['Push-up', 'chest', 'Bodyweight'], ['Chest press', 'chest', 'Machine'],
    ['Deadlift', 'back', 'Barbell'], ['Pull-up', 'back', 'Bodyweight'], ['Chin-up', 'back', 'Bodyweight'],
    ['Lat pulldown', 'back', 'Cable'], ['Barbell row', 'back', 'Barbell'], ['Dumbbell row', 'back', 'Dumbbell'],
    ['Seated cable row', 'back', 'Cable'], ['T-bar row', 'back', 'Barbell'], ['Back extension', 'back', 'Bodyweight'],
    ['Overhead press', 'shoulders', 'Barbell'], ['Dumbbell shoulder press', 'shoulders', 'Dumbbell'], ['Lateral raise', 'shoulders', 'Dumbbell'],
    ['Cable lateral raise', 'shoulders', 'Cable'], ['Front raise', 'shoulders', 'Dumbbell'], ['Rear delt fly', 'shoulders', 'Dumbbell'],
    ['Arnold press', 'shoulders', 'Dumbbell'], ['Face pull', 'shoulders', 'Cable'], ['Shrug', 'back', 'Dumbbell'],
    ['Barbell curl', 'biceps', 'Barbell'], ['Dumbbell curl', 'biceps', 'Dumbbell'], ['Hammer curl', 'biceps', 'Dumbbell'],
    ['Preacher curl', 'biceps', 'Machine'], ['Cable curl', 'biceps', 'Cable'], ['Incline dumbbell curl', 'biceps', 'Dumbbell'],
    ['Triceps pushdown', 'triceps', 'Cable'], ['Skull crusher', 'triceps', 'Barbell'], ['Overhead triceps extension', 'triceps', 'Dumbbell'],
    ['Close-grip bench press', 'triceps', 'Barbell'], ['Dips', 'triceps', 'Bodyweight'],
    ['Wrist curl', 'forearms', 'Dumbbell'], ["Farmer's walk", 'forearms', 'Dumbbell'],
    ['Plank', 'core', 'Bodyweight'], ['Crunch', 'core', 'Bodyweight'], ['Hanging leg raise', 'core', 'Bodyweight'],
    ['Cable crunch', 'core', 'Cable'], ['Russian twist', 'core', 'Bodyweight'], ['Ab wheel rollout', 'core', 'Bodyweight'],
    ['Squat', 'quads', 'Barbell'], ['Front squat', 'quads', 'Barbell'], ['Leg press', 'quads', 'Machine'],
    ['Leg extension', 'quads', 'Machine'], ['Walking lunge', 'quads', 'Dumbbell'], ['Bulgarian split squat', 'quads', 'Dumbbell'],
    ['Hack squat', 'quads', 'Machine'], ['Goblet squat', 'quads', 'Kettlebell'],
    ['Romanian deadlift', 'hamstrings', 'Barbell'], ['Lying leg curl', 'hamstrings', 'Machine'], ['Seated leg curl', 'hamstrings', 'Machine'],
    ['Good morning', 'hamstrings', 'Barbell'], ['Nordic curl', 'hamstrings', 'Bodyweight'],
    ['Hip thrust', 'glutes', 'Barbell'], ['Glute bridge', 'glutes', 'Bodyweight'], ['Cable kickback', 'glutes', 'Cable'],
    ['Hip abduction', 'glutes', 'Machine'],
    ['Standing calf raise', 'calves', 'Machine'], ['Seated calf raise', 'calves', 'Machine'],
    ['Running', 'cardio', 'Cardio'], ['Cycling', 'cardio', 'Cardio'], ['Rowing machine', 'cardio', 'Cardio'],
    ['Elliptical', 'cardio', 'Cardio'], ['Stair climber', 'cardio', 'Cardio'], ['Walking', 'cardio', 'Cardio'],
    ['Swimming', 'cardio', 'Cardio'], ['Jump rope', 'cardio', 'Cardio']
  ];
  var LIB = {};
  // The full library comes from exercises.js, built by tools/build_exercises.py from
  // hasaneyldrm/exercises-dataset (MIT, the dataset openGym uses). The names above stay
  // first and keep their spelling; they borrow how-to steps from their dataset twin.
  var DB = global.WorkoutExercises || { alias: {}, list: [] };
  function secList(csv, muscle) { return String(csv || '').split(' ').filter(function (m) { return m && m !== muscle && MUSCLES[m]; }); }
  var ALL = LIBRARY.map(function (x) {
    var a = DB.alias[key(x[0])];
    return (LIB[key(x[0])] = { name: x[0], muscle: x[1], equipment: x[2], sec: secList(a && a[1], x[1]), id: a && a[0], popular: true });
  });
  DB.list.forEach(function (x) {
    var k = key(x[0]);
    if (LIB[k] || !MUSCLES[x[1]]) return;
    ALL.push(LIB[k] = { name: x[0], muscle: x[1], equipment: x[2], sec: secList(x[3], x[1]), id: x[4] });
  });

  // Step-by-step instructions are ~650 KB, so they load the first time someone opens "How to".
  // A script tag (not fetch) so it also works from file://.
  var SCRIPT_BASE = (function () { var c = document.currentScript; return c && c.src ? c.src.replace(/[^\/]*$/, '') : ''; })();
  var howto = { status: global.WorkoutExerciseHowTo ? 'ready' : 'idle', waiting: [] };
  function loadHowTo(cb) {
    if (howto.status === 'ready' || howto.status === 'failed') { cb(); return; }
    howto.waiting.push(cb);
    if (howto.status === 'loading') return;
    howto.status = 'loading';
    var tag = document.createElement('script');
    tag.src = SCRIPT_BASE + 'exercise-howto.js';
    tag.onload = tag.onerror = function () {
      howto.status = global.WorkoutExerciseHowTo ? 'ready' : 'failed';
      if (howto.status === 'failed') tag.remove();
      var w = howto.waiting; howto.waiting = [];
      w.forEach(function (f) { f(); });
    };
    document.head.appendChild(tag);
  }

  // Starter routines: [name, program, [[exercise, sets, target reps], ...]].
  // Every exercise name is in LIBRARY or the dataset, so muscles and how-to steps resolve.
  var TEMPLATES = [
    ['Push', 'Push · Pull · Legs', [['Bench press', 4, '6–8'], ['Overhead press', 3, '8–10'], ['Incline dumbbell press', 3, '8–12'], ['Lateral raise', 3, '12–15'], ['Triceps pushdown', 3, '10–12'], ['Overhead triceps extension', 2, '10–12']]],
    ['Pull', 'Push · Pull · Legs', [['Deadlift', 3, '5'], ['Pull-up', 3, '6–10'], ['Barbell row', 3, '8–10'], ['Cable rear delt row (with rope)', 3, '12–15'], ['Barbell curl', 3, '8–12'], ['Hammer curl', 2, '10–12']]],
    ['Legs', 'Push · Pull · Legs', [['Squat', 4, '6–8'], ['Romanian deadlift', 3, '8–10'], ['Leg press', 3, '10–12'], ['Lying leg curl', 3, '10–12'], ['Standing calf raise', 4, '12–15'], ['Hanging leg raise', 3, '10–15']]],
    ['Upper', 'Upper · Lower', [['Bench press', 4, '6–8'], ['Barbell row', 4, '6–8'], ['Dumbbell shoulder press', 3, '8–10'], ['Lat pulldown', 3, '10–12'], ['Dumbbell curl', 2, '10–12'], ['Triceps pushdown', 2, '10–12']]],
    ['Lower', 'Upper · Lower', [['Squat', 4, '6–8'], ['Romanian deadlift', 3, '8–10'], ['Bulgarian split squat', 3, '8–10'], ['Leg extension', 2, '12–15'], ['Seated leg curl', 2, '12–15'], ['Standing calf raise', 3, '12–15']]],
    ['5×5 A', 'Beginner strength', [['Squat', 5, '5'], ['Bench press', 5, '5'], ['Barbell row', 5, '5']]],
    ['5×5 B', 'Beginner strength', [['Squat', 5, '5'], ['Overhead press', 5, '5'], ['Deadlift', 1, '5']]],
    ['Full body · dumbbells', 'Home or hotel gym', [['Goblet squat', 3, '10–12'], ['Dumbbell bench press', 3, '8–12'], ['Dumbbell row', 3, '8–12'], ['Dumbbell shoulder press', 3, '8–12'], ['Dumbbell romanian deadlift', 3, '10–12'], ['Hammer curl', 2, '10–12']]],
    ['Bodyweight', 'No equipment', [['Push-up', 3, '8–15'], ['Inverted row', 3, '8–12'], ['Split squats', 3, '10–12'], ['Glute bridge', 3, '12–15'], ['Dips', 3, '6–12'], ['Hanging leg raise', 3, '8–12']]]
  ];

  // Best guess for names typed by hand (English and Portuguese gym words). Order matters.
  var GUESSES = [
    [/\b(run|running|jog|corrida|correr|bike|cycling|bicicleta|rowing|remo|swim|nata[cç][aã]o|walk|caminhada|elliptical|el[ií]ptica|cardio|stair|passadeira|treadmill|corda|jump rope|hiit)\b/i, 'cardio'],
    [/romanian|\brdl\b|stiff|leg curl|hamstring|isquio|good morning|nordic|flexora/i, 'hamstrings'],
    [/calf|g[eé]meos|panturrilha/i, 'calves'],
    [/hip thrust|glute|gl[uú]teo|bridge|kickback|abdu[cç]/i, 'glutes'],
    [/squat|agachamento|leg press|prensa|lunge|afundo|leg ext|extensora|quad/i, 'quads'],
    [/tricep|tr[ií]cep|pushdown|skull|\bdips?\b|fundos|testa/i, 'triceps'],
    [/curl|rosca|bicep|b[ií]cep/i, 'biceps'],
    [/wrist|forearm|antebra[cç]o|farmer/i, 'forearms'],
    [/plank|prancha|crunch|\babs?\b|abdominal|sit-?up|core|twist|leg raise|rollout/i, 'core'],
    [/bench|supino|chest|peito|\bfly\b|crucifixo|push-?up|flex[oõ]es|peck|pec deck/i, 'chest'],
    [/deadlift|peso morto|\brow\b|remada|pull|puxada|\blat\b|chin|costas|back|shrug|encolhimento/i, 'back'],
    [/press|ombro|shoulder|lateral|raise|eleva[cç][aã]o|delt|militar|arnold/i, 'shoulders']
  ];

  // ---------- helpers ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function today() { return ymd(new Date()); }
  function parseDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2] || 1); }
  function fmtDate(s, opts) { return parseDate(s).toLocaleDateString(undefined, opts || { weekday: 'short', day: 'numeric', month: 'short' }); }
  function daysAgo(s) { return Math.round((parseDate(today()) - parseDate(s)) / 864e5); }
  function relDay(s) {
    var n = daysAgo(s);
    return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : n > 1 && n < 7 ? n + ' days ago' : fmtDate(s);
  }
  function startOfWeek(d) { // Monday
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round1(n) { return Math.round(n * 10) / 10; }
  function fmtN(n) { return Math.round(n).toLocaleString(); }
  function e1rm(weight, reps) { return reps > 0 && weight > 0 ? weight * (1 + reps / 30) : 0; } // Epley
  function normName(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
  function key(s) { return normName(s).toLowerCase(); }
  function clock(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function fmtMinutes(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ' min';
  }
  function restLabel(s) { return s ? (s < 60 ? s + 's' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) : 'Off'; }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0); }
  function byDateAsc(a, b) { return -byDateDesc(a, b); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  function isCardioSet(st) { return st && (st.km != null || st.min != null) && !num(st.reps); }
  function setCounts(st) { return isCardioSet(st) ? num(st.km) > 0 || num(st.min) > 0 : num(st.reps) > 0; }
  function sessionVolume(s) {
    var v = 0;
    s.exercises.forEach(function (ex) { ex.sets.forEach(function (st) { if (!st.warmup) v += num(st.reps) * num(st.weight); }); });
    return v;
  }
  function sessionSets(s) { return s.exercises.reduce(function (a, ex) { return a + ex.sets.length; }, 0); }

  function summarizeSets(sets, unit) {
    // "3×8 @ 60kg, 1×6 @ 65kg" – groups consecutive identical sets
    var out = [], i = 0;
    var dist = unit === 'lb' ? 'mi' : 'km';
    while (i < sets.length) {
      var j = i;
      if (isCardioSet(sets[i])) {
        var st = sets[i];
        out.push([num(st.km) ? round1(num(st.km)) + ' ' + dist : '', num(st.min) ? round1(num(st.min)) + ' min' : ''].filter(Boolean).join(' in '));
        i++; continue;
      }
      while (j + 1 < sets.length && num(sets[j + 1].reps) === num(sets[i].reps) && num(sets[j + 1].weight) === num(sets[i].weight)) j++;
      var w = num(sets[i].weight);
      out.push((j - i + 1) + '×' + num(sets[i].reps) + (w ? ' @ ' + w + unit : ' (bodyweight)'));
      i = j + 1;
    }
    return out.join(', ');
  }

  function bestSet(sets, unit) {
    var best = null;
    sets.forEach(function (st) {
      if (st.warmup) return;
      if (isCardioSet(st)) { if (!best || num(st.km) > num(best.km)) best = st; return; }
      var score = e1rm(num(st.weight), num(st.reps)) || num(st.reps) / 1000;
      if (!best || score > best.score) best = { score: score, weight: num(st.weight), reps: num(st.reps) };
    });
    if (!best) return '';
    if (best.km != null || best.min != null) return summarizeSets([best], unit);
    return best.weight ? best.weight + ' ' + unit + ' × ' + best.reps : best.reps + ' reps';
  }

  // exerciseName -> { name, points: [{date, top, e1rm, volume, maxReps, reps, km, min, sets}] } sorted by date
  function exerciseHistory(data) {
    var map = {};
    data.sessions.slice().sort(byDateAsc).forEach(function (s) {
      s.exercises.forEach(function (ex) {
        var k = key(ex.name);
        if (!k) return;
        var p = { date: s.date, sid: s.id, top: 0, e1rm: 0, volume: 0, maxReps: 0, reps: 0, km: 0, min: 0, best: null, sets: ex.sets };
        ex.sets.forEach(function (st) {
          if (st.warmup) return;
          var w = num(st.weight), r = num(st.reps);
          if (w > p.top) p.top = w;
          if (r > p.maxReps) p.maxReps = r;
          var e = e1rm(w, r);
          if (e > p.e1rm) { p.e1rm = e; p.best = { weight: w, reps: r }; }
          p.volume += w * r; p.reps += r;
          p.km += num(st.km); p.min += num(st.min);
        });
        map[k] = map[k] || { name: normName(ex.name), points: [] };
        map[k].name = normName(ex.name);
        map[k].points.push(p);
      });
    });
    return map;
  }

  // Personal records: walk sessions in order and note which exercises beat their earlier best.
  // Returns { sessionId: { exerciseKey: true } }. The first time an exercise is done doesn't count.
  function recordsBySession(data) {
    var best = {}, out = {};
    data.sessions.slice().sort(byDateAsc).forEach(function (s) {
      s.exercises.forEach(function (ex) {
        var k = key(ex.name); if (!k) return;
        var cur = { e: 0, w: 0, r: 0, km: 0 };
        ex.sets.forEach(function (st) {
          if (st.warmup) return;
          var w = num(st.weight), r = num(st.reps);
          cur.e = Math.max(cur.e, e1rm(w, r)); cur.w = Math.max(cur.w, w);
          if (!w) cur.r = Math.max(cur.r, r);
          cur.km = Math.max(cur.km, num(st.km));
        });
        var b = best[k];
        if (b && (cur.e > b.e + 1e-9 || cur.w > b.w || (!cur.w && !b.w && cur.r > b.r) || cur.km > b.km)) {
          (out[s.id] = out[s.id] || {})[k] = true;
        }
        best[k] = b ? { e: Math.max(b.e, cur.e), w: Math.max(b.w, cur.w), r: Math.max(b.r, cur.r), km: Math.max(b.km, cur.km) } : cur;
      });
    });
    return out;
  }

  // ---------- drawings ----------
  // Lucide icons (lucide.dev), 24px grid, drawn at 16px with a 1.5px stroke.
  var ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    dots: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
    trophy: '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>',
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    weight: '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/>',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
    heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    flame: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>'
  };
  function ic(name, cls) {
    return '<svg class="wt-ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  // A stylised body, drawn for this app. Left-side parts are mirrored for the right side.
  // Each part: [muscle or '', svg element]. viewBox 0 0 60 124.
  var ARM = {
    upper: '<ellipse cx="14.6" cy="38.6" rx="3.4" ry="7" transform="rotate(9 14.6 38.6)"/>',
    fore: '<ellipse cx="11.6" cy="53.6" rx="2.9" ry="7.2" transform="rotate(11 11.6 53.6)"/>',
    hand: '<circle cx="10.2" cy="63.6" r="2.5"/>'
  };
  var BODY = {
    front: {
      side: [
        ['shoulders', '<ellipse cx="17.4" cy="27.2" rx="4.8" ry="5.4"/>'],
        ['chest', '<path d="M29.3 23.4c-4.8-.3-8.1 1.3-8.7 5.7l.4 6.5c2.4 2.6 6.2 2.8 8.3 1.2z"/>'],
        ['biceps', ARM.upper], ['forearms', ARM.fore], ['', ARM.hand],
        ['core', '<path d="M21.3 40.2l1.8.6.6 18-1.1-.4c-1.2-5.8-1.6-12.4-1.3-18.2z"/>'],
        ['quads', '<path d="M22.2 67.2h7.2L29 91.5c-1.6 2.1-4.4 2.1-5.8.1-1.8-7.6-2-16.6-1-24.4z"/>'],
        ['', '<circle cx="26.2" cy="96" r="2.4"/>'],
        ['calves', '<path d="M23.6 99.5c-1 5.5-.2 11.5 1.2 16h2.6c1.2-4.5 1.6-10.5 1.2-16z"/>'],
        ['', '<ellipse cx="25.8" cy="119.2" rx="3.2" ry="1.9"/>']
      ],
      mid: [
        ['', '<ellipse cx="30" cy="9" rx="6.2" ry="7.2"/>'],
        ['', '<rect x="27.2" y="15" width="5.6" height="6.4" rx="2"/>'],
        ['core', '<path d="M23.6 40.4c2.4-1.2 10.4-1.2 12.8 0l-.6 19.2c-2 2.8-9.6 2.8-11.6 0z"/>'],
        ['', '<path d="M24 61.6c2.6 2.2 9.4 2.2 12 0l1.6 4.8H22.4z"/>']
      ]
    },
    back: {
      side: [
        ['shoulders', '<ellipse cx="17.4" cy="27.2" rx="4.8" ry="5.4"/>'],
        ['back', '<path d="M20.8 28.6l8.5 3v19.8c-3.5-1-6.3-4.8-7.3-9.8z"/>'],
        ['triceps', ARM.upper], ['forearms', ARM.fore], ['', ARM.hand],
        ['glutes', '<path d="M22.6 60.4h6.8v9.8c-2.6 2-6 1.2-7-2z"/>'],
        ['hamstrings', '<path d="M22.6 71.4c1.6 1.8 5.2 2 6.7.6L29 91.5c-1.6 2.1-4.4 2.1-5.8.1-1.6-7-1.6-13.8-.6-20.2z"/>'],
        ['', '<circle cx="26.2" cy="95.8" r="2.3"/>'],
        ['calves', '<path d="M23.2 98.4c-1.6 5.2-.2 11.2 1.6 15.2h2.8c1.6-4.2 2-10.2 1-15.2z"/>'],
        ['', '<ellipse cx="26" cy="118.6" rx="3" ry="2.4"/>']
      ],
      mid: [
        ['', '<ellipse cx="30" cy="9" rx="6.2" ry="7.2"/>'],
        ['', '<rect x="27.2" y="15" width="5.6" height="5" rx="2"/>'],
        ['back', '<path d="M24.4 19.6h11.2l4.6 6.2-10.2 4.8-10.2-4.8z"/>'],
        ['back', '<path d="M23.4 50.8c2.6 2.6 10.6 2.6 13.2 0v8.6H23.4z"/>']
      ]
    }
  };
  // levels: { muscle: 1..4 } for a heat map; or a muscle name to highlight one
  function bodySvg(view, levels, viewBox, cls) {
    var lv = typeof levels === 'string' ? (function () { var o = {}; o[levels] = 4; return o; })() : (levels || {});
    function part(p) {
      var l = p[0] && lv[p[0]] ? ' l' + lv[p[0]] : '';
      return p[1].replace(/^<(\w+)/, '<$1 class="p' + l + '"');
    }
    var b = BODY[view];
    var side = b.side.map(part).join('');
    return '<svg class="wt-body' + (cls ? ' ' + cls : '') + '" viewBox="' + (viewBox || '0 0 60 124') + '" aria-hidden="true">' +
      '<g>' + side + '</g><g transform="matrix(-1 0 0 1 60 0)">' + side + '</g>' + b.mid.map(part).join('') + '</svg>';
  }
  var CROP = { upper: '3 15 54 54', lower: '7 58 46 66' };
  var LOWER = { quads: 1, hamstrings: 1, glutes: 1, calves: 1 };
  function thumb(muscle, size) {
    var cls = 'wt-thumb' + (size ? ' wt-thumb-' + size : '');
    var m = MUSCLES[muscle];
    if (muscle === 'cardio') return '<span class="' + cls + ' is-cardio">' + ic('heart') + '</span>';
    if (!m || !m.view) return '<span class="' + cls + ' is-other">' + ic('weight') + '</span>';
    return '<span class="' + cls + '">' + bodySvg(m.view, muscle, LOWER[muscle] ? CROP.lower : CROP.upper) + '</span>';
  }

  // ---------- charts ----------
  // Charts are drawn at the panel's real width so labels stay readable on a phone.
  var chartW = 640, halfW = 320, wide = false;
  function lineChart(points, label, fmt) {
    var W = chartW, H = 220, L = 44, R = 14, T = 14, B = 28;
    var vals = points.map(function (p) { return p.v; });
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    var pad = (max - min) * 0.15; max += pad; min = Math.max(0, min - pad);
    var t0 = parseDate(points[0].date).getTime(), t1 = parseDate(points[points.length - 1].date).getTime();
    function x(i) {
      if (t1 === t0) return points.length === 1 ? L + (W - L - R) / 2 : L + i / (points.length - 1) * (W - L - R);
      return L + (parseDate(points[i].date).getTime() - t0) / (t1 - t0) * (W - L - R);
    }
    function y(v) { return T + (1 - (v - min) / (max - min)) * (H - T - B); }
    var line = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join('');
    var svg = '<svg class="wt-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + ' over time">';
    for (var g = 0; g <= 3; g++) {
      var v = min + (max - min) * g / 3, yy = y(v).toFixed(1);
      svg += '<line class="wt-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      svg += '<text x="' + (L - 8) + '" y="' + (+yy + 4) + '" text-anchor="end">' + esc(fmt(v, true)) + '</text>';
    }
    var labelIdx = points.length <= 2 ? points.map(function (_, i) { return i; }) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
    labelIdx.forEach(function (i) {
      var anchor = points.length > 1 && i === 0 ? 'start' : points.length > 1 && i === points.length - 1 ? 'end' : 'middle';
      svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + esc(fmtDate(points[i].date, { day: 'numeric', month: 'short' })) + '</text>';
    });
    if (points.length > 1) {
      svg += '<path class="wt-area" d="' + line + 'L' + x(points.length - 1).toFixed(1) + ',' + (H - B) + 'L' + x(0).toFixed(1) + ',' + (H - B) + 'Z"/>';
    }
    svg += '<path class="wt-line" d="' + line + '"/>';
    vals.forEach(function (v, i) {
      svg += '<circle class="wt-dot' + (i === vals.length - 1 ? ' is-last' : '') + '" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="' + (i === vals.length - 1 ? 5 : 3.5) + '"><title>' +
        esc(fmtDate(points[i].date) + ': ' + fmt(v)) + '</title></circle>';
    });
    return svg + '</svg>';
  }

  function barChart(bars, fmt) {
    // on wide screens this chart sits in a half-width card
    var W = wide ? halfW : chartW, H = wide ? 240 : 180, L = 8, R = 8, T = 22, B = 26;
    var max = Math.max.apply(null, bars.map(function (b) { return b.v; })) || 1;
    var slot = (W - L - R) / bars.length, bw = Math.min(30, slot * 0.62);
    var svg = '<svg class="wt-chart wt-bars" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Weekly totals">';
    svg += '<line class="wt-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    bars.forEach(function (b, i) {
      var h = b.v ? Math.max(4, (H - T - B) * b.v / max) : 0;
      var cx = L + slot * i + slot / 2;
      if (h) {
        svg += '<rect class="wt-bar' + (b.cur ? ' is-cur' : '') + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="5"><title>' +
          esc(b.title + ': ' + fmt(b.v)) + '</title></rect>';
      }
      if (b.v === max && max > 0) svg += '<text class="wt-bar-top" x="' + cx.toFixed(1) + '" y="' + (H - B - h - 7).toFixed(1) + '" text-anchor="middle">' + esc(fmt(b.v, true)) + '</text>';
      if (b.label) svg += '<text x="' + cx.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(b.label) + '</text>';
    });
    return svg + '</svg>';
  }

  // ---------- rest timer sound ----------
  var audio = null;
  function primeAudio() {
    try {
      if (!audio) { var AC = global.AudioContext || global.webkitAudioContext; if (AC) audio = new AC(); }
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }
  function chime() {
    try {
      if (global.navigator && navigator.vibrate) navigator.vibrate([180, 80, 180]);
      if (!audio) return;
      [0, 0.22].forEach(function (t, i) {
        var o = audio.createOscillator(), g = audio.createGain(), at = audio.currentTime + t;
        o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
        o.connect(g); g.connect(audio.destination); o.start(at); o.stop(at + 0.32);
      });
    } catch (e) { /* sound is optional */ }
  }

  // ---------- module ----------
  /*
   * opts.storage: { load() -> data, save(data) -> bool }   (default: localStorage)
   * opts.state:   object kept by the caller so the open tab and the workout in
   *               progress survive being re-mounted
   * opts.date:    'YYYY-MM-DD' to use as the date for a new workout
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
    // Overlays (rest timer, exercise picker, toasts) live in a layer on <body>: the
    // dashboard's views are animated, which would pin position:fixed to the view.
    var layer = document.createElement('div');
    layer.className = 'wt-root wt-layer' + (opts.embedded ? ' wt-embedded' : '');
    document.body.appendChild(layer);

    function newDraft() { return { date: defaultDate, title: '', notes: '', startedAt: null, exercises: [] }; }
    function loadDraft() {
      try {
        var saved = JSON.parse(global.localStorage.getItem(DRAFT_KEY));
        if (saved && saved.draft && Array.isArray(saved.draft.exercises)) { state.editingId = saved.editingId || null; return saved.draft; }
      } catch (e) { /* none saved */ }
      return null;
    }
    if (!state.draft || !Array.isArray(state.draft.exercises)) state.draft = loadDraft() || newDraft();
    function active() { return !!(state.editingId || state.draft.startedAt); }

    function saveDraft() {
      try {
        if (active()) global.localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: state.draft, editingId: state.editingId || null }));
        else global.localStorage.removeItem(DRAFT_KEY);
      } catch (e) { /* private mode: the draft just isn't kept across reloads */ }
    }

    function persist() {
      if (storage.save(data) === false) toast('Could not save – browser storage is unavailable');
    }

    function toast(msg) {
      var old = layer.querySelector('.wt-toast'); if (old) old.remove();
      var t = document.createElement('div');
      t.className = 'wt-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
      layer.appendChild(t);
      setTimeout(function () { t.remove(); }, 2600);
    }

    function muscleOf(name) {
      var k = key(name);
      if (data.muscles && data.muscles[k] && MUSCLES[data.muscles[k]]) return data.muscles[k];
      if (LIB[k]) return LIB[k].muscle;
      for (var i = 0; i < GUESSES.length; i++) if (GUESSES[i][0].test(name)) return GUESSES[i][1];
      return 'other';
    }
    function equipmentOf(name) { var l = LIB[key(name)]; return l ? l.equipment : ''; }
    function isCardio(name) { return muscleOf(name) === 'cardio'; }
    function isBodyweight(name) {
      if (equipmentOf(name) === 'Bodyweight') return true;
      var last = lastFor(name);
      return !!(last && last.ex.sets.length && last.ex.sets.every(function (s) { return !num(s.weight); }));
    }
    // Cardio exercises log distance + time instead of weight + reps. Old entries keep
    // whatever they were logged with, so a "5k run" saved with reps stays that way.
    function kindOf(name, sets) {
      if (sets && sets.some(isCardioSet)) return 'cardio';
      if (sets && sets.some(function (st) { return num(st.reps) > 0; })) return 'lift';
      return isCardio(name) ? 'cardio' : 'lift';
    }
    function exKind(ex) { return ex.kind || (ex.kind = kindOf(ex.name, ex.sets)); }
    // The matching set from last time: warm-ups line up with warm-ups, working sets with working sets.
    function prevSet(prevSets, sets, si) {
      if (!prevSets || !sets[si]) return null;
      var warm = !!sets[si].warmup, n = 0;
      for (var i = 0; i < si; i++) if (!!sets[i].warmup === warm) n++;
      var same = prevSets.filter(function (p) { return !!p.warmup === warm; });
      return same[n] || null;
    }
    function distUnit() { return data.unit === 'lb' ? 'mi' : 'km'; }
    function defaultRest() { return data.rest != null ? +data.rest : 90; }

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

    function weekDays() {
      var start = startOfWeek(new Date()), on = {};
      data.sessions.forEach(function (s) { on[s.date] = 1; });
      var out = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i);
        out.push({ date: ymd(d), on: !!on[ymd(d)], today: ymd(d) === today(), letter: 'MTWTFSS'[i] });
      }
      return out;
    }

    // ----- stats strip -----
    function renderStats() {
      var wk = startOfWeek(new Date()).getTime();
      var thisWeek = data.sessions.filter(function (s) { return parseDate(s.date).getTime() >= wk; });
      var vol = thisWeek.reduce(function (a, s) { return a + sessionVolume(s); }, 0);
      var mins = thisWeek.reduce(function (a, s) { return a + num(s.duration); }, 0);
      // consecutive weeks (ending this or last week) with at least one session
      var weeks = {};
      data.sessions.forEach(function (s) { weeks[startOfWeek(parseDate(s.date)).getTime()] = 1; });
      var streak = 0, cur = new Date(wk);
      if (!weeks[cur.getTime()]) cur.setDate(cur.getDate() - 7);
      while (weeks[cur.getTime()]) { streak++; cur.setDate(cur.getDate() - 7); }
      var last = data.sessions.slice().sort(byDateDesc)[0];
      var days = weekDays().map(function (d) {
        return '<span class="wt-wd' + (d.on ? ' is-on' : '') + (d.today ? ' is-today' : '') + '" title="' + esc(fmtDate(d.date)) + '">' +
          '<i>' + (d.on ? ic('check') : '') + '</i><small>' + d.letter + '</small></span>';
      }).join('');
      return '<div class="wt-stats">' +
        '<div class="wt-stat wt-stat-week"><div class="wt-stat-top"><span>This week</span><b>' + plural(thisWeek.length, 'workout') + '</b></div><div class="wt-week">' + days + '</div></div>' +
        stat('weight', fmtN(vol) + ' ' + data.unit, 'Volume this week', mins ? fmtMinutes(mins) + ' trained' : '') +
        stat('flame', plural(streak, 'week'), 'Streak', streak ? 'with a workout' : 'Train this week to start one') +
        stat('clock', last ? relDay(last.date) : '–', 'Last workout', last ? last.title || 'Workout' : 'Nothing logged yet') +
        '</div>';
    }
    function stat(icon, v, l, sub) {
      return '<div class="wt-stat" data-icon="' + icon + '"><span class="wt-stat-l">' + esc(l) + '</span><b>' + esc(v) + '</b>' +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    }

    // ----- workout tab: start screen -----
    function routines() {
      var seen = {}, out = [];
      data.sessions.slice().sort(byDateDesc).forEach(function (s) {
        var k = key(s.title);
        if (!k || seen[k] || !s.exercises.length) return;
        seen[k] = 1; out.push(s);
      });
      return out.slice(0, 6);
    }

    function renderStart() {
      var last = data.sessions.slice().sort(byDateDesc)[0];
      var h = '<div class="wt-start">' +
        '<div class="wt-card wt-quick">' +
        '<div class="wt-quick-text"><h3>New workout</h3><p>Start empty and add exercises as you go, or start from one of your routines.</p>' +
        '<div class="wt-actions"><button class="wt-btn wt-primary" data-a="start">' + ic('play') + 'Start empty workout</button>' +
        (last ? '<button class="wt-btn" data-a="start-from" data-id="' + esc(last.id) + '">' + ic('repeat') + 'Repeat ' + esc(last.title || 'last workout') + '</button>' : '') +
        '</div></div></div>';
      var rs = routines();
      if (rs.length) {
        h += '<div class="wt-sec-head"><h3>Routines</h3><span>From the workouts you named</span></div><div class="wt-routines">';
        rs.forEach(function (s) {
          var muscles = [];
          s.exercises.forEach(function (ex) { var m = muscleOf(ex.name); if (muscles.indexOf(m) < 0) muscles.push(m); });
          h += '<article class="wt-card wt-routine"><div class="wt-routine-head"><h4>' + esc(s.title) + '</h4><span>' + esc(relDay(s.date)) + '</span></div>' +
            '<div class="wt-routine-thumbs">' + muscles.slice(0, 5).map(function (m) { return thumb(m, 'sm'); }).join('') + '</div>' +
            '<p>' + esc(s.exercises.slice(0, 4).map(function (ex) { return ex.name; }).join(' · ')) + (s.exercises.length > 4 ? ' · +' + (s.exercises.length - 4) + ' more' : '') + '</p>' +
            '<button class="wt-btn" data-a="start-from" data-id="' + esc(s.id) + '">' + ic('play') + 'Start routine</button></article>';
        });
        h += '</div>';
      } else if (!data.sessions.length) {
        h += '<p class="wt-hint">Name a workout when you finish it, for example “Push day”, and it becomes a routine you can start again.</p>';
      }
      h += '<div class="wt-sec-head"><h3>Templates</h3><span>Common splits to start from</span></div><div class="wt-routines wt-templates">';
      TEMPLATES.forEach(function (tpl, i) {
        var muscles = [];
        tpl[2].forEach(function (x) { var m = muscleOf(x[0]); if (muscles.indexOf(m) < 0) muscles.push(m); });
        var sets = tpl[2].reduce(function (a, x) { return a + x[1]; }, 0);
        h += '<article class="wt-card wt-routine"><div class="wt-routine-head"><h4>' + esc(tpl[0]) + '</h4><span>' + esc(tpl[1]) + '</span></div>' +
          '<div class="wt-routine-thumbs">' + muscles.slice(0, 5).map(function (m) { return thumb(m, 'sm'); }).join('') + '</div>' +
          '<p>' + esc(tpl[2].map(function (x) { return x[0]; }).join(' · ')) + '</p>' +
          '<span class="wt-tpl-meta">' + plural(tpl[2].length, 'exercise') + ' · ' + plural(sets, 'set') + '</span>' +
          '<button class="wt-btn" data-a="start-template" data-i="' + i + '">' + ic('play') + 'Start template</button></article>';
      });
      h += '</div>';
      return h + '</div>';
    }

    // ----- workout tab: live log -----
    function liveTotals() {
      var vol = 0, done = 0, total = 0;
      state.draft.exercises.forEach(function (ex) {
        ex.sets.forEach(function (st) {
          total++;
          if (st.done) { done++; if (!st.warmup) vol += num(st.reps) * num(st.weight); }
        });
      });
      return { vol: vol, done: done, total: total };
    }
    function elapsed() { return state.draft.startedAt ? (Date.now() - state.draft.startedAt) / 1000 : 0; }

    function renderLive() {
      var d = state.draft, t = liveTotals(), editing = !!state.editingId;
      var editingSession = editing && data.sessions.filter(function (s) { return s.id === state.editingId; })[0];
      var h = '<div class="wt-card wt-live">' +
        '<div class="wt-live-top"><div class="wt-live-name">' +
        '<span class="wt-eyebrow">' + (editing ? 'Editing workout' : '<i class="wt-pulse"></i>Workout in progress') + '</span>' +
        '<input class="wt-title-in" data-f="title" placeholder="Name this workout" aria-label="Workout name" value="' + esc(d.title) + '"></div>' +
        '<button class="wt-btn wt-primary wt-finish" data-a="save">' + ic('check') + (editing ? 'Save' : 'Finish') + '</button></div>' +
        '<div class="wt-live-stats">' +
        '<div><span>Duration</span><b data-live="duration">' + (editing ? (editingSession && editingSession.duration ? fmtMinutes(editingSession.duration) : '–') : clock(elapsed())) + '</b></div>' +
        '<div><span>Volume</span><b data-live="volume">' + fmtN(t.vol) + ' ' + data.unit + '</b></div>' +
        '<div><span>Sets</span><b data-live="sets">' + t.done + ' / ' + t.total + '</b></div>' +
        '<label class="wt-live-date"><span>Date</span><input type="date" data-f="date" value="' + esc(d.date) + '"></label>' +
        '</div></div>';

      d.exercises.forEach(function (ex, ei) { h += renderExercise(ex, ei); });
      if (!d.exercises.length) {
        h += '<div class="wt-card wt-emptyex">' + thumb('other') + '<p><b>No exercises yet</b><br>Add the first one to start logging sets.</p></div>';
      }
      h += '<button class="wt-btn wt-add-ex" data-a="add-ex">' + ic('plus') + 'Add exercise</button>';
      h += '<div class="wt-card wt-notes"><label><span>Notes</span><textarea data-f="notes" rows="2" placeholder="How did it feel?">' + esc(d.notes) + '</textarea></label></div>';
      h += '<div class="wt-live-foot">' + (state.confirmDiscard
        ? '<span>' + (editing ? 'Drop your changes?' : 'Discard this workout? Nothing will be saved.') + '</span><button class="wt-btn wt-danger-solid" data-a="discard-yes">' + (editing ? 'Drop changes' : 'Discard') + '</button><button class="wt-btn" data-a="discard-no">Keep going</button>'
        : '<button class="wt-btn wt-ghost-danger" data-a="discard">' + ic(editing ? 'x' : 'trash') + (editing ? 'Cancel editing' : 'Discard workout') + '</button>') + '</div>';
      return h;
    }

    function renderExercise(ex, ei) {
      var m = muscleOf(ex.name), cardio = exKind(ex) === 'cardio', bw = !cardio && isBodyweight(ex.name);
      var last = lastFor(ex.name);
      var prev = last ? last.ex.sets : [];
      var rest = ex.rest != null ? +ex.rest : defaultRest();
      var h = '<section class="wt-card wt-exc" data-ex="' + ei + '"><header class="wt-exc-head">' + thumb(m) +
        '<div class="wt-exc-title"><h4>' + esc(ex.name) + '</h4><span>' + esc(MUSCLES[m].label) + (equipmentOf(ex.name) && !cardio ? ' · ' + esc(equipmentOf(ex.name)) : '') +
        (ex.target ? ' · ' + ex.sets.filter(function (st) { return !st.warmup; }).length + ' × ' + esc(ex.target) : '') +
        (last ? ' · last ' + esc(relDay(last.date).toLowerCase()) : '') + '</span></div>' +
        '<label class="wt-rest-chip" title="Rest timer after each set">' + ic('timer') + '<select data-a="rest" data-ex="' + ei + '" aria-label="Rest timer for ' + esc(ex.name) + '">' +
        REST_CHOICES.map(function (s) { return '<option value="' + s + '"' + (s === rest ? ' selected' : '') + '>' + restLabel(s) + '</option>'; }).join('') + '</select></label>' +
        '<button class="wt-iconbtn" data-a="menu" data-ex="' + ei + '" aria-label="More for ' + esc(ex.name) + '" aria-expanded="' + (state.menuFor === ei) + '">' + ic('dots') + '</button></header>';
      if (state.menuFor === ei) {
        h += '<div class="wt-exmenu">' +
          (ei > 0 ? '<button class="wt-btn" data-a="move-up" data-ex="' + ei + '">' + ic('up') + 'Move up</button>' : '') +
          (ei < state.draft.exercises.length - 1 ? '<button class="wt-btn" data-a="move-down" data-ex="' + ei + '">' + ic('down') + 'Move down</button>' : '') +
          '<button class="wt-btn" data-a="replace" data-ex="' + ei + '">' + ic('swap') + 'Replace</button>' +
          (LIB[key(ex.name)] ? '<button class="wt-btn" data-a="howto" data-ex="' + ei + '" aria-expanded="' + (state.howFor === ei) + '">' + ic('info') + (state.howFor === ei ? 'Hide how-to' : 'How to') + '</button>' : '') +
          '<button class="wt-btn wt-ghost-danger" data-a="del-ex" data-ex="' + ei + '">' + ic('trash') + 'Remove</button></div>';
      }
      if (state.howFor === ei) h += renderHowTo(ex.name, ei);
      h += '<div class="wt-sets' + (cardio ? ' is-cardio' : '') + '" role="table" aria-label="Sets for ' + esc(ex.name) + '">' +
        '<div class="wt-set-row wt-set-head" role="row"><span role="columnheader">Set</span><span role="columnheader">Previous</span>' +
        '<span role="columnheader">' + (cardio ? distUnit() : (bw ? '+' : '') + data.unit) + '</span><span role="columnheader">' + (cardio ? 'min' : 'Reps') + '</span>' +
        '<span role="columnheader" class="wt-c-check">' + ic('check') + '</span><span></span></div>';
      var n = 0;
      ex.sets.forEach(function (st, si) {
        var p = prevSet(prev, ex.sets, si);
        var prevText = !p ? '–' : isCardioSet(p) ? summarizeSets([p], data.unit) : (num(p.weight) ? num(p.weight) + ' × ' + num(p.reps) : num(p.reps) + ' reps');
        if (!st.warmup) n++;
        var a = cardio ? 'km' : 'weight', b = cardio ? 'min' : 'reps';
        var phA = p ? (cardio ? (num(p.km) || '') : (num(p.weight) || (bw ? 'BW' : ''))) : (bw ? 'BW' : '');
        var phB = p ? (cardio ? (num(p.min) || '') : (num(p.reps) || '')) : (ex.target && !cardio ? ex.target : '');
        h += '<div class="wt-set-row' + (st.done ? ' is-done' : '') + (st.warmup ? ' is-warm' : '') + '" role="row">' +
          '<button class="wt-setno" data-a="warm" data-ex="' + ei + '" data-set="' + si + '" title="Tap to mark as a warm-up set" aria-label="Set ' + (si + 1) + (st.warmup ? ', warm-up' : '') + '">' + (st.warmup ? 'W' : n) + '</button>' +
          '<button class="wt-prev" data-a="use-prev" data-ex="' + ei + '" data-set="' + si + '"' + (p ? ' title="Copy last time\'s numbers"' : ' disabled') + '>' + esc(prevText) + '</button>' +
          '<input type="number" inputmode="decimal" min="0" step="' + (cardio ? '0.1' : '0.5') + '" data-ex="' + ei + '" data-set="' + si + '" data-f="' + a + '" placeholder="' + esc(phA) + '" value="' + esc(st[a]) + '" aria-label="' + (cardio ? 'Distance' : 'Weight') + ', set ' + (si + 1) + '">' +
          '<input type="number" inputmode="' + (cardio ? 'decimal' : 'numeric') + '" min="0" step="' + (cardio ? '0.5' : '1') + '" data-ex="' + ei + '" data-set="' + si + '" data-f="' + b + '" placeholder="' + esc(phB) + '" value="' + esc(st[b]) + '" aria-label="' + (cardio ? 'Minutes' : 'Reps') + ', set ' + (si + 1) + '">' +
          '<button class="wt-check" data-a="done" data-ex="' + ei + '" data-set="' + si + '" aria-pressed="' + !!st.done + '" aria-label="Set ' + (si + 1) + ' done">' + ic('check') + '</button>' +
          '<button class="wt-delset" data-a="del-set" data-ex="' + ei + '" data-set="' + si + '" aria-label="Remove set ' + (si + 1) + '">' + ic('x') + '</button></div>';
      });
      h += '</div><button class="wt-btn wt-add-set" data-a="add-set" data-ex="' + ei + '">' + ic('plus') + 'Add set' + (rest ? '<span>· rest ' + restLabel(rest) + '</span>' : '') + '</button></section>';
      return h;
    }

    // ----- exercise picker -----
    function pickerItems() {
      var counts = {}, names = {};
      data.sessions.forEach(function (s) { s.exercises.forEach(function (ex) { var k = key(ex.name); if (!k) return; counts[k] = (counts[k] || 0) + 1; names[k] = normName(ex.name); }); });
      var items = ALL.map(function (x) { var k = key(x.name); return { name: x.name, k: k, muscle: x.muscle, equipment: x.equipment, popular: x.popular, count: counts[k] || 0 }; });
      Object.keys(names).forEach(function (k) { if (!LIB[k]) items.push({ name: names[k], k: k, muscle: muscleOf(names[k]), equipment: '', count: counts[k] }); });
      return items;
    }
    // Every word typed has to appear in the name, muscle or equipment: "db press" finds nothing,
    // "dumbbell press" finds the presses done with dumbbells.
    function pickMatches() {
      var p = state.picker, words = key(p.q).split(' ').filter(Boolean);
      return pickerItems().filter(function (it) {
        if (p.muscle !== 'all' && it.muscle !== p.muscle) return false;
        if (!words.length) return true;
        var hay = it.k + ' ' + MUSCLES[it.muscle].label.toLowerCase() + ' ' + String(it.equipment).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
    }
    // Equipment chips come from what the search and muscle filter left, most common first,
    // so every chip has results behind it (the same idea as openGym's library).
    function equipmentChoices(items) {
      var c = {};
      items.forEach(function (it) { if (it.equipment && it.muscle !== 'cardio') c[it.equipment] = (c[it.equipment] || 0) + 1; });
      return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.localeCompare(b); });
    }
    function renderEqChips(choices) {
      var p = state.picker;
      if (choices.length < 2) return '';
      return ['all'].concat(choices).map(function (e) {
        return '<button class="wt-chip" data-a="pick-eq" data-e="' + esc(e) + '" aria-pressed="' + (p.eq === e) + '">' + (e === 'all' ? 'Any equipment' : esc(e)) + '</button>';
      }).join('');
    }
    function renderPickList(matches) {
      var p = state.picker, q = key(p.q);
      var items = matches || pickMatches();
      if (p.eq !== 'all') items = items.filter(function (it) { return it.equipment === p.eq; });
      var used = items.filter(function (it) { return it.count; }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
      var rest = items.filter(function (it) { return !it.count; });
      function starts(it) { return q && it.k.indexOf(q) === 0 ? 0 : 1; }
      rest.sort(function (a, b) { return (b.popular ? 1 : 0) - (a.popular ? 1 : 0) || starts(a) - starts(b) || a.name.localeCompare(b.name); });
      var popular = q ? [] : rest.filter(function (it) { return it.popular; });
      var others = q ? rest : rest.filter(function (it) { return !it.popular; });
      function row(it) {
        var open = p.info === it.k, lib = LIB[it.k];
        return '<div class="wt-pick-item' + (open ? ' is-open' : '') + '"><div class="wt-pick-line">' +
          '<button class="wt-pick-row" data-a="pick" data-name="' + esc(it.name) + '">' + thumb(it.muscle) + '<span class="wt-pick-txt"><b>' + esc(it.name) + '</b><small>' +
          esc(MUSCLES[it.muscle].label + (it.equipment && it.muscle !== 'cardio' ? ' · ' + it.equipment : '')) + '</small></span>' +
          (it.count ? '<span class="wt-pick-count">' + plural(it.count, 'time') + '</span>' : '') + '</button>' +
          (lib ? '<button class="wt-iconbtn wt-pick-info" data-a="pick-info" data-k="' + esc(it.k) + '" aria-expanded="' + open + '" aria-label="How to do ' + esc(it.name) + '" title="How to">' + ic('info') + '</button>' : '') +
          '</div>' + (open ? renderHowTo(it.name) : '') + '</div>';
      }
      var h = '';
      var typed = normName(p.q);
      if (typed && !items.some(function (it) { return it.k === key(typed); })) {
        var gm = p.muscle !== 'all' ? p.muscle : muscleOf(typed);
        h += '<button class="wt-pick-row wt-pick-new" data-a="pick-new">' + thumb(gm) + '<span class="wt-pick-txt"><b>Add “' + esc(typed) + '”</b><small>New exercise · ' +
          esc(MUSCLES[gm].label) + (p.muscle === 'all' ? ' (pick a muscle above to change it)' : '') + '</small></span>' + ic('plus') + '</button>';
      }
      if (used.length) h += '<div class="wt-pick-sec">Done before</div>' + used.map(row).join('');
      if (popular.length) h += '<div class="wt-pick-sec">Popular</div>' + popular.map(row).join('');
      if (others.length) {
        var shown = others.slice(0, p.limit);
        h += '<div class="wt-pick-sec">' + (q ? others.length + (others.length === 1 ? ' match' : ' matches') : 'Full library · ' + fmtN(others.length)) + '</div>' + shown.map(row).join('');
        if (others.length > shown.length) h += '<button class="wt-btn wt-pick-more" data-a="pick-more">Show ' + Math.min(PICK_PAGE, others.length - shown.length) + ' more</button>';
      }
      if (!items.length && !typed) h += '<p class="wt-hint">No exercises match. Try another word or clear a filter.</p>';
      return h;
    }
    function refreshPicker() {
      var matches = pickMatches(), choices = equipmentChoices(matches);
      if (state.picker.eq !== 'all' && choices.indexOf(state.picker.eq) < 0) state.picker.eq = 'all';
      var eqEl = layer.querySelector('.wt-pick-eq');
      if (eqEl) { eqEl.innerHTML = renderEqChips(choices); eqEl.hidden = choices.length < 2; }
      layer.querySelector('.wt-pick-list').innerHTML = renderPickList(matches);
    }
    // Muscles worked (main one solid, helpers lighter) and the dataset's steps.
    function renderHowTo(name, ei) {
      var lib = LIB[key(name)];
      if (!lib) return '';
      var levels = {}; levels[lib.muscle] = 4;
      lib.sec.forEach(function (m) { levels[m] = levels[m] || 2; });
      var views = ['front', 'back'].filter(function (v) { return Object.keys(levels).some(function (m) { return MUSCLES[m] && MUSCLES[m].view === v; }); });
      var h = '<div class="wt-howto">';
      if (views.length) h += '<div class="wt-figures">' + views.map(function (v) { return '<figure>' + bodySvg(v, levels) + '</figure>'; }).join('') + '</div>';
      h += '<div class="wt-howto-text"><p class="wt-howto-muscles"><b>' + esc(MUSCLES[lib.muscle].label) + '</b>' +
        (lib.sec.length ? '<span> · also ' + esc(lib.sec.map(function (m) { return MUSCLES[m].label.toLowerCase(); }).join(', ')) + '</span>' : '') + '</p>';
      var steps = lib.id && global.WorkoutExerciseHowTo && global.WorkoutExerciseHowTo[lib.id];
      if (steps && steps.length) h += '<ol>' + steps.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('') + '</ol>';
      else if (lib.id && howto.status !== 'ready' && howto.status !== 'failed') h += '<p class="wt-hint">Loading steps…</p>';
      else if (lib.id && howto.status === 'failed') h += '<p class="wt-hint">Couldn’t load the steps. Check your connection and open this again.</p>';
      else h += '<p class="wt-hint">No written steps for this one yet.</p>';
      if (ei != null) h += '<button class="wt-btn wt-howto-close" data-a="howto" data-ex="' + ei + '">' + ic('x') + 'Hide how-to</button>';
      return h + '</div></div>';
    }
    function needHowTo(name, after) {
      var lib = LIB[key(name)];
      if (!lib || !lib.id || global.WorkoutExerciseHowTo) return;
      if (howto.status === 'failed') howto.status = 'idle';
      loadHowTo(after);
    }
    function renderPicker() {
      var p = state.picker, matches = pickMatches(), eqChoices = equipmentChoices(matches);
      if (p.eq !== 'all' && eqChoices.indexOf(p.eq) < 0) p.eq = 'all';
      return '<div class="wt-sheet-wrap" data-close="1"><div class="wt-sheet" role="dialog" aria-modal="true" aria-label="' + (p.mode === 'replace' ? 'Replace exercise' : 'Add exercise') + '">' +
        '<div class="wt-sheet-head"><h3>' + (p.mode === 'replace' ? 'Replace exercise' : 'Add exercise') + '</h3><button class="wt-iconbtn" data-a="close-picker" aria-label="Close">' + ic('x') + '</button></div>' +
        '<label class="wt-search">' + ic('search') + '<input data-a="pick-q" placeholder="Search ' + fmtN(ALL.length) + ' exercises or type a new one" value="' + esc(p.q) + '" autocomplete="off" aria-label="Search exercises"></label>' +
        '<div class="wt-chips" role="group" aria-label="Muscle">' + ['all'].concat(MUSCLE_ORDER).map(function (m) {
          return '<button class="wt-chip" data-a="pick-muscle" data-m="' + m + '" aria-pressed="' + (p.muscle === m) + '">' + (m === 'all' ? 'All' : MUSCLES[m].label) + '</button>';
        }).join('') + '</div>' +
        '<div class="wt-chips wt-pick-eq" role="group" aria-label="Equipment"' + (eqChoices.length < 2 ? ' hidden' : '') + '>' + renderEqChips(eqChoices) + '</div>' +
        '<div class="wt-pick-list">' + renderPickList(matches) + '</div></div></div>';
    }

    // ----- rest bar -----
    function renderRestBar() {
      var r = state.rest; if (!r) return '';
      var left = Math.max(0, (r.endsAt - Date.now()) / 1000);
      return '<div class="wt-restbar" role="timer" aria-live="off">' +
        '<div class="wt-rest-prog"><i style="width:' + (100 * left / r.total).toFixed(1) + '%"></i></div>' +
        '<div class="wt-rest-main"><span class="wt-rest-ic">' + ic('timer') + '</span><div class="wt-rest-txt"><small>Rest · ' + esc(r.name) + '</small><b data-live="rest">' + clock(left) + '</b></div>' +
        '<button class="wt-btn" data-a="rest-minus">−15</button><button class="wt-btn" data-a="rest-plus">+15</button><button class="wt-btn wt-primary" data-a="rest-skip">Skip</button></div></div>';
    }

    // ----- history tab -----
    function renderCalendar() {
      var ym = state.histMonth || today().slice(0, 7);
      var first = parseDate(ym + '-01');
      var startPad = (first.getDay() + 6) % 7;
      var dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      var on = {}, monthCount = 0;
      data.sessions.forEach(function (s) { on[s.date] = (on[s.date] || 0) + 1; if (s.date.slice(0, 7) === ym) monthCount++; });
      var h = '<div class="wt-card wt-cal"><div class="wt-cal-head"><button class="wt-iconbtn" data-a="month" data-d="-1" aria-label="Previous month">' + ic('left') + '</button>' +
        '<div><b>' + esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</b><span>' + plural(monthCount, 'workout') + '</span></div>' +
        '<button class="wt-iconbtn" data-a="month" data-d="1" aria-label="Next month">' + ic('right') + '</button></div><div class="wt-cal-grid">' +
        ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(function (l) { return '<span class="wt-cal-dow">' + l + '</span>'; }).join('');
      for (var i = 0; i < startPad; i++) h += '<span></span>';
      for (var dnum = 1; dnum <= dim; dnum++) {
        var ds = ym + '-' + String(dnum).padStart(2, '0');
        var cls = 'wt-cal-day' + (on[ds] ? ' is-on' : '') + (ds === today() ? ' is-today' : '') + (state.histDay === ds ? ' is-sel' : '');
        h += on[ds]
          ? '<button class="' + cls + '" data-a="day" data-date="' + ds + '" aria-label="' + esc(fmtDate(ds)) + ', ' + plural(on[ds], 'workout') + '">' + dnum + '</button>'
          : '<span class="' + cls + '">' + dnum + '</span>';
      }
      return h + '</div></div>';
    }

    function renderSession(s, prs) {
      var pr = prs[s.id] ? Object.keys(prs[s.id]).length : 0;
      var h = '<article class="wt-card wt-sess"><header class="wt-sess-head"><div><h4>' + esc(s.title || 'Workout') + '</h4><span>' + esc(fmtDate(s.date, { weekday: 'long', day: 'numeric', month: 'long' })) + '</span></div>' +
        '<div class="wt-sess-acts"><button class="wt-iconbtn" data-a="start-from" data-id="' + esc(s.id) + '" title="Do this workout again" aria-label="Do this workout again">' + ic('repeat') + '</button>' +
        '<button class="wt-iconbtn" data-a="edit" data-id="' + esc(s.id) + '" title="Edit" aria-label="Edit">' + ic('edit') + '</button>' +
        '<button class="wt-iconbtn wt-del" data-a="delete" data-id="' + esc(s.id) + '" title="Delete" aria-label="Delete">' + ic('trash') + '</button></div></header>';
      if (state.confirmDelete === s.id) {
        h += '<div class="wt-confirm"><span>Delete this workout?</span><button class="wt-btn wt-danger-solid" data-a="delete-yes" data-id="' + esc(s.id) + '">Delete</button><button class="wt-btn" data-a="delete-no">Keep</button></div>';
      }
      h += '<div class="wt-sess-stats">' +
        (s.duration ? '<span>' + ic('clock') + fmtMinutes(s.duration) + '</span>' : '') +
        (sessionVolume(s) ? '<span>' + ic('weight') + fmtN(sessionVolume(s)) + ' ' + data.unit + '</span>' : '') +
        '<span>' + ic('layers') + plural(sessionSets(s), 'set') + '</span>' +
        (pr ? '<span class="wt-pr">' + ic('trophy') + plural(pr, 'PR') + '</span>' : '') + '</div><ul class="wt-sess-ex">';
      s.exercises.forEach(function (ex) {
        var isPr = prs[s.id] && prs[s.id][key(ex.name)];
        h += '<li>' + thumb(muscleOf(ex.name), 'sm') + '<span class="wt-sess-name"><b>' + ex.sets.length + ' × </b>' + esc(ex.name) + (isPr ? ' <i class="wt-pr-dot" title="Personal record">' + ic('trophy') + '</i>' : '') + '</span>' +
          '<span class="wt-sess-best">' + esc(bestSet(ex.sets, data.unit)) + '</span></li>';
      });
      h += '</ul>' + (s.notes ? '<p class="wt-sess-notes">' + esc(s.notes) + '</p>' : '') + '</article>';
      return h;
    }

    function renderHistory() {
      if (!data.sessions.length) return emptyState('No workouts yet', 'Finish your first workout and it shows up here, with a calendar of the days you trained.');
      var prs = recordsBySession(data);
      var list = data.sessions.slice().sort(byDateDesc);
      if (state.histDay) list = list.filter(function (s) { return s.date === state.histDay; });
      var h = '<div class="wt-hist-layout"><div class="wt-hist-side">' + renderCalendar() + '</div><div class="wt-hist-main">';
      if (state.histDay) h += '<div class="wt-filter"><span>' + esc(fmtDate(state.histDay, { weekday: 'long', day: 'numeric', month: 'long' })) + '</span><button class="wt-btn" data-a="day-clear">Show all</button></div>';
      var shown = state.histMore || 12, more = list.length - shown;
      if (!state.histDay) list = list.slice(0, shown);
      var month = '';
      list.forEach(function (s) {
        var m = s.date.slice(0, 7);
        if (m !== month && !state.histDay) { month = m; h += '<div class="wt-month">' + esc(parseDate(m + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</div>'; }
        h += renderSession(s, prs);
      });
      if (!state.histDay && more > 0) h += '<button class="wt-btn wt-more" data-a="hist-more">Show older workouts (' + more + ')</button>';
      return h + '</div></div>';
    }

    function emptyState(title, text) {
      return '<div class="wt-card wt-empty"><span class="wt-empty-ic">' + ic('weight') + '</span><div class="wt-empty-copy"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
        '<button class="wt-btn wt-primary" data-a="go-log">' + ic('play') + 'Start a workout</button></div></div>';
    }

    // ----- progress tab -----
    function muscleSets(days) {
      var since = new Date(); since.setDate(since.getDate() - days + 1);
      var from = ymd(since), out = {};
      data.sessions.forEach(function (s) {
        if (s.date < from || s.date > today()) return;
        s.exercises.forEach(function (ex) {
          var m = muscleOf(ex.name);
          out[m] = (out[m] || 0) + ex.sets.filter(function (st) { return !st.warmup; }).length;
        });
      });
      return out;
    }

    function renderMuscleCard() {
      var days = state.muscleDays || 30, sets = muscleSets(days);
      var body = MUSCLE_ORDER.filter(function (m) { return MUSCLES[m].view && sets[m]; });
      var max = Math.max.apply(null, body.map(function (m) { return sets[m]; }).concat([1]));
      var levels = {};
      body.forEach(function (m) { levels[m] = Math.max(1, Math.ceil(sets[m] / max * 4)); });
      var listed = MUSCLE_ORDER.filter(function (m) { return sets[m]; }).sort(function (a, b) { return sets[b] - sets[a]; });
      var h = '<div class="wt-card wt-muscles"><div class="wt-card-head"><div><h3>Muscles trained</h3><span>Working sets per muscle group</span></div>' +
        seg('days', [[7, '7 days'], [30, '30 days']], days) + '</div><div class="wt-muscles-body"><div class="wt-figures">' +
        '<figure>' + bodySvg('front', levels) + '<figcaption>Front</figcaption></figure><figure>' + bodySvg('back', levels) + '<figcaption>Back</figcaption></figure></div>';
      if (listed.length) {
        var lmax = sets[listed[0]];
        h += '<ul class="wt-mlist">' + listed.map(function (m) {
          return '<li><span>' + esc(MUSCLES[m].label) + '</span><i><b style="width:' + Math.round(100 * sets[m] / lmax) + '%"></b></i><em>' + sets[m] + '</em></li>';
        }).join('') + '</ul>';
      } else {
        h += '<p class="wt-hint">Nothing logged in the last ' + days + ' days.</p>';
      }
      return h + '</div><div class="wt-legend"><span>Less</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div></div>';
    }

    function renderWeeksCard() {
      var metric = state.weekMetric || 'workouts';
      var start = startOfWeek(new Date()); start.setDate(start.getDate() - 7 * 11);
      var bars = [];
      for (var i = 0; i < 12; i++) {
        var a = new Date(start); a.setDate(start.getDate() + 7 * i);
        var b = new Date(a); b.setDate(a.getDate() + 6);
        var from = ymd(a), to = ymd(b);
        var ss = data.sessions.filter(function (s) { return s.date >= from && s.date <= to; });
        var v = metric === 'volume' ? ss.reduce(function (x, s) { return x + sessionVolume(s); }, 0)
          : metric === 'time' ? ss.reduce(function (x, s) { return x + num(s.duration); }, 0) : ss.length;
        bars.push({ v: v, cur: i === 11, title: 'Week of ' + fmtDate(from, { day: 'numeric', month: 'short' }), label: i % 3 === 2 || i === 11 ? (i === 11 ? 'This wk' : fmtDate(from, { day: 'numeric', month: 'short' })) : '' });
      }
      var fmt = metric === 'volume' ? function (v, short) { return short && v >= 1000 ? round1(v / 1000) + 'k' : fmtN(v) + (short ? '' : ' ' + data.unit); }
        : metric === 'time' ? function (v) { return fmtMinutes(v); } : function (v, short) { return short ? String(v) : plural(v, 'workout'); };
      return '<div class="wt-card"><div class="wt-card-head"><div><h3>Last 12 weeks</h3><span>' + (metric === 'volume' ? 'Volume lifted' : metric === 'time' ? 'Time trained' : 'Workouts') + ' per week</span></div>' +
        seg('weeks', [['workouts', 'Workouts'], ['volume', 'Volume'], ['time', 'Time']], metric) + '</div>' + barChart(bars, fmt) + '</div>';
    }

    function seg(name, options, cur) {
      return '<div class="wt-seg" role="group">' + options.map(function (o) {
        return '<button data-a="seg" data-seg="' + name + '" data-v="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(cur)) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }

    function cardioPoints(pts) { return pts.some(function (p) { return p.km > 0 || p.min > 0; }); }
    function exerciseBest(name, pts) {
      if (cardioPoints(pts)) { var km = Math.max.apply(null, pts.map(function (p) { return p.km; })); return km ? round1(km) + ' ' + distUnit() : fmtMinutes(Math.max.apply(null, pts.map(function (p) { return p.min; }))); }
      var top = Math.max.apply(null, pts.map(function (p) { return p.top; }));
      return top ? round1(top) + ' ' + data.unit : Math.max.apply(null, pts.map(function (p) { return p.maxReps; })) + ' reps';
    }

    function renderProgress() {
      var hist = exerciseHistory(data), keys = Object.keys(hist);
      if (!keys.length) return emptyState('Progress shows up here', 'Once you log a few workouts you get a muscle map, weekly totals and a chart and records for every exercise.');
      if (state.progressEx && hist[state.progressEx]) return renderExerciseDetail(hist[state.progressEx]);
      state.progressEx = null;
      keys.sort(function (a, b) { return hist[b].points.length - hist[a].points.length || a.localeCompare(b); });
      var h = renderInsightsTop() + '<div class="wt-prog-grid">' + renderMuscleCard() + renderWeeksCard() + renderInsightsGrid() + '</div>';
      h += '<div class="wt-card wt-exlist"><div class="wt-card-head"><div><h3>Exercises</h3><span>Tap one for its chart and records</span></div></div>';
      keys.forEach(function (k) {
        var e = hist[k], pts = e.points, m = muscleOf(e.name);
        h += '<button class="wt-exrow" data-a="open-ex" data-k="' + esc(k) + '">' + thumb(m) + '<span class="wt-pick-txt"><b>' + esc(e.name) + '</b><small>' +
          esc(MUSCLES[m].label) + ' · ' + plural(pts.length, 'session') + ' · last ' + esc(relDay(pts[pts.length - 1].date).toLowerCase()) + '</small></span>' +
          '<span class="wt-exrow-best"><small>Best</small>' + esc(exerciseBest(e.name, pts)) + '</span>' + ic('right') + '</button>';
      });
      return h + '</div>';
    }

    function renderExerciseDetail(e) {
      var pts = e.points, m = muscleOf(e.name), cardio = cardioPoints(pts);
      var weighted = !cardio && pts.some(function (p) { return p.top > 0; });
      var metrics = cardio ? [['km', 'Distance'], ['min', 'Time']]
        : weighted ? [['e1rm', 'Est. 1RM'], ['top', 'Heaviest'], ['volume', 'Volume']] : [['maxReps', 'Best set'], ['reps', 'Total reps']];
      var metric = state.metric && metrics.some(function (x) { return x[0] === state.metric; }) ? state.metric : metrics[0][0];
      var unitOf = { e1rm: data.unit, top: data.unit, volume: data.unit, maxReps: 'reps', reps: 'reps', km: distUnit(), min: 'min' };
      var fmt = function (v, short) { return (metric === 'volume' && short && v >= 1000 ? round1(v / 1000) + 'k' : String(round1(v))) + (short ? '' : ' ' + unitOf[metric]); };
      var series = pts.filter(function (p) { return p[metric] > 0; }).map(function (p) { return { date: p.date, v: p[metric] }; });

      function maxOf(f) { return Math.max.apply(null, pts.map(f)); }
      var tiles = [];
      if (cardio) {
        tiles.push(['Longest', round1(maxOf(function (p) { return p.km; })) + ' ' + distUnit()]);
        tiles.push(['Most time', fmtMinutes(maxOf(function (p) { return p.min; }))]);
        var paces = pts.filter(function (p) { return p.km > 0 && p.min > 0; }).map(function (p) { return p.min / p.km; });
        if (paces.length) { var bp = Math.min.apply(null, paces); tiles.push(['Best pace', Math.floor(bp) + ':' + String(Math.round(bp % 1 * 60)).padStart(2, '0') + ' /' + distUnit()]); }
      } else if (weighted) {
        var bestP = pts.slice().sort(function (a, b) { return b.e1rm - a.e1rm; })[0];
        tiles.push(['Heaviest', round1(maxOf(function (p) { return p.top; })) + ' ' + data.unit]);
        tiles.push(['Est. 1RM', round1(bestP.e1rm) + ' ' + data.unit]);
        if (bestP.best) tiles.push(['Best set', bestP.best.weight + ' × ' + bestP.best.reps]);
        tiles.push(['Best volume', fmtN(maxOf(function (p) { return p.volume; })) + ' ' + data.unit]);
      } else {
        tiles.push(['Best set', maxOf(function (p) { return p.maxReps; }) + ' reps']);
        tiles.push(['Most in a session', maxOf(function (p) { return p.reps; }) + ' reps']);
      }
      tiles.push(['Sessions', String(pts.length)]);

      var h = '<button class="wt-back" data-a="close-ex">' + ic('left') + 'All exercises</button>' +
        '<div class="wt-card wt-exhero">' + thumb(m, 'lg') + '<div><h3>' + esc(e.name) + '</h3><span>' + esc(MUSCLES[m].label) + (equipmentOf(e.name) && !cardio ? ' · ' + esc(equipmentOf(e.name)) : '') +
        ' · first logged ' + esc(fmtDate(pts[0].date, { day: 'numeric', month: 'short', year: 'numeric' })) + '</span></div></div>' +
        '<div class="wt-tiles">' + tiles.map(function (t) { return '<div class="wt-tile"><span>' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b></div>'; }).join('') + '</div>' +
        '<div class="wt-card"><div class="wt-card-head"><div><h3>' + esc(metrics.filter(function (x) { return x[0] === metric; })[0][1]) + '</h3><span>' +
        (metric === 'e1rm' ? 'Estimated one-rep max from your best set (Epley)' : 'Per session') + '</span></div>' + seg('metric', metrics, metric) + '</div>' +
        (series.length ? lineChart(series, e.name, fmt) : '<p class="wt-hint">No numbers for this yet.</p>') +
        (pts.length < 2 ? '<p class="wt-hint">Log this exercise again to see a trend.</p>' : '') + '</div>' +
        (weighted ? renderRepRanges(pts) : '') +
        '<div class="wt-card"><div class="wt-card-head"><div><h3>History</h3></div></div><ul class="wt-exhist">' +
        pts.slice().reverse().map(function (p) {
          return '<li><span>' + esc(fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })) + '</span><b>' + esc(summarizeSets(p.sets, data.unit)) + '</b></li>';
        }).join('') + '</ul></div>';
      return h;
    }

    // ----- progress insights (insights.js) and CSV (transfer.js) -----
    // Both live in their own files; if one isn't loaded its cards are left out.
    function Insights() { return global.DashboardModules.workoutInsights; }
    function Transfer() { return global.DashboardModules.workoutTransfer; }
    function round2(n) { return Math.round(n * 100) / 100; }
    function shortVol(v) { return v >= 10000 ? round1(v / 1000) + 'k ' + data.unit : fmtN(v) + ' ' + data.unit; }

    function renderInsightsTop() {
      if (!Insights()) return '';
      var c = Insights().consistency(data.sessions, today());
      var tiles = [
        ['Workouts this week', String(c.week.workouts), 'Last week ' + c.prev.workouts, c.week.workouts - c.prev.workouts],
        ['Volume this week', shortVol(c.week.volume), 'Last week ' + shortVol(c.prev.volume), c.week.volume - c.prev.volume],
        ['Working sets this week', String(c.week.sets), 'Last week ' + c.prev.sets, c.week.sets - c.prev.sets],
        ['Week streak', plural(c.streak, 'week'), 'Longest ' + plural(c.longest, 'week'), 0]
      ];
      return '<div class="wt-tiles wt-sumtiles">' + tiles.map(function (t) {
        return '<div class="wt-tile"><span>' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b><small' + (t[3] > 0 ? ' class="is-up"' : '') + '>' +
          (t[3] > 0 ? ic('up') : '') + esc(t[2]) + '</small></div>';
      }).join('') + '</div>' + renderHeatmap();
    }

    function renderHeatmap() {
      var weeks = wide ? 52 : 17, hm = Insights().heatmap(data.sessions, today(), weeks);
      var lastMonth = '';
      var cols = hm.cols.map(function (col) {
        var m = fmtDate(col[0].date, { month: 'short' }), label = m !== lastMonth ? m : '';
        lastMonth = m;
        return '<span class="wt-heat-m">' + esc(label) + '</span>' + col.map(function (d) {
          if (d.future) return '<i class="is-future"></i>';
          var tip = fmtDate(d.date) + (d.workouts ? ' · ' + (d.titles.length ? d.titles.join(', ') : plural(d.workouts, 'workout')) + ' · ' + plural(d.sets, 'set') : ' · rest');
          return '<i class="l' + d.level + (d.date === today() ? ' is-today' : '') + '" title="' + esc(tip) + '"></i>';
        }).join('');
      }).join('');
      return '<div class="wt-card wt-heatcard"><div class="wt-card-head"><div><h3>Training calendar</h3><span>' +
        plural(hm.activeDays, 'day') + ' trained in the last ' + weeks + ' weeks</span></div></div>' +
        '<div class="wt-heat" style="--weeks:' + weeks + '" role="img" aria-label="' + esc(plural(hm.activeDays, 'day') + ' trained in the last ' + weeks + ' weeks') + '">' +
        '<span class="wt-heat-m"></span><b>Mon</b><b></b><b>Wed</b><b></b><b>Fri</b><b></b><b></b>' +
        cols + '</div>' +
        '<div class="wt-legend"><span>Fewer sets</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div></div>';
    }

    function renderInsightsGrid() {
      return Insights() ? renderRecordsCard() + renderRecoveryCard() : '';
    }

    function renderRecordsCard() {
      var recs = Insights().records(data.sessions, 6);
      var h = '<div class="wt-card"><div class="wt-card-head"><div><h3>Recent records</h3><span>Each time you beat an earlier best</span></div></div>';
      if (!recs.length) return h + '<p class="wt-hint">Beat an earlier best and it shows up here.</p></div>';
      return h + '<ul class="wt-prlist">' + recs.map(function (r) {
        var u = r.kind === 'reps' ? 'reps' : r.kind === 'km' ? distUnit() : data.unit;
        var what = r.kind === 'e1rm' ? 'Est. 1RM ' + round2(r.value) + ' ' + u + (r.set ? ' · ' + r.set.weight + ' × ' + r.set.reps : '')
          : r.kind === 'weight' ? 'Heaviest ' + round2(r.value) + ' ' + u
          : r.kind === 'reps' ? 'Best set ' + r.value + ' reps'
          : 'Longest ' + round2(r.value) + ' ' + u;
        var gain = '+' + round2(r.value - r.prev) + ' ' + u;
        return '<li><button data-a="open-pr" data-k="' + esc(r.key) + '">' + ic('trophy') + '<span class="wt-pick-txt"><b>' + esc(normName(r.name)) + '</b><small>' +
          esc(what) + '</small></span><span class="wt-prlist-r"><em>' + esc(gain) + '</em><small>' + esc(relDay(r.date)) + '</small></span></button></li>';
      }).join('') + '</ul></div>';
    }

    // Under 48 hours since a muscle's last working set reads as still recovering.
    function renderRecoveryCard() {
      var list = Insights().recovery(data.sessions, today(), muscleOf).filter(function (r) { return MUSCLES[r.muscle] && MUSCLES[r.muscle].view; });
      var h = '<div class="wt-card"><div class="wt-card-head"><div><h3>Recovery</h3><span>Time since each muscle group was last trained</span></div></div>';
      if (!list.length) return h + '<p class="wt-hint">Log a workout to see which muscles are rested.</p></div>';
      return h + '<ul class="wt-recov">' + list.map(function (r) {
        var ready = r.days >= 2;
        return '<li><i class="' + (ready ? 'is-ready' : 'is-rest') + '"></i><span>' + esc(MUSCLES[r.muscle].label) + '</span>' +
          '<small>' + esc(ready ? 'Ready' : 'Recovering') + ' · ' + plural(r.sets, 'set') + '</small><em>' + esc(r.days === 0 ? 'Today' : r.days === 1 ? 'Yesterday' : r.days + ' days ago') + '</em></li>';
      }).join('') + '</ul></div>';
    }

    function renderRepRanges(pts) {
      if (!Insights()) return '';
      var rows = Insights().repRangeBests(pts);
      if (!rows.length) return '';
      return '<div class="wt-card"><div class="wt-card-head"><div><h3>Best by rep range</h3><span>Heaviest working set at each rep count</span></div></div><ul class="wt-exhist">' +
        rows.map(function (r) {
          return '<li><span>' + esc(r.label) + '</span><b>' + esc(r.best.weight + ' ' + data.unit + ' × ' + r.best.reps) +
            ' <small>' + esc(fmtDate(r.best.date, { day: 'numeric', month: 'short', year: 'numeric' })) + '</small></b></li>';
        }).join('') + '</ul></div>';
    }

    function renderTransferCard() {
      if (!Transfer()) return '';
      return '<div class="wt-card"><h3>Spreadsheet (CSV)</h3><p class="wt-hint">One row per set, ready for Excel, Numbers or Google Sheets. ' +
        'Import reads this file and exports from Strong, Hevy and FitNotes. Workouts you already have are skipped, and weights in the other unit are converted.</p>' +
        '<div class="wt-actions"><button class="wt-btn" data-a="export-csv">Download CSV</button>' +
        '<button class="wt-btn" data-a="csv-pick">Import CSV</button>' +
        '<input type="file" accept=".csv,text/csv" data-a="import-csv" hidden></div></div>';
    }

    function download(text, type, name) {
      // Downloads are blocked in some frames; the copy box in Backup always works.
      try {
        var link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: type })); link.download = name;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
      } catch (err) { toast('Download blocked here'); }
    }

    function exportCSV() {
      if (!data.sessions.length) { toast('Nothing logged yet'); return; }
      download(Transfer().toCSV(data), 'text/csv', 'workouts-' + today() + '.csv');
    }

    function importCSV(text) {
      var T = Transfer(), res;
      try { res = T.fromCSV(text, data.unit); }
      catch (err) { toast('Could not read that CSV. ' + err.message); return; }
      var ids = {}, sigs = {}, added = 0, dup = 0, now = Date.now();
      data.sessions.forEach(function (s) { ids[s.id] = 1; sigs[T.signature(s)] = 1; });
      res.sessions.forEach(function (s, i) {
        var sig = T.signature(s);
        if (ids[s.id] || sigs[sig]) { dup++; return; }
        s.createdAt = now + i;
        data.sessions.push(s); ids[s.id] = 1; sigs[sig] = 1; added++;
      });
      state.flash = (added ? 'Imported ' + plural(added, 'workout') + (/Strong|Hevy|FitNotes/.test(res.format) ? ' from ' + res.format : '') : 'Nothing new to import') +
        (dup ? ' · ' + dup + ' already in your log' : '') + (res.skipped ? ' · ' + plural(res.skipped, 'row') + ' skipped' : '');
      if (added) persist();
      render();
    }

    // ----- settings -----
    function renderData() {
      var rest = defaultRest();
      return '<div class="wt-settings"><div class="wt-card"><h3>Units</h3><div class="wt-row"><select data-a="unit" aria-label="Units">' +
        '<option value="kg"' + (data.unit === 'kg' ? ' selected' : '') + '>Kilograms (kg, km)</option>' +
        '<option value="lb"' + (data.unit === 'lb' ? ' selected' : '') + '>Pounds (lb, mi)</option></select>' +
        '<span class="wt-hint">Changes the label only; logged numbers are not converted.</span></div></div>' +
        '<div class="wt-card"><h3>Rest timer</h3><div class="wt-row"><select data-a="rest-default" aria-label="Default rest">' +
        REST_CHOICES.map(function (s) { return '<option value="' + s + '"' + (s === rest ? ' selected' : '') + '>' + (s ? restLabel(s) + (s < 60 ? '' : ' min') : 'Off') + '</option>'; }).join('') + '</select>' +
        '<span class="wt-hint">Starts when you tick a set. Each exercise can have its own time.</span></div></div>' +
        renderTransferCard() +
        '<div class="wt-card"><h3>Backup</h3><p class="wt-hint">Your workouts are saved with the rest of the dashboard. Export a file to back them up or move them to another device.</p>' +
        '<div class="wt-actions"><button class="wt-btn" data-a="export">Download file</button>' +
        '<button class="wt-btn" data-a="import-pick">Import file</button>' +
        '<input type="file" accept="application/json,.json,.csv,text/csv" data-a="import" hidden></div>' +
        '<p class="wt-hint">Or copy and paste the backup as text:</p>' +
        '<textarea data-a="backup-text" rows="3" class="wt-mono" placeholder="Paste a backup or CSV here to import it" aria-label="Backup text"></textarea>' +
        '<div class="wt-actions"><button class="wt-btn" data-a="copy">Copy backup</button><button class="wt-btn" data-a="paste-import">Import pasted text</button></div></div></div>';
    }

    // ----- frame -----
    function render() {
      chartW = el.clientWidth ? Math.max(300, Math.min(760, el.clientWidth - 34)) : 640;
      wide = el.clientWidth >= 860;
      halfW = Math.round((el.clientWidth - 12) / 2 - 34);
      el.classList.toggle('is-wide', wide);
      var live = active();
      var tabs = [['log', live ? (state.editingId ? 'Editing' : 'Workout') : 'Workout'], ['history', 'History'], ['progress', 'Progress'], ['data', 'Settings']];
      var body = state.tab === 'log' ? (live ? renderLive() : renderStart()) : state.tab === 'history' ? renderHistory() : state.tab === 'progress' ? renderProgress() : renderData();
      var banner = live && state.tab !== 'log'
        ? '<button class="wt-banner" data-a="go-log"><i class="wt-pulse"></i><span>' + (state.editingId ? 'Editing a workout' : esc(state.draft.title || 'Workout in progress')) + '</span>' +
          (state.editingId ? '' : '<b data-live="duration">' + clock(elapsed()) + '</b>') + '<em>Resume' + ic('right') + '</em></button>' : '';
      el.innerHTML = (opts.embedded ? '' : '<h2 class="wt-h">Workouts</h2>') +
        '<div class="wt-tabs" role="tablist">' + tabs.map(function (t) {
          return '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '">' + (t[0] === 'log' && live ? '<i class="wt-pulse"></i>' : '') + t[1] + '</button>';
        }).join('') + '</div>' + banner +
        (state.tab === 'log' && !live ? renderStats() : '') +
        '<div class="wt-body wt-tab-' + state.tab + '">' + body + '</div>';
      var toastEl = layer.querySelector('.wt-toast');
      layer.innerHTML = renderRestBar() + (state.picker ? renderPicker() : '');
      if (toastEl) layer.appendChild(toastEl);
      el.classList.toggle('has-rest', !!state.rest);
      layer.classList.toggle('has-rest', !!state.rest);
      document.documentElement.classList.toggle('wt-locked', !!state.picker);
      if (state.flash && el.isConnected) { toast(state.flash); state.flash = null; }
    }

    // ----- actions -----
    function blankSet(prev) { return { weight: '', reps: '', km: '', min: '', done: false, warmup: !!(prev && prev.warmup) }; }
    function newPicker(mode, ei) { return { mode: mode, ex: ei, q: '', muscle: 'all', eq: 'all', limit: PICK_PAGE, info: null }; }
    // A template starts a workout with its exercises, set count and target reps; last
    // time's numbers still show in the Previous column as usual.
    function draftFromTemplate(tpl) {
      var d = newDraft();
      d.title = tpl[0]; d.startedAt = Date.now();
      d.exercises = tpl[2].map(function (x) {
        var last = lastFor(x[0]), sets = [];
        for (var i = 0; i < x[1]; i++) sets.push(blankSet());
        return { name: x[0], kind: kindOf(x[0], last && last.ex.sets), rest: last && last.ex.rest != null ? last.ex.rest : undefined, target: x[2], sets: sets };
      });
      return d;
    }
    function draftFrom(s, keepValues) {
      return {
        date: keepValues ? s.date : defaultDate, title: s.title || '', notes: keepValues ? s.notes || '' : '',
        startedAt: keepValues ? null : Date.now(),
        exercises: s.exercises.map(function (ex) {
          return {
            name: ex.name, rest: ex.rest, kind: kindOf(ex.name, ex.sets),
            sets: ex.sets.map(function (st) {
              if (!keepValues) return blankSet(st);
              return { weight: st.weight != null ? st.weight : '', reps: st.reps != null ? st.reps : '', km: st.km != null ? st.km : '', min: st.min != null ? st.min : '', done: true, warmup: !!st.warmup };
            })
          };
        })
      };
    }

    function cleanDraft() {
      var d = state.draft;
      var exercises = d.exercises.map(function (ex) {
        var cardio = exKind(ex) === 'cardio';
        var out = {
          name: normName(ex.name),
          sets: ex.sets.map(function (st) {
            var o = cardio ? { km: num(st.km), min: num(st.min) } : { reps: num(st.reps), weight: num(st.weight) };
            if (st.warmup) o.warmup = true;
            return o;
          }).filter(setCounts)
        };
        if (ex.rest != null && +ex.rest !== defaultRest()) out.rest = +ex.rest;
        return out;
      }).filter(function (ex) { return ex.name && ex.sets.length; });
      return { date: d.date || defaultDate, title: normName(d.title), notes: String(d.notes || '').trim(), exercises: exercises };
    }

    function addExercise(name) {
      name = normName(name); if (!name) return;
      var p = state.picker, k = key(name);
      if (!LIB[k] && p.muscle !== 'all') { data.muscles = data.muscles || {}; data.muscles[k] = p.muscle; }
      var last = lastFor(name);
      var kind = kindOf(name, last && last.ex.sets);
      var sets = last ? last.ex.sets.map(blankSet) : kind === 'cardio' ? [blankSet()] : [blankSet(), blankSet(), blankSet()];
      var ex = { name: name, kind: kind, rest: last && last.ex.rest != null ? last.ex.rest : undefined, sets: sets };
      if (p.mode === 'replace' && state.draft.exercises[p.ex]) state.draft.exercises[p.ex] = ex;
      else state.draft.exercises.push(ex);
      state.picker = null; state.menuFor = null;
      if (data.muscles && data.muscles[k]) persist();
      saveDraft();
    }

    function startRest(ex) {
      var secs = ex.rest != null ? +ex.rest : defaultRest();
      if (!secs) return;
      state.rest = { endsAt: Date.now() + secs * 1000, total: secs, name: ex.name };
    }

    function onClick(e) {
      var wrap = e.target.closest('.wt-sheet-wrap');
      if (wrap && e.target === wrap) { state.picker = null; render(); return; }
      var t = e.target.closest('button');
      if (!t || !(el.contains(t) || layer.contains(t))) return;
      if (t.dataset.tab) { state.tab = t.dataset.tab; state.menuFor = null; render(); return; }
      var a = t.dataset.a, d = state.draft, ei = +t.dataset.ex, si = +t.dataset.set;
      var ex = d.exercises[ei], st = ex && ex.sets[si];
      switch (a) {
        case 'start':
          if (active()) { state.tab = 'log'; break; }
          state.draft = newDraft(); state.draft.startedAt = Date.now(); state.tab = 'log'; state.howFor = null; saveDraft(); break;
        case 'start-from':
          if (active()) { state.tab = 'log'; state.flash = 'Finish or discard this workout first'; break; }
          var src = data.sessions.filter(function (x) { return x.id === t.dataset.id; })[0];
          if (!src) return;
          state.draft = draftFrom(src, false); state.tab = 'log'; state.howFor = null; saveDraft(); break;
        case 'go-log': state.tab = 'log'; break;
        case 'add-ex': state.picker = newPicker('add'); state.menuFor = null; break;
        case 'replace': state.picker = newPicker('replace', ei); break;
        case 'close-picker': state.picker = null; break;
        case 'pick': addExercise(t.dataset.name); break;
        case 'pick-new': addExercise(state.picker.q); break;
        case 'pick-muscle':
          state.picker.muscle = t.dataset.m; state.picker.limit = PICK_PAGE;
          layer.querySelectorAll('[data-a="pick-muscle"]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === t)); });
          refreshPicker();
          return;
        case 'pick-eq':
          state.picker.eq = t.dataset.e; state.picker.limit = PICK_PAGE;
          refreshPicker();
          return;
        case 'pick-more':
          var list = layer.querySelector('.wt-pick-list'), top = list.scrollTop;
          state.picker.limit += PICK_PAGE;
          list.innerHTML = renderPickList(); list.scrollTop = top;
          return;
        case 'pick-info':
          var pk = t.dataset.k, pl = layer.querySelector('.wt-pick-list'), ptop = pl.scrollTop;
          state.picker.info = state.picker.info === pk ? null : pk;
          pl.innerHTML = renderPickList(); pl.scrollTop = ptop;
          var again = pl.querySelector('[data-a="pick-info"][data-k="' + pk.replace(/["\\]/g, '\\$&') + '"]'); if (again) again.focus();
          if (state.picker.info) needHowTo(pk, function () {
            if (!state.picker || state.picker.info !== pk) return;
            var l = layer.querySelector('.wt-pick-list'), lt = l.scrollTop;
            l.innerHTML = renderPickList(); l.scrollTop = lt;
          });
          return;
        case 'howto':
          state.howFor = state.howFor === ei ? null : ei; state.menuFor = null;
          if (state.howFor != null) needHowTo(ex.name, render);
          break;
        case 'start-template':
          if (active()) { state.tab = 'log'; state.flash = 'Finish or discard this workout first'; break; }
          var tpl = TEMPLATES[+t.dataset.i];
          if (!tpl) return;
          state.draft = draftFromTemplate(tpl); state.tab = 'log'; state.howFor = null; saveDraft(); break;
        case 'menu': state.menuFor = state.menuFor === ei ? null : ei; break;
        case 'move-up': case 'move-down':
          var to = a === 'move-up' ? ei - 1 : ei + 1;
          d.exercises.splice(to, 0, d.exercises.splice(ei, 1)[0]); state.menuFor = null; state.howFor = null; saveDraft(); break;
        case 'del-ex': d.exercises.splice(ei, 1); state.menuFor = null; state.howFor = null; saveDraft(); break;
        case 'add-set':
          var lastSet = ex.sets[ex.sets.length - 1];
          var ns = blankSet();
          // carry the numbers you just did into the next set, like a paper log
          if (lastSet) ['weight', 'reps', 'km', 'min'].forEach(function (f) { ns[f] = lastSet[f]; });
          ex.sets.push(ns); saveDraft(); break;
        case 'del-set': ex.sets.splice(si, 1); saveDraft(); break;
        case 'warm': st.warmup = !st.warmup; saveDraft(); break;
        case 'use-prev': case 'done':
          var last = lastFor(ex.name), p = last && prevSet(last.ex.sets, ex.sets, si), cardio = exKind(ex) === 'cardio';
          var fields = cardio ? ['km', 'min'] : ['weight', 'reps'];
          if (a === 'use-prev' || !st.done) {
            if (p) fields.forEach(function (f) { if (a === 'use-prev' || st[f] === '' || st[f] == null) st[f] = p[f] != null && (num(p[f]) || f === 'weight') ? num(p[f]) : st[f]; });
          }
          if (a === 'done') {
            if (!st.done && !(cardio ? num(st.km) || num(st.min) : num(st.reps))) { toast(cardio ? 'Enter a distance or time first' : 'Enter the reps first'); return; }
            st.done = !st.done;
            if (st.done) { primeAudio(); startRest(ex); }
          }
          saveDraft(); break;
        case 'rest-minus': if (state.rest) state.rest.endsAt -= 15000; if (state.rest && state.rest.endsAt <= Date.now()) state.rest = null; break;
        case 'rest-plus': if (state.rest) { state.rest.endsAt += 15000; state.rest.total += 15; } break;
        case 'rest-skip': state.rest = null; break;
        case 'discard': state.confirmDiscard = true; break;
        case 'discard-no': state.confirmDiscard = false; break;
        case 'discard-yes':
          var wasEditing = !!state.editingId;
          state.confirmDiscard = false; state.editingId = null; state.draft = newDraft(); state.rest = null; state.howFor = null;
          if (wasEditing) state.tab = 'history';
          saveDraft(); break;
        case 'save':
          var s = cleanDraft(); state.howFor = null;
          if (!s.exercises.length) { toast('Fill in at least one set first'); return; }
          if (state.editingId) {
            var idx = data.sessions.findIndex(function (x) { return x.id === state.editingId; });
            if (idx >= 0) {
              s.id = state.editingId; s.createdAt = data.sessions[idx].createdAt;
              if (data.sessions[idx].duration) s.duration = data.sessions[idx].duration;
              data.sessions[idx] = s;
            }
            state.editingId = null; state.tab = 'history'; state.flash = 'Changes saved';
          } else {
            var mins = d.startedAt ? Math.round((Date.now() - d.startedAt) / 60000) : 0;
            if (mins >= 1 && mins <= 600) s.duration = mins;
            s.id = uid(); s.createdAt = Date.now(); data.sessions.push(s);
            var prCount = Object.keys(recordsBySession(data)[s.id] || {}).length;
            state.flash = 'Workout saved' + (prCount ? ' · ' + plural(prCount, 'new PR') : '');
            state.tab = 'history'; state.histDay = null;
          }
          // Update UI state before persisting: in the dashboard a save re-mounts the panel.
          state.draft = newDraft(); state.rest = null; state.confirmDiscard = false; saveDraft(); persist(); break;
        case 'edit':
          if (active()) { state.tab = 'log'; state.flash = 'Finish or discard this workout first'; break; }
          var found = data.sessions.filter(function (x) { return x.id === t.dataset.id; })[0];
          if (!found) return;
          state.editingId = found.id;
          state.draft = draftFrom(found, true);
          state.tab = 'log'; saveDraft(); break;
        // confirm() is blocked in sandboxed frames, so deletes are confirmed in the panel.
        case 'delete': state.confirmDelete = t.dataset.id; break;
        case 'delete-no': state.confirmDelete = null; break;
        case 'delete-yes':
          state.confirmDelete = null;
          data.sessions = data.sessions.filter(function (x) { return x.id !== t.dataset.id; });
          state.flash = 'Workout deleted'; persist(); break;
        case 'month':
          var cur = parseDate((state.histMonth || today().slice(0, 7)) + '-01');
          cur.setMonth(cur.getMonth() + +t.dataset.d);
          state.histMonth = ymd(cur).slice(0, 7); break;
        case 'day': state.histDay = state.histDay === t.dataset.date ? null : t.dataset.date; break;
        case 'hist-more': state.histMore = (state.histMore || 12) + 20; break;
        case 'day-clear': state.histDay = null; break;
        case 'open-ex': state.progressEx = t.dataset.k; state.metric = null; break;
        case 'close-ex': state.progressEx = null; break;
        case 'seg':
          var v = t.dataset.v;
          if (t.dataset.seg === 'days') state.muscleDays = +v;
          else if (t.dataset.seg === 'weeks') state.weekMetric = v;
          else state.metric = v;
          break;
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
        case 'export-csv': exportCSV(); return;
        case 'csv-pick': el.querySelector('input[data-a="import-csv"]').click(); return;
        case 'open-pr': state.progressEx = t.dataset.k; state.metric = null; break;
        default: return;
      }
      var hadPicker = a === 'add-ex' || a === 'replace';
      render();
      if (a === 'open-ex' || a === 'close-ex' || a === 'open-pr' || (a === 'save' && state.tab === 'history')) {
        var top = el.getBoundingClientRect().top;
        if (top < 0) global.scrollTo(0, global.scrollY + top - 80);
      }
      if (hadPicker && global.matchMedia && matchMedia('(pointer: fine)').matches) {
        var q = layer.querySelector('input[data-a="pick-q"]'); if (q) q.focus();
      }
    }

    function onInput(e) {
      var t = e.target, f = t.dataset.f;
      if (t.dataset.a === 'pick-q' && state.picker) {
        state.picker.q = t.value; state.picker.limit = PICK_PAGE;
        refreshPicker();
        return;
      }
      if (!f || state.tab !== 'log' || !active()) return;
      var d = state.draft;
      if (t.dataset.set != null) d.exercises[+t.dataset.ex].sets[+t.dataset.set][f] = t.value;
      else d[f] = t.value;
      saveDraft();
      var tt = liveTotals();
      var vEl = el.querySelector('[data-live="volume"]'), sEl = el.querySelector('[data-live="sets"]');
      if (vEl) vEl.textContent = fmtN(tt.vol) + ' ' + data.unit;
      if (sEl) sEl.textContent = tt.done + ' / ' + tt.total;
    }

    function onChange(e) {
      var t = e.target, a = t.dataset.a;
      if (a === 'rest') {
        state.draft.exercises[+t.dataset.ex].rest = +t.value; saveDraft(); render();
      } else if (a === 'rest-default') { data.rest = +t.value; persist(); render(); }
      else if (a === 'unit') { data.unit = t.value; persist(); render(); }
      else if ((a === 'import' || a === 'import-csv') && t.files && t.files[0]) {
        var reader = new FileReader();
        reader.onload = function () { importText(reader.result); };
        reader.readAsText(t.files[0]);
        t.value = '';
      }
    }

    function onKey(e) {
      if (e.key === 'Escape' && state.picker) { state.picker = null; render(); }
      else if (e.key === 'Enter' && e.target.dataset.a === 'pick-q' && state.picker) {
        var first = layer.querySelector('.wt-pick-list .wt-pick-row');
        if (first) first.click();
      }
    }

    function importText(text) {
      if (Transfer() && Transfer().looksLikeCSV(text)) return importCSV(text);
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
        state.flash = 'Imported ' + plural(added, 'workout');
        persist(); render();
      } catch (err) { toast('That is not a workouts backup'); }
    }

    // live clock + rest countdown, updated in place so typing isn't interrupted
    var timer = setInterval(function () {
      if (!el.isConnected) return;
      if (state.draft.startedAt && !state.editingId) {
        el.querySelectorAll('[data-live="duration"]').forEach(function (n) { n.textContent = clock(elapsed()); });
      }
      if (state.rest) {
        var left = (state.rest.endsAt - Date.now()) / 1000;
        if (left <= 0) {
          state.rest = null; chime();
          var bar = layer.querySelector('.wt-restbar'); if (bar) bar.remove();
          el.classList.remove('has-rest'); layer.classList.remove('has-rest');
          toast('Rest over · next set');
          return;
        }
        var r = layer.querySelector('[data-live="rest"]'), prog = layer.querySelector('.wt-rest-prog i');
        if (r) r.textContent = clock(left);
        if (prog) prog.style.width = (100 * left / state.rest.total).toFixed(1) + '%';
      }
    }, 250);

    [el, layer].forEach(function (n) {
      n.addEventListener('click', onClick);
      n.addEventListener('input', onInput);
      n.addEventListener('change', onChange);
      n.addEventListener('keydown', onKey);
    });
    render();

    return {
      // Re-read storage and redraw (e.g. after the shell restored a backup).
      refresh: function (newOpts) {
        if (newOpts && newOpts.date && newOpts.date !== defaultDate) {
          defaultDate = newOpts.date;
          if (!active()) state.draft = newDraft();
        }
        data = normalize(storage.load());
        render();
      },
      unmount: function () {
        clearInterval(timer);
        layer.remove();
        document.documentElement.classList.remove('wt-locked');
        el.removeEventListener('click', onClick);
        el.removeEventListener('input', onInput);
        el.removeEventListener('change', onChange);
        el.removeEventListener('keydown', onKey);
        el.classList.remove('wt-root', 'wt-embedded', 'has-rest');
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
