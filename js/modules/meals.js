/*
 * Meals module: adapter for the planner/tracker in modules/meals/.
 * The panel keeps its own data in localStorage ('pd.meals.v1').
 * Planned meals for the day show on the schedule at typical meal times.
 */
(function () {
  'use strict';

  var TIMES = { breakfast: ['08:00', '08:30'], lunch: ['13:00', '13:45'], snack: ['16:30', '16:45'], dinner: ['20:00', '20:45'] };
  var NAMES = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };
  var M = window.PDModules && window.PDModules.meals;
  var mounted = null;

  if (M) window.addEventListener('pd:meals:change', function () { Dashboard.refresh(); });

  Dashboard.registerModule({
    id: 'meals',
    title: 'Meals',
    category: 'meal',
    order: 40,
    wide: true,
    render: function (el) {
      if (mounted === el) return;
      if (!M) { el.textContent = 'The meals module did not load.'; return; }
      mounted = el;
      M.mount(el, { hideTitle: true });
    },
    itemsFor: function (date) {
      if (!M || !M.summary) return [];
      var s = M.summary(date);
      var bySlot = {};
      (s.planned || []).forEach(function (p) { (bySlot[p.slot] = bySlot[p.slot] || []).push(p.label); });
      return Object.keys(bySlot).filter(function (k) { return TIMES[k]; }).map(function (k) {
        return {
          id: 'meal-' + date + '-' + k,
          title: NAMES[k] + ': ' + bySlot[k].join(', '),
          start: TIMES[k][0], end: TIMES[k][1],
          category: 'meal', source: 'meal plan'
        };
      });
    }
  });
})();
