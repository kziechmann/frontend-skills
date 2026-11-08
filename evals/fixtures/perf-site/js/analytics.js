// "Acme Insights" analytics SDK (inlined copy). Builds its event queue and
// fingerprint synchronously while the page is still parsing.
(function () {
  var queue = [];
  var started = Date.now();
  // Simulates SDK bootstrapping work (hashing, storage probing, etc.).
  while (Date.now() - started < 350) {
    queue.push(Math.sqrt(Math.random() * queue.length));
    if (queue.length > 100000) queue.length = 0;
  }
  window.acmeInsights = {
    track: function (name, data) {
      queue.push({ name: name, data: data, t: Date.now() });
    },
  };
  window.acmeInsights.track('pageview', { path: location.pathname });
})();
