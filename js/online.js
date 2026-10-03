/*
 * Online mode: when the dashboard is served by server/server.mjs, this keeps the
 * browser's data in sync with the account on the server.
 *
 * Load it before js/store.js. It asks the server who is signed in and fetches the
 * saved data *before* the other scripts run (a short synchronous request), writes it
 * into localStorage, and from then on pushes every change to the tracked keys back to
 * the server. Opened any other way (published page, file://, python http.server) it
 * finds no server and does nothing, so the dashboard keeps working locally.
 *
 * Exposes window.PDOnline = { user, openUni(), syncUni(), signOut(), status() }.
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
  var auth;
  try { auth = syncRequest('GET', '/api/auth'); } catch (e) { return; }
  if (auth.status !== 200 || !auth.json || !('user' in auth.json)) return; // no server here: local mode
  if (!auth.json.user) { location.replace('/login'); return; }

  var ls = window.localStorage;
  var origSet = Storage.prototype.setItem;
  var meta = readMeta();
  var dirty = {};
  var timer = null;
  var inflight = false;
  var state = 'saved'; // saved | saving | offline | error
  var listeners = [];

  function readMeta() {
    try {
      var m = JSON.parse(ls.getItem(META)) || {};
      return { versions: m.versions || {}, pending: m.pending || {} };
    } catch (e) { return { versions: {}, pending: {} }; }
  }
  function writeMeta() { try { origSet.call(ls, META, JSON.stringify(meta)); } catch (e) { /* ignore */ } }

  /* ---- 1. Pull the account's data before the dashboard reads localStorage. */
  var first = syncRequest('GET', '/api/state');
  if (first.status === 401) { location.replace('/login'); return; }
  var docs = (first.json && first.json.docs) || {};
  KEYS.forEach(function (k) {
    var d = docs[k];
    var local = ls.getItem(k);
    if (meta.pending[k] && local != null) {
      dirty[k] = true; // edits made offline last time: try to send them
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
  writeMeta();

  /* ---- 2. Watch for changes to the tracked keys. */
  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    if (this === ls && KEYS.indexOf(k) !== -1) markDirty(k);
  };

  function markDirty(k) {
    dirty[k] = true;
    meta.pending[k] = true;
    writeMeta();
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
    if (inflight) { timer = setTimeout(flush, 400); return Promise.resolve(); }
    var keys = Object.keys(dirty);
    if (!keys.length) { if (state === 'saving') setState('saved'); return Promise.resolve(); }
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
              origSet.call(ls, k, r.json.current.value);
              meta.versions[k] = r.json.current.version;
              delete meta.pending[k];
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
      if (conflict) {
        notice('This was changed on another device, so the newest version was loaded. Your last change here was not kept.');
        setTimeout(function () { location.reload(); }, 2500);
        return;
      }
      if (Object.keys(dirty).length) { timer = setTimeout(flush, 400); return; }
      setState('saved');
    }, function () {
      inflight = false;
      writeMeta();
      setState(navigator.onLine === false ? 'offline' : 'error');
      timer = setTimeout(flush, 10000);
    });
  }

  /* ---- 4. Pick up changes made on another device when this tab comes back. */
  var lastPull = Date.now();
  function pull() {
    if (Object.keys(dirty).length || inflight || Date.now() - lastPull < 5000) return;
    lastPull = Date.now();
    api('GET', '/api/state').then(function (r) {
      if (r.status !== 200 || Object.keys(dirty).length) return;
      var changed = false;
      KEYS.forEach(function (k) {
        var d = r.json.docs[k];
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

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
    else pull();
  });
  window.addEventListener('pagehide', function () { flush(true); });
  window.addEventListener('online', function () { flush(); });
  window.addEventListener('focus', pull);
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

  var LABELS = { saved: 'Saved', saving: 'Saving…', offline: 'Offline, will save when back', error: 'Not saved yet, retrying' };

  function buildBar() {
    var bar = document.querySelector('.topbar');
    if (!bar || document.getElementById('online-bar')) return;
    var wrap = document.createElement('div');
    wrap.id = 'online-bar';
    wrap.className = 'online-bar';
    wrap.innerHTML =
      '<span class="sync-status" id="sync-status" aria-live="polite"></span>' +
      '<details class="account-menu">' +
      '<summary class="btn ghost">Account</summary>' +
      '<div class="account-pop">' +
      '<p class="muted small">Signed in as <b></b></p>' +
      '<button class="btn small" type="button" data-act="uni">Uni connections</button>' +
      '<button class="btn small" type="button" data-act="out">Sign out</button>' +
      '<button class="btn small ghost" type="button" data-act="out-all">Sign out on all devices</button>' +
      '<p class="muted small" data-f="version" hidden></p>' +
      '</div></details>';
    wrap.querySelector('b').textContent = auth.json.user.username;
    // The GitHub commit the server was built from: matches the newest commit once an update is live.
    var version = wrap.querySelector('[data-f="version"]');
    if (auth.json.version) { version.textContent = 'Version ' + auth.json.version; version.hidden = false; }
    var status = wrap.querySelector('#sync-status');
    var paint = function (s) { status.textContent = LABELS[s]; status.dataset.state = s; };
    paint(state);
    listeners.push(paint);
    wrap.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act) return;
      wrap.querySelector('details').open = false;
      if (act === 'uni') openUni();
      if (act === 'out') signOut();
      if (act === 'out-all' && confirm('Sign out on every phone and computer, this one included?')) signOut(true);
    });
    bar.appendChild(wrap);

    var foot = document.querySelector('.foot');
    if (foot) foot.textContent = 'Saved to your account and synced across your devices.';
    var backupIntro = document.querySelector('#settings-dialog p.muted');
    if (backupIntro) backupIntro.textContent = 'Your data is saved to your account. A backup copy is still a good idea before big changes.';
  }

  function signOut(everywhere) {
    flush().then(function () {
      return api('POST', everywhere ? '/api/logout-all' : '/api/logout', {});
    }).catch(function () {}).then(function () {
      KEYS.concat([META, 'pd.tutor.chat']).forEach(function (k) { try { ls.removeItem(k); } catch (e) {} });
      location.replace('/login');
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
    el.innerHTML =
      '<form method="dialog" class="dialog-body">' +
      '<h2>Uni connections</h2>' +
      '<p class="muted small">The server fetches these for you, so they work on every device. Saved links and passwords are encrypted.</p>' +
      '<h3>Moodle deadlines</h3>' +
      '<p class="muted small">Moodle → Calendar → Import or export calendars → Export calendar → All courses + Recent and next 60 days → Get calendar URL.</p>' +
      '<div class="field"><label for="uc-moodle">Calendar URL <span data-f="moodleState"></span></label>' +
      '<input id="uc-moodle" type="password" autocomplete="off" placeholder="Paste to set or replace"></div>' +
      '<h3>SIGARRA</h3>' +
      '<p class="muted small">Timetable, exams, course units, fees and print balance. The server signs in the same way as the U.Porto app.</p>' +
      '<div class="field-row">' +
      '<div class="field"><label for="uc-user">Username</label><input id="uc-user" type="text" autocomplete="off" placeholder="up202301234"></div>' +
      '<div class="field"><label for="uc-fac">Faculty (optional)</label><input id="uc-fac" type="text" placeholder="found automatically"></div>' +
      '</div>' +
      '<div class="field"><label for="uc-pw">Password <span data-f="pwState"></span></label>' +
      '<input id="uc-pw" type="password" autocomplete="off" placeholder="Your SIGARRA password"></div>' +
      '<label class="check" for="uc-remember"><input id="uc-remember" type="checkbox"> Remember it on the server (encrypted) so SIGARRA syncs on its own</label>' +
      '<details class="localsync"><summary class="small">Sync from your own computer (if SIGARRA blocks the server)</summary>' +
      '<p class="muted small">SIGARRA can turn the server away. Run a small script on your computer instead: it signs in from your own network and your SIGARRA password stays with you. <span data-f="localState"></span></p>' +
      '<div class="field-row">' +
      '<button class="btn small" type="button" data-act="synckey">Create a sync key</button>' +
      '<button class="btn small ghost" type="button" data-act="synckey-off" hidden>Turn off local sync</button>' +
      '</div>' +
      '<div class="field" data-f="keybox" hidden><label>Your sync key (copy it now, shown once)</label>' +
      '<input data-f="keyval" type="text" readonly></div>' +
      '<p class="muted small">Then follow server/tools/README to run it.</p>' +
      '</details>' +
      '<details><summary class="small">Type the timetable by hand instead</summary>' +
      '<div class="field"><label for="uc-csv">One class per line: day,start,end,course,type,room,teacher</label>' +
      '<textarea id="uc-csv" rows="4" placeholder="Mon,08:30,10:30,ES,TP,B208,ABC"></textarea></div></details>' +
      '<p class="small" data-f="sources"></p>' +
      '<p class="small" data-f="msg" aria-live="polite"></p>' +
      '<div class="dialog-actions"><span class="spacer"></span>' +
      '<button class="btn" type="button" data-act="close">Close</button>' +
      '<button class="btn primary" type="button" data-act="save">Save and sync</button></div>' +
      '</form>';
    document.body.appendChild(el);
    var $ = function (s) { return el.querySelector(s); };
    var msg = $('[data-f="msg"]');

    function showSources() {
      var d = window.UNI_DATA;
      var src = (d && d.sources) || {};
      var names = { moodle: 'Moodle', sigarra: 'SIGARRA', manual: 'Manual timetable' };
      $('[data-f="sources"]').textContent = Object.keys(src).map(function (k) {
        var s = src[k];
        var when = s.synced_at ? new Date(s.synced_at).toLocaleString() : 'never';
        var warn = s.ok && s.warnings && s.warnings.length ? ' (not refreshed: ' + s.warnings.join('; ') + ')' : '';
        return (names[k] || k) + ': ' + (s.ok ? 'synced ' + when + warn : 'failed (' + s.error + ')');
      }).join(' · ');
      var p = d && d.profile;
      if (p && p.faculties && p.faculties.length) {
        $('#uc-fac').placeholder = 'found: ' + p.faculties.join(', ').toUpperCase();
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
        if (r.status !== 200) throw new Error(r.json.error || 'Could not create a key.');
        $('[data-f="keybox"]').hidden = false;
        $('[data-f="keyval"]').value = r.json.key;
        $('[data-f="keyval"]').focus();
        $('[data-f="keyval"]').select();
        showLocalState(true, r.json.user);
        msg.textContent = 'Key created. Copy it now into local-sync.config.json; it will not be shown again.';
      }).catch(function (e) { msg.textContent = e.message; });
    }

    function turnOffSyncKey() {
      api('DELETE', '/api/uni/sync-key', {}).then(function (r) {
        if (r.status !== 200) throw new Error((r.json && r.json.error) || 'Could not turn it off.');
        $('[data-f="keybox"]').hidden = true;
        $('[data-f="keyval"]').value = '';
        showLocalState(false);
        msg.textContent = 'Local sync turned off. The old key no longer works.';
      }).catch(function (e) { msg.textContent = e.message; });
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
        if (r.status !== 200) throw new Error(r.json.error || 'Could not save.');
        msg.textContent = 'Syncing…';
        return syncUni(pw || null);
      }).then(function (r) {
        $('#uc-pw').value = '';
        if (r.status !== 200) throw new Error(r.json.error || 'Sync failed.');
        var d = r.json.data;
        msg.textContent = 'Synced: ' + d.classes.length + ' classes, ' + (d.exams || []).length + ' exams, ' + d.deadlines.length + ' deadlines.' +
          (r.json.sigarraSkipped ? ' Type your SIGARRA password to update SIGARRA.' : '');
        load();
      }).catch(function (e) { msg.textContent = e.message; });
    }

    el.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'close') el.close();
      if (act === 'save') save();
      if (act === 'synckey') makeSyncKey();
      if (act === 'synckey-off') turnOffSyncKey();
    });
    return { el: el, load: load };
  }

  window.PDOnline = {
    user: auth.json.user,
    openUni: openUni,
    syncUni: syncUni,
    signOut: signOut,
    status: function () { return state; },
    flush: flush
  };

  function start() {
    buildBar();
    if (Object.keys(dirty).length) flush();
    // Refresh uni data in the background if it is more than an hour old.
    api('POST', '/api/uni/sync', { ifStale: true }).then(function (r) {
      if (r.status === 200 && r.json.data) publishUni(r.json.data);
      if (r.json && r.json.forgotPassword) notice('The SIGARRA sign-in failed, so your saved password was removed. Type it again in Account → Uni connections.');
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
