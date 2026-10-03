/*
 * Personal Dashboard: Meals module (meal planner + food log).
 * Plain JS, no dependencies, works from file:// as a classic <script>.
 *
 * Usage:
 *   <script src="modules/meals/meals.js"></script>
 *   PDModules.meals.mount(document.getElementById('panel'));
 *
 * The module injects its own stylesheet (meals.css next to this file) and stores
 * data in localStorage under "pd.meals.v1". It fires a "pd:meals:change" event on
 * window with today's totals whenever data changes.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'pd.meals.v1';
  var SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['snack', 'Snack'], ['dinner', 'Dinner']];
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MEAL_PREFIX = 'Meal: ';

  // Built-in foods, values per 100 g / 100 ml.
  var F = [
    // id, name, kcal, protein, carbs, fat
    ['oats', 'Oats (rolled)', 379, 13.2, 67.7, 6.5],
    ['bread-white', 'Bread, white', 265, 9, 49, 3.2],
    ['bread-whole', 'Bread, wholemeal', 247, 13, 41, 3.4],
    ['rice-cooked', 'Rice, white, cooked', 130, 2.7, 28, 0.3],
    ['rice-brown-cooked', 'Rice, brown, cooked', 123, 2.7, 25.6, 1],
    ['pasta-cooked', 'Pasta, cooked', 158, 5.8, 31, 0.9],
    ['potato-boiled', 'Potato, boiled', 87, 1.9, 20, 0.1],
    ['sweet-potato', 'Sweet potato, baked', 90, 2, 20.7, 0.2],
    ['egg', 'Egg (1 large ≈ 50 g)', 143, 12.6, 0.7, 9.5],
    ['egg-white', 'Egg white', 52, 10.9, 0.7, 0.2],
    ['chicken-breast', 'Chicken breast, cooked', 165, 31, 0, 3.6],
    ['turkey-breast', 'Turkey breast, cooked', 135, 30, 0, 1],
    ['beef-mince', 'Beef mince 5% fat, cooked', 164, 26, 0, 6.5],
    ['pork-loin', 'Pork loin, cooked', 196, 27, 0, 9],
    ['salmon', 'Salmon, cooked', 206, 22, 0, 12],
    ['tuna-can', 'Tuna, canned in water', 116, 26, 0, 1],
    ['cod', 'Cod, cooked', 105, 23, 0, 0.9],
    ['sardines', 'Sardines, canned in oil', 208, 25, 0, 11.5],
    ['tofu', 'Tofu, firm', 144, 15.8, 2.8, 8.7],
    ['chickpeas', 'Chickpeas, cooked', 164, 8.9, 27.4, 2.6],
    ['lentils', 'Lentils, cooked', 116, 9, 20, 0.4],
    ['beans-black', 'Black beans, cooked', 132, 8.9, 23.7, 0.5],
    ['milk-semi', 'Milk, semi-skimmed', 47, 3.4, 4.8, 1.6],
    ['yogurt-greek', 'Greek yogurt, plain 0%', 59, 10, 3.6, 0.4],
    ['skyr', 'Skyr, plain', 63, 11, 4, 0.2],
    ['cheese-cheddar', 'Cheese, cheddar', 403, 25, 1.3, 33],
    ['cheese-fresh', 'Fresh cheese (queijo fresco)', 174, 11, 3, 13],
    ['cottage', 'Cottage cheese', 98, 11, 3.4, 4.3],
    ['whey', 'Whey protein powder', 400, 80, 8, 6],
    ['banana', 'Banana', 89, 1.1, 22.8, 0.3],
    ['apple', 'Apple', 52, 0.3, 13.8, 0.2],
    ['orange', 'Orange', 47, 0.9, 11.8, 0.1],
    ['berries', 'Berries, mixed', 50, 0.8, 12, 0.3],
    ['broccoli', 'Broccoli', 34, 2.8, 6.6, 0.4],
    ['spinach', 'Spinach', 23, 2.9, 3.6, 0.4],
    ['tomato', 'Tomato', 18, 0.9, 3.9, 0.2],
    ['lettuce', 'Lettuce / salad leaves', 15, 1.4, 2.9, 0.2],
    ['carrot', 'Carrot', 41, 0.9, 9.6, 0.2],
    ['onion', 'Onion', 40, 1.1, 9.3, 0.1],
    ['avocado', 'Avocado', 160, 2, 8.5, 14.7],
    ['olive-oil', 'Olive oil', 884, 0, 0, 100],
    ['butter', 'Butter', 717, 0.9, 0.1, 81],
    ['peanut-butter', 'Peanut butter', 588, 25, 20, 50],
    ['almonds', 'Almonds', 579, 21, 22, 50],
    ['walnuts', 'Walnuts', 654, 15, 14, 65],
    ['honey', 'Honey', 304, 0.3, 82, 0],
    ['dark-chocolate', 'Dark chocolate 70%', 598, 7.8, 46, 43],
    ['ham', 'Ham, sliced', 145, 21, 1.5, 6],
    ['pizza', 'Pizza, cheese', 266, 11, 33, 10],
    ['soup-veg', 'Vegetable soup (sopa)', 40, 1.5, 6, 1.2],
    ['orange-juice', 'Orange juice', 45, 0.7, 10.4, 0.2],
    ['coffee-milk', 'Coffee with milk (galão)', 30, 1.7, 2.5, 1.3]
  ];
  var BUILTIN_FOODS = F.map(function (r) {
    return { id: r[0], name: r[1], kcal: r[2], protein: r[3], carbs: r[4], fat: r[5], builtin: true };
  });

  // Inject stylesheet next to this script.
  var SCRIPT_SRC = document.currentScript && document.currentScript.src;
  function ensureStyles() {
    if (!SCRIPT_SRC || document.querySelector('link[data-pdm-style]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = SCRIPT_SRC.replace(/[^/]*$/, 'meals.css');
    link.setAttribute('data-pdm-style', '');
    document.head.appendChild(link);
  }

  /* ---------- small helpers ---------- */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function today() { return ymd(new Date()); }
  function mondayOf(s) { var d = parseYmd(s); var wd = (d.getDay() + 6) % 7; return addDays(s, -wd); }
  function fmtDate(s, opts) { return parseYmd(s).toLocaleDateString(undefined, opts || { weekday: 'short', day: 'numeric', month: 'short' }); }
  function r0(n) { return Math.round(n || 0); }
  function r1(n) { return Math.round((n || 0) * 10) / 10; }
  function num(v, dflt) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : dflt; }

  // Element builder: h('div', {class: 'x', onclick: fn}, child, 'text', ...)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }

  /* ---------- data ---------- */

  function emptyState() {
    return {
      version: 1,
      goals: { kcal: 2200, protein: 140, carbs: 250, fat: 70 },
      customFoods: [],   // {id, name, kcal, protein, carbs, fat} per 100 g
      meals: [],         // saved meals: {id, name, items: [{foodId, grams}]}
      plan: {},          // 'YYYY-MM-DD' -> {slot: [{id, kind: 'food'|'meal'|'note', foodId, mealId, grams, text}]}
      log: {},           // 'YYYY-MM-DD' -> {slot: [{id, name, grams, kcal, protein, carbs, fat}]}
      shopping: {}       // week monday 'YYYY-MM-DD' -> {key: true} for ticked items
    };
  }

  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { s = null; }
    var base = emptyState();
    if (!s || typeof s !== 'object') return base;
    Object.keys(base).forEach(function (k) { if (s[k] == null) s[k] = base[k]; });
    return s;
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: keep in memory */ }
    try { window.dispatchEvent(new CustomEvent('pd:meals:change', { detail: summaryFrom(state, today()) })); } catch (e) {}
  }

  function allFoods(state) { return BUILTIN_FOODS.concat(state.customFoods); }
  function findFood(state, id) {
    var list = allFoods(state);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findMeal(state, id) {
    for (var i = 0; i < state.meals.length; i++) if (state.meals[i].id === id) return state.meals[i];
    return null;
  }
  function byName(list, name) {
    var n = name.trim().toLowerCase();
    for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === n) return list[i];
    return null;
  }

  // Resolve what the user typed in a food/meal search box.
  function resolvePick(state, text) {
    text = (text || '').trim();
    if (!text) return null;
    if (text.indexOf(MEAL_PREFIX) === 0) {
      var m = byName(state.meals, text.slice(MEAL_PREFIX.length));
      if (m) return { kind: 'meal', meal: m };
    }
    var m2 = byName(state.meals, text);
    if (m2) return { kind: 'meal', meal: m2 };
    var f = byName(allFoods(state), text);
    if (f) return { kind: 'food', food: f };
    // Fall back to a unique partial match.
    var low = text.toLowerCase();
    var hits = allFoods(state).filter(function (x) { return x.name.toLowerCase().indexOf(low) !== -1; });
    if (hits.length === 1) return { kind: 'food', food: hits[0] };
    return { kind: 'unknown', text: text };
  }

  function macrosFor(food, grams) {
    var k = grams / 100;
    return { kcal: food.kcal * k, protein: food.protein * k, carbs: food.carbs * k, fat: food.fat * k };
  }
  function addMacros(a, b) {
    return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
  }
  function zero() { return { kcal: 0, protein: 0, carbs: 0, fat: 0 }; }

  function mealMacros(state, meal) {
    return meal.items.reduce(function (acc, it) {
      var f = findFood(state, it.foodId);
      return f ? addMacros(acc, macrosFor(f, it.grams)) : acc;
    }, zero());
  }

  // Log entries are snapshots, so editing a food later never rewrites history.
  function logEntryForFood(food, grams) {
    var m = macrosFor(food, grams);
    return { id: uid(), name: food.name, grams: grams, kcal: r1(m.kcal), protein: r1(m.protein), carbs: r1(m.carbs), fat: r1(m.fat) };
  }
  function logEntriesForMeal(state, meal) {
    return meal.items.map(function (it) {
      var f = findFood(state, it.foodId);
      return f ? logEntryForFood(f, it.grams) : null;
    }).filter(Boolean);
  }

  function dayLog(state, date) { return state.log[date] || {}; }
  function dayTotals(state, date) {
    var d = dayLog(state, date), t = zero();
    SLOTS.forEach(function (s) { (d[s[0]] || []).forEach(function (e) { t = addMacros(t, e); }); });
    return t;
  }
  function planEntryMacros(state, e) {
    if (e.kind === 'food') { var f = findFood(state, e.foodId); return f ? macrosFor(f, e.grams) : zero(); }
    if (e.kind === 'meal') { var m = findMeal(state, e.mealId); return m ? mealMacros(state, m) : zero(); }
    return zero();
  }
  function planEntryLabel(state, e) {
    if (e.kind === 'food') { var f = findFood(state, e.foodId); return (f ? f.name : 'Unknown food') + ' · ' + r0(e.grams) + ' g'; }
    if (e.kind === 'meal') { var m = findMeal(state, e.mealId); return m ? m.name : 'Deleted meal'; }
    return e.text;
  }
  function dayPlanTotals(state, date) {
    var p = state.plan[date] || {}, t = zero();
    SLOTS.forEach(function (s) { (p[s[0]] || []).forEach(function (e) { t = addMacros(t, planEntryMacros(state, e)); }); });
    return t;
  }

  function summaryFrom(state, date) {
    var t = dayTotals(state, date);
    var p = state.plan[date] || {};
    var planned = [];
    SLOTS.forEach(function (s) {
      (p[s[0]] || []).forEach(function (e) { planned.push({ slot: s[0], label: planEntryLabel(state, e) }); });
    });
    return { date: date, kcal: r0(t.kcal), protein: r0(t.protein), carbs: r0(t.carbs), fat: r0(t.fat), goals: state.goals, planned: planned };
  }

  /* ---------- UI ---------- */

  function mount(root, options) {
    if (!root) throw new Error('PDModules.meals.mount: missing container element');
    options = options || {};
    ensureStyles();
    var state = load();
    var view = { tab: options.tab || 'today', date: today(), week: mondayOf(today()), draft: { name: '', items: [] }, foodFilter: '', msg: '' };

    root.classList.add('pdm');

    function commit() { save(state); render(); }
    function flash(text) { view.msg = text; render(); setTimeout(function () { if (view.msg === text) { view.msg = ''; render(); } }, 2500); }

    // Two-step confirm inside the panel (window.confirm is blocked in sandboxed frames).
    function twoStep(armedLabel, action) {
      return function (ev) {
        var btn = ev.currentTarget;
        if (btn.getAttribute('data-armed')) { action(); return; }
        var orig = btn.textContent;
        btn.setAttribute('data-armed', '1');
        btn.classList.add('armed');
        btn.textContent = armedLabel;
        setTimeout(function () {
          if (!btn.isConnected) return;
          btn.removeAttribute('data-armed'); btn.classList.remove('armed'); btn.textContent = orig;
        }, 4000);
      };
    }

    function onStorage(ev) { if (ev.key === STORAGE_KEY) { state = load(); render(); } }
    window.addEventListener('storage', onStorage);

    function datalist(id, includeMeals) {
      var opts = [];
      if (includeMeals) state.meals.forEach(function (m) { opts.push(h('option', { value: MEAL_PREFIX + m.name })); });
      allFoods(state).forEach(function (f) { opts.push(h('option', { value: f.name })); });
      return h('datalist', { id: id }, opts);
    }

    function bar(label, val, goal, unit) {
      var pct = goal > 0 ? Math.min(100, (val / goal) * 100) : 0;
      var over = goal > 0 && val > goal * 1.05;
      return h('div', { class: 'pdm-bar' + (over ? ' over' : '') },
        h('div', { class: 'pdm-bar-head' }, h('span', null, label), h('span', { class: 'pdm-num' }, r0(val) + ' / ' + r0(goal) + ' ' + unit)),
        h('div', { class: 'pdm-track' }, h('div', { class: 'pdm-fill', style: 'width:' + pct + '%' })));
    }

    function macroLine(m) {
      return h('span', { class: 'pdm-macros' }, r0(m.kcal) + ' kcal · P ' + r0(m.protein) + ' · C ' + r0(m.carbs) + ' · F ' + r0(m.fat));
    }

    /* --- Today --- */
    function renderToday() {
      var date = view.date;
      var log = dayLog(state, date);
      var plan = state.plan[date] || {};
      var t = dayTotals(state, date);
      var g = state.goals;
      var hasPlan = SLOTS.some(function (s) { return (plan[s[0]] || []).length; });

      function logPlanned(slot) {
        var entries = [];
        (plan[slot] || []).forEach(function (e) {
          if (e.kind === 'food') { var f = findFood(state, e.foodId); if (f) entries.push(logEntryForFood(f, e.grams)); }
          else if (e.kind === 'meal') { var m = findMeal(state, e.mealId); if (m) entries = entries.concat(logEntriesForMeal(state, m)); }
        });
        if (!entries.length) return 0;
        state.log[date] = state.log[date] || {};
        state.log[date][slot] = (state.log[date][slot] || []).concat(entries);
        return entries.length;
      }

      var head = h('div', { class: 'pdm-row pdm-datenav' },
        h('button', { class: 'pdm-btn ghost', 'aria-label': 'Previous day', onclick: function () { view.date = addDays(view.date, -1); render(); } }, '‹'),
        h('strong', { class: 'pdm-date' }, fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('button', { class: 'pdm-btn ghost', 'aria-label': 'Next day', onclick: function () { view.date = addDays(view.date, 1); render(); } }, '›'),
        date !== today() ? h('button', { class: 'pdm-btn ghost', onclick: function () { view.date = today(); render(); } }, 'Today') : null,
        hasPlan ? h('button', { class: 'pdm-btn', onclick: function () {
          var n = 0; SLOTS.forEach(function (s) { n += logPlanned(s[0]); });
          save(state); flash(n ? 'Logged ' + n + ' planned item' + (n > 1 ? 's' : '') : 'Nothing planned to log');
        } }, 'Log whole plan') : null);

      var totals = h('div', { class: 'pdm-card pdm-totals' },
        bar('Calories', t.kcal, g.kcal, 'kcal'),
        h('div', { class: 'pdm-grid3' }, bar('Protein', t.protein, g.protein, 'g'), bar('Carbs', t.carbs, g.carbs, 'g'), bar('Fat', t.fat, g.fat, 'g')),
        h('div', { class: 'pdm-muted' }, g.kcal - t.kcal >= 0 ? r0(g.kcal - t.kcal) + ' kcal left today' : r0(t.kcal - g.kcal) + ' kcal over goal'));

      var slots = SLOTS.map(function (s) {
        var key = s[0];
        var items = log[key] || [];
        var st = items.reduce(addMacros, zero());
        var planned = plan[key] || [];
        var listId = 'pdm-dl-' + key;
        var pick = h('input', { class: 'pdm-input grow', list: listId, placeholder: 'Food or saved meal', 'aria-label': 'Food or saved meal' });
        var grams = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', step: '1', value: '100', 'aria-label': 'Grams' });

        function add() {
          var r = resolvePick(state, pick.value);
          if (!r) return;
          var entries;
          if (r.kind === 'meal') entries = logEntriesForMeal(state, r.meal);
          else if (r.kind === 'food') entries = [logEntryForFood(r.food, num(grams.value, 100))];
          else { flash('No food called "' + r.text + '". Add it under Foods, or use Quick add.'); return; }
          state.log[date] = state.log[date] || {};
          state.log[date][key] = items.concat(entries);
          commit();
        }
        pick.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
        grams.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

        return h('section', { class: 'pdm-card pdm-slot' },
          h('div', { class: 'pdm-row spread' }, h('h3', null, s[1]), h('span', { class: 'pdm-muted pdm-num' }, r0(st.kcal) + ' kcal')),
          planned.length ? h('div', { class: 'pdm-planned' },
            h('span', { class: 'pdm-muted' }, 'Planned: ' + planned.map(function (e) { return planEntryLabel(state, e); }).join(', ')),
            h('button', { class: 'pdm-btn small', onclick: function () { var n = logPlanned(key); save(state); flash(n ? 'Logged ' + s[1].toLowerCase() : 'Planned notes have no nutrition to log'); } }, 'Log it')) : null,
          items.length ? h('ul', { class: 'pdm-list' }, items.map(function (e) {
            return h('li', null,
              h('div', { class: 'grow' }, h('div', null, e.name, e.grams ? h('span', { class: 'pdm-muted' }, ' · ' + r0(e.grams) + ' g') : null), macroLine(e)),
              h('button', { class: 'pdm-x', 'aria-label': 'Remove ' + e.name, onclick: function () {
                state.log[date][key] = items.filter(function (x) { return x.id !== e.id; }); commit();
              } }, '×'));
          })) : null,
          h('div', { class: 'pdm-row' }, pick, grams, h('span', { class: 'pdm-muted' }, 'g'), h('button', { class: 'pdm-btn', onclick: add }, 'Add'), datalist(listId, true)));
      });

      // Quick add for things not in the food list (restaurant meal, snack bar...).
      var qName = h('input', { class: 'pdm-input grow', placeholder: 'What did you eat?' });
      var qSlot = h('select', { class: 'pdm-input' }, SLOTS.map(function (s) { return h('option', { value: s[0] }, s[1]); }));
      var qK = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'kcal' });
      var qP = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'P g' });
      var qC = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'C g' });
      var qF = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'F g' });
      var quick = h('details', { class: 'pdm-card' },
        h('summary', null, 'Quick add (no food lookup)'),
        h('div', { class: 'pdm-row wrap' }, qName, qSlot, qK, qP, qC, qF,
          h('button', { class: 'pdm-btn', onclick: function () {
            if (!qName.value.trim() || !(num(qK.value, 0) > 0)) { flash('Give it a name and calories'); return; }
            var slot = qSlot.value;
            state.log[date] = state.log[date] || {};
            state.log[date][slot] = (state.log[date][slot] || []).concat([{ id: uid(), name: qName.value.trim(), grams: 0,
              kcal: num(qK.value, 0), protein: num(qP.value, 0), carbs: num(qC.value, 0), fat: num(qF.value, 0) }]);
            commit();
          } }, 'Add')));

      return [head, totals, h('div', { class: 'pdm-slots' }, slots), quick];
    }

    /* --- Week plan --- */
    function renderPlan() {
      var wk = view.week;
      var days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays(wk, i); });

      var daySel = h('select', { class: 'pdm-input', 'aria-label': 'Day' }, days.map(function (d, i) {
        return h('option', { value: d, selected: d === view.planDay ? true : null }, DAY_NAMES[i] + ' ' + parseYmd(d).getDate());
      }));
      var slotSel = h('select', { class: 'pdm-input', 'aria-label': 'Meal' }, SLOTS.map(function (s) {
        return h('option', { value: s[0], selected: s[0] === view.planSlot ? true : null }, s[1]);
      }));
      var pick = h('input', { class: 'pdm-input grow', list: 'pdm-dl-plan', placeholder: 'Food, saved meal, or any note (e.g. "eat out")' });
      var grams = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', value: '100', 'aria-label': 'Grams' });

      function add() {
        var text = pick.value.trim();
        if (!text) return;
        var r = resolvePick(state, text), e = { id: uid() };
        if (r.kind === 'meal') { e.kind = 'meal'; e.mealId = r.meal.id; }
        else if (r.kind === 'food') { e.kind = 'food'; e.foodId = r.food.id; e.grams = num(grams.value, 100); }
        else { e.kind = 'note'; e.text = text; }
        view.planDay = daySel.value; view.planSlot = slotSel.value;
        var p = state.plan[daySel.value] = state.plan[daySel.value] || {};
        p[slotSel.value] = (p[slotSel.value] || []).concat([e]);
        commit();
      }
      pick.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') add(); });

      var nav = h('div', { class: 'pdm-row pdm-datenav' },
        h('button', { class: 'pdm-btn ghost', 'aria-label': 'Previous week', onclick: function () { view.week = addDays(view.week, -7); render(); } }, '‹'),
        h('strong', { class: 'pdm-date' }, 'Week of ' + fmtDate(wk, { day: 'numeric', month: 'long' })),
        h('button', { class: 'pdm-btn ghost', 'aria-label': 'Next week', onclick: function () { view.week = addDays(view.week, 7); render(); } }, '›'),
        wk !== mondayOf(today()) ? h('button', { class: 'pdm-btn ghost', onclick: function () { view.week = mondayOf(today()); render(); } }, 'This week') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'pdm-btn ghost', onclick: function () {
          var n = 0;
          days.forEach(function (d) {
            var src = state.plan[addDays(d, -7)];
            if (!src) return;
            var copy = {};
            Object.keys(src).forEach(function (k) { copy[k] = src[k].map(function (e) { n++; return Object.assign({}, e, { id: uid() }); }); });
            state.plan[d] = copy;
          });
          if (!n) { flash('Last week has no plan to copy'); return; }
          save(state); flash('Copied last week\'s plan');
        } }, 'Copy last week'),
        h('button', { class: 'pdm-btn ghost', onclick: twoStep('Tap again to clear', function () {
          days.forEach(function (d) { delete state.plan[d]; }); commit();
        }) }, 'Clear week'));

      var form = h('div', { class: 'pdm-card' }, h('div', { class: 'pdm-row wrap' }, daySel, slotSel, pick, grams, h('span', { class: 'pdm-muted' }, 'g'),
        h('button', { class: 'pdm-btn', onclick: add }, 'Add to plan'), datalist('pdm-dl-plan', true)));

      var grid = h('div', { class: 'pdm-week' }, days.map(function (d, i) {
        var p = state.plan[d] || {};
        var tot = dayPlanTotals(state, d);
        return h('section', { class: 'pdm-card pdm-day' + (d === today() ? ' is-today' : '') },
          h('div', { class: 'pdm-row spread' }, h('h3', null, DAY_NAMES[i] + ' ' + parseYmd(d).getDate()), h('span', { class: 'pdm-muted pdm-num' }, r0(tot.kcal) + ' kcal')),
          SLOTS.map(function (s) {
            var list = p[s[0]] || [];
            if (!list.length) return null;
            return h('div', { class: 'pdm-dayslot' }, h('div', { class: 'pdm-label' }, s[1]),
              h('ul', { class: 'pdm-list tight' }, list.map(function (e) {
                return h('li', { class: e.kind === 'note' ? 'is-note' : null }, h('span', { class: 'grow' }, planEntryLabel(state, e)),
                  h('button', { class: 'pdm-x', 'aria-label': 'Remove', onclick: function () {
                    p[s[0]] = list.filter(function (x) { return x.id !== e.id; }); commit();
                  } }, '×'));
              })));
          }),
          !Object.keys(p).some(function (k) { return p[k].length; }) ? h('div', { class: 'pdm-muted' }, 'Nothing planned') : null);
      }));

      return [nav, form, grid, renderShopping(days)];
    }

    function renderShopping(days) {
      var wk = days[0];
      var agg = {}, notes = [];
      function addFood(id, g) { agg[id] = (agg[id] || 0) + g; }
      days.forEach(function (d) {
        var p = state.plan[d] || {};
        Object.keys(p).forEach(function (k) {
          p[k].forEach(function (e) {
            if (e.kind === 'food') addFood(e.foodId, e.grams);
            else if (e.kind === 'meal') { var m = findMeal(state, e.mealId); if (m) m.items.forEach(function (it) { addFood(it.foodId, it.grams); }); }
          });
        });
      });
      var ticks = state.shopping[wk] || {};
      var rows = Object.keys(agg).map(function (id) { var f = findFood(state, id); return { id: id, name: f ? f.name : id, grams: agg[id] }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      return h('details', { class: 'pdm-card', open: rows.length ? true : null },
        h('summary', null, 'Shopping list for this week (' + rows.length + ')'),
        rows.length ? h('ul', { class: 'pdm-list tight pdm-shop' }, rows.map(function (r) {
          return h('li', null, h('label', { class: 'grow' + (ticks[r.id] ? ' done' : '') },
            h('input', { type: 'checkbox', checked: !!ticks[r.id], onchange: function (ev) {
              state.shopping[wk] = state.shopping[wk] || {};
              state.shopping[wk][r.id] = ev.target.checked; commit();
            } }), ' ' + r.name), h('span', { class: 'pdm-muted pdm-num' }, r.grams >= 1000 ? r1(r.grams / 1000) + ' kg' : r0(r.grams) + ' g'));
        })) : h('div', { class: 'pdm-muted' }, 'Plan foods or saved meals and their ingredients show up here.'));
    }

    /* --- Foods & saved meals --- */
    function renderFoods() {
      var out = [];

      // Saved meal builder
      var d = view.draft;
      var dName = h('input', { class: 'pdm-input grow', placeholder: 'Meal name, e.g. Overnight oats', value: d.name, oninput: function (e) { d.name = e.target.value; } });
      var dPick = h('input', { class: 'pdm-input grow', list: 'pdm-dl-foods', placeholder: 'Ingredient' });
      var dGrams = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', value: '100', 'aria-label': 'Grams' });
      function addIng() {
        var r = resolvePick(state, dPick.value);
        if (!r || r.kind !== 'food') { if (r) flash('Pick a food from the list'); return; }
        d.items.push({ foodId: r.food.id, grams: num(dGrams.value, 100) }); render();
      }
      dPick.addEventListener('keydown', function (e) { if (e.key === 'Enter') addIng(); });
      var dm = d.items.reduce(function (a, it) { var f = findFood(state, it.foodId); return f ? addMacros(a, macrosFor(f, it.grams)) : a; }, zero());

      out.push(h('section', { class: 'pdm-card' },
        h('h3', null, d.id ? 'Edit saved meal' : 'New saved meal'),
        h('div', { class: 'pdm-row' }, dName),
        d.items.length ? h('ul', { class: 'pdm-list tight' }, d.items.map(function (it, i) {
          var f = findFood(state, it.foodId);
          return h('li', null, h('span', { class: 'grow' }, (f ? f.name : it.foodId) + ' · ' + r0(it.grams) + ' g'),
            h('button', { class: 'pdm-x', 'aria-label': 'Remove ingredient', onclick: function () { d.items.splice(i, 1); render(); } }, '×'));
        })) : null,
        h('div', { class: 'pdm-row' }, dPick, dGrams, h('span', { class: 'pdm-muted' }, 'g'), h('button', { class: 'pdm-btn ghost', onclick: addIng }, 'Add ingredient'), datalist('pdm-dl-foods', false)),
        h('div', { class: 'pdm-row spread' }, d.items.length ? macroLine(dm) : h('span'),
          h('span', null,
            d.id ? h('button', { class: 'pdm-btn ghost', onclick: function () { view.draft = { name: '', items: [] }; render(); } }, 'Cancel') : null,
            h('button', { class: 'pdm-btn', onclick: function () {
              if (!d.name.trim() || !d.items.length) { flash('Name the meal and add at least one ingredient'); return; }
              var meal = { id: d.id || uid(), name: d.name.trim(), items: d.items.slice() };
              var idx = state.meals.findIndex(function (m) { return m.id === meal.id; });
              if (idx >= 0) state.meals[idx] = meal; else state.meals.push(meal);
              view.draft = { name: '', items: [] }; commit();
            } }, 'Save meal')))));

      out.push(h('section', { class: 'pdm-card' }, h('h3', null, 'Saved meals'),
        state.meals.length ? h('ul', { class: 'pdm-list' }, state.meals.map(function (m) {
          return h('li', null, h('div', { class: 'grow' }, h('div', null, m.name), macroLine(mealMacros(state, m))),
            h('button', { class: 'pdm-btn small ghost', onclick: function () { view.draft = { id: m.id, name: m.name, items: m.items.slice() }; render(); } }, 'Edit'),
            h('button', { class: 'pdm-x', 'aria-label': 'Delete ' + m.name, title: 'Past log entries stay', onclick: twoStep('Delete?', function () {
              state.meals = state.meals.filter(function (x) { return x.id !== m.id; }); commit();
            }) }, '×'));
        })) : h('div', { class: 'pdm-muted' }, 'Save meals you eat often to log or plan them in one go.')));

      // Custom food
      var fN = h('input', { class: 'pdm-input grow', placeholder: 'Food name' });
      var fK = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'kcal' });
      var fP = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'P g' });
      var fC = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'C g' });
      var fF = h('input', { class: 'pdm-input w-num', type: 'number', min: '0', placeholder: 'F g' });
      out.push(h('section', { class: 'pdm-card' }, h('h3', null, 'Add a food'),
        h('div', { class: 'pdm-muted' }, 'Values per 100 g, from the label.'),
        h('div', { class: 'pdm-row wrap' }, fN, fK, fP, fC, fF, h('button', { class: 'pdm-btn', onclick: function () {
          var name = fN.value.trim();
          if (!name || !(num(fK.value, -1) >= 0)) { flash('Give the food a name and calories'); return; }
          if (byName(allFoods(state), name)) { flash('A food with that name already exists'); return; }
          state.customFoods.push({ id: 'c-' + uid(), name: name, kcal: num(fK.value, 0), protein: num(fP.value, 0), carbs: num(fC.value, 0), fat: num(fF.value, 0) });
          commit();
        } }, 'Add food'))));

      // Food list with filter
      var filter = h('input', { class: 'pdm-input grow', type: 'search', placeholder: 'Search foods', value: view.foodFilter });
      var listBox = h('div');
      function drawList() {
        var q = view.foodFilter.trim().toLowerCase();
        var rows = allFoods(state).filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) !== -1; });
        listBox.textContent = '';
        listBox.appendChild(h('table', { class: 'pdm-table' },
          h('thead', null, h('tr', null, h('th', null, 'Food (per 100 g)'), h('th', null, 'kcal'), h('th', null, 'P'), h('th', null, 'C'), h('th', null, 'F'), h('th'))),
          h('tbody', null, rows.map(function (f) {
            return h('tr', null, h('td', null, f.name), h('td', { class: 'pdm-num' }, r0(f.kcal)), h('td', { class: 'pdm-num' }, r1(f.protein)),
              h('td', { class: 'pdm-num' }, r1(f.carbs)), h('td', { class: 'pdm-num' }, r1(f.fat)),
              h('td', null, f.builtin ? null : h('button', { class: 'pdm-x', 'aria-label': 'Delete ' + f.name, title: 'Saved meals using it lose that ingredient', onclick: twoStep('Delete?', function () {
                state.customFoods = state.customFoods.filter(function (x) { return x.id !== f.id; }); commit();
              }) }, '×')));
          }))));
      }
      filter.addEventListener('input', function () { view.foodFilter = filter.value; drawList(); });
      drawList();
      out.push(h('section', { class: 'pdm-card' }, h('h3', null, 'Food list'), h('div', { class: 'pdm-row' }, filter), h('div', { class: 'pdm-scroll' }, listBox)));
      return out;
    }

    /* --- Goals & data --- */
    function renderGoals() {
      var g = state.goals;
      function field(key, label, unit) {
        return h('label', { class: 'pdm-field' }, h('span', null, label),
          h('span', { class: 'pdm-row' }, h('input', { class: 'pdm-input w-num', type: 'number', min: '0', value: g[key], onchange: function (e) {
            g[key] = Math.max(0, num(e.target.value, g[key])); save(state);
          } }), h('span', { class: 'pdm-muted' }, unit)));
      }

      // Last 7 days of totals
      var days = [6, 5, 4, 3, 2, 1, 0].map(function (i) { return addDays(today(), -i); });
      var maxK = Math.max(g.kcal, Math.max.apply(null, days.map(function (d) { return dayTotals(state, d).kcal; }))) || 1;
      var chart = h('div', { class: 'pdm-chart', role: 'img', 'aria-label': 'Calories over the last 7 days' },
        h('div', { class: 'pdm-goal-line', style: 'bottom:calc(20px + (100% - 20px) * ' + (g.kcal / maxK).toFixed(3) + ')' }),
        days.map(function (d) {
          var k = dayTotals(state, d).kcal;
          return h('div', { class: 'pdm-col', title: fmtDate(d) + ': ' + r0(k) + ' kcal' },
            h('div', { class: 'pdm-colbar' + (k > g.kcal * 1.05 ? ' over' : ''), style: 'height:' + (k / maxK * 100) + '%' }),
            h('div', { class: 'pdm-collabel' }, DAY_NAMES[(parseYmd(d).getDay() + 6) % 7]));
        }));
      var logged = days.filter(function (d) { return dayTotals(state, d).kcal > 0; });
      var avg = logged.length ? logged.reduce(function (a, d) { return a + dayTotals(state, d).kcal; }, 0) / logged.length : 0;

      function importText(text) {
        try {
          var s = JSON.parse(text);
          if (!s || s.version !== 1 || !s.log) throw new Error('bad');
          state = s; Object.keys(emptyState()).forEach(function (k) { if (state[k] == null) state[k] = emptyState()[k]; });
          save(state); flash('Backup restored');
        } catch (err) { flash('That is not a meals backup'); }
      }
      var fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'pdm-hidden', onchange: function (e) {
        var file = e.target.files[0]; if (!file) return;
        var rd = new FileReader();
        rd.onload = function () { importText(rd.result); };
        rd.readAsText(file);
      } });
      // Backups also go through a text box, since downloads can be blocked where the dashboard is hosted.
      var backupBox = h('textarea', { class: 'pdm-input pdm-backup', rows: '4', spellcheck: 'false', placeholder: 'Exported backup text appears here. To restore, paste a backup here and press Restore.', 'aria-label': 'Backup text' });

      return [
        h('section', { class: 'pdm-card' }, h('h3', null, 'Last 7 days'), chart,
          h('div', { class: 'pdm-muted' }, logged.length ? 'Average ' + r0(avg) + ' kcal on ' + logged.length + ' logged day' + (logged.length > 1 ? 's' : '') + ' · goal ' + r0(g.kcal) : 'No days logged yet')),
        h('section', { class: 'pdm-card' }, h('h3', null, 'Daily goals'),
          h('div', { class: 'pdm-goals' }, field('kcal', 'Calories', 'kcal'), field('protein', 'Protein', 'g'), field('carbs', 'Carbs', 'g'), field('fat', 'Fat', 'g'))),
        h('section', { class: 'pdm-card' }, h('h3', null, 'Your data'),
          h('div', { class: 'pdm-muted' }, 'Stored in this browser only. Export a backup to move it to another device.'),
          h('div', { class: 'pdm-row wrap' },
            h('button', { class: 'pdm-btn ghost', onclick: function () {
              var json = JSON.stringify(state);
              backupBox.value = json; backupBox.focus(); backupBox.select();
              var copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(json) : Promise.reject();
              copied.then(function () { view.msg = 'Backup copied. Paste it somewhere safe, like a note.'; },
                function () { view.msg = 'Backup is in the box below. Select it all and copy it.'; })
                .then(function () { var m = root.querySelector('.pdm-msg'); if (m) m.textContent = view.msg; else root.insertBefore(h('div', { class: 'pdm-msg', role: 'status' }, view.msg), root.querySelector('.pdm-body')); });
            } }, 'Copy backup'),
            h('button', { class: 'pdm-btn ghost', onclick: function () {
              try {
                var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
                var a = h('a', { href: URL.createObjectURL(blob), download: 'meals-backup-' + today() + '.json' });
                document.body.appendChild(a); a.click(); a.remove();
              } catch (e) { flash('Download is blocked here. Use Copy backup instead.'); }
            } }, 'Download file'),
            h('button', { class: 'pdm-btn ghost', onclick: function () { fileIn.click(); } }, 'Import file'), fileIn,
            h('button', { class: 'pdm-btn ghost danger', onclick: twoStep('Tap again to delete everything', function () {
              state = emptyState(); commit();
            }) }, 'Reset all')),
          backupBox,
          h('div', { class: 'pdm-row' }, h('button', { class: 'pdm-btn ghost', onclick: function () {
            if (!backupBox.value.trim()) { flash('Paste a backup into the box first'); return; }
            importText(backupBox.value.trim());
          } }, 'Restore from text')))];
    }

    function render() {
      var tabs = [['today', 'Today'], ['plan', 'Week plan'], ['foods', 'Foods & meals'], ['goals', 'Goals & history']];
      var body = view.tab === 'plan' ? renderPlan() : view.tab === 'foods' ? renderFoods() : view.tab === 'goals' ? renderGoals() : renderToday();
      root.textContent = '';
      append(root, [
        options.hideTitle ? null : h('h2', { class: 'pdm-title' }, 'Meals'),
        h('nav', { class: 'pdm-tabs', role: 'tablist' }, tabs.map(function (t) {
          return h('button', { role: 'tab', 'aria-selected': view.tab === t[0] ? 'true' : 'false', class: 'pdm-tab', onclick: function () { view.tab = t[0]; render(); } }, t[1]);
        })),
        view.msg ? h('div', { class: 'pdm-msg', role: 'status' }, view.msg) : null,
        h('div', { class: 'pdm-body' }, body)
      ]);
    }

    render();

    return {
      unmount: function () { window.removeEventListener('storage', onStorage); root.textContent = ''; root.classList.remove('pdm'); },
      refresh: function () { state = load(); render(); },
      summary: function (date) { return summaryFrom(state, date || today()); }
    };
  }

  window.PDModules = window.PDModules || {};
  window.PDModules.meals = {
    id: 'meals',
    title: 'Meals',
    storageKey: STORAGE_KEY,
    mount: mount,
    // Today's totals and plan without mounting the UI (for a dashboard overview card).
    summary: function (date) { return summaryFrom(load(), date || today()); }
  };
})();
