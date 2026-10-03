/*
 * Store: the single local data store for the dashboard.
 *
 * Everything is one JSON document kept in localStorage:
 *   {
 *     schema: 1,
 *     events:  [{ id, title, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM',
 *                 category, weekly:bool, notes, sample? }],
 *     tasks:   [{ id, title, due:'YYYY-MM-DD'|null, done:bool, doneAt,
 *                 category, notes, created, sample? }],
 *     notes:   { 'YYYY-MM-DD': 'text' },
 *     modules: { <moduleId>: { ...anything the module wants to keep } }
 *   }
 *
 * Modules should keep their own data under Store.moduleData(id) so the
 * core shape stays stable.
 */
(function () {
  'use strict';

  var KEY = 'personal-dashboard.v1';
  var SCHEMA = 1;
  var data = null;
  var persistent = true;
  var listeners = [];

  function blank() {
    return { schema: SCHEMA, events: [], tasks: [], notes: {}, modules: {} };
  }

  function normalize(d) {
    var out = blank();
    if (!d || typeof d !== 'object') return out;
    out.events = Array.isArray(d.events) ? d.events : [];
    out.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    out.notes = d.notes && typeof d.notes === 'object' ? d.notes : {};
    out.modules = d.modules && typeof d.modules === 'object' ? d.modules : {};
    return out;
  }

  function load() {
    var fresh = true;
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        data = normalize(JSON.parse(raw));
        fresh = false;
      }
    } catch (e) {
      persistent = false;
    }
    if (!data) data = blank();
    return fresh;
  }

  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      persistent = false;
    }
    listeners.forEach(function (fn) { fn(data); });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  window.Store = {
    load: load,
    get: function () { return data; },
    isPersistent: function () { return persistent; },
    /* Mutate inside fn, then everything re-renders. */
    update: function (fn) { fn(data); save(); },
    onChange: function (fn) { listeners.push(fn); },
    uid: uid,
    moduleData: function (id) {
      if (!data.modules[id]) data.modules[id] = {};
      return data.modules[id];
    },
    exportJSON: function () {
      return JSON.stringify(Object.assign({ exported: new Date().toISOString() }, data), null, 2);
    },
    importJSON: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || (!Array.isArray(parsed.events) && !Array.isArray(parsed.tasks))) {
        throw new Error('That text is not a dashboard backup.');
      }
      data = normalize(parsed);
      save();
    },
    reset: function () { data = blank(); save(); }
  };

  /* Date helpers shared by the core and modules. Dates are local, not UTC. */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  window.D = {
    ymd: function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    parse: function (s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); },
    addDays: function (s, n) { var d = D.parse(s); d.setDate(d.getDate() + n); return D.ymd(d); },
    today: function () { return D.ymd(new Date()); },
    /* Monday = 0 ... Sunday = 6 (week starts on Monday, as in Portugal). */
    weekday: function (s) { return (D.parse(s).getDay() + 6) % 7; },
    mins: function (hhmm) { if (!hhmm) return null; var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; },
    hhmm: function (m) { m = Math.max(0, Math.min(24 * 60 - 1, m)); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); },
    pad: pad
  };
})();
