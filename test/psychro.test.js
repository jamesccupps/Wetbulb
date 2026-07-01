'use strict';

// Zero-dependency test suite for the psychrometric core.
// Run with:  node --test   (Node 18+; node:test is built in)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/psychro.js');

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${a} ≈ ${b} (±${tol})`);

test('Stull (2011) worked example: 20 °C / 50 % RH ≈ 13.7 °C', () => {
  close(P.wetBulbStull(20, 50), 13.7, 0.05, 'Stull reference');
});

test('bisection wet bulb at 35 °C / 50 % RH ≈ 26.2 °C', () => {
  close(P.wetBulb(35, 50, 1013.25, P.dewpoint(35, 50)), 26.2, 0.2, 'accepted value');
});

test('wet bulb is bracketed by dew point and dry bulb across a wide grid', () => {
  for (let Tc = -20; Tc <= 50; Tc += 5) {
    for (let RH = 1; RH <= 100; RH += 7) {
      const td = P.dewpoint(Tc, RH);
      const wb = P.wetBulb(Tc, RH, 1013.25, td);
      assert.ok(Number.isFinite(wb), `wb finite at ${Tc}/${RH}`);
      assert.ok(wb <= Tc + 1e-6, `wb ≤ dry bulb at ${Tc}/${RH}`);
      assert.ok(wb >= td - 1e-6, `wb ≥ dew point at ${Tc}/${RH}`);
    }
  }
});

test('psychro and Stull agree within ~1 °C over Stull\'s valid range', () => {
  // A coefficient typo in either method blows this well past 1 °C; the real
  // agreement is ~0.3 °C typical, ~0.85 °C at the grid corners.
  let maxDelta = 0;
  for (let Tc = 0; Tc <= 45; Tc += 5) {
    for (let RH = 20; RH <= 95; RH += 5) {
      const wb = P.wetBulb(Tc, RH, 1013.25, P.dewpoint(Tc, RH));
      maxDelta = Math.max(maxDelta, Math.abs(wb - P.wetBulbStull(Tc, RH)));
    }
  }
  assert.ok(maxDelta <= 1.0, `max psychro–Stull delta ${maxDelta.toFixed(3)} °C`);
});

test('RH ≥ 100 % returns dry bulb exactly (no discontinuity artifact)', () => {
  assert.equal(P.wetBulb(25, 100, 1013.25, 25), 25);
  assert.equal(P.wetBulb(30, 101, 1013.25, 30), 30);
});

test('low-RH re-bracket branch stays physical (45 °C / 5 % RH)', () => {
  const td = P.dewpoint(45, 5);
  const wb = P.wetBulb(45, 5, 1013.25, td);
  assert.ok(Number.isFinite(wb));
  assert.ok(wb < 45 && wb > td, `dew ${td.toFixed(2)} < wb ${wb.toFixed(2)} < 45`);
});

test('wet bulb rises monotonically with RH at fixed temperature', () => {
  let prev = -Infinity;
  for (let RH = 5; RH <= 99; RH += 2) {
    const wb = P.wetBulb(30, RH, 1013.25, P.dewpoint(30, RH));
    assert.ok(wb >= prev - 1e-9, `monotonic at RH=${RH}`);
    prev = wb;
  }
});

test('lower station pressure lowers wet bulb (altitude effect)', () => {
  const seaLevel = P.wetBulb(35, 50, 1013.25, P.dewpoint(35, 50));
  const denver = P.wetBulb(35, 50, 840, P.dewpoint(35, 50));
  assert.ok(denver < seaLevel, `denver ${denver.toFixed(2)} < sea ${seaLevel.toFixed(2)}`);
});

test('missing/invalid pressure falls back to sea level, not NaN', () => {
  const ref = P.wetBulb(28, 60, 1013.25, P.dewpoint(28, 60));
  close(P.wetBulb(28, 60, null, P.dewpoint(28, 60)), ref, 1e-9, 'null P');
  close(P.wetBulb(28, 60, 0, P.dewpoint(28, 60)), ref, 1e-9, 'zero P');
});

test('dewpoint is a consistent inverse of esat, and never exceeds dry bulb', () => {
  for (let Tc = -15; Tc <= 45; Tc += 5) {
    for (let RH = 5; RH <= 99; RH += 8) {
      const td = P.dewpoint(Tc, RH);
      assert.ok(td <= Tc + 1e-9, `dew ≤ dry at ${Tc}/${RH}`);
      close(P.esat(td), P.esat(Tc) * RH / 100, 1e-6, `esat round-trip ${Tc}/${RH}`);
    }
  }
});

test('stullValid gates the published envelope', () => {
  assert.ok(P.stullValid(20, 50));
  assert.ok(!P.stullValid(20, 3));    // RH below 5
  assert.ok(!P.stullValid(20, 100));  // RH above 99
  assert.ok(!P.stullValid(60, 50));   // T above 50
  assert.ok(!P.stullValid(-30, 50));  // T below -20
});

test('shade WBGT estimate sits between wet bulb and dry bulb', () => {
  const wb = 24, db = 33;
  const w = P.wbgtShade(wb, db);
  assert.ok(w > wb && w < db, `${wb} < ${w} < ${db}`);
  close(w, 0.7 * wb + 0.3 * db, 1e-9, 'formula');
});

test('wind chill defined only for cold + windy, else null', () => {
  assert.equal(P.windChillF(60, 20), null);   // too warm
  assert.equal(P.windChillF(20, 2), null);    // too calm
  const wc = P.windChillF(20, 20);
  assert.ok(Number.isFinite(wc) && wc < 20, `wind chill ${wc} < 20 °F`);
});

test('unit conversions round-trip and handle deltas without the 32° offset', () => {
  close(P.fToC(P.cToF(21.7)), 21.7, 1e-9, 'C↔F round trip');
  close(P.deltaCToF(5), 9, 1e-9, 'a 5 °C delta is 9 °F');
  close(P.deltaFToC(9), 5, 1e-9, 'a 9 °F delta is 5 °C');
  close(P.inHgToHpa(P.hpaToInHg(1009)), 1009, 1e-6, 'hPa↔inHg round trip');
  close(P.hpaToInHg(1013.25), 29.921, 0.001, 'standard atmosphere in inHg');
});
