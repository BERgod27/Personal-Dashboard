/*
 * Online mode: when the dashboard is served by server/server.mjs, this keeps the
 * browser's data in sync with the account on the server.
 *
 * Load it before js/store.js. The first time on a device it asks the server who is signed
 * in and fetches the saved data *before* the other scripts run (a short synchronous request),
 * writes it into localStorage, and from then on pushes every change to the tracked keys back
 * to the server. On a device that has signed in before it does not wait: the dashboard starts
 * from the data already here (with sw.js that also works with no connection) and catches up
 * with the server afterwards. Opened any other way (published page, file://, python
 * http.server) it finds no server and does nothing, so the dashboard keeps working locally.
 *
 * Exposes window.PDOnline = { user, openUni(), syncUni(), signOut(), status(), flush() }.
 */
(function () {
  'use strict';

  /* localStorage keys that hold user data; each one is a document on the server. */
  var KEYS = ['personal-dashboard.v1', 'pd.meals.v1', 'pd.workouts.v1'];
  var META = 'pd.online.meta'; // { versions: {key: n}, pending: {key: true} }

  function syncRequest(method, url) {
    var x = new XMLHttpRequest();
    x.open(method, url, false);
    x.setRequestHeader('Accept', 'application/json');
    x.send(null);
    var json = null;
    try { json = JSON.parse(x.responseText); } catch (e) { /* not JSON: not our server */ }
    return { status: x.status, json: json };
  }

  if (!/^https?:$/.test(location.protocol)) return;

  var ls = window.localStorage;
  var origSet = Storage.prototype.setItem;
  var meta = readMeta();
  var dirty = {};
  var timer = null;
  var inflight = false;
  var state = 'saved'; // saved | saving | offline | error | conflict
  var listeners = [];
  var confirmed = false; // this page load has heard from the server that meta.user is signed in
  var reconciling = false;
  var version = '';

  function readMeta() {
    try {
      var m = JSON.parse(window.localStorage.getItem(META)) || {};
      return { user: m.user || '', versions: m.versions || {}, pending: m.pending || {}, conflict: m.conflict || {} };
    } catch (e) { return { user: '', versions: {}, pending: {}, conflict: {} }; }
  }
  function writeMeta() { try { origSet.call(ls, META, JSON.stringify(meta)); } catch (e) { /* ignore */ } }
  function conflicted() { return Object.keys(meta.conflict); }
  function idle() { return conflicted().length ? 'conflict' : 'saved'; }

  // The server did not answer and there is no data of this account here to start from. Nothing
  // below may run: it would show example data and later push it as if it were the account's.
  function unreachable() {
    window.stop();
    document.body.innerHTML = '<main class="unreachable"><h1>The server could not be reached</h1>' +
      '<p class="muted">Check your connection. A sleeping server can take a minute to wake up.</p>' +
      '<button class="btn primary" type="button">Try again</button></main>';
    document.body.querySelector('button').addEventListener('click', function () { location.reload(); });
  }

  /* ---- 1. Get the account's data in place before the dashboard reads localStorage. */
  if (meta.user) {
    // Signed in on this device before: start from what is here, catch up in reconcile().
    KEYS.forEach(function (k) {
      if (meta.pending[k] && !meta.conflict[k] && ls.getItem(k) != null) dirty[k] = true; // edits not sent last time
    });
    state = 'offline';
  } else {
    var auth;
    try { auth = syncRequest('GET', '/api/auth'); } catch (e) { auth = { status: 0, json: null }; }
    if (auth.status !== 200 || !auth.json || !('user' in auth.json)) {
      // Our worker only ever runs on the hosted site, so this is the server not answering.
      if (navigator.serviceWorker && navigator.serviceWorker.controller) { unreachable(); return; }
      return; // no server here: local mode
    }
    if (!auth.json.user) { location.replace('/login'); return; }
    var first;
    try { first = syncRequest('GET', '/api/state'); } catch (e) { first = { status: 0, json: null }; }
    if (first.status === 401) { location.replace('/login'); return; }
    // Anything but a real answer must not be read as "the account is empty".
    if (first.status !== 200 || !first.json || !first.json.docs) { unreachable(); return; }
    var docs = first.json.docs;
    KEYS.forEach(function (k) {
      var d = docs[k];
      var local = ls.getItem(k);
      if (meta.pending[k] && local != null) {
        dirty[k] = true; // edits made offline before this device remembered its user: send them
      } else if (d) {
        origSet.call(ls, k, d.value);
        meta.versions[k] = d.version;
        delete meta.pending[k];
      } else if (local != null) {
        // Nothing on the server yet: this browser's data becomes the account's data.
        meta.versions[k] = 0;
        meta.pending[k] = true;
        dirty[k] = true;
      } else {
        meta.versions[k] = 0;
      }
    });
    meta.user = auth.json.user.username;
    version = auth.json.version || '';
    confirmed = true;
    writeMeta();
    installed();
  }

  // Signed in for sure: keep the app's files on the device (sw.js) and ask the browser not to
  // clear this site's storage when space runs low, since it can hold edits not yet sent.
  function installed() {
    if (navigator.serviceWorker) navigator.serviceWorker.register('/sw.js').catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  // Everything of the signed-in user kept in this browser.
  function forget() {
    KEYS.concat([META, 'pd.tutor.chat', 'pd.workouts.draft.v1']).forEach(function (k) { try { ls.removeItem(k); } catch (e) {} });
    if (!window.caches) return Promise.resolve();
    // Without the cached page, the next launch asks the server and reaches the sign-in page.
    return Promise.all([caches.delete('pd-data'), caches.open('pd-shell').then(function (c) { return c.delete('/'); })]).catch(function () {});
  }

  /* After a start from local data: check who is signed in, send what was not sent, then load
     anything newer. Until this succeeds nothing is sent (the data here might belong to someone
     who has since signed out). flush() and pull() call it again until it does. */
  function reconcile() {
    if (reconciling || confirmed) return;
    reconciling = true;
    fetch('/api/auth', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !('user' in j)) throw new Error('not the dashboard server');
      // Signed out: edits not sent yet stay here and go up after the next sign-in.
      if (!j.user) { location.replace('/login'); return; }
      if (j.user.username !== meta.user) { forget().then(function () { location.reload(); }); return; }
      confirmed = true;
      reconciling = false;
      version = j.version || '';
      paintVersion();
      installed();
      setState(Object.keys(dirty).length ? 'saving' : idle());
      return flush().then(function () { return pull(true); }).then(function () {
        // The uni data on screen came from the device's copy; replace it with the server's.
        return api('GET', '/api/uni').then(function (r) { if (r.status === 200) publishUni(r.json); });
      }).then(refreshUni);
    }).catch(function () {
      reconciling = false;
      if (confirmed) return;
      setState('offline');
      clearTimeout(timer);
      timer = setTimeout(flush, 10000);
    });
  }
  if (meta.user) reconcile(); // started here, before the other scripts load, to keep the wait short

  /* ---- 2. Watch for changes to the tracked keys. */
  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this === ls && KEYS.indexOf(k) !== -1) markDirty(k);
  };

  function markDirty(k) {
    meta.pending[k] = true;
    writeMeta();
    // A document waiting for the conflict question is not sent until it is answered.
    if (meta.conflict[k]) return;
    dirty[k] = true;
    setState('saving');
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }

  function setState(s) {
    if (state === s) return;
    state = s;
    listeners.forEach(function (fn) { fn(s); });
  }

  function api(method, url, body, opts) {
    return fetch(url, Object.assign({
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }, opts || {})).then(function (r) {
      if (r.status === 401) { location.replace('/login'); throw new Error('signed out'); }
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; });
    });
  }

  /* ---- 3. Push changes. The server rejects a write based on an old version (409);
     then the newer copy from the other device wins and the page reloads with it. */
  function flush(keepalive) {
    clearTimeout(timer);
    if (!confirmed) { reconcile(); return Promise.resolve(); }
    if (inflight) { timer = setTimeout(flush, 400); return Promise.resolve(); }
    var keys = Object.keys(dirty);
    if (!keys.length) { if (state === 'saving') setState(idle()); return Promise.resolve(); }
    inflight = true;
    var conflict = false;
    return keys.reduce(function (p, k) {
      return p.then(function () {
        var value = ls.getItem(k);
        delete dirty[k];
        if (value == null) { delete meta.pending[k]; return; }
        var small = keepalive && value.length < 60000;
        return api('PUT', '/api/state/' + encodeURIComponent(k), { value: value, baseVersion: meta.versions[k] || 0 }, small ? { keepalive: true } : null)
          .then(function (r) {
            if (r.status === 200) {
              meta.versions[k] = r.json.version;
              if (!dirty[k]) delete meta.pending[k];
            } else if (r.status === 409 && r.json.current) {
              // Changed on another device too. Both copies stay as they are until the person
              // chooses (showConflict); the one here keeps collecting edits meanwhile.
              meta.conflict[k] = { version: r.json.current.version, at: Number(r.json.current.updatedAt) || 0 };
              conflict = true;
            } else {
              dirty[k] = true;
              throw new Error(r.json.error || ('HTTP ' + r.status));
            }
          }, function (err) { dirty[k] = true; throw err; });
      });
    }, Promise.resolve()).then(function () {
      inflight = false;
      writeMeta();
      if (conflict) showConflict();
      if (Object.keys(dirty).length) { timer = setTimeout(flush, 400); return; }
      setState(idle());
    }, function () {
      inflight = false;
      writeMeta();
      setState(navigator.onLine === false ? 'offline' : 'error');
      timer = setTimeout(flush, 10000);
    });
  }

  /* ---- 4. Pick up changes made on another device when this tab comes back. */
  var lastPull = Date.now();

  // Loading newer data reloads the page, which would throw away what the person is in the
  // middle of: text being typed, an open dialog or sheet, a running rest timer.
  function busy() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) ||
      !!document.querySelector('dialog[open], .wt-sheet-wrap, .wt-rest-main, .tutor-panel:not([hidden])');
  }

  function pull(now) {
    if (!confirmed) { reconcile(); return Promise.resolve(); }
    if (Object.keys(dirty).length || inflight || (!now && Date.now() - lastPull < 5000)) return Promise.resolve();
    lastPull = Date.now();
    return api('GET', '/api/state').then(function (r) {
      // Checked again here: nothing may be written unless the page reloads right after, or the
      // dashboard would save its older in-memory copy over the newer one.
      if (r.status !== 200 || !r.json.docs || Object.keys(dirty).length || busy()) return;
      var changed = false;
      KEYS.forEach(function (k) {
        var d = r.json.docs[k];
        if (meta.pending[k]) return; // edits here not sent yet (or a conflict): never overwritten
        if (d && d.version > (meta.versions[k] || 0)) {
          origSet.call(ls, k, d.value);
          meta.versions[k] = d.version;
          changed = true;
        }
      });
      writeMeta();
      if (changed) location.reload();
    }).catch(function () { /* offline: try again later */ });
  }

  /* ---- 4b. Two devices changed the same document: ask which one to keep. */
  function showConflict() {
    var el = document.getElementById('online-conflict');
    var keys = conflicted();
    if (!keys.length) { if (el) el.remove(); return; }
    if (!document.body) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'online-conflict';
      el.className = 'online-conflict';
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-labelledby', 'online-conflict-text');
      el.innerHTML = '<p id="online-conflict-text"></p><div class="row">' +
        '<button class="btn small" type="button" data-act="mine">Keep this device’s version</button>' +
        '<button class="btn small" type="button" data-act="theirs">Use the other device’s version</button></div>' +
        '<p class="form-msg" aria-live="polite"></p>';
      el.addEventListener('click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act) resolveConflict(el, act === 'mine');
      });
      document.body.appendChild(el);
    }
    var at = Math.max.apply(null, keys.map(function (k) { return meta.conflict[k].at || 0; }));
    el.firstChild.textContent = 'Your data was also changed on another device' +
      (at ? ' (' + new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) + ')' : '') +
      ', so the changes made here are not saved to your account yet. Only one version can be kept.';
  }

  function resolveConflict(el, mine) {
    var buttons = el.querySelectorAll('button');
    var msg = el.querySelector('.form-msg');
    var lock = function (on) { for (var i = 0; i < buttons.length; i++) buttons[i].disabled = on; };
    lock(true);
    msg.textContent = '';
    var work = mine ? conflicted().reduce(function (p, k) {
      return p.then(function () {
        var value = ls.getItem(k);
        if (value == null) { delete meta.conflict[k]; delete meta.pending[k]; return; }
        return api('PUT', '/api/state/' + encodeURIComponent(k), { value: value, baseVersion: meta.conflict[k].version }).then(function (r) {
          if (r.status === 200) {
            meta.versions[k] = r.json.version;
            delete meta.conflict[k];
            if (ls.getItem(k) === value) delete meta.pending[k];
            else dirty[k] = true; // edited while this was being sent
          } else if (r.status === 409 && r.json.current) {
            meta.conflict[k] = { version: r.json.current.version, at: Number(r.json.current.updatedAt) || 0 };
            throw new Error('It was changed on the other device again just now. Choose once more.');
          } else throw new Error(r.json.error || 'Not saved. Try again in a moment.');
        });
      });
    }, Promise.resolve()) : api('GET', '/api/state').then(function (r) {
      if (r.status !== 200 || !r.json.docs) throw new Error('The other version could not be loaded. Try again in a moment.');
      conflicted().forEach(function (k) {
        var d = r.json.docs[k];
        if (d) { origSet.call(ls, k, d.value); meta.versions[k] = d.version; }
        delete meta.conflict[k];
        delete meta.pending[k];
        delete dirty[k];
      });
      writeMeta();
      location.reload();
    });
    work.then(function () {
      writeMeta();
      showConflict();
      setState(idle());
      flush();
    }, function (e) {
      writeMeta();
      showConflict();
      lock(false);
      msg.textContent = e instanceof TypeError ? 'The server could not be reached. Check your connection and try again.' : e.message;
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
    else pull();
  });
  window.addEventListener('pagehide', function () { flush(true); });
  window.addEventListener('online', function () { flush(); });
  window.addEventListener('focus', function () { pull(); });
  setInterval(function () { if (document.visibilityState === 'visible') pull(); }, 120000);

  /* ---- 5. Uni: server-side sync of Moodle, SIGARRA and a manual timetable. */
  function publishUni(data) {
    if (!data) return;
    window.UNI_DATA = data;
    window.dispatchEvent(new CustomEvent('pd:uni:data', { detail: data }));
  }

  function syncUni(password) {
    return api('POST', '/api/uni/sync', password ? { password: password } : {}).then(function (r) {
      if (r.json && r.json.data) publishUni(r.json.data);
      return r;
    });
  }

  /* ---- 6. Small UI: sync status + account menu in the top bar, uni connections dialog. */
  function notice(text) {
    var el = document.getElementById('online-notice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'online-notice';
      el.className = 'online-notice';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 6000);
  }

  var LABELS = { saved: 'Saved', saving: 'Saving…', offline: 'Offline, will save when back', error: 'Not saved yet, retrying', conflict: 'Not saved: changed on another device' };

  // Lucide icons (lucide.dev), drawn inline so they follow the text colour.
  function icon(paths) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>'; }
  var ICON = {
    user: icon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>'),
    uni: icon('<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>'),
    out: icon('<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'),
    devices: icon('<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>')
  };

  function buildBar() {
    var bar = document.querySelector('.topbar');
    if (!bar || document.getElementById('online-bar')) return;
    var wrap = document.createElement('div');
    wrap.id = 'online-bar';
    wrap.className = 'online-bar';
    wrap.innerHTML =
      '<span class="sync-status" id="sync-status" aria-live="polite"><span class="sync-label"></span></span>' +
      '<details class="account-menu">' +
      '<summary class="btn ghost account-btn" aria-label="Account">' + ICON.user + '<span class="account-name"></span></summary>' +
      '<div class="account-pop">' +
      '<p class="account-who">Signed in as <b></b></p>' +
      '<button class="menu-item" type="button" data-act="uni">' + ICON.uni + 'Uni connections</button>' +
      '<button class="menu-item" type="button" data-act="out">' + ICON.out + 'Sign out</button>' +
      '<button class="menu-item danger" type="button" data-act="out-all">' + ICON.devices + 'Sign out on all devices</button>' +
      '<p class="account-version" data-f="version" hidden></p>' +
      '</div></details>';
    wrap.querySelector('.account-who b').textContent = meta.user;
    wrap.querySelector('.account-name').textContent = meta.user;
    var status = wrap.querySelector('#sync-status');
    var paint = function (s) { status.firstChild.textContent = LABELS[s]; status.title = LABELS[s]; status.dataset.state = s; };
    paint(state);
    listeners.push(paint);
    var menu = wrap.querySelector('details');
    wrap.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-act]');
      var act = t && t.getAttribute('data-act');
      if (!act) return;
      menu.open = false;
      if (act === 'uni') openUni();
      if (act === 'out') signOut();
      if (act === 'out-all' && confirm('Sign out on every phone and computer, this one included?')) signOut(true);
    });
    // Close the menu on Escape or a click elsewhere, like any other menu.
    document.addEventListener('click', function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    });
    bar.appendChild(wrap);
    paintVersion();

    var foot = document.querySelector('.foot');
    if (foot) foot.textContent = 'Saved to your account and synced across your devices.';
    var backupIntro = document.querySelector('#settings-dialog p.muted');
    if (backupIntro) backupIntro.textContent = 'Your data is saved to your account. A backup copy is still a good idea before big changes.';
    // Erasing syncs like any other change, so it empties the account on every device.
    var erase = document.getElementById('erase-text');
    if (erase) {
      erase.dataset.text = erase.textContent = 'Deletes every event, task, note and workout from your account, on all your devices. Meals keep their own data.';
      erase.dataset.ask = 'Erase every event, task, note and workout from your account, on all your devices? Copy a backup first if you might want them back.';
    }
  }

  // The GitHub commit the server was built from: matches the newest commit once an update is live.
  function paintVersion() {
    var el = document.querySelector('#online-bar [data-f="version"]');
    if (el && version) { el.textContent = 'Version ' + version; el.hidden = false; }
  }

  function signOut(everywhere) {
    flush().then(function () {
      // Signing out clears this browser, so anything the server does not have yet would be gone.
      var unsent = KEYS.some(function (k) { return meta.pending[k]; });
      if (unsent && !confirm('Some changes are not saved to your account yet. Sign out and lose them?')) return;
      return api('POST', everywhere ? '/api/logout-all' : '/api/logout', {}).catch(function () {})
        .then(forget).then(function () { location.replace('/login'); });
    });
  }

  var dlg = null;
  function openUni() {
    if (!dlg) dlg = buildUniDialog();
    dlg.el.querySelector('[data-f="msg"]').textContent = '';
    dlg.load();
    dlg.el.showModal();
  }

  function buildUniDialog() {
    var el = document.createElement('dialog');
    el.className = 'dialog uni-connect';
    el.setAttribute('aria-labelledby', 'uc-title');
    el.innerHTML =
      '<form method="dialog">' +
      '<div class="dialog-head"><h2 id="uc-title">Uni connections</h2>' +
      '<p class="muted">The server fetches these for you, so they work on every device. Saved links and passwords are encrypted.</p></div>' +
      '<div class="dialog-body">' +
      '<section class="dialog-section"><h3>Moodle deadlines</h3>' +
      '<p class="muted">In Moodle: Calendar, Import or export calendars, Export calendar. Choose All courses and Recent and next 60 days, then Get calendar URL.</p>' +
      '<div class="field"><label for="uc-moodle">Calendar URL <span data-f="moodleState"></span></label>' +
      '<input id="uc-moodle" type="password" autocomplete="off" placeholder="Paste to set or replace"></div></section>' +
      '<section class="dialog-section"><h3>SIGARRA</h3>' +
      '<p class="muted">Timetable, exams, course units, fees and print balance. The server signs in the same way as the U.Porto app.</p>' +
      '<div class="field-row">' +
      '<div class="field"><label for="uc-user">Username</label><input id="uc-user" type="text" autocomplete="off" placeholder="up202301234"></div>' +
      '<div class="field"><label for="uc-fac">Faculty (optional)</label><input id="uc-fac" type="text" placeholder="Found automatically"></div>' +
      '</div>' +
      '<div class="field"><label for="uc-pw">Password <span data-f="pwState"></span></label>' +
      '<input id="uc-pw" type="password" autocomplete="off"></div>' +
      '<label class="check" for="uc-remember"><input id="uc-remember" type="checkbox"> Remember it on the server (encrypted) so SIGARRA syncs on its own</label>' +
      '<details class="disclosure localsync"><summary>Sync from your own computer if SIGARRA blocks the server</summary>' +
      '<div class="disclosure-body">' +
      '<p>SIGARRA can turn the server away. A small script on your computer signs in from your own network instead, and your SIGARRA password stays with you. <span data-f="localState"></span></p>' +
      '<div class="row">' +
      '<button class="btn small" type="button" data-act="synckey">Create a sync key</button>' +
      '<button class="btn small ghost danger" type="button" data-act="synckey-off" hidden>Turn off local sync</button>' +
      '</div>' +
      '<div class="field" data-f="keybox" hidden><label for="uc-key">Your sync key (copy it now, it is shown once)</label>' +
      '<input id="uc-key" class="mono" data-f="keyval" type="text" readonly></div>' +
      '<p>Then follow server/tools/README to run it.</p>' +
      '</div></details>' +
      '<details class="disclosure"><summary>Type the timetable by hand instead</summary>' +
      '<div class="disclosure-body"><div class="field"><label for="uc-csv">One class per line: day, start, end, course, type, room, teacher</label>' +
      '<textarea id="uc-csv" class="mono" rows="4" placeholder="Mon,08:30,10:30,ES,TP,B208,ABC"></textarea></div></div></details>' +
      '</section>' +
      '<ul class="sources" data-f="sources" aria-label="Last sync"></ul>' +
      '<p class="form-msg" data-f="msg" aria-live="polite"></p>' +
      '</div>' +
      '<div class="dialog-actions"><span class="spacer"></span>' +
      '<button class="btn" type="button" data-act="close">Close</button>' +
      '<button class="btn primary" type="button" data-act="save">Save and sync</button></div>' +
      '</form>';
    document.body.appendChild(el);
    var $ = function (s) { return el.querySelector(s); };
    var msg = $('[data-f="msg"]');
    // fetch() rejects with a TypeError ("Failed to fetch") when the server can't be reached.
    function offlineOr(e) {
      return e instanceof TypeError ? 'The server could not be reached. Check your connection and try again.' : e.message;
    }

    function showSources() {
      var d = window.UNI_DATA;
      var src = (d && d.sources) || {};
      var names = { moodle: 'Moodle', sigarra: 'SIGARRA', manual: 'Manual timetable' };
      var list = $('[data-f="sources"]');
      list.textContent = '';
      Object.keys(src).forEach(function (k) {
        var s = src[k];
        var when = s.synced_at ? new Date(s.synced_at).toLocaleString() : 'never';
        var warn = s.ok && s.warnings && s.warnings.length ? ' (not refreshed: ' + s.warnings.join('; ') + ')' : '';
        var li = document.createElement('li');
        li.className = !s.ok ? 'is-bad' : warn ? 'is-warn' : '';
        var name = document.createElement('b');
        name.textContent = names[k] || k;
        li.appendChild(name);
        li.appendChild(document.createTextNode(s.ok ? ' synced ' + when + warn : ' failed: ' + s.error));
        list.appendChild(li);
      });
      var p = d && d.profile;
      if (p && p.faculties && p.faculties.length) {
        $('#uc-fac').placeholder = 'Found: ' + p.faculties.join(', ').toUpperCase();
      }
    }

    function showLocalState(on, username) {
      $('[data-f="localState"]').textContent = on
        ? 'A sync key is set' + (username ? ' for ' + username : '') + '.'
        : 'No sync key yet.';
      $('[data-act="synckey-off"]').hidden = !on;
      $('[data-act="synckey"]').textContent = on ? 'Create a new key' : 'Create a sync key';
    }

    function makeSyncKey() {
      msg.textContent = 'Creating a key…';
      api('POST', '/api/uni/sync-key', {}).then(function (r) {
        if (r.status !== 200) throw new Error(r.json.error || 'No key was created. Try again in a moment.');
        $('[data-f="keybox"]').hidden = false;
        $('[data-f="keyval"]').value = r.json.key;
        $('[data-f="keyval"]').focus();
        $('[data-f="keyval"]').select();
        showLocalState(true, r.json.user);
        msg.textContent = 'Key created. Copy it now into local-sync.config.json; it will not be shown again.';
      }).catch(function (e) { msg.textContent = offlineOr(e); });
    }

    function turnOffSyncKey() {
      api('DELETE', '/api/uni/sync-key', {}).then(function (r) {
        if (r.status !== 200) throw new Error((r.json && r.json.error) || 'Local sync is still on. Try again in a moment.');
        $('[data-f="keybox"]').hidden = true;
        $('[data-f="keyval"]').value = '';
        showLocalState(false);
        msg.textContent = 'Local sync turned off. The old key no longer works.';
      }).catch(function (e) { msg.textContent = offlineOr(e); });
    }

    function load() {
      $('#uc-moodle').value = '';
      $('#uc-pw').value = '';
      $('[data-f="keybox"]').hidden = true;
      $('[data-f="keyval"]').value = '';
      showSources();
      api('GET', '/api/uni/settings').then(function (r) {
        var s = r.json || {};
        $('[data-f="moodleState"]').textContent = s.moodleConfigured ? '(saved for ' + s.moodleHost + ')' : '(not set)';
        $('#uc-fac').value = s.faculty || '';
        $('#uc-user').value = s.sigarraUser || '';
        $('#uc-remember').checked = !!s.passwordRemembered;
        $('[data-f="pwState"]').textContent = s.passwordRemembered ? '(remembered)' : '';
        $('#uc-csv').value = s.scheduleCsv || '';
        showLocalState(!!s.localSyncEnabled);
      });
    }

    function save() {
      var pw = $('#uc-pw').value;
      var body = {
        faculty: $('#uc-fac').value,
        sigarraUser: $('#uc-user').value,
        rememberPassword: $('#uc-remember').checked,
        scheduleCsv: $('#uc-csv').value
      };
      if ($('#uc-moodle').value.trim()) body.moodleIcsUrl = $('#uc-moodle').value.trim();
      if (pw && body.rememberPassword) body.sigarraPassword = pw;
      msg.textContent = 'Saving…';
      api('PUT', '/api/uni/settings', body).then(function (r) {
        if (r.status !== 200) throw new Error(r.json.error || 'Your settings were not saved. Try again in a moment.');
        msg.textContent = 'Syncing…';
        return syncUni(pw || null);
      }).then(function (r) {
        $('#uc-pw').value = '';
        if (r.status !== 200) throw new Error(r.json.error || 'Your settings are saved, but the sync did not finish. Press Save and sync to try again.');
        var d = r.json.data;
        msg.textContent = 'Synced: ' + d.classes.length + ' classes, ' + (d.exams || []).length + ' exams, ' + d.deadlines.length + ' deadlines.' +
          (r.json.sigarraSkipped ? ' Type your SIGARRA password to update SIGARRA.' : '');
        load();
      }).catch(function (e) { msg.textContent = offlineOr(e); });
    }

    el.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-act]');
      var act = t && t.getAttribute('data-act');
      if (act === 'close') el.close();
      if (act === 'save') save();
      if (act === 'synckey') makeSyncKey();
      if (act === 'synckey-off') turnOffSyncKey();
    });
    return { el: el, load: load };
  }

  window.PDOnline = {
    user: { username: meta.user },
    openUni: openUni,
    syncUni: syncUni,
    signOut: signOut,
    status: function () { return state; },
    flush: flush
  };

  // Refresh uni data in the background if it is more than an hour old.
  function refreshUni() {
    return api('POST', '/api/uni/sync', { ifStale: true }).then(function (r) {
      if (r.status === 200 && r.json.data) publishUni(r.json.data);
      if (r.json && r.json.forgotPassword) notice('The SIGARRA sign-in failed, so your saved password was removed. Type it again in Account → Uni connections.');
    }).catch(function () {});
  }

  function start() {
    buildBar();
    showConflict();
    if (!confirmed) return; // reconcile() does the rest once the server has answered
    if (Object.keys(dirty).length) flush();
    refreshUni();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
