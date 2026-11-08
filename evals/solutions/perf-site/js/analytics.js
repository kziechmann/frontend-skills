// "Acme Insights" analytics SDK (inlined copy). Bootstrapping now runs when the
// browser is idle and in small slices, so it never blocks rendering or input.
(function () {
  var queue = [];
  window.acmeInsights = {
    track: function (name, data) {
      queue.push({ name: name, data: data, t: Date.now() });
    },
  };
  var idle = window.requestIdleCallback || function (cb) { return setTimeout(function () { cb({ timeRemaining: function () { return 8; } }); }, 1); };
  var remainingMs = 350;
  function bootstrap(deadline) {
    var sliceStart = Date.now();
    var budget = Math.min(deadline.timeRemaining(), 8);
    while (Date.now() - sliceStart < budget && remainingMs > 0) {
      queue.push(Math.sqrt(Math.random() * queue.length));
      if (queue.length > 100000) queue.length = 0;
    }
    remainingMs -= Date.now() - sliceStart;
    if (remainingMs > 0) idle(bootstrap);
  }
  idle(bootstrap);
  window.acmeInsights.track('pageview', { path: location.pathname });
})();
