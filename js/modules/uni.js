/*
 * Uni module: adapter for the panel in modules/uni/ (Moodle + SIGARRA).
 *
 * Data comes from modules/uni/sync_uni.py, which runs on your own computer and
 * writes modules/uni/data/uni.js (window.UNI_DATA) and uni.json.
 * Classes and exams go on the schedule and Moodle deadlines go in Tasks.
 * With no synced data, the panel says how to sync and can show example data.
 */
(function () {
  'use strict';

  var data = window.UNI_DATA || null;
  var isSample = false;
  var mounted = null; // the element the panel is mounted in

  function hhmm(iso) { return iso ? iso.slice(11, 16) : null; }
  function day(iso) { return iso ? iso.slice(0, 10) : null; }

  function mountPanel(el) {
    mounted = el;
    var url = new URL('modules/uni/panel.js', document.baseURI).href;
    import(url).then(function (mod) {
      return mod.mountUniPanel(el, { data: data, deadlineDays: 14 });
    }).catch(function () {
      el.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'This panel needs the dashboard opened through a local server (python3 -m http.server). Your classes and deadlines still show in the schedule and tasks.';
      el.appendChild(p);
    });
  }

  function renderSetup(el) {
    el.innerHTML = '';
    if (window.PDOnline) return renderOnlineSetup(el);
    Dashboard.placeholder(el, {
        title: 'Uni',
      status: 'Not synced yet',
      summary: 'Classes from SIGARRA and deadlines from Moodle. The sync runs on your computer because the university sites only answer from there.',
      planned: [
        'cd personal-dashboard/modules/uni',
        'python3 sync_uni.py setup   (once)',
        'python3 sync_uni.py         (each sync)'
      ]
    });
    el.querySelector('.planned').classList.add('code');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = 'Show example data';
    b.addEventListener('click', function () {
      fetch(new URL('modules/uni/sample/uni.sample.json', document.baseURI).href)
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (d) {
          data = d; isSample = true;
          el.innerHTML = '';
          mountPanel(el);
          Dashboard.refresh();
        })
        .catch(function () { b.textContent = 'Example data could not be loaded here'; b.disabled = true; });
    });
    el.appendChild(b);
  }

  /* Hosted version (server/server.mjs): the server syncs, so setup is a form, not commands. */
  function renderOnlineSetup(el) {
    Dashboard.placeholder(el, {
      title: 'Uni',
      status: 'Not connected yet',
      summary: 'Classes from SIGARRA and deadlines from Moodle, synced by the server so they show on all your devices.',
      planned: ['Moodle: paste your calendar export link', 'SIGARRA: your username and password', 'Or type your timetable by hand']
    });
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small primary';
    b.textContent = 'Connect Moodle and SIGARRA';
    b.addEventListener('click', function () { window.PDOnline.openUni(); });
    el.appendChild(b);
  }

  function useData(d) {
    data = d; isSample = false;
    if (mounted !== null || document.getElementById('module-uni')) {
      var body = document.querySelector('#module-uni .module-body');
      if (body) { body.innerHTML = ''; mounted = null; }
    }
    Dashboard.refresh();
  }

  /* Online mode: new data after a server-side sync. */
  window.addEventListener('pd:uni:data', function (e) { if (e.detail) useData(e.detail); });

  /* Pick up synced data (modules/uni/data/uni.js) if the sync has run. */
  if (!data) {
    var tag = document.createElement('script');
    tag.src = 'modules/uni/data/uni.js';
    tag.onload = function () {
      if (!window.UNI_DATA || window.UNI_DATA === data) return;
      useData(window.UNI_DATA);
    };
    document.head.appendChild(tag);
  }

  Dashboard.registerModule({
    id: 'uni',
    title: 'Uni',
    category: 'uni',
    order: 10,
    ownTitle: true,
    render: function (el) {
      if (mounted === el) return;
      if (data) mountPanel(el);
      else if (!el.childNodes.length) renderSetup(el);
    },
    itemsFor: function (date) {
      if (!data) return [];
      var classes = (data.classes || []).filter(function (c) { return day(c.start) === date; }).map(function (c) {
        return {
          id: c.id,
          title: [c.course, c.type].filter(Boolean).join(' ') + (c.room ? ' · ' + c.room : ''),
          start: hhmm(c.start), end: hhmm(c.end),
          category: 'uni', source: 'SIGARRA', sample: isSample
        };
      });
      var exams = (data.exams || []).filter(function (x) { return day(x.start) === date; }).map(function (x) {
        return {
          id: x.id,
          title: 'Exam: ' + (x.course || x.course_name) + (x.rooms && x.rooms.length ? ' · ' + x.rooms.join(', ') : ''),
          start: x.all_day ? null : hhmm(x.start), end: x.all_day ? null : hhmm(x.end),
          category: 'uni', source: 'SIGARRA', sample: isSample
        };
      });
      return classes.concat(exams);
    },
    tasksFor: function (date) {
      if (!data || !data.deadlines) return [];
      return data.deadlines.filter(function (d) { return day(d.due) === date; }).map(function (d) {
        return {
          id: d.id,
          title: (d.course ? d.course + ': ' : '') + d.title + ' (' + hhmm(d.due) + ')',
          due: date, done: false, category: 'uni', source: 'Moodle', sample: isSample
        };
      });
    }
  });
})();
