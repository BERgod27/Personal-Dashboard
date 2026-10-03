/* Sign-in page for the hosted dashboard (server/server.mjs). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var mode = 'login';

  function setMode(m) {
    mode = m;
    var setup = m === 'signup';
    $('auth-title').textContent = setup ? 'Create your account' : 'Sign in';
    $('auth-submit').textContent = setup ? 'Create account' : 'Sign in';
    $('auth-intro').hidden = !setup;
    $('auth-code-field').hidden = !setup;
    $('auth-code').required = setup;
    $('auth-pass').autocomplete = setup ? 'new-password' : 'current-password';
  }

  fetch('/api/auth', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.user) location.replace('/');
    else if (j.needsSetup) setMode('signup');
  }).catch(function () {});

  $('auth-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('auth-submit');
    btn.disabled = true;
    $('auth-error').textContent = '';
    var body = { username: $('auth-user').value, password: $('auth-pass').value };
    if (mode === 'signup') body.code = $('auth-code').value;
    fetch(mode === 'signup' ? '/api/signup' : '/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Could not sign in.');
        location.replace('/');
      });
    }).catch(function (err) {
      $('auth-error').textContent = err.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection.' : err.message;
      btn.disabled = false;
    });
  });
})();
