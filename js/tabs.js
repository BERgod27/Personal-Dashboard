/*
 * Tabs: switches between the Today view and one screen per module.
 * The view lives in the URL hash (#today, #uni, #workouts, #meals, #news), so
 * back/forward and bookmarks work. Keys 1-5 jump to a tab.
 * Purely presentational: app.js still renders everything; CSS shows the active view
 * from .app[data-view].
 */
(function () {
  'use strict';

  var VIEWS = {
    today: { title: 'Today' },
    uni: { title: 'Uni', sub: 'Your timetable and what is due next.' },
    workouts: { title: 'Workouts', sub: 'Log your sessions and watch your lifts go up.' },
    meals: { title: 'Meals', sub: 'Plan the week and keep track of what you eat.' },
    news: { title: 'News', sub: 'Headlines from Portugal and the world.' }
  };
  var ORDER = ['today', 'uni', 'workouts', 'meals', 'news'];
  var BASE_TITLE = document.title;

  var app = document.getElementById('app');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('#tabs .tab'));
  var wrap = document.getElementById('timeline-wrap');
  var current = null;
  var scheduleScroll = 0;

  function fromHash() {
    var v = location.hash.replace('#', '');
    return VIEWS[v] ? v : 'today';
  }

  function show(view) {
    if (view === current) return;
    if (current === 'today' && wrap) scheduleScroll = wrap.scrollTop;
    current = view;
    app.dataset.view = view;
    tabs.forEach(function (t) {
      if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    var v = VIEWS[view];
    if (view !== 'today') {
      document.getElementById('view-title').textContent = v.title;
      document.getElementById('view-sub').textContent = v.sub;
    }
    document.title = view === 'today' ? BASE_TITLE : v.title + ' · ' + BASE_TITLE;
    window.scrollTo(0, 0);
    if (view === 'today' && wrap && scheduleScroll) wrap.scrollTop = scheduleScroll;
  }

  function go(view) {
    if (location.hash !== '#' + view) location.hash = view;
    else show(view);
  }

  window.addEventListener('hashchange', function () { show(fromHash()); });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, dialog, [contenteditable]')) return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= ORDER.length) { go(ORDER[n - 1]); return; }
    // Quick-add and day keys belong to Today: jump there first.
    if (current !== 'today' && (e.key === '/' || e.key === 'n' || e.key === 't')) {
      go('today');
      if (e.key !== 't') setTimeout(function () { document.getElementById('quickadd-input').focus(); }, 0);
    }
  });

  show(fromHash());
})();
