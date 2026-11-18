'use strict';

// live.js: the saved last reading.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/live.js');

const KEY = '43.6574,-70.2589';
const NOW = Date.UTC(2026, 10, 18, 15, 0);
const W = {
  latitude: 43.65, longitude: -70.26,
  current: { time: '2026-11-18T10:00', temperature_2m: 5.1, relative_humidity_2m: 71, dew_point_2m: 0.2 },
  hourly: { time: [], temperature_2m: [], relative_humidity_2m: [] }
};
const saved = (over, at) => Object.assign(L.packReading(KEY, W, at == null ? NOW - 60e3 : at), over);

test('a recent reading for the same place is used', () => {
  const s = saved();
  assert.equal(L.usableReading(s, KEY, NOW), s);
  assert.equal(L.usableReading(saved({}, NOW - L.READING_MAX_AGE_MS), KEY, NOW).key, KEY);   // exactly at the limit
});

test('a reading for another place is not used', () => {
  assert.equal(L.usableReading(saved(), '43.5800,-70.3300', NOW), null);
});

test('a reading older than the limit, or dated in the future, is not used', () => {
  assert.equal(L.usableReading(saved({}, NOW - L.READING_MAX_AGE_MS - 1), KEY, NOW), null);
  assert.equal(L.usableReading(saved({}, NOW + 60e3), KEY, NOW), null);
  assert.equal(L.READING_MAX_AGE_MS, 6 * 3600 * 1000);
});

test('anything without the fields the page renders is not used', () => {
  const withW = w => saved({ w });
  assert.equal(L.usableReading(null, KEY, NOW), null);
  assert.equal(L.usableReading('oops', KEY, NOW), null);
  assert.equal(L.usableReading(saved({ at: '1700000000000' }), KEY, NOW), null);
  assert.equal(L.usableReading(withW(null), KEY, NOW), null);
  assert.equal(L.usableReading(withW({ ...W, current: null }), KEY, NOW), null);
  assert.equal(L.usableReading(withW({ ...W, current: { ...W.current, temperature_2m: null } }), KEY, NOW), null);
  assert.equal(L.usableReading(withW({ ...W, current: { ...W.current, relative_humidity_2m: '71' } }), KEY, NOW), null);
  assert.equal(L.usableReading(withW({ ...W, latitude: undefined }), KEY, NOW), null);
});
