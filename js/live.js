/*!
 * live.js — live-data plumbing for the Wet-Bulb Calculator: the saved last
 * reading that a return visit shows at once.
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
    READING_MAX_AGE_MS: READING_MAX_AGE_MS,
    packReading: packReading,
    usableReading: usableReading
  };
});
