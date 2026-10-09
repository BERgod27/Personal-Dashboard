/*
 * Hooks the workout tracker into the dashboard shell (js/core.js + js/store.js).
 *
 * In index.html, after core.js, load:
 *   <link rel="stylesheet" href="modules/workouts/workouts.css">
 *   <link rel="stylesheet" href="modules/workouts/insights.css">
 *   <script src="modules/workouts/exercises.js"></script>   (optional: the full exercise library)
 *   <script src="modules/workouts/workouts.js"></script>
 *   <script src="modules/workouts/insights.js"></script>
 *   <script src="modules/workouts/transfer.js"></script>
 *   <script src="modules/workouts/register.js"></script>
 *
 * Data lives in the shell's Store under Store.moduleData('workout'), so it is
 * part of the dashboard's Data & backup export. Workouts logged earlier in the
 * standalone page (localStorage 'pd.workouts.v1') are copied over once.
 */
(function () {
  'use strict';
  if (!window.Dashboard || !window.Store || !window.DashboardModules || !DashboardModules.workouts) return;

  var ID = 'workout';
  var W = DashboardModules.workouts;
  var uiState = {}; // open tab + unsaved draft, kept across re-renders

  function snapshot() { return JSON.parse(JSON.stringify(Store.moduleData(ID))); }

  var migrated = false;
  function migrateOnce() {
    if (migrated) return;
    migrated = true;
    var d = Store.moduleData(ID);
    if (Array.isArray(d.sessions) && d.sessions.length) return;
    var legacy = W.localStorage.load();
    if (legacy.sessions.length) Store.update(function (all) { all.modules[ID] = legacy; });
  }

  var storage = {
    load: function () { return W.normalize(snapshot()); },
    save: function (data) {
      var copy = JSON.parse(JSON.stringify(data));
      Store.update(function (all) { all.modules[ID] = copy; });
      return Store.isPersistent();
    }
  };

  var def = {
    id: ID,
    title: 'Workouts',
    category: 'workout',
    order: 20,
    render: function (el, ctx) {
      var date = ctx && ctx.date;
      migrateOnce();
      var inst = el.__workouts;
      if (inst && el.querySelector('.wt-tabs')) {
        // Skip redraws that change nothing, so typing in the form isn't interrupted
        // when another part of the dashboard saves.
        var stored = JSON.stringify(W.normalize(snapshot()));
        if (stored === inst.lastStored && date === inst.lastDate) return;
        inst.lastStored = stored; inst.lastDate = date;
        inst.api.refresh({ date: date });
        return;
      }
      if (inst) inst.api.unmount(); // shell wiped the panel; drop old listeners
      el.__workouts = {
        api: W.mount(el, { storage: storage, state: uiState, date: date, embedded: true }),
        lastStored: JSON.stringify(W.normalize(snapshot())),
        lastDate: date
      };
    },
    // Logged workouts show as all-day items on that day's schedule.
    itemsFor: function (date) {
      var d = Store.moduleData(ID);
      return (d.sessions || []).filter(function (s) { return s.date === date; }).map(function (s) {
        return {
          id: 'workout-' + s.id,
          title: (s.title || 'Workout') + ' · ' + s.exercises.length + ' exercise' + (s.exercises.length === 1 ? '' : 's'),
          date: date, start: null, end: null, category: 'workout', source: ID
        };
      });
    }
  };

  Dashboard.registerModule(def);
})();
