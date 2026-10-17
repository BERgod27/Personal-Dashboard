/*
 * Tutor: a floating "Ask" button that opens a chat with Claude on every tab.
 *
 * Only in online mode (served by server/server.mjs): the server adds the signed-in user's
 * own dashboard data (uni, planner, workouts, meals, news) to each question and calls the
 * Claude API with its ANTHROPIC_API_KEY. The conversation is kept in this browser only
 * (localStorage 'pd.tutor.chat'); the server keeps no copy.
 */
(function () {
  'use strict';
  if (!window.PDOnline) return; // local mode: no server, no tutor

  var KEY = 'pd.tutor.chat';
  var MAX_KEEP = 40;
  var SUGGESTIONS = [
    'What do I have due this week?',
    'When is my next exam, and how should I prepare?',
    'Make me a study plan for the next 7 days around my classes',
    'How has my training gone over the last month?',
    'Am I hitting my protein goal?',
    'Quiz me on something I have this week'
  ];

  var messages = load();
  var busy = null; // AbortController while an answer streams
  var configured = null;
  var el = {};

  function load() {
    try {
      var m = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(m) ? m.filter(function (x) { return x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string'; }) : [];
    } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(messages.slice(-MAX_KEEP))); } catch (e) { /* storage blocked */ }
  }

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k]; // only ever static markup or render() output
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  // Lucide icons (lucide.dev)
  var ICON = {
    ask: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    fresh: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>',
    send: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
    stop: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect width="10" height="10" x="7" y="7" rx="1.5" class="fill"/></svg>',
    arrow: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>'
  };

  /* ---------- a small, safe Markdown renderer (everything is escaped first) */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function inline(s) {
    var codes = [];
    s = esc(s).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }
  function render(md) {
    var out = [];
    var lines = String(md).replace(/\r/g, '').split('\n');
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      var hd = line.match(/^(#{1,4})\s+(.*)$/);
      if (hd) { out.push('<p class="tt-h">' + inline(hd[2]) + '</p>'); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        var row = function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return inline(c.trim()); }); };
        var head = row(line);
        i += 2;
        var body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
        out.push('<div class="tt-table"><table><thead><tr><th>' + head.join('</th><th>') + '</th></tr></thead><tbody>' +
          body.map(function (r) { return '<tr><td>' + r.join('</td><td>') + '</td></tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      var li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (li) {
        var ordered = /\d/.test(li[1]);
        var items = [];
        while (i < lines.length && (li = lines[i].match(/^\s*([-*•]|\d+[.)])\s+(.*)$/))) { items.push('<li>' + inline(li[2]) + '</li>'); i++; }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }
      if (!line.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s|\s*\|)/.test(lines[i])) para.push(inline(lines[i++]));
      if (!para.length) para.push(inline(lines[i++]));
      out.push('<p>' + para.join('<br>') + '</p>');
    }
    return out.join('');
  }

  /* ---------- UI */
  function build() {
    el.fab = h('button', { class: 'tutor-fab', type: 'button', 'aria-label': 'Ask the tutor', 'aria-expanded': 'false', 'aria-controls': 'tutor-panel', html: ICON.ask + '<span>Ask</span>' });
    el.list = h('div', { class: 'tt-list', role: 'log', 'aria-live': 'polite' });
    el.input = h('textarea', { id: 'tutor-input', rows: '1', placeholder: 'Ask about your classes, exams, training or anything you are studying', enterkeyhint: 'send' });
    el.send = h('button', { class: 'btn primary icon tt-send', type: 'submit', 'aria-label': 'Send', html: ICON.send });
    el.note = h('p', { class: 'tt-note muted small' });
    var form = h('form', { class: 'tt-composer', autocomplete: 'off' }, [h('label', { class: 'sr-only', for: 'tutor-input', text: 'Your question' }), el.input, el.send]);
    var newBtn = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'New chat', title: 'New chat', html: ICON.fresh });
    var closeBtn = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Close', title: 'Close', html: ICON.close });
    el.panel = h('section', { class: 'tutor-panel', id: 'tutor-panel', role: 'dialog', 'aria-labelledby': 'tutor-title', hidden: '' }, [
      h('header', { class: 'tt-head' }, [
        h('div', { class: 'tt-title' }, [h('h2', { id: 'tutor-title', text: 'Tutor' }), h('p', { text: 'Answers from your timetable, deadlines, workouts and meals' })]),
        newBtn, closeBtn
      ]),
      el.list, el.note, form
    ]);
    document.body.appendChild(el.fab);
    document.body.appendChild(el.panel);

    el.fab.addEventListener('click', function () { toggle(el.panel.hidden); });
    closeBtn.addEventListener('click', function () { toggle(false); });
    newBtn.addEventListener('click', function () {
      if (busy) busy.abort();
      messages = []; save(); draw(); el.input.focus();
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); busy ? busy.abort() : ask(el.input.value); });
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) ask(el.input.value); }
    });
    el.input.addEventListener('input', grow);
    document.addEventListener('keydown', function (e) {
      if (el.panel.hidden) return;
      if (e.key === 'Escape') toggle(false);
      else if (e.key === 'Tab' && fullScreen.matches) trapTab(e);
    });
    draw();
  }

  /* Below 960px the chat covers the page, so Tab stays inside it like any other dialog.
     On desktop it is a corner panel next to the page, and Tab moves freely. */
  var fullScreen = window.matchMedia('(max-width: 959.98px)');
  function trapTab(e) {
    var items = Array.prototype.filter.call(
      el.panel.querySelectorAll('button, textarea, a[href], [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.getClientRects().length; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    var inside = el.panel.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  }

  function grow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 160) + 'px';
  }

  function toggle(open) {
    el.panel.hidden = !open;
    el.fab.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('tutor-open', open);
    if (open) {
      checkSetup();
      setTimeout(function () { el.input.focus(); el.list.scrollTop = el.list.scrollHeight; }, 30);
    } else el.fab.focus();
  }

  function checkSetup() {
    if (configured) return;
    fetch('/api/tutor', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { configured = !!j.configured; showNote(configured ? '' : 'The tutor is not set up yet: the server needs an Anthropic API key (ANTHROPIC_API_KEY in Render). Questions will work once it is added.'); })
      .catch(function () {});
  }
  function showNote(text) { el.note.textContent = text || ''; el.note.hidden = !text; }

  function bubble(m) {
    var b = h('div', { class: 'tt-msg ' + (m.role === 'user' ? 'is-user' : 'is-bot') });
    if (m.role === 'user') b.textContent = m.content;
    else b.innerHTML = render(m.content);
    return b;
  }

  function draw() {
    el.list.textContent = '';
    if (!messages.length) {
      var list = h('ul', { class: 'tt-suggest', 'aria-label': 'Suggested questions' });
      SUGGESTIONS.forEach(function (s) {
        var c = h('button', { class: 'tt-suggestion', type: 'button', html: '<span></span>' + ICON.arrow });
        c.firstChild.textContent = s;
        c.addEventListener('click', function () { ask(s); });
        list.appendChild(h('li', null, [c]));
      });
      el.list.appendChild(h('div', { class: 'tt-empty' }, [
        h('p', { class: 'tt-empty-title', text: 'Ask about anything on this dashboard' }),
        h('p', { class: 'tt-empty-text', text: 'The tutor reads your timetable, deadlines, exams, workouts, meals and the news, and can help you study.' }),
        h('p', { class: 'tt-suggest-label', text: 'Try asking' }),
        list
      ]));
    }
    messages.forEach(function (m) { el.list.appendChild(bubble(m)); });
    el.list.scrollTop = el.list.scrollHeight;
  }

  function setBusy(ctrl) {
    busy = ctrl;
    el.send.innerHTML = ctrl ? ICON.stop : ICON.send;
    el.send.setAttribute('aria-label', ctrl ? 'Stop' : 'Send');
    el.panel.classList.toggle('is-busy', !!ctrl);
  }

  function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    // Keep the history small enough for the server's limits: oldest pairs go first.
    while (messages.length > MAX_KEEP - 2) messages.splice(0, 2);
    messages.push({ role: 'user', content: text });
    save();
    el.input.value = ''; grow();
    draw();
    showNote('');

    var answer = { role: 'assistant', content: '' };
    var b = bubble(answer);
    b.classList.add('is-typing');
    b.innerHTML = '<span class="tt-thinking">Thinking…</span>';
    el.list.appendChild(b);
    el.list.scrollTop = el.list.scrollHeight;

    var ctrl = new AbortController();
    setBusy(ctrl);
    var failed = null;
    var app = document.getElementById('app');
    var view = app ? app.dataset.view : null;

    // Push unsaved dashboard edits first, so the answer sees the latest data.
    window.PDOnline.flush().catch(function () {}).then(function () {
      return fetch('/api/tutor', {
        method: 'POST', credentials: 'same-origin', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ messages: messages, view: view })
      });
    }).then(function (r) {
      if (r.status === 401) { location.replace('/login'); throw new Error('signed out'); }
      if (!r.ok || !r.body) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (j.setup) configured = false;
          failed = j.error || 'The tutor did not answer this time. Your question is still in the box: send it again in a moment.';
        });
      }
      var reader = r.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var paint = null;
      function show() {
        paint = null;
        b.classList.remove('is-typing');
        b.innerHTML = render(answer.content);
        var nearBottom = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 120;
        if (nearBottom) el.list.scrollTop = el.list.scrollHeight;
      }
      function handle(o) {
        if (o.t) answer.content += o.t;
        if (o.reset) answer.content = '';
        if (o.error) failed = o.error;
        if (!paint) paint = requestAnimationFrame(show);
      }
      return (function pump() {
        return reader.read().then(function (res) {
          buf += dec.decode(res.value || new Uint8Array(), { stream: !res.done });
          var parts = buf.split('\n');
          buf = res.done ? '' : parts.pop();
          parts.forEach(function (p) { if (p.trim()) { try { handle(JSON.parse(p)); } catch (e) { /* partial line */ } } });
          if (!res.done) return pump();
          if (paint) { cancelAnimationFrame(paint); show(); }
        });
      })();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') failed = answer.content ? null : 'Stopped.';
      else if (!failed) failed = navigator.onLine === false
        ? 'This device is offline. Ask again once it is back online.'
        : 'The tutor could not be reached. Ask again in a moment.';
    }).then(function () {
      setBusy(null);
      if (answer.content.trim()) {
        if (ctrl.signal.aborted) answer.content += '\n\n*(stopped)*';
        messages.push(answer);
        save();
        b.classList.remove('is-typing');
        b.innerHTML = render(answer.content);
      } else {
        // Nothing came back: drop the question so it can be asked again.
        messages.pop();
        save();
        el.input.value = text; grow();
        b.remove();
        draw();
      }
      if (failed) showNote(failed);
      el.input.focus();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
