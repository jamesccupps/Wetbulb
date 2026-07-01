/*!
 * psychro.js — pure psychrometric core for the Wet-Bulb Calculator.
 *
 * Zero dependencies. Loads as a classic <script> in the browser (exposes
 * window.Psychro) AND as a CommonJS module in Node (module.exports), so the
 * exact same source is unit-tested without a build step.
 *
 * All temperatures are °C and all pressures hPa unless a name says otherwise.
 *
 * References:
 *   Alduchov & Eskridge (1996), J. Appl. Meteor. 35(4), 601–609  — saturation vapor pressure
 *   Stull, R. (2011),  J. Appl. Meteor. Climatol. 50(11), 2267–2269 — empirical wet-bulb
 *   Sherwood & Huber (2010), PNAS 107(21), 9552–9555 — ~35 °C wet-bulb survivability limit
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Psychro = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- saturation & dew point ---------- */

  // Saturation vapor pressure over water (hPa), Alduchov–Eskridge (1996).
  // Water phase (supercooled below 0 °C) is intentional: it keeps esat, the
  // dew-point inverse, and the wet-bulb solve on one phase and consistent with
  // Open-Meteo's over-water dew point. Do NOT add an ice branch here.
  function esat(Tc) { return 6.1094 * Math.exp(17.625 * Tc / (243.04 + Tc)); }

  // Dew point (°C) from temperature + RH — exact inverse of esat().
  function dewpoint(Tc, RH) {
    if (RH <= 0) return -100;
    var a = 17.625, b = 243.04;
    var g = Math.log(RH / 100) + a * Tc / (b + Tc);
    return b * g / (a - g);
  }

  /* ---------- wet bulb ---------- */

  // Pressure-corrected wet-bulb via bisection on the psychrometric equation:
  //   e = es(Tw) − γ·(T − Tw),  γ = 6.65e-4 · P  (hPa/°C, the standard
  //   0.665e-3·P[kPa] aspirated-psychrometer constant).
  // Wet bulb lies between dew point and dry bulb, so the root is bracketed and
  // bisection always converges. Runs the full solve up to (but not at) 100 % RH
  // to avoid a discontinuity at saturation.
  function wetBulb(Tc, RH, P_hPa, Tdew) {
    if (!isFinite(P_hPa) || P_hPa <= 0) P_hPa = 1013.25;
    if (RH >= 100) return Tc;
    var e = esat(Tc) * RH / 100;
    var gamma = 6.65e-4 * P_hPa;
    var lo = isFinite(Tdew) ? Tdew : Tc - 30;
    var hi = Tc;
    var f = function (Tw) { return esat(Tw) - gamma * (Tc - Tw) - e; };
    if (f(lo) > 0) lo = Tc - 60;            // widen bracket at very low RH
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (f(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Stull (2011) empirical fit — a fast, sea-level cross-check only.
  // Valid RH 5–99 %, T −20..50 °C; carries no pressure term.
  function wetBulbStull(Tc, RH) {
    return Tc * Math.atan(0.151977 * Math.sqrt(RH + 8.313659))
         + Math.atan(Tc + RH)
         - Math.atan(RH - 1.676331)
         + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH)
         - 4.686035;
  }

  // Is the Stull fit inside its published validity envelope for these inputs?
  function stullValid(Tc, RH) {
    return RH >= 5 && RH <= 99 && Tc >= -20 && Tc <= 50;
  }

  /* ---------- heat / cold stress ---------- */

  // Ambient wet-bulb heat-stress screening bands (°C wet-bulb). Note these are
  // a *wet-bulb* scale, not WBGT; the caller must label them as such.
  function heatStress(wbC) {
    if (wbC < 26) return { t: 'Low risk', c: 'var(--good)' };
    if (wbC < 29) return { t: 'Caution', c: '#a3e635' };
    if (wbC < 31) return { t: 'High risk', c: 'var(--warn)' };
    if (wbC < 35) return { t: 'Extreme', c: '#fb923c' };
    return { t: 'Survivability limit', c: 'var(--danger)' };
  }

  // Estimated *shade / no-solar* WBGT ≈ 0.7·Tnwb + 0.3·Tdb, approximating the
  // natural wet-bulb by the psychrometric wet-bulb. This is an unofficial
  // estimate: it is NOT valid in direct sun (which adds a globe-temperature
  // load, typically several °C higher) and is not a compliance measurement.
  function wbgtShade(wbC, dbC) { return 0.7 * wbC + 0.3 * dbC; }

  // NWS wind chill (°F, wind in mph). Defined only for T ≤ 50 °F and wind > 3 mph.
  function windChillF(Tf, mph) {
    if (!isFinite(Tf) || !isFinite(mph) || Tf > 50 || mph <= 3) return null;
    var w = Math.pow(mph, 0.16);
    return 35.74 + 0.6215 * Tf - 35.75 * w + 0.4275 * Tf * w;
  }

  /* ---------- unit conversions ---------- */

  function cToF(c) { return c * 9 / 5 + 32; }
  function fToC(f) { return (f - 32) * 5 / 9; }
  function deltaCToF(d) { return d * 9 / 5; }     // convert a temperature DELTA
  function deltaFToC(d) { return d * 5 / 9; }
  // 1 inHg = 33.8638815789 hPa (0 °C, standard gravity); derive the inverse
  // from the same constant so the two conversions round-trip exactly.
  function hpaToInHg(h) { return h / 33.8638815789; }
  function inHgToHpa(i) { return i * 33.8638815789; }

  return {
    esat: esat,
    dewpoint: dewpoint,
    wetBulb: wetBulb,
    wetBulbStull: wetBulbStull,
    stullValid: stullValid,
    heatStress: heatStress,
    wbgtShade: wbgtShade,
    windChillF: windChillF,
    cToF: cToF,
    fToC: fToC,
    deltaCToF: deltaCToF,
    deltaFToC: deltaFToC,
    hpaToInHg: hpaToInHg,
    inHgToHpa: inHgToHpa
  };
});
