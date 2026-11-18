/*!
 * live.js — live-data plumbing for the Wet-Bulb Calculator: fetching JSON
 * with a hedged retry inside one time budget, and the saved last reading that
 * a return visit shows at once.
 *
 * Pure and dependency-free, UMD like psychro.js and geo.js, so the same source
 * runs in the browser (window.Live) and under node:test.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Live = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isObj(x) { return !!x && typeof x === 'object'; }
  function finiteNum(v) { return typeof v === 'number' && isFinite(v); }

  /* ---------- fetching ---------- */

  var HEDGE_MS = 4000;     // no reply by then: start a second attempt alongside
  var BUDGET_MS = 12000;   // one budget for a whole lookup + weather chain

  function namedError(name, msg) { var e = new Error(msg); e.name = name; return e; }

  // GET url and parse the body as JSON, hedged and inside a deadline.
  //
  // A stalled connection is the failure that makes the page look stuck, and a
  // fresh connection usually fixes it. So when the first attempt has no reply
  // after hedgeMs, a second starts *alongside* it and the first good answer
  // wins. A plain "time out at 5 s, then retry" would instead keep cutting off
  // a link that is merely slow (6 s every time on weak cellular) and never
  // finish. A failure a retry can fix -- network error, 5xx -- retries at once
  // instead of waiting for the hedge. A 4xx is never retried: a 429 repeated
  // straight away is just another 429. Never more than two attempts.
  //
  // The deadline covers the body read too, and is shared with whatever the
  // caller does next (lookup then weather) via o.deadline.
  //
  // Resolves { status, ok, json } -- json is undefined if the body isn't JSON.
  // Rejects with name 'AbortError' when o.signal aborts (superseded: show
  // nothing), 'TimeoutError' at the deadline, or the last network error.
  function getJson(fetchFn, url, o) {
    o = o || {};
    var hedgeMs = o.hedgeMs != null ? o.hedgeMs : HEDGE_MS;
    var deadline = o.deadline != null ? o.deadline : Date.now() + BUDGET_MS;
    var outer = o.signal;
    return new Promise(function (resolve, reject) {
      var ctrls = [], started = 0, pending = 0, settled = false;
      var lastRes = null, lastErr = null, hedgeTimer = null, deadTimer = null;

      function finish(fn, v) {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer); clearTimeout(deadTimer);
        if (outer) outer.removeEventListener('abort', onOuterAbort);
        ctrls.forEach(function (c) { c.abort(); });
        fn(v);
      }
      function onOuterAbort() { finish(reject, namedError('AbortError', 'Aborted')); }

      function attemptDone(res, err) {
        pending--;
        if (settled) return;
        // Attempts are only aborted by finish(), so any error seen here is a
        // real failure of that attempt (network, unreadable stream).
        var retryable = err ? true : res.status >= 500;
        if (!retryable) return finish(resolve, res);
        if (err) lastErr = err; else lastRes = res;
        if (started < 2) return launch();     // failed fast: retry now, not at the hedge
        if (pending > 0) return;              // the other attempt may still come good
        if (lastRes) return finish(resolve, lastRes);
        finish(reject, lastErr);
      }

      function launch() {
        if (settled || started >= 2) return;
        started++; pending++;
        clearTimeout(hedgeTimer);
        var c = new AbortController();
        ctrls.push(c);
        Promise.resolve().then(function () { return fetchFn(url, { signal: c.signal }); })
          .then(function (r) {
            return r.json().then(
              function (j) { return { status: r.status, ok: r.ok, json: j }; },
              function (e) {
                if (e && e.name === 'AbortError') throw e;
                return { status: r.status, ok: r.ok, json: undefined };
              });
          })
          .then(function (res) { attemptDone(res, null); }, function (e) { attemptDone(null, e || new Error('Request failed')); });
        if (started < 2) hedgeTimer = setTimeout(launch, hedgeMs);
      }

      if (outer && outer.aborted) return reject(namedError('AbortError', 'Aborted'));
      var left = deadline - Date.now();
      if (left <= 0) return reject(namedError('TimeoutError', 'Timed out'));
      if (outer) outer.addEventListener('abort', onOuterAbort);
      deadTimer = setTimeout(function () { finish(reject, namedError('TimeoutError', 'Timed out')); }, left);
      launch();
    });
  }

  /* ---------- saved last reading ---------- */

  // Older than this, the day's swing makes a reading misleading even with its
  // time printed beside it, so it is not shown at all.
  var READING_MAX_AGE_MS = 6 * 3600 * 1000;

  // What is stored: the weather reply as received, the place it belongs to
  // (the caller's place key) and when it was fetched.
  function packReading(key, w, now) { return { key: key, at: now, w: w }; }

  // The saved reading if it belongs to `key`, is at most READING_MAX_AGE_MS old
  // and still has what the renderer reads; otherwise null. Storage is shared by
  // every site on the origin and can hold anything, and a future-dated `at`
  // (clock change) is refused rather than shown as brand new.
  function usableReading(saved, key, now) {
    if (!isObj(saved) || saved.key !== key || !finiteNum(saved.at)) return null;
    var age = now - saved.at;
    if (age < 0 || age > READING_MAX_AGE_MS) return null;
    var w = saved.w;
    if (!isObj(w) || !isObj(w.current)) return null;
    if (!finiteNum(w.current.temperature_2m) || !finiteNum(w.current.relative_humidity_2m)) return null;
    if (!finiteNum(w.latitude) || !finiteNum(w.longitude)) return null;
    return saved;
  }

  return {
    HEDGE_MS: HEDGE_MS,
    BUDGET_MS: BUDGET_MS,
    getJson: getJson,
    READING_MAX_AGE_MS: READING_MAX_AGE_MS,
    packReading: packReading,
    usableReading: usableReading
  };
});
