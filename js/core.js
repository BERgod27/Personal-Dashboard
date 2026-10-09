/*
 * Core: areas (categories), the module registry, and the quick-add parser.
 *
 * Adding a module (modules/workouts/register.js is a full example):
 *
 *   Dashboard.registerModule({
 *     id: 'workout',                 // also the key under Store.moduleData()
 *     title: 'Workouts',
 *     category: 'workout',           // colour/area it belongs to
 *     order: 20,                     // sort order among the modules
 *     render: function (el, ctx) {}, // draw the panel; ctx.date is the day shown
 *     itemsFor: function (date) {    // optional: put things on the day's schedule
 *       return [{ id, title, start:'HH:MM', end:'HH:MM', category, source:'workout' }];
 *     },
 *     tasksFor: function (date) {}   // optional: same idea for the task list
 *   });
 *
 * Each module has its own tab, whose page header names it, so render() draws only
 * the content. render() runs on every change, so mount once and update after that.
 * Call Dashboard.refresh() when the module's own data changes.
 *
 * Module items are read-only on the schedule; the module owns them.
 */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'uni', label: 'Uni', aliases: ['uni', 'class', 'aula', 'aulas', 'feup', 'study', 'estudo', 'exam', 'exame'] },
    { id: 'workout', label: 'Workout', aliases: ['workout', 'gym', 'treino', 'ginasio', 'run', 'corrida', 'sport'] },
    { id: 'meal', label: 'Meal', aliases: ['meal', 'food', 'refeicao', 'lunch', 'almoco', 'dinner', 'jantar', 'breakfast', 'pequeno-almoco'] },
    { id: 'personal', label: 'Personal', aliases: ['personal', 'pessoal', 'me', 'home', 'casa'] }
  ];

  var modules = [];

  /* Lower case without accents, so "Almoço" matches "almoco". */
  function fold(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function categoryFromTag(tag) {
    tag = fold(tag);
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].aliases.indexOf(tag) !== -1) return CATEGORIES[i].id;
    }
    return null;
  }

  /* English and Portuguese weekday names, Monday first. */
  var WEEKDAYS = [
    ['monday', 'mon', 'segunda', 'seg'],
    ['tuesday', 'tue', 'tues', 'terca', 'ter'],
    ['wednesday', 'wed', 'quarta', 'qua'],
    ['thursday', 'thu', 'thur', 'thurs', 'quinta', 'qui'],
    ['friday', 'fri', 'sexta', 'sex'],
    ['saturday', 'sat', 'sabado', 'sab'],
    ['sunday', 'sun', 'domingo', 'dom']
  ];

  function to24(h, m, ampm) {
    h = +h; m = m ? +m : 0;
    if (ampm) {
      ampm = ampm.toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
    }
    if (h > 23 || m > 59) return null;
    return D.pad(h) + ':' + D.pad(m);
  }

  /*
   * Turns a line of text into an event or a task.
   *   "Calculus 9:00-10:30 #uni weekly"  -> weekly event
   *   "gym 18h tomorrow"                 -> event at 18:00
   *   "buy oats"                         -> task due on the day being viewed
   */
  function parseQuick(text, baseDate) {
    var s = ' ' + text + ' ';
    var out = { kind: 'task', title: '', date: baseDate, start: null, end: null, category: null, weekly: false, dateSet: false };

    s = s.replace(/#([\wÀ-ÿ-]+)/g, function (_, tag) {
      var c = categoryFromTag(tag);
      if (c) out.category = c;
      return ' ';
    });

    s = s.replace(/\s(weekly|every week|semanal|todas as semanas)(?=\s)/i, function () { out.weekly = true; return ' '; });

    s = s.replace(/\s(today|hoje)(?=\s)/i, function () { out.date = D.today(); out.dateSet = true; return ' '; });
    s = s.replace(/\s(tomorrow|amanh[aã])(?=\s)/i, function () { out.date = D.addDays(D.today(), 1); out.dateSet = true; return ' '; });

    /* dd/mm or dd/mm/yyyy */
    s = s.replace(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?=\s)/, function (m, dd, mm, yy) {
      var now = new Date();
      var y = yy ? +yy : now.getFullYear();
      var d = new Date(y, +mm - 1, +dd);
      if (isNaN(d) || d.getMonth() !== +mm - 1) return m;
      if (!yy && D.ymd(d) < D.today()) d.setFullYear(y + 1);
      out.date = D.ymd(d); out.dateSet = true;
      return ' ';
    });

    /* weekday names, optionally "every <day>" / "on <day>" */
    var names = [];
    WEEKDAYS.forEach(function (list) { names = names.concat(list); });
    var wdRe = new RegExp('\\s(every\\s+|on\\s+|[àa]s?\\s+)?(' + names.join('|') + ')(?:-feira)?\\.?(?=\\s)', 'i');
    s = s.replace(wdRe, function (m, prefix, name) {
      var key = fold(name);
      var idx = -1;
      WEEKDAYS.forEach(function (list, i) { if (list.indexOf(key) !== -1) idx = i; });
      if (idx === -1) return m;
      var from = out.dateSet ? out.date : D.today();
      var diff = (idx - D.weekday(from) + 7) % 7;
      out.date = D.addDays(from, diff); out.dateSet = true;
      if (prefix && /every/i.test(prefix)) out.weekly = true;
      return ' ';
    });

    /* time range: 9-10, 9:00-10:30, 9h-10h30, 9am-11am */
    var T = '(\\d{1,2})(?:[:h.](\\d{2})|h)?\\s*(am|pm)?';
    var rangeRe = new RegExp('\\s(?:from\\s+|das\\s+)?' + T + '\\s*(?:-|–|to|até|ate|às|as)\\s*' + T + '(?=\\s)', 'i');
    s = s.replace(rangeRe, function (m, h1, m1, ap1, h2, m2, ap2) {
      var a = to24(h1, m1, ap1 || ap2);
      var b = to24(h2, m2, ap2);
      if (!a || !b) return m;
      out.start = a; out.end = b;
      return ' ';
    });

    /* single time: 18h, 18:30, 6pm, at 9 */
    if (!out.start) {
      var singleRe = /\s(?:at\s+|[àa]s\s+)?(\d{1,2})(?:[:h.](\d{2})|(h)|\s*(am|pm))(?=\s)|\s(?:at|[àa]s)\s+(\d{1,2})(?=\s)/i;
      s = s.replace(singleRe, function (m, h, mm, hh, ap, bareH) {
        var t = to24(h || bareH, mm, ap);
        if (!t) return m;
        out.start = t;
        out.end = D.hhmm(D.mins(t) + 60);
        return ' ';
      });
    }

    out.title = s.replace(/\s+/g, ' ').trim();
    if (out.start) out.kind = 'event';
    if (!out.category) out.category = guessCategory(out.title);
    return out;
  }

  /* Light keyword guess so "Gym" or "Almoço" land in the right area without a tag. */
  function guessCategory(title) {
    var words = fold(title).split(/[^a-z-]+/);
    for (var i = 0; i < words.length; i++) {
      var c = categoryFromTag(words[i]);
      if (c) return c;
    }
    return 'personal';
  }

  /* Does a stored event happen on this date? Handles weekly repeats. */
  function occursOn(ev, date) {
    if (ev.date === date) return true;
    if (!ev.weekly || date < ev.date) return false;
    if (ev.until && date > ev.until) return false;
    if (ev.skip && ev.skip.indexOf(date) !== -1) return false;
    return D.weekday(ev.date) === D.weekday(date);
  }

  window.Dashboard = {
    CATEGORIES: CATEGORIES,
    category: function (id) {
      for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
      return CATEGORIES[CATEGORIES.length - 1];
    },
    registerModule: function (m) {
      modules.push(m);
      modules.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    },
    modules: function () { return modules.slice(); },
    /* Redraw everything; app.js sets this. Modules call it when their own data changes. */
    refresh: function () {},
    parseQuick: parseQuick,
    occursOn: occursOn,

    /* Everything on the schedule for a date: your events plus module items. */
    eventsFor: function (date) {
      var own = Store.get().events.filter(function (e) { return occursOn(e, date); })
        .map(function (e) { return Object.assign({}, e, { source: null }); });
      modules.forEach(function (m) {
        if (!m.itemsFor) return;
        try { own = own.concat(m.itemsFor(date) || []); } catch (err) { console.error(m.id, err); }
      });
      return own.sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });
    },

    /* Tasks for a date: due that day, plus (on today) overdue and undated ones. */
    tasksFor: function (date) {
      var today = D.today();
      var list = Store.get().tasks.filter(function (t) {
        if (t.due === date) return true;
        if (date !== today) return false;
        if (!t.due) return !t.done || (t.doneAt && t.doneAt.slice(0, 10) === today);
        return t.due < today && (!t.done || (t.doneAt && t.doneAt.slice(0, 10) === today));
      }).map(function (t) { return Object.assign({}, t, { source: null }); });
      modules.forEach(function (m) {
        if (!m.tasksFor) return;
        try { list = list.concat(m.tasksFor(date) || []); } catch (err) { console.error(m.id, err); }
      });
      return list;
    },

    /* Standard "not built yet" panel body, used until a module is real. */
    placeholder: function (el, opts) {
      el.innerHTML = '';
      var status = document.createElement('p');
      status.className = 'module-status';
      status.innerHTML = '<span class="pill">' + opts.status + '</span>';
      el.appendChild(status);
      var p = document.createElement('p');
      p.className = 'muted';
      p.textContent = opts.summary;
      el.appendChild(p);
      var ul = document.createElement('ul');
      ul.className = 'planned';
      opts.planned.forEach(function (line) {
        var li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      });
      el.appendChild(ul);
    }
  };
})();
