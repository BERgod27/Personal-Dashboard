/*
 * Tooltips for icon-only buttons, on mouse hover and on keyboard focus.
 *
 * Any button, link or <summary> with an aria-label and no visible text gets one, in every
 * tab and module (shadow DOM included), and so does any control with aria-keyshortcuts.
 * The tooltip shows the label, plus the key from aria-keyshortcuts as a <kbd>. A native
 * title on the same control is taken over so the browser's slow tooltip doesn't show too:
 * if it only repeats the label it is dropped, otherwise it becomes a second line (and stays
 * available to screen readers as aria-description). Touch screens get no tooltip; the
 * aria-label still names the control.
 */
(function () {
  'use strict';

  var KEYS = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Enter: '↵' };
  var tip = null;
  var current = null; // control whose tooltip is showing
  var pending = null; // control whose tooltip is about to show
  var timer = null;

  function wants(n) {
    if (!n || n.nodeType !== 1 || !n.matches('button, a[href], summary, [role="button"]')) return false;
    if (n.hasAttribute('aria-keyshortcuts')) return true;
    // Visible text already says what the control does.
    return !!n.getAttribute('aria-label') && !(n.innerText || '').trim();
  }

  // The innermost control the event came from, looking inside shadow roots.
  function target(e) {
    var path = e.composedPath ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length && path[i] !== document.body; i++) {
      if (wants(path[i])) return path[i];
    }
    return null;
  }

  function label(n) { return n.getAttribute('aria-label') || (n.innerText || '').trim(); }

  function takeTitle(n) {
    var title = n.getAttribute('title');
    if (!title) return;
    n.removeAttribute('title');
    var l = label(n).toLowerCase(), t = title.toLowerCase();
    if (l.indexOf(t) === -1 && t.indexOf(l) !== 0) {
      n.dataset.tipHint = title;
      if (!n.hasAttribute('aria-description')) n.setAttribute('aria-description', title);
    }
  }

  function show(n) {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.setAttribute('role', 'tooltip');
    }
    takeTitle(n);
    tip.textContent = '';
    var line = document.createElement('span');
    line.textContent = label(n);
    var key = (n.getAttribute('aria-keyshortcuts') || '').split(' ')[0];
    if (key) {
      var kbd = document.createElement('kbd');
      kbd.textContent = KEYS[key] || key;
      line.appendChild(kbd);
    }
    tip.appendChild(line);
    if (n.dataset.tipHint) {
      var hint = document.createElement('small');
      hint.textContent = n.dataset.tipHint;
      tip.appendChild(hint);
    }
    // A modal <dialog> sits in the top layer, so the tooltip has to live inside it to show.
    var host = n.closest('dialog[open]') || document.body;
    if (tip.parentNode !== host) host.appendChild(tip);
    tip.hidden = false;
    current = n;
    pending = null;
    place(n);
  }

  function place(n) {
    var r = n.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight, gap = 6, edge = 8;
    var top = r.top - h - gap;
    if (top < edge) top = r.bottom + gap;
    var left = Math.max(edge, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - edge));
    tip.style.top = Math.round(top) + 'px';
    tip.style.left = Math.round(left) + 'px';
  }

  function hide() {
    clearTimeout(timer);
    current = pending = null;
    if (tip) tip.hidden = true;
  }

  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse') return;
    var n = target(e);
    if (n && (n === current || n === pending)) return;
    hide();
    if (!n) return;
    takeTitle(n); // before the browser's own tooltip timer starts
    pending = n;
    timer = setTimeout(function () { if (pending === n && n.isConnected) show(n); }, 400);
  });
  document.addEventListener('pointerout', function (e) { if (!e.relatedTarget) hide(); });
  document.addEventListener('focusin', function (e) {
    var n = target(e);
    if (n && n.matches(':focus-visible')) { clearTimeout(timer); show(n); }
    else hide();
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); }, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
