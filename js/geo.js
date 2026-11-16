/*!
 * geo.js — geocoder result selection for the Wet-Bulb Calculator.
 *
 * Pure and dependency-free, UMD like psychro.js so the same source runs in the
 * browser (window.Geo) and under node:test. The network calls stay in app.js;
 * this decides which of the geocoder's candidates "Portland, ME" means, and
 * whether a reply holds a usable place at all.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // USPS code -> the admin1 name Open-Meteo returns (GeoNames). Territories are
  // absent on purpose: GeoNames gives PR, GU, VI, AS and MP their own country
  // codes, so the country-code tier already resolves "San Juan, PR".
  var US_STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
    MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
    OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
    TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
  };

  // Everyday names for a country that are not its ISO 3166 code.
  var COUNTRY_ALIASES = { UK: 'GB', USA: 'US' };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function norm(s) { return String(s == null ? '' : s).replace(/\./g, '').trim().toUpperCase(); }
  function isObj(x) { return !!x && typeof x === 'object'; }
  function isText(s) { return typeof s === 'string' && s.trim() !== ''; }
  function finiteNum(v) { return typeof v === 'number' && isFinite(v); }
  // Strict string -> number: Number('') is 0 and parseFloat('43abc') is 43,
  // both of which would put a wrong place on the map instead of failing.
  function toNum(v) { return typeof v === 'number' ? v : (isText(v) ? Number(v) : NaN); }

  // A place is only usable if lat/lon are real numbers in range. isFinite()
  // alone is not enough: it coerces, so a stringified "43.66" out of
  // localStorage would pass and then throw in placeKey()'s toFixed().
  function validPlace(p) {
    return isObj(p) && finiteNum(p.lat) && finiteNum(p.lon) &&
      p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180;
  }

  // Zippopotam reply -> place, or null when it holds no usable one. Its
  // coordinates arrive as strings ("43.6606"). Unchecked, a reply without
  // `places` surfaced as a raw TypeError and a non-numeric latitude went out
  // to the weather service as latitude=NaN.
  function placeFromZip(j, zip) {
    var p = isObj(j) && Array.isArray(j.places) ? j.places[0] : null;
    if (!isObj(p)) return null;
    var place = {
      lat: toNum(p.latitude), lon: toNum(p.longitude),
      name: [p['place name'], p['state abbreviation']].filter(isText).join(', ') || 'ZIP ' + zip,
      detail: 'ZIP ' + zip
    };
    return validPlace(place) ? place : null;
  }

  // Open-Meteo geocoding result -> place with the label the UI shows, or null
  // when it has no name or no usable coordinates.
  function placeFromResult(r) {
    if (!isObj(r) || !isText(r.name)) return null;
    var place = {
      lat: r.latitude, lon: r.longitude,
      name: r.name + (isText(r.admin1) ? ', ' + r.admin1 : '') +
        (isText(r.country_code) && r.country_code !== 'US' ? ' (' + r.country_code + ')' : ''),
      detail: isText(r.country) ? r.country : ''
    };
    return validPlace(place) ? place : null;
  }

  // "Portland, ME" -> { name: 'Portland', qualifier: 'ME' }. Anything after a
  // second comma is ignored.
  function parseQuery(q) {
    var parts = String(q).split(',').map(function (x) { return x.trim(); });
    return { name: parts[0], qualifier: parts[1] || '' };
  }

  // US first (the tool is US-centric), then the larger place.
  function rank(a, b) {
    var au = a.country_code === 'US' ? 0 : 1, bu = b.country_code === 'US' ? 0 : 1;
    if (au !== bu) return au - bu;
    return (b.population || 0) - (a.population || 0);
  }

  // The result the query means, or null when the qualifier matches none of the
  // candidates. Returning null rather than a best guess is deliberate: falling
  // back to the API's first result is how "Portland, ME" became Portland, Oregon.
  //
  // Every comparison is whole-field. The substring test this replaces matched
  // "ME" inside "Saint James Windward" (St Kitts) but not inside "Maine", and
  // "GA" inside "Michigan".
  //
  // Tiers run most-specific first and the first tier with any hit wins, so a
  // two-letter code is read as a US state before an ISO country: "CA" is
  // California, but "Toronto, CA" still reaches Canada because no Toronto in
  // California is among the candidates.
  function pickResult(results, qualifier) {
    results = Array.isArray(results) ? results.filter(isObj) : [];
    if (!results.length) return null;
    var q = norm(qualifier);
    if (!q) return results.slice().sort(rank)[0];
    var state = own(US_STATES, q) ? US_STATES[q].toUpperCase() : null;
    var cc = own(COUNTRY_ALIASES, q) ? COUNTRY_ALIASES[q] : q;
    var tiers = [
      function (x) { return !!state && x.country_code === 'US' && norm(x.admin1) === state; },
      function (x) { return norm(x.country_code) === cc; },
      function (x) { return norm(x.admin1) === q || norm(x.country) === q; },
      // Prefix of a state/province or country name ("Mass", "Ont"). Three letters
      // minimum so an unknown two-letter code cannot fall through to a prefix hit.
      function (x) { return q.length >= 3 && (norm(x.admin1).indexOf(q) === 0 || norm(x.country).indexOf(q) === 0); }
    ];
    for (var i = 0; i < tiers.length; i++) {
      var hit = results.filter(tiers[i]);
      if (hit.length) return hit.sort(rank)[0];
    }
    return null;
  }

  return {
    US_STATES: US_STATES,
    parseQuery: parseQuery,
    pickResult: pickResult,
    validPlace: validPlace,
    placeFromZip: placeFromZip,
    placeFromResult: placeFromResult
  };
});
