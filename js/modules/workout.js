/*
 * Workout module (placeholder).
 * Will log sessions (exercises, sets, reps, weight) under Store.moduleData('workout')
 * and put planned sessions on the schedule via itemsFor.
 */
(function () {
  'use strict';
  Dashboard.registerModule({
    id: 'workout',
    title: 'Workouts',
    category: 'workout',
    order: 20,
    wide: true,
    render: function (el) {
      Dashboard.placeholder(el, {
        status: 'Coming next',
        summary: 'Plan training days and log what you lifted or ran.',
        planned: [
          'Weekly split, e.g. push / pull / legs',
          'Log sets, reps and kg for each exercise',
          'Progress per lift and a weekly streak'
        ]
      });
    }
  });
})();
