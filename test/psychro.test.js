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

test('psychro and Stull agree within ~1 °C over ordinary conditions', () => {
  // A coefficient typo in either method blows this well past 1 °C. Note this
  // grid is deliberately narrower than stullValid()'s envelope — see the
  // cold-and-dry test below for what happens at the true corners.
  let maxDelta = 0;
  for (let Tc = 0; Tc <= 45; Tc += 5) {
    for (let RH = 20; RH <= 95; RH += 5) {
      const wb = P.wetBulb(Tc, RH, 1013.25, P.dewpoint(Tc, RH));
      maxDelta = Math.max(maxDelta, Math.abs(wb - P.wetBulbStull(Tc, RH)));
    }
  }
  assert.ok(maxDelta <= 1.0, `max psychro–Stull delta ${maxDelta.toFixed(3)} °C`);
});

test('Stull divergence is pinned across the whole envelope stullValid() admits', () => {
  // The 1 °C bound above is measured on a grid that never reaches the cold, dry
  // corner — but stullValid() returns true there, so the app will happily show a
  // cross-check Δ at −20 °C / 5 % RH. That Δ is ~4 °C, not ~0.85 °C. Pin the real
  // number so the envelope and the tolerance can never silently drift apart.
  let maxDelta = 0, at = null;
  for (let Tc = -20; Tc <= 50; Tc += 1) {
    for (let RH = 5; RH <= 99; RH += 1) {
      if (!P.stullValid(Tc, RH)) continue;
      const d = Math.abs(P.wetBulb(Tc, RH, 1013.25, P.dewpoint(Tc, RH)) - P.wetBulbStull(Tc, RH));
      if (d > maxDelta) { maxDelta = d; at = `${Tc} °C / ${RH} %`; }
    }
  }
  assert.ok(maxDelta <= 4.2, `envelope-wide max delta ${maxDelta.toFixed(2)} °C at ${at}`);
  // And it really is the cold/dry corner that drives it, not a coefficient slip
  // somewhere in the middle of the range.
  assert.ok(maxDelta >= 3.5, `expected the cold/dry corner to dominate, got ${maxDelta.toFixed(2)} °C`);
  assert.equal(at, '-20 °C / 5 %');
});

test('Stull stays close to psychro wherever it is warm or humid', () => {
  // The practical envelope for HVAC/cooling-tower work. Divergence is confined
  // to cold + very dry air; anywhere a tower is running, the fits track well.
  let maxDelta = 0, at = null;
  for (let Tc = 5; Tc <= 50; Tc += 1) {
    for (let RH = 15; RH <= 99; RH += 1) {
      const d = Math.abs(P.wetBulb(Tc, RH, 1013.25, P.dewpoint(Tc, RH)) - P.wetBulbStull(Tc, RH));
      if (d > maxDelta) { maxDelta = d; at = `${Tc} °C / ${RH} %`; }
    }
  }
  assert.ok(maxDelta <= 1.0, `warm/humid max delta ${maxDelta.toFixed(3)} °C at ${at}`);
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

test('heatStress returns a label + level slug, and no presentation detail', () => {
  const bands = [[20, 'low'], [27, 'caution'], [30, 'high'], [33, 'extreme'], [36, 'limit']];
  for (const [wb, level] of bands) {
    const s = P.heatStress(wb);
    assert.equal(s.level, level, `band at ${wb} °C`);
    assert.ok(typeof s.t === 'string' && s.t.length, `label at ${wb} °C`);
    // The core is imported by Node and must not leak colors into the UI layer;
    // a hardcoded hex here is what broke light-theme contrast in 1.0.0.
    assert.ok(!('c' in s), `no color key at ${wb} °C`);
  }
});

test('heatStress bands are contiguous and ordered across the edges', () => {
  const order = ['low', 'caution', 'high', 'extreme', 'limit'];
  let prev = 0;
  for (let wb = 15; wb <= 40; wb += 0.25) {
    const i = order.indexOf(P.heatStress(wb).level);
    assert.ok(i >= 0, `known level at ${wb} °C`);
    assert.ok(i >= prev, `never steps back down at ${wb} °C`);
    prev = i;
  }
  assert.equal(P.heatStress(25.99).level, 'low');
  assert.equal(P.heatStress(26).level, 'caution');
  assert.equal(P.heatStress(34.99).level, 'extreme');
  assert.equal(P.heatStress(35).level, 'limit');   // Sherwood & Huber (2010)
});

test('shade WBGT estimate sits between wet bulb and dry bulb', () => {
  const wb = 24, db = 33;
  const w = P.wbgtShade(wb, db);
  assert.ok(w > wb && w < db, `${wb} < ${w} < ${db}`);
  close(w, 0.7 * wb + 0.3 * db, 1e-9, 'formula');
});

test('unit conversions round-trip and handle deltas without the 32° offset', () => {
  close(P.fToC(P.cToF(21.7)), 21.7, 1e-9, 'C↔F round trip');
  close(P.deltaCToF(5), 9, 1e-9, 'a 5 °C delta is 9 °F');
  close(P.deltaFToC(9), 5, 1e-9, 'a 9 °F delta is 5 °C');
  close(P.inHgToHpa(P.hpaToInHg(1009)), 1009, 1e-6, 'hPa↔inHg round trip');
  close(P.hpaToInHg(1013.25), 29.921, 0.001, 'standard atmosphere in inHg');
});
