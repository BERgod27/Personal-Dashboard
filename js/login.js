/* Sign-in page for the hosted dashboard (server/server.mjs). The button is a plain link to
   /auth/google: the server sends the browser to Google and back, and comes back here with
   ?error=<code> if the sign-in didn't go through. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  // Fixed messages only: nothing from the address bar is shown as it is.
  var ERRORS = {
    cancelled: 'Sign-in was cancelled. Choose Sign in with Google to try again.',
    expired: 'That sign-in took too long or was started in another tab. Try again.',
    not_allowed: 'That Google account doesn\'t have access to this dashboard. Try again and pick the account it belongs to.',
    unverified: 'Google hasn\'t verified that account\'s email address yet. Verify it with Google, then try again.',
    failed: 'Google sign-in didn\'t go through. Try again in a moment.',
    busy: 'Too many sign-in attempts from here. Wait a few minutes, then try again.',
    setup: 'Google sign-in isn\'t set up on this server yet.'
  };

  var code = new URLSearchParams(location.search).get('error');
  if (code) {
    $('auth-error').textContent = ERRORS[code] || ERRORS.failed;
    history.replaceState(null, '', location.pathname);
  }

  fetch('/api/auth', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
    if (j.user) location.replace('/');
    else if (j.google === false) $('auth-setup').hidden = false;
  }).catch(function () {});

  // One tap is enough: a second one would start a second round trip and expire the first.
  $('auth-google').addEventListener('click', function (e) {
    var a = e.currentTarget;
    if (a.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    a.setAttribute('aria-disabled', 'true');
    a.lastElementChild.textContent = 'Opening Google…';
    // Coming back with the browser's Back button shows the page from cache: make it usable again.
    window.addEventListener('pageshow', function () {
      a.removeAttribute('aria-disabled');
      a.lastElementChild.textContent = 'Sign in with Google';
    }, { once: true });
  });
})();
