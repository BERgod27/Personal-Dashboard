/*
 * News module: adapter for the <news-panel> in modules/news/.
 * Headlines come from /api/news: the hosted server (server/server.mjs) online, or the
 * news helper (node modules/news/server.mjs) on http://localhost:8787 when run locally.
 */
(function () {
  'use strict';
  var mounted = null;

  Dashboard.registerModule({
    id: 'news',
    title: 'News',
    category: 'personal',
    order: 15,
    render: function (el) {
      if (mounted === el) return;
      mounted = el;
      var url = new URL('modules/news/news-panel.js', document.baseURI).href;
      import(url).then(function (mod) {
        // Online (server/server.mjs) the same server answers /api/news; locally it is the news helper.
        var api = window.PDOnline ? location.origin : 'http://localhost:8787';
        mod.mount(el, { api: api, compact: true, limit: 20 });
      }).catch(function () {
        Dashboard.placeholder(el, {
          status: 'Needs the local helper',
          summary: 'World and Portugal headlines. Open the dashboard through a local server and start the news helper:',
          planned: ['cd personal-dashboard/modules/news', 'node server.mjs']
        });
      });
    }
  });
})();
