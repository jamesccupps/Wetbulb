'use strict';

// Geocoder result selection. Fixtures are real Open-Meteo geocoding responses
// (count=10), trimmed to the fields the selector reads, so the API's own
// candidate order is what is under test — including the orders that broke 1.1.0.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geo.js');
const FX = require('./fixtures/geocode.json');

function pick(fixture, query) {
  const r = G.pickResult(FX[fixture], G.parseQuery(query).qualifier);
  return r && `${r.name}|${r.admin1}|${r.country_code}`;
}

test('parseQuery splits name and qualifier', () => {
  assert.deepEqual(G.parseQuery('Portland, ME'), { name: 'Portland', qualifier: 'ME' });
  assert.deepEqual(G.parseQuery('  Portland  '), { name: 'Portland', qualifier: '' });
  assert.deepEqual(G.parseQuery('Portland , Maine , USA'), { name: 'Portland', qualifier: 'Maine' });
});

test('USPS state codes resolve to that state, not a substring hit', () => {
  // Each of these resolved somewhere else in 1.1.0.
  assert.equal(pick('Scarborough', 'Scarborough, ME'), 'Scarborough|Maine|US');   // was St Kitts & Nevis
  assert.equal(pick('Portland', 'Portland, ME'), 'Portland|Maine|US');            // was Portland, Oregon
  assert.equal(pick('Augusta', 'Augusta, GA'), 'Augusta|Georgia|US');             // was Augusta, Michigan
  assert.equal(pick('KansasCity', 'Kansas City, KS'), 'Kansas City|Kansas|US');   // was Kansas City, Missouri
});

test('state codes that already worked keep working', () => {
  assert.equal(pick('Portland', 'Portland, OR'), 'Portland|Oregon|US');
  assert.equal(pick('Augusta', 'Augusta, ME'), 'Augusta|Maine|US');
  assert.equal(pick('KansasCity', 'Kansas City, MO'), 'Kansas City|Missouri|US');
  assert.equal(pick('Austin', 'Austin, TX'), 'Austin|Texas|US');
  assert.equal(pick('Washington', 'Washington, DC'), 'Washington D.C.|District of Columbia|US');
});

test('qualifier is case-, space- and period-insensitive', () => {
  assert.equal(pick('Portland', 'Portland, me'), 'Portland|Maine|US');
  assert.equal(pick('Portland', 'Portland, Me.'), 'Portland|Maine|US');
  assert.equal(pick('Washington', 'Washington, D.C.'), 'Washington D.C.|District of Columbia|US');
});

test('full state / province / country names match whole-field', () => {
  assert.equal(pick('Portland', 'Portland, Maine'), 'Portland|Maine|US');
  assert.equal(pick('Toronto', 'Toronto, Ontario'), 'Toronto|Ontario|CA');
  assert.equal(pick('London', 'London, United Kingdom'), 'London|England|GB');
  assert.equal(pick('London', 'London, England'), 'London|England|GB');
  assert.equal(pick('Sydney', 'Sydney, Australia'), 'Sydney|New South Wales|AU');
});

test('a state code wins over the same ISO country code, then falls through', () => {
  // CA is California first...
  assert.equal(pick('London', 'London, CA'), 'London|California|US');
  // ...but with no Toronto in California, the country tier reaches Canada.
  assert.equal(pick('Toronto', 'Toronto, CA'), 'Toronto|Ontario|CA');
});

test('ISO country codes and common aliases', () => {
  assert.equal(pick('London', 'London, GB'), 'London|England|GB');
  assert.equal(pick('London', 'London, UK'), 'London|England|GB');
  assert.equal(pick('Sydney', 'Sydney, AU'), 'Sydney|New South Wales|AU');
  assert.equal(pick('Portland', 'Portland, USA'), 'Portland|Oregon|US');
});

test('name prefixes of 3+ letters match; shorter unknown codes do not', () => {
  assert.equal(pick('Toronto', 'Toronto, Ont'), 'Toronto|Ontario|CA');
  assert.equal(pick('Portland', 'Portland, Conn'), 'Portland|Connecticut|US');
  assert.equal(pick('Portland', 'Portland, ZZ'), null);
});

test('an unmatched qualifier returns null instead of guessing', () => {
  assert.equal(pick('Scarborough', 'Scarborough, Atlantis'), null);
  // Known tradeoff, pinned so it is a decision rather than an accident: a
  // non-US regional abbreviation is not expanded. 1.1.0 "got" this one only
  // because its fallback happened to be the API's first result.
  assert.equal(pick('Sydney', 'Sydney, NSW'), null);
});

test('no qualifier: US first, then population (unchanged from 1.1.0)', () => {
  assert.equal(pick('Scarborough', 'Scarborough'), 'Scarborough|Maine|US');
  assert.equal(pick('Portland', 'Portland'), 'Portland|Oregon|US');
  assert.equal(pick('Washington', 'Washington'), 'Washington D.C.|District of Columbia|US');
  assert.equal(pick('London', 'London'), 'London|Ohio|US');
});

test('empty or missing results return null', () => {
  assert.equal(G.pickResult([], 'ME'), null);
  assert.equal(G.pickResult(undefined, ''), null);
});

test('qualifier lookup ignores prototype keys', () => {
  assert.equal(pick('Portland', 'Portland, constructor'), null);
  assert.equal(pick('Portland', 'Portland, __proto__'), null);
});

test('state table covers the 50 states + DC with unique names', () => {
  const codes = Object.keys(G.US_STATES);
  assert.equal(codes.length, 51);
  assert.ok(codes.every(c => /^[A-Z]{2}$/.test(c)));
  assert.equal(new Set(Object.values(G.US_STATES)).size, 51);
});

// ---- reply -> place ----
// Real Zippopotam reply for 04101 (coordinates come back as strings).
const ZIP_04101 = require('./fixtures/zippopotam-04101.json');

test('validPlace wants real, in-range numbers (no coercion)', () => {
  assert.ok(G.validPlace({ lat: 43.66, lon: -70.26 }));
  assert.ok(!G.validPlace({ lat: '43.66', lon: -70.26 }));   // stringified, e.g. from storage
  assert.ok(!G.validPlace({ lat: 91, lon: 0 }));
  assert.ok(!G.validPlace({ lat: 0, lon: -181 }));
  assert.ok(!G.validPlace({ lat: NaN, lon: 0 }));
  assert.ok(!G.validPlace(null));
  assert.ok(!G.validPlace('43.66,-70.26'));
});

test('placeFromZip reads a real Zippopotam reply', () => {
  assert.deepEqual(G.placeFromZip(ZIP_04101, '04101'),
    { lat: 43.6606, lon: -70.2589, name: 'Portland, ME', detail: 'ZIP 04101' });
});

test('placeFromZip rejects replies without a usable place', () => {
  // Each of these used to throw a raw TypeError or send latitude=NaN onward.
  const withPlace = p => ({ places: [Object.assign({}, ZIP_04101.places[0], p)] });
  assert.equal(G.placeFromZip({}, '04101'), null);                       // Zippopotam's 404 body
  assert.equal(G.placeFromZip({ places: [] }, '04101'), null);
  assert.equal(G.placeFromZip({ places: [null] }, '04101'), null);
  assert.equal(G.placeFromZip(null, '04101'), null);
  assert.equal(G.placeFromZip('<html>', '04101'), null);
  assert.equal(G.placeFromZip(withPlace({ latitude: 'n/a' }), '04101'), null);
  assert.equal(G.placeFromZip(withPlace({ latitude: '' }), '04101'), null);      // Number('') is 0
  assert.equal(G.placeFromZip(withPlace({ latitude: '43.66abc' }), '04101'), null);
  assert.equal(G.placeFromZip(withPlace({ latitude: '143.6' }), '04101'), null);
});

test('placeFromZip falls back to the ZIP when the reply has no names', () => {
  const r = G.placeFromZip({ places: [{ latitude: '43.6606', longitude: '-70.2589' }] }, '04101');
  assert.equal(r.name, 'ZIP 04101');
});

test('placeFromResult builds the UI label from a real geocoder result', () => {
  const maine = FX.Portland.find(r => r.admin1 === 'Maine');
  assert.deepEqual(G.placeFromResult(maine),
    { lat: maine.latitude, lon: maine.longitude, name: 'Portland, Maine', detail: 'United States' });
  const london = FX.London.find(r => r.country_code === 'GB');
  assert.equal(G.placeFromResult(london).name, 'London, England (GB)');
});

test('placeFromResult rejects results without a name or usable coordinates', () => {
  const maine = FX.Portland.find(r => r.admin1 === 'Maine');
  assert.equal(G.placeFromResult(Object.assign({}, maine, { latitude: undefined })), null);
  assert.equal(G.placeFromResult(Object.assign({}, maine, { latitude: '43.65' })), null);
  assert.equal(G.placeFromResult(Object.assign({}, maine, { name: '' })), null);
  assert.equal(G.placeFromResult(null), null);
});

test('pickResult skips entries that are not objects', () => {
  const res = [null, 'junk', ...FX.Portland];
  assert.equal(pickFrom(res, 'ME'), 'Portland|Maine|US');
  assert.equal(G.pickResult([null, 7], ''), null);
  assert.equal(G.pickResult({ not: 'an array' }, ''), null);
});

function pickFrom(results, qualifier) {
  const r = G.pickResult(results, qualifier);
  return r && `${r.name}|${r.admin1}|${r.country_code}`;
}
