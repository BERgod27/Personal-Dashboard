/*
 * News module: adapter for the <news-panel> in modules/news/.
 * Headlines come from modules/news/server.mjs (node server.mjs), which must be
 * running on this computer at http://localhost:8787.
 */
(function () {
  'use strict';
  var mounted = null;

  Dashboard.registerModule({
    id: 'news',
    title: 'News',
    category: 'personal',
    order: 15,
    ownTitle: true,
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
        title: 'News',
          status: 'Needs the local helper',
          summary: 'World and Portugal headlines. Open the dashboard through a local server and start the news helper:',
          planned: ['cd personal-dashboard/modules/news', 'node server.mjs']
        });
      });
    }
  });
})();
