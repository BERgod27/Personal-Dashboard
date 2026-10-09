/*
 * App: boots the store, draws the daily view and the module panels,
 * and wires up quick-add, the item editor and backup/restore.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var DAY_START = 7;      // first hour shown on the schedule
  var DAY_END = 24;       // last hour line
  var HOUR_PX = 52;

  var state = { date: D.today() };

  /* ---------- formatting ---------- */

  var fmtLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  var fmtShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  var fmtWd = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

  function isoWeek(s) {
    var d = D.parse(s);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    var jan4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
  }

  function relDay(s) {
    var t = D.today();
    if (s === t) return 'Today';
    if (s === D.addDays(t, 1)) return 'Tomorrow';
    if (s === D.addDays(t, -1)) return 'Yesterday';
    return null;
  }

  function dayLabel(s) { return relDay(s) || fmtShort.format(D.parse(s)); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function chip(category) {
    var c = Dashboard.category(category);
    return el('span', 'chip cat-' + c.id, c.label);
  }

  /* A quiet empty or error state: icon tile, title, one line of help. */
  var ICONS = {
    tasks: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'
  };
  function emptyState(icon, title, text, cls) {
    var box = el('div', 'empty-state' + (cls ? ' ' + cls : ''));
    var tile = el('span', 'empty-icon');
    tile.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[icon] + '</svg>';
    var copy = el('div', 'empty-copy');
    copy.appendChild(el('p', 'empty-title', title));
    if (text) copy.appendChild(el('p', 'empty-text', text));
    box.appendChild(tile);
    box.appendChild(copy);
    return box;
  }

  /* ---------- day header + week strip ---------- */

  function renderHeader() {
    var rel = relDay(state.date);
    $('day-eyebrow').textContent = (rel ? rel + ' · ' : '') + 'Week ' + isoWeek(state.date);
    $('day-title').textContent = fmtLong.format(D.parse(state.date));

    var strip = $('weekstrip');
    strip.innerHTML = '';
    var monday = D.addDays(state.date, -D.weekday(state.date));
    for (var i = 0; i < 7; i++) {
      var day = D.addDays(monday, i);
      var li = el('li');
      var b = el('button', 'wday');
      b.type = 'button';
      if (day === state.date) b.classList.add('selected');
      if (day === D.today()) b.classList.add('is-today');
      b.setAttribute('aria-label', fmtLong.format(D.parse(day)));
      b.appendChild(el('span', 'wday-name', fmtWd.format(D.parse(day))));
      b.appendChild(el('span', 'wday-num', String(D.parse(day).getDate())));
      var dots = el('span', 'wday-dots');
      Dashboard.eventsFor(day).slice(0, 4).forEach(function (ev) {
        dots.appendChild(el('i', 'dot cat-' + Dashboard.category(ev.category).id));
      });
      b.appendChild(dots);
      b.addEventListener('click', (function (d) { return function () { setDate(d); }; })(day));
      li.appendChild(b);
      strip.appendChild(li);
    }
  }

  /* ---------- schedule ---------- */

  /* Put overlapping events side by side: greedy lanes per overlapping cluster. */
  function layout(events) {
    var placed = [];
    var cluster = [];
    var clusterEnd = -1;
    function flush() {
      var lanes = [];
      cluster.forEach(function (p) {
        var lane = 0;
        while (lanes[lane] != null && lanes[lane] > p.s) lane++;
        lanes[lane] = p.e;
        p.lane = lane;
      });
      cluster.forEach(function (p) { p.lanes = lanes.length; placed.push(p); });
      cluster = [];
    }
    events.forEach(function (ev) {
      var s = D.mins(ev.start);
      var e = Math.max(D.mins(ev.end || ev.start) || s + 60, s + 20);
      if (s >= clusterEnd) flush();
      cluster.push({ ev: ev, s: s, e: e });
      clusterEnd = Math.max(clusterEnd, e);
    });
    flush();
    return placed;
  }

  function renderSchedule() {
    var events = Dashboard.eventsFor(state.date);
    var timed = events.filter(function (e) { return e.start; });
    var allday = events.filter(function (e) { return !e.start; });

    $('schedule-count').textContent = events.length ? events.length + (events.length === 1 ? ' item' : ' items') : '';

    var ad = $('allday');
    ad.innerHTML = '';
    ad.hidden = !allday.length;
    allday.forEach(function (ev) { ad.appendChild(eventCard(ev, false)); });

    var startH = DAY_START;
    timed.forEach(function (e) { startH = Math.min(startH, Math.floor(D.mins(e.start) / 60)); });

    var tl = $('timeline');
    tl.innerHTML = '';
    tl.style.height = (DAY_END - startH) * HOUR_PX + 'px';
    tl.dataset.start = startH;

    for (var h = startH; h < DAY_END; h++) {
      var row = el('div', 'hour');
      row.style.top = (h - startH) * HOUR_PX + 'px';
      row.style.height = HOUR_PX + 'px';
      row.appendChild(el('span', 'hour-label', D.pad(h) + ':00'));
      tl.appendChild(row);
    }

    if (!timed.length) {
      var empty = el('p', 'timeline-empty', 'Nothing scheduled. Select an hour or use Quick add.');
      empty.style.top = Math.max(0, (10 - startH)) * HOUR_PX + 'px';
      tl.appendChild(empty);
    }

    layout(timed).forEach(function (p) {
      var card = eventCard(p.ev, true);
      card.style.top = (p.s / 60 - startH) * HOUR_PX + 'px';
      card.style.height = Math.max((p.e - p.s) / 60 * HOUR_PX - 3, 22) + 'px';
      card.style.left = 'calc(var(--gutter) + (100% - var(--gutter)) * ' + (p.lane / p.lanes) + ')';
      card.style.width = 'calc((100% - var(--gutter)) / ' + p.lanes + ' - 4px)';
      if (p.e - p.s < 45) card.classList.add('compact');
      else if (p.e - p.s < 80) card.classList.add('short');
      tl.appendChild(card);
    });

    renderNow();
  }

  function eventCard(ev, positioned) {
    var c = Dashboard.category(ev.category);
    var card = el('button', 'event cat-' + c.id + (positioned ? ' positioned' : ''));
    card.type = 'button';
    var timeText = ev.start ? ev.start + (ev.end ? '–' + ev.end : '') : 'All day';
    var time = el('span', 'event-time', ev.start || 'All day');
    if (ev.start && ev.end) time.appendChild(el('span', 'event-end', '–' + ev.end));
    card.appendChild(time);
    var title = el('span', 'event-title', ev.title);
    card.appendChild(title);
    var meta = el('span', 'event-meta');
    if (ev.weekly) meta.appendChild(el('span', 'tag', 'weekly'));
    if (ev.sample) meta.appendChild(el('span', 'chip sample', 'Example'));
    if (ev.source) meta.appendChild(el('span', 'tag', 'from ' + ev.source));
    if (meta.childNodes.length) card.appendChild(meta);
    card.setAttribute('aria-label', timeText + ', ' + ev.title + ', ' + c.label);
    if (ev.source) {
      card.disabled = true;
    } else {
      card.addEventListener('click', function (e) { e.stopPropagation(); openEditor('event', ev.id); });
    }
    return card;
  }

  function renderNow() {
    var tl = $('timeline');
    var old = tl.querySelector('.now');
    if (old) old.remove();
    if (state.date !== D.today()) return;
    var d = new Date();
    var m = d.getHours() * 60 + d.getMinutes();
    var startH = +tl.dataset.start;
    if (m < startH * 60) return;
    var line = el('div', 'now');
    line.style.top = (m / 60 - startH) * HOUR_PX + 'px';
    line.appendChild(el('span', 'now-label', D.hhmm(m)));
    tl.appendChild(line);
  }

  function scrollSchedule() {
    var wrap = $('timeline-wrap');
    var startH = +$('timeline').dataset.start;
    var target;
    if (state.date === D.today()) {
      var d = new Date();
      target = d.getHours() - 1;
    } else {
      var first = Dashboard.eventsFor(state.date).filter(function (e) { return e.start; })[0];
      target = first ? Math.floor(D.mins(first.start) / 60) - 1 : 8;
    }
    wrap.scrollTop = Math.max(0, (target - startH) * HOUR_PX);
  }

  $('timeline').addEventListener('click', function (e) {
    if (e.target.closest('.event')) return;
    var rect = this.getBoundingClientRect();
    var startH = +this.dataset.start;
    var m = Math.floor(((e.clientY - rect.top) / HOUR_PX + startH) * 2) * 30;
    openEditor('event', null, { start: D.hhmm(m), end: D.hhmm(m + 60) });
  });

  /* ---------- tasks ---------- */

  function renderTasks() {
    var box = $('tasks');
    box.innerHTML = '';
    var tasks = Dashboard.tasksFor(state.date);
    var open = tasks.filter(function (t) { return !t.done; }).length;
    $('tasks-count').textContent = tasks.length ? open + ' open' : '';

    var groups = [
      { label: 'Overdue', items: tasks.filter(function (t) { return t.due && t.due < state.date; }) },
      { label: state.date === D.today() ? 'Due today' : 'Due ' + dayLabel(state.date), items: tasks.filter(function (t) { return t.due === state.date; }) },
      { label: 'Anytime', items: tasks.filter(function (t) { return !t.due; }) }
    ];

    if (!tasks.length) {
      box.appendChild(emptyState('tasks', 'No tasks for this day', 'Add one with Quick add, for example “email professor tomorrow”.'));
      return;
    }

    groups.forEach(function (g) {
      if (!g.items.length) return;
      box.appendChild(el('h3', 'group-label' + (g.label === 'Overdue' ? ' overdue' : ''), g.label));
      var ul = el('ul', 'tasklist');
      g.items.sort(function (a, b) { return (a.done - b.done) || (a.created || '').localeCompare(b.created || ''); });
      g.items.forEach(function (t) {
        var li = el('li', 'task' + (t.done ? ' done' : ''));
        var cbId = 'task-' + t.id;
        var cb = el('input');
        cb.type = 'checkbox';
        cb.id = cbId;
        cb.checked = !!t.done;
        if (t.source) cb.disabled = true;
        cb.addEventListener('change', function () {
          Store.update(function (d) {
            var real = d.tasks.find(function (x) { return x.id === t.id; });
            if (!real) return;
            real.done = cb.checked;
            real.doneAt = cb.checked ? new Date().toISOString() : null;
          });
        });
        var label = el('label', 'sr-only', 'Done: ' + t.title);
        label.htmlFor = cbId;
        var title = el('button', 'task-title', t.title);
        title.type = 'button';
        if (t.source) title.disabled = true;
        else title.addEventListener('click', function () { openEditor('task', t.id); });
        var meta = el('span', 'task-meta');
        if (t.due && t.due < state.date) meta.appendChild(el('span', 'due', dayLabel(t.due)));
        if (t.sample) meta.appendChild(el('span', 'chip sample', 'Example'));
        meta.appendChild(chip(t.category));
        li.appendChild(cb);
        li.appendChild(label);
        li.appendChild(title);
        li.appendChild(meta);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
  }

  /* ---------- day note ---------- */

  var noteTimer = null;
  function renderNote() {
    var note = $('day-note');
    if (document.activeElement === note) return;
    note.value = Store.get().notes[state.date] || '';
    $('note-saved').textContent = '';
  }
  $('day-note').addEventListener('input', function () {
    var v = this.value;
    var date = state.date;
    $('note-saved').textContent = 'Saving…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      Store.update(function (d) {
        if (v.trim()) d.notes[date] = v; else delete d.notes[date];
      });
      $('note-saved').textContent = 'Saved';
    }, 400);
  });

  /* ---------- modules ---------- */

  /* Panels are created once and kept; each render() calls module.render again,
     so a module must cope with being re-rendered (mount once, then update). */
  var moduleBodies = {};
  function renderModules() {
    var grid = $('modules');
    Dashboard.modules().forEach(function (m) {
      var body = moduleBodies[m.id];
      if (!body) {
        // No heading here: the module's tab names it in the page header (js/tabs.js).
        var sec = el('section', 'panel module cat-' + Dashboard.category(m.category).id);
        sec.id = 'module-' + m.id;
        body = el('div', 'module-body');
        sec.appendChild(body);
        grid.appendChild(sec);
        moduleBodies[m.id] = body;
      }
      try {
        m.render(body, { date: state.date, setDate: setDate });
      } catch (err) {
        console.error(m.id, err);
        body.textContent = '';
        body.appendChild(emptyState('alert', m.title + ' could not load', 'Reload the page. If it keeps happening, the browser console has the details.', 'error-state module-error'));
      }
    });
  }

  /* ---------- quick add ---------- */

  var qa = $('quickadd-input');
  qa.addEventListener('input', function () {
    var v = qa.value.trim();
    var prev = $('quickadd-preview');
    if (!v) { prev.textContent = ''; return; }
    var p = Dashboard.parseQuick(v, state.date);
    var parts = [p.kind === 'event' ? 'Event' : 'Task', '“' + (p.title || '…') + '”', dayLabel(p.date)];
    if (p.start) parts.push(p.start + '–' + p.end);
    if (p.weekly) parts.push('every ' + fmtWd.format(D.parse(p.date)));
    parts.push(Dashboard.category(p.category).label);
    prev.textContent = 'Will add: ' + parts.join(' · ');
  });

  $('quickadd').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = qa.value.trim();
    if (!v) return;
    var p = Dashboard.parseQuick(v, state.date);
    if (!p.title) return;
    Store.update(function (d) {
      if (p.kind === 'event') {
        d.events.push({ id: Store.uid(), title: p.title, date: p.date, start: p.start, end: p.end, category: p.category, weekly: p.weekly, notes: '' });
      } else {
        d.tasks.push({ id: Store.uid(), title: p.title, due: p.date, done: false, doneAt: null, category: p.category, notes: '', created: new Date().toISOString() });
      }
    });
    qa.value = '';
    $('quickadd-preview').textContent = 'Added to ' + dayLabel(p.date) + '.';
    if (p.date !== state.date) setDate(p.date);
  });

  /* ---------- item editor ---------- */

  var dlg = $('item-dialog');
  var editing = null; // { kind, id }

  Dashboard.CATEGORIES.forEach(function (c) {
    var o = el('option', null, c.label);
    o.value = c.id;
    $('f-category').appendChild(o);
  });

  function syncKind() {
    var isEvent = $('f-kind').value === 'event';
    Array.prototype.forEach.call(dlg.querySelectorAll('.event-only'), function (n) { n.hidden = !isEvent; });
    $('f-start').required = isEvent;
  }
  $('f-kind').addEventListener('change', syncKind);

  function openEditor(kind, id, defaults) {
    var d = Store.get();
    var item = id ? (kind === 'event' ? d.events : d.tasks).find(function (x) { return x.id === id; }) : null;
    editing = { kind: kind, id: id };
    defaults = defaults || {};
    $('item-dialog-title').textContent = item ? 'Edit ' + kind : 'New ' + kind;
    $('f-title').value = item ? item.title : '';
    $('f-kind').value = kind;
    $('f-category').value = item ? item.category : (defaults.category || 'personal');
    $('f-date').value = item ? (kind === 'event' ? item.date : (item.due || '')) : state.date;
    $('f-start').value = item && item.start ? item.start : (defaults.start || '09:00');
    $('f-end').value = item && item.end ? item.end : (defaults.end || '10:00');
    $('f-weekly').checked = !!(item && item.weekly);
    $('f-notes').value = item ? (item.notes || '') : '';
    $('f-delete').hidden = !item;
    $('f-delete').textContent = item && item.weekly ? 'Delete all weeks' : 'Delete';
    syncSkip(item);
    syncKind();
    dlg.showModal();
    $('f-title').focus();
  }

  /* For a weekly event opened on another week, offer to drop just that day. */
  var skipBtn = el('button', 'btn', 'Remove this day only');
  skipBtn.type = 'button';
  skipBtn.id = 'f-skip';
  $('f-delete').after(skipBtn);
  function syncSkip(item) {
    skipBtn.hidden = !(item && item.weekly && editing.kind === 'event');
  }
  skipBtn.addEventListener('click', function () {
    var date = state.date;
    Store.update(function (d) {
      var ev = d.events.find(function (x) { return x.id === editing.id; });
      if (!ev) return;
      if (ev.date === date) {
        ev.date = D.addDays(ev.date, 7);
      } else {
        ev.skip = (ev.skip || []).concat(date);
      }
    });
    dlg.close();
  });

  $('f-cancel').addEventListener('click', function () { dlg.close(); });

  $('f-delete').addEventListener('click', function () {
    var key = editing.kind === 'event' ? 'events' : 'tasks';
    Store.update(function (d) {
      d[key] = d[key].filter(function (x) { return x.id !== editing.id; });
    });
    dlg.close();
  });

  $('item-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('f-title').value.trim();
    if (!title) return;
    var newKind = $('f-kind').value;
    var date = $('f-date').value || null;
    var fields = {
      title: title,
      category: $('f-category').value,
      notes: $('f-notes').value
    };
    Store.update(function (d) {
      var old = null;
      if (editing.id) {
        var oldKey = editing.kind === 'event' ? 'events' : 'tasks';
        old = d[oldKey].find(function (x) { return x.id === editing.id; });
        if (old && editing.kind !== newKind) {
          d[oldKey] = d[oldKey].filter(function (x) { return x.id !== editing.id; });
          old = null;
        }
      }
      if (newKind === 'event') {
        var start = $('f-start').value || '09:00';
        var end = $('f-end').value;
        if (!end || end <= start) end = D.hhmm(D.mins(start) + 60);
        Object.assign(fields, { date: date || state.date, start: start, end: end, weekly: $('f-weekly').checked });
        if (old) { Object.assign(old, fields); delete old.sample; }
        else d.events.push(Object.assign({ id: Store.uid() }, fields));
      } else {
        Object.assign(fields, { due: date });
        if (old) { Object.assign(old, fields); delete old.sample; }
        else d.tasks.push(Object.assign({ id: Store.uid(), done: false, doneAt: null, created: new Date().toISOString() }, fields));
      }
    });
    dlg.close();
  });

  /* ---------- settings: backup / restore ---------- */

  var sdlg = $('settings-dialog');
  var framed = true;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  $('download-backup').hidden = framed;

  $('open-settings').addEventListener('click', function () {
    $('backup-text').value = Store.exportJSON();
    $('backup-status').textContent = '';
    $('restore-status').textContent = '';
    $('erase-confirm').hidden = true;
    sdlg.showModal();
  });
  $('settings-close').addEventListener('click', function () { sdlg.close(); });

  $('copy-backup').addEventListener('click', function () {
    var ta = $('backup-text');
    ta.value = Store.exportJSON();
    function fallback() {
      ta.focus();
      ta.select();
      $('backup-status').textContent = 'Selected. Press Ctrl+C (or Copy) to copy it.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(function () {
        $('backup-status').textContent = 'Copied. Paste it somewhere safe, like a note or an email to yourself.';
      }, fallback);
    } else {
      fallback();
    }
  });

  $('download-backup').addEventListener('click', function () {
    var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dashboard-backup-' + D.today() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    $('backup-status').textContent = 'Saved.';
  });

  $('restore-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      $('restore-text').value = r.result;
      $('restore-status').textContent = 'File loaded. Press Restore to use it.';
    };
    r.readAsText(f);
  });

  $('restore-btn').addEventListener('click', function () {
    var text = $('restore-text').value.trim();
    if (!text) { $('restore-status').textContent = 'Paste a backup or choose a file first.'; return; }
    try {
      Store.importJSON(text);
      $('restore-text').value = '';
      $('restore-status').textContent = 'Restored.';
      $('backup-text').value = Store.exportJSON();
    } catch (err) {
      $('restore-status').textContent = 'Could not read that backup. Check that you pasted all of it.';
    }
  });

  $('erase-btn').addEventListener('click', function () { $('erase-confirm').hidden = false; });
  $('erase-confirm').addEventListener('click', function () {
    Store.reset();
    $('erase-confirm').hidden = true;
    $('backup-text').value = Store.exportJSON();
    sdlg.close();
  });

  /* ---------- examples ---------- */

  function seedSamples() {
    var today = D.today();
    var monday = D.addDays(today, -D.weekday(today));
    var at = function (offset) { return D.addDays(monday, offset); };
    var ev = function (title, date, start, end, category, weekly) {
      return { id: Store.uid(), title: title, date: date, start: start, end: end, category: category, weekly: !!weekly, notes: '', sample: true };
    };
    var task = function (title, due, category) {
      return { id: Store.uid(), title: title, due: due, done: false, doneAt: null, category: category, notes: '', created: new Date().toISOString(), sample: true };
    };
    Store.update(function (d) {
      d.events.push(
        ev('Análise Matemática II · B013', at(0), '09:00', '11:00', 'uni', true),
        ev('Programação · lab B107', at(1), '14:00', '16:00', 'uni', true),
        ev('Física I · theory', at(2), '11:00', '13:00', 'uni', true),
        ev('Gym · push day', at(0), '18:30', '19:45', 'workout', true),
        ev('Gym · pull day', at(2), '18:30', '19:45', 'workout', true),
        ev('Gym · legs', at(4), '18:30', '19:45', 'workout', true),
        ev('Run · Parque da Cidade', today, '10:00', '11:00', 'workout'),
        ev('Lunch with family', today, '13:00', '14:00', 'meal'),
        ev('Review Física notes', today, '16:00', '17:30', 'uni')
      );
      d.tasks.push(
        task('Read Física chapter 3', today, 'uni'),
        task('Submit Programação lab report', D.addDays(today, 2), 'uni'),
        task('Top up Andante card', D.addDays(today, -1), 'personal'),
        task('Buy oats and eggs', null, 'meal')
      );
    });
  }

  function hasSamples() {
    var d = Store.get();
    return d.events.some(function (x) { return x.sample; }) || d.tasks.some(function (x) { return x.sample; });
  }

  $('clear-samples').addEventListener('click', function () {
    Store.update(function (d) {
      d.events = d.events.filter(function (x) { return !x.sample; });
      d.tasks = d.tasks.filter(function (x) { return !x.sample; });
    });
  });

  /* ---------- boot ---------- */

  function render() {
    renderHeader();
    renderSchedule();
    renderTasks();
    renderNote();
    renderModules();
    $('sample-banner').hidden = !hasSamples();
    $('storage-banner').hidden = Store.isPersistent();
  }

  function setDate(date) {
    state.date = date;
    render();
    scrollSchedule();
  }

  $('prev-day').addEventListener('click', function () { setDate(D.addDays(state.date, -1)); });
  $('next-day').addEventListener('click', function () { setDate(D.addDays(state.date, 1)); });
  $('go-today').addEventListener('click', function () { setDate(D.today()); });

  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select, dialog')) return;
    if (e.key === 'ArrowLeft') setDate(D.addDays(state.date, -1));
    else if (e.key === 'ArrowRight') setDate(D.addDays(state.date, 1));
    else if (e.key === 't') setDate(D.today());
    else if (e.key === '/' || e.key === 'n') { e.preventDefault(); qa.focus(); }
  });

  var fresh = Store.load();
  if (fresh) seedSamples();
  Store.onChange(render);
  Dashboard.refresh = render;

  render();
  scrollSchedule();
  setInterval(function () {
    if (state.date === D.today()) renderNow();
  }, 60000);
})();
