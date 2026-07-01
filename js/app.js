/* Wet-Bulb Calculator — UI layer.
   Pure psychrometrics live in psychro.js (window.Psychro); this file owns
   fetching, rendering, persistence and events. Zero dependencies. */
(function () {
'use strict';
var P = window.Psychro;

/* ---------- element cache ---------- */
var IDS = ['locInput','goBtn','gpsBtn','unitSeg','themeSeg','refreshSel','chips','recentList',
  'status','result','locName','locMeta','wxDesc','obsTime','wbBig','wbAlt','stressBadge','wbgtLine','outlook',
  'mDp','mWb','mDb','lWb','lDp','lDb','mTemp','mDew','mRh','mDep','mPres','mFeels','mWind','mElev',
  'copyBtn','shareBtn','csvBtn','methNote','chartCard','chartBox','chartNote','chartLegend',
  'towerCard','twMin','approachIn','apprUnit','designWbIn','designWbUnit','twCold','towerHint','towerMargin',
  'mTempIn','mTempUnit','mRhIn','mPresIn','manApproachIn','manApprUnit','manWb','manDew','manDep','manWbgt',
  'manMin','manCold','manBadge','manErr'];
var el = {};
IDS.forEach(function (id) { el[id] = document.getElementById(id); });

/* ---------- state ---------- */
var unit = 'F';
var current = null;      // last payload + computed values
var refreshTimer = null;
var inFlight = null;     // AbortController for the active request
var timedOut = false;

/* ---------- helpers ---------- */
function finiteNum(v) { return typeof v === 'number' && isFinite(v); }
function dC(c) { return unit === 'F' ? P.cToF(c) : c; }            // Celsius value -> display
function dDelta(c) { return unit === 'F' ? P.deltaCToF(c) : c; }   // Celsius delta -> display
function t1(c) { return finiteNum(c) ? dC(c).toFixed(1) + '°' + unit : '—'; }
function tDelta(c) { return dDelta(c).toFixed(1) + '°' + unit; }
function placeKey(p) { return p.lat.toFixed(4) + ',' + p.lon.toFixed(4); }
function shortName(n) { return (n || '').split(',')[0]; }
function slug(s) { return (s || 'location').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase(); }
function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function compass(deg) {
  if (!finiteNum(deg)) return '';
  var dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
function fmtHour(t) {
  var hh = parseInt(t.substr(11, 2), 10);
  if (isNaN(hh)) return '';
  var ap = hh < 12 ? 'AM' : 'PM', h12 = hh % 12; if (h12 === 0) h12 = 12;
  return h12 + ' ' + ap;
}
function hourLabelShort(t) {
  var hh = parseInt(t.substr(11, 2), 10);
  var ap = hh < 12 ? 'a' : 'p', h12 = hh % 12; if (h12 === 0) h12 = 12;
  return h12 + ap;
}
var WMO = {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',
  51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',
  80:'Rain showers',81:'Rain showers',82:'Violent showers',85:'Snow showers',86:'Snow showers',
  95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ hail'};

/* ---------- status (XSS-safe: text only; spinner is a real node) ---------- */
function setStatus(msg, isErr) {
  var s = el.status;
  s.classList.remove('hidden');
  s.className = 'status' + (isErr ? ' err' : '');
  s.setAttribute('aria-live', isErr ? 'assertive' : 'polite');
  s.textContent = msg;
}
function loading(msg) {
  var s = el.status;
  s.classList.remove('hidden');
  s.className = 'status';
  s.setAttribute('aria-live', 'polite');
  s.textContent = '';
  var sp = document.createElement('span'); sp.className = 'spin';
  s.appendChild(sp);
  s.appendChild(document.createTextNode(msg));
}
function hideStatus() { el.status.classList.add('hidden'); }
function showError(e) {
  var msg = (!navigator.onLine)
    ? 'You appear to be offline. The manual calculator below still works without a connection.'
    : (e && e.message ? e.message : 'Something went wrong loading the data.');
  setStatus(msg, true);
}

/* ---------- geocoding ---------- */
function geocodeZip(zip, signal) {
  return fetch('https://api.zippopotam.us/us/' + zip, { signal: signal }).then(function (r) {
    if (!r.ok) throw new Error('ZIP ' + zip + ' not found.');
    return r.json();
  }).then(function (j) {
    var p = j.places[0];
    return { lat: +p.latitude, lon: +p.longitude, name: p['place name'] + ', ' + p['state abbreviation'], detail: 'ZIP ' + zip };
  });
}
function geocodeCity(q, signal) {
  var parts = q.split(',').map(function (x) { return x.trim(); });
  var name = parts[0];
  return fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=10&language=en&format=json', { signal: signal })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.results || !j.results.length) throw new Error('No match for "' + q + '".');
      var res = j.results;
      if (parts[1]) {
        var qual = parts[1].toUpperCase();
        var filt = res.filter(function (x) {
          return (x.admin1 && x.admin1.toUpperCase().indexOf(qual) >= 0) ||
                 (x.country_code && x.country_code.toUpperCase() === qual) ||
                 (x.country && x.country.toUpperCase().indexOf(qual) >= 0);
        });
        if (filt.length) res = filt;
      } else {
        res.sort(function (a, b) {
          var au = a.country_code === 'US' ? 0 : 1, bu = b.country_code === 'US' ? 0 : 1;
          if (au !== bu) return au - bu;
          return (b.population || 0) - (a.population || 0);
        });
      }
      var p = res[0];
      var label = p.name + (p.admin1 ? ', ' + p.admin1 : '') + (p.country_code && p.country_code !== 'US' ? ' (' + p.country_code + ')' : '');
      return { lat: p.latitude, lon: p.longitude, name: label, detail: p.country || '' };
    });
}

/* ---------- weather ---------- */
function fetchWeather(lat, lon, signal) {
  var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code' +
    '&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,surface_pressure' +
    '&past_days=1&forecast_days=2&wind_speed_unit=mph&timezone=auto';
  return fetch(u, { signal: signal }).then(function (r) {
    if (!r.ok) throw new Error('Weather service error (' + r.status + ').');
    return r.json();
  });
}

function run(place) {
  if (inFlight) inFlight.abort();
  var ctrl = new AbortController();
  inFlight = ctrl;
  timedOut = false;
  var to = setTimeout(function () { timedOut = true; ctrl.abort(); }, 12000);
  loading('Fetching current conditions for ' + place.name + '…');
  return fetchWeather(place.lat, place.lon, ctrl.signal).then(function (w) {
    clearTimeout(to);
    if (ctrl.signal.aborted) return;
    computeAndRender(place, w);
  }).catch(function (e) {
    clearTimeout(to);
    if (e && e.name === 'AbortError') {
      if (timedOut) showError(new Error('Timed out contacting the weather service. Try again.'));
      return; // otherwise superseded by a newer request
    }
    showError(e);
  });
}

/* ---------- derived series (Celsius) ---------- */
function hourlyNowIndex(h, nowT) {
  var idx = 0;
  for (var i = 0; i < h.time.length; i++) { if (h.time[i] <= nowT) idx = i; else break; }
  return idx;
}
function buildSeries(w) {
  var h = w.hourly;
  if (!h || !h.time || !h.temperature_2m || !h.relative_humidity_2m) return [];
  var sp = h.surface_pressure || [], dp = h.dew_point_2m || [];
  var idx = hourlyNowIndex(h, w.current.time);
  var start = Math.max(0, idx - 23), end = Math.min(h.time.length - 1, idx + 24);
  var out = [];
  for (var i = start; i <= end; i++) {
    var tC = h.temperature_2m[i], rh = h.relative_humidity_2m[i];
    if (!finiteNum(tC) || !finiteNum(rh)) continue;
    rh = Math.max(0, Math.min(100, rh));
    var pr = finiteNum(sp[i]) ? sp[i] : 1013.25;
    var wbC = P.wetBulb(tC, rh, pr, dp[i]);
    var tdC = finiteNum(dp[i]) ? dp[i] : P.dewpoint(tC, rh);
    out.push({ time: h.time[i], tC: tC, wbC: wbC, tdC: tdC, rh: rh, pr: pr, fc: i > idx, now: i === idx });
  }
  return out;
}
function forecastPeak(series) {
  var best = null;
  series.forEach(function (p) { if (p.fc && (!best || p.wbC > best.wbC)) best = p; });
  return best;
}
function pressureTrend(w) {
  var h = w.hourly; if (!h || !h.surface_pressure) return null;
  var idx = hourlyNowIndex(h, w.current.time);
  var now = h.surface_pressure[idx], past = h.surface_pressure[idx - 3];
  if (!finiteNum(now) || !finiteNum(past)) return null;
  return now - past;                 // hPa over ~3 h
}

/* ---------- compute + render ---------- */
function computeAndRender(place, w) {
  var c = w.current;
  var Tc = c.temperature_2m, RH = c.relative_humidity_2m, Tdew = c.dew_point_2m, Pv = c.surface_pressure;
  if (!finiteNum(Tc) || !finiteNum(RH)) {
    showError(new Error('Weather service returned incomplete current conditions. The manual calculator below still works.'));
    return;
  }
  RH = Math.max(0, Math.min(100, RH));   // models can report slightly >100% at saturation
  var wbC = P.wetBulb(Tc, RH, Pv, Tdew);
  var wbStull = P.stullValid(Tc, RH) ? P.wetBulbStull(Tc, RH) : NaN;
  current = {
    place: place, w: w, Tc: Tc, RH: RH, Tdew: Tdew, P: Pv, wbC: wbC, wbStull: wbStull,
    apparent: c.apparent_temperature, windSpd: c.wind_speed_10m, windDir: c.wind_direction_10m,
    wcode: c.weather_code, elevM: w.elevation,
    series: buildSeries(w), trend: pressureTrend(w)
  };
  current.fcPeak = forecastPeak(current.series);

  // populate the per-site design wet-bulb input for this location
  var dw = loadDesignWb(place);
  el.designWbIn.value = (dw != null) ? dC(dw).toFixed(1) : '';

  render();
  hideStatus();
  saveLast(place);
  pushRecent(place);
  renderChips();
  updateURL();
}

function render() {
  if (!current) return;
  var c = current, w = c.w, cur = w.current;
  el.result.classList.remove('hidden');
  el.towerCard.classList.remove('hidden');
  el.chartCard.classList.remove('hidden');

  el.locName.textContent = c.place.name;
  el.locMeta.textContent = (c.place.detail ? c.place.detail + ' · ' : '') + w.latitude.toFixed(3) + ', ' + w.longitude.toFixed(3);
  el.wxDesc.textContent = WMO[cur.weather_code] || '—';
  el.obsTime.textContent = 'Obs ' + (cur.time ? cur.time.replace('T', ' ') : '') + ' ' + (w.timezone_abbreviation || '');

  // hero + alternate unit
  el.wbBig.textContent = t1(c.wbC);
  el.wbAlt.textContent = unit === 'F' ? c.wbC.toFixed(1) + '°C' : P.cToF(c.wbC).toFixed(1) + '°F';
  var st = P.heatStress(c.wbC);
  el.stressBadge.innerHTML = '<span class="badge" title="Ambient wet-bulb heat-stress screening" style="color:' + st.c + '">' +
    '<span class="pip" style="background:' + st.c + '"></span>' + st.t + '</span>';

  // metrics (each optional field guarded)
  el.mTemp.innerHTML = t1(c.Tc);
  el.mDew.innerHTML = t1(c.Tdew);
  el.mRh.innerHTML = Math.round(c.RH) + '<span class="u">%</span>';
  el.mDep.innerHTML = tDelta(c.Tc - c.wbC);
  if (finiteNum(c.P)) {
    var inHg = P.hpaToInHg(c.P).toFixed(2);
    var tr = trendText(c.trend);
    el.mPres.innerHTML = Math.round(c.P) + '<span class="u"> hPa · ' + inHg + ' inHg' + (tr ? ' · ' + tr : '') + '</span>';
  } else { el.mPres.innerHTML = '—'; }
  el.mFeels.innerHTML = finiteNum(cur.apparent_temperature) ? t1(cur.apparent_temperature) : '—';
  el.mWind.innerHTML = finiteNum(cur.wind_speed_10m)
    ? Math.round(cur.wind_speed_10m) + '<span class="u"> mph' + (finiteNum(cur.wind_direction_10m) ? ' ' + compass(cur.wind_direction_10m) : '') + '</span>'
    : '—';
  el.mElev.innerHTML = finiteNum(w.elevation) ? Math.round(w.elevation * 3.28084) + '<span class="u"> ft</span>' : '—';

  // scale
  var lo = finiteNum(c.Tdew) ? c.Tdew : c.wbC, hi = c.Tc, span = hi - lo;
  var pWb = (span <= 0.001) ? 50 : Math.max(2, Math.min(98, (c.wbC - lo) / span * 100));
  el.mDp.style.left = '2%'; el.mDb.style.left = '98%'; el.mWb.style.left = pWb + '%';
  el.lDp.style.left = '6%'; el.lDb.style.left = '94%'; el.lWb.style.left = pWb + '%';
  el.lWb.textContent = 'wet bulb ' + dC(c.wbC).toFixed(1) + '°';

  // shade-WBGT clarification (honest: this is wet-bulb, not measured WBGT)
  var wbgtC = P.wbgtShade(c.wbC, c.Tc);
  el.wbgtLine.hidden = false;
  el.wbgtLine.innerHTML = 'Estimated <strong>shade WBGT ≈ ' + t1(wbgtC) + '</strong> (0.7·wet-bulb + 0.3·dry-bulb). ' +
    'This is thermodynamic wet-bulb, <em>not</em> a measured WBGT — OSHA/ACGIH heat-stress limits use WBGT, which adds solar/globe load and runs several degrees higher in direct sun.';

  // next-24h outlook
  if (c.fcPeak) {
    el.outlook.hidden = false;
    el.outlook.innerHTML = 'Next-24h peak wet-bulb <strong>' + t1(c.fcPeak.wbC) + '</strong> around ' + fmtHour(c.fcPeak.time) + ' — ' +
      (c.fcPeak.wbC > c.wbC + 0.3 ? 'rising from now; stage cooling-tower capacity ahead of the peak.'
        : (c.fcPeak.wbC < c.wbC - 0.3 ? 'lower than now; conditions easing.' : 'about the same as now.'));
  } else { el.outlook.hidden = true; }

  // method note
  var note = 'Computed from air temp ' + t1(c.Tc) + ', RH ' + Math.round(c.RH) + '%, and station pressure ' +
    (finiteNum(c.P) ? Math.round(c.P) + ' hPa' : 'sea-level default') + '. ';
  if (finiteNum(c.wbStull)) {
    note += 'Stull cross-check: ' + t1(c.wbStull) + ' (Δ ' + tDelta(Math.abs(c.wbC - c.wbStull)) + ').';
    if (finiteNum(c.P) && Math.abs(c.P - 1013.25) > 40) note += ' Stull is a sea-level fit, so the Δ grows with elevation.';
  } else {
    note += 'Stull cross-check n/a (outside its RH 5–99% / −20…50°C validity range).';
  }
  el.methNote.innerHTML = note;

  // a11y summary for the chart
  var obs = c.series.filter(function (p) { return !p.fc; }).map(function (p) { return dC(p.wbC); });
  c.a11yDesc = 'Wet-bulb now ' + t1(c.wbC) + '. Observed 24-hour range ' +
    (obs.length ? Math.min.apply(null, obs).toFixed(1) + ' to ' + Math.max.apply(null, obs).toFixed(1) + '°' + unit : 'n/a') +
    (c.fcPeak ? '. Forecast peak ' + t1(c.fcPeak.wbC) + ' around ' + fmtHour(c.fcPeak.time) + '.' : '.');

  updateTower();
  drawChart();
}
function trendText(d) {
  if (!finiteNum(d)) return '';
  var mag = dDelta(Math.abs(d)).toFixed(1);
  if (d > 0.4) return '▲ ' + mag + '/3h';
  if (d < -0.4) return '▼ ' + mag + '/3h';
  return 'steady';
}

/* ---------- cooling tower ---------- */
function updateTower() {
  if (!current) return;
  el.apprUnit.textContent = '°' + unit;
  el.designWbUnit.textContent = '°' + unit;
  el.twMin.textContent = t1(current.wbC);
  var appr = parseFloat(el.approachIn.value); if (isNaN(appr)) appr = 0;
  var apprC = unit === 'F' ? P.deltaFToC(appr) : appr;
  var coldC = current.wbC + apprC;
  el.twCold.textContent = t1(coldC);
  el.towerHint.innerHTML = 'At a ' + appr + '°' + unit + ' approach, expected leaving (cold) water ≈ <strong>' + t1(coldC) + '</strong>.';

  var dwRaw = parseFloat(el.designWbIn.value);
  if (!isNaN(dwRaw)) {
    var dwC = unit === 'F' ? P.fToC(dwRaw) : dwRaw;
    var marginC = dwC - current.wbC;      // >0 => today is below design (margin)
    el.towerMargin.hidden = false;
    el.towerMargin.innerHTML = 'Today’s wet-bulb ' + t1(current.wbC) + ' is <strong>' + tDelta(Math.abs(marginC)) + ' ' +
      (marginC >= 0 ? 'below' : 'above') + '</strong> your ' + dwRaw.toFixed(1) + '°' + unit + ' design wet-bulb — ' +
      (marginC >= 0 ? 'the tower has approach margin to spare.' : 'less thermal margin than design; expect elevated cold-water temperatures.');
  } else {
    el.towerMargin.hidden = true;
  }
}

/* ---------- 24h + forecast chart ---------- */
function palette() {
  var cs = getComputedStyle(document.documentElement);
  function v(n) { return (cs.getPropertyValue(n) || '').trim() || '#888'; }
  return { accent: v('--accent'), warn: v('--warn'), muted: v('--muted'), grid: v('--grid-line'), text: v('--text') };
}
function drawChart() {
  if (!current || !current.series.length) return;
  var pts = current.series.map(function (p) {
    return { time: p.time, dry: dC(p.tC), wb: dC(p.wbC), dew: dC(p.tdC), fc: p.fc, now: p.now };
  });
  if (pts.length < 2) { el.chartBox.innerHTML = '<div class="note">Not enough hourly data to chart.</div>'; return; }
  el.chartBox.innerHTML = buildChartSVG(pts);
  var pal = palette();
  el.chartLegend.innerHTML =
    '<span aria-hidden="true" style="color:' + pal.accent + '">●</span> wet bulb ' +
    '<span aria-hidden="true" style="color:' + pal.warn + ';margin-left:10px">●</span> dry bulb ' +
    '<span aria-hidden="true" style="color:' + pal.muted + ';margin-left:10px">●</span> dew point';
  var wbs = pts.filter(function (p) { return !p.fc; }).map(function (p) { return p.wb; });
  el.chartNote.textContent = 'Observed 24h wet-bulb ' + Math.min.apply(null, wbs).toFixed(1) + '–' +
    Math.max.apply(null, wbs).toFixed(1) + '°' + unit + '. Solid = observed, dashed = forecast.';
}
function buildChartSVG(pts) {
  var pal = palette();
  var W = 720, H = 220, padL = 44, padR = 16, padT = 14, padB = 28;
  var x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
  var vals = []; pts.forEach(function (p) { vals.push(p.dry, p.wb, p.dew); });
  var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
  var range = mx - mn || 1; mn -= range * 0.12; mx += range * 0.12;
  var xF = function (i) { return x0 + (x1 - x0) * (pts.length <= 1 ? 0.5 : i / (pts.length - 1)); };
  var yF = function (v) { return y1 - (y1 - y0) * (v - mn) / (mx - mn); };
  var nowIdx = -1; pts.forEach(function (p, i) { if (p.now) nowIdx = i; });
  var polyOf = function (key, from, to) {
    var a = [];
    for (var i = from; i <= to; i++) a.push(xF(i).toFixed(1) + ',' + yF(pts[i][key]).toFixed(1));
    return a.join(' ');
  };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="chTitle chDesc">';
  s += '<title id="chTitle">Wet-bulb, dry-bulb and dew-point temperature, past and next 24 hours</title>';
  s += '<desc id="chDesc">' + escXml(current.a11yDesc || '') + '</desc>';
  var ticks = 4;
  for (var k = 0; k <= ticks; k++) {
    var vv = mn + (mx - mn) * k / ticks, y = yF(vv);
    s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="' + pal.grid + '" stroke-width="1"/>';
    s += '<text x="' + (x0 - 6) + '" y="' + (y + 3.5).toFixed(1) + '" fill="' + pal.muted + '" font-size="11" text-anchor="end">' + Math.round(vv) + '°</text>';
  }
  var step = Math.max(1, Math.round((pts.length - 1) / 5));
  for (var i2 = 0; i2 < pts.length - 1; i2 += step) {
    s += '<text x="' + xF(i2).toFixed(1) + '" y="' + (H - 8) + '" fill="' + pal.muted + '" font-size="11" text-anchor="middle">' + hourLabelShort(pts[i2].time) + '</text>';
  }
  // "now" divider
  if (nowIdx >= 0) {
    var nx = xF(nowIdx);
    s += '<line x1="' + nx.toFixed(1) + '" y1="' + y0 + '" x2="' + nx.toFixed(1) + '" y2="' + y1 + '" stroke="' + pal.muted + '" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>';
    s += '<text x="' + nx.toFixed(1) + '" y="' + (H - 8) + '" fill="' + pal.text + '" font-size="11" text-anchor="middle">now</text>';
  }
  // dew point (muted, thin)
  s += '<polyline points="' + polyOf('dew', 0, pts.length - 1) + '" fill="none" stroke="' + pal.muted + '" stroke-width="1.2" stroke-opacity="0.7"/>';
  // dry bulb (amber)
  s += '<polyline points="' + polyOf('dry', 0, pts.length - 1) + '" fill="none" stroke="' + pal.warn + '" stroke-width="1.6" stroke-opacity="0.85"/>';
  // wet bulb: area under observed, solid observed, dashed forecast
  var obsEnd = nowIdx >= 0 ? nowIdx : pts.length - 1;
  var area = 'M ' + xF(0).toFixed(1) + ' ' + y1.toFixed(1);
  for (var a = 0; a <= obsEnd; a++) area += ' L ' + xF(a).toFixed(1) + ' ' + yF(pts[a].wb).toFixed(1);
  area += ' L ' + xF(obsEnd).toFixed(1) + ' ' + y1.toFixed(1) + ' Z';
  s += '<path d="' + area + '" fill="' + pal.accent + '" fill-opacity="0.10" stroke="none"/>';
  s += '<polyline points="' + polyOf('wb', 0, obsEnd) + '" fill="none" stroke="' + pal.accent + '" stroke-width="2.4"/>';
  if (nowIdx >= 0 && nowIdx < pts.length - 1) {
    s += '<polyline points="' + polyOf('wb', nowIdx, pts.length - 1) + '" fill="none" stroke="' + pal.accent + '" stroke-width="2.2" stroke-dasharray="5 4" stroke-opacity="0.9"/>';
  }
  // current-value marker
  var lx = xF(obsEnd), ly = yF(pts[obsEnd].wb);
  s += '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="4.5" fill="#fff" stroke="' + pal.accent + '" stroke-width="2"/>';
  s += '<text x="' + (lx - 8).toFixed(1) + '" y="' + (ly - 8).toFixed(1) + '" fill="' + pal.text + '" font-size="12" font-weight="600" text-anchor="end">' + pts[obsEnd].wb.toFixed(1) + '°' + unit + '</text>';
  s += '</svg>';
  return s;
}

/* ---------- manual calculator (offline) ---------- */
function updateManual() {
  var tRaw = parseFloat(el.mTempIn.value);
  var rh = parseFloat(el.mRhIn.value);
  var prIn = parseFloat(el.mPresIn.value);
  if (isNaN(prIn) || prIn <= 0) prIn = 29.92;
  var pr = P.inHgToHpa(prIn);
  el.manErr.textContent = '';
  if (isNaN(tRaw) || isNaN(rh)) { clearManual(); el.manErr.textContent = 'Enter a temperature and humidity.'; return; }
  if (rh < 0 || rh > 100) { clearManual(); el.manErr.textContent = 'Humidity must be between 0 and 100%.'; return; }
  var tC = unit === 'F' ? P.fToC(tRaw) : tRaw;
  var td = P.dewpoint(tC, rh);
  var wbC = P.wetBulb(tC, rh, pr, td);
  el.manWb.textContent = t1(wbC);
  el.manDew.textContent = t1(td);
  el.manDep.textContent = tDelta(tC - wbC);
  el.manWbgt.textContent = t1(P.wbgtShade(wbC, tC));
  el.manMin.textContent = t1(wbC);
  var appr = parseFloat(el.manApproachIn.value); if (isNaN(appr)) appr = 0;
  var apprC = unit === 'F' ? P.deltaFToC(appr) : appr;
  el.manCold.textContent = t1(wbC + apprC);
  var st = P.heatStress(wbC);
  el.manBadge.innerHTML = '<span class="badge" style="color:' + st.c + '">' +
    '<span class="pip" style="background:' + st.c + '"></span>' + st.t + '</span>';
}
function clearManual() {
  ['manWb','manDew','manDep','manWbgt','manMin','manCold'].forEach(function (id) { el[id].textContent = '—'; });
  el.manBadge.innerHTML = '';
}

/* ---------- persistence ---------- */
function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

function saveLast(p) { jset('wb_last', { lat: p.lat, lon: p.lon, name: p.name, detail: p.detail || '', query: p.query || '' }); }
function loadLast() { return jget('wb_last', null); }
function loadSites() { return jget('wb_sites', []); }
function saveSites(a) { jset('wb_sites', a); }
function isSaved(p) { var k = placeKey(p); return loadSites().some(function (s) { return placeKey(s) === k; }); }
function addSite(p) {
  var a = loadSites();
  if (!a.some(function (s) { return placeKey(s) === placeKey(p); })) {
    a.push({ name: p.name, lat: p.lat, lon: p.lon, detail: p.detail || '', query: p.query || '' });
    saveSites(a);
  }
  renderChips();
}
function removeSite(key) { saveSites(loadSites().filter(function (s) { return placeKey(s) !== key; })); renderChips(); }

function loadDesignWb(p) { var m = jget('wb_designwb', {}); var v = m[placeKey(p)]; return finiteNum(v) ? v : null; }
function saveDesignWb(p, valC) { var m = jget('wb_designwb', {}); m[placeKey(p)] = valC; jset('wb_designwb', m); }

function pushRecent(p) {
  if (!p.query) return;
  var r = jget('wb_recent', []).filter(function (q) { return q !== p.query; });
  r.unshift(p.query); r = r.slice(0, 6);
  jset('wb_recent', r);
  el.recentList.innerHTML = r.map(function (q) { return '<option value="' + escXml(q) + '">'; }).join('');
}

function renderChips() {
  var a = loadSites();
  el.chips.innerHTML = '';
  a.forEach(function (s) {
    var chip = document.createElement('span');
    chip.className = 'chip';
    if (current && placeKey(current.place) === placeKey(s)) chip.setAttribute('aria-current', 'true');
    var lbl = document.createElement('button');
    lbl.type = 'button';
    lbl.style.cssText = 'border:none;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:0';
    lbl.textContent = s.name;
    lbl.onclick = function () { run({ lat: s.lat, lon: s.lon, name: s.name, detail: s.detail, query: s.query }); };
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', 'Remove ' + s.name); x.textContent = '×';
    x.onclick = function (e) { e.stopPropagation(); removeSite(placeKey(s)); };
    chip.appendChild(lbl); chip.appendChild(x);
    el.chips.appendChild(chip);
  });
  if (current && !isSaved(current.place)) {
    var add = document.createElement('button');
    add.type = 'button'; add.className = 'chip add';
    add.textContent = '☆ Pin ' + shortName(current.place.name);
    add.onclick = function () { addSite(current.place); };
    el.chips.appendChild(add);
  }
}

/* ---------- share / copy / export ---------- */
function shareURL() {
  var u;
  try { u = new URL(window.location.href); } catch (e) { return window.location.href; }
  u.search = '';
  var p = current ? current.place : null;
  if (p) {
    if (p.query) u.searchParams.set('loc', p.query);
    else { u.searchParams.set('lat', p.lat.toFixed(4)); u.searchParams.set('lon', p.lon.toFixed(4)); if (p.name) u.searchParams.set('n', p.name); }
  }
  u.searchParams.set('u', unit);
  return u.toString();
}
function updateURL() { try { window.history.replaceState(null, '', shareURL()); } catch (e) {} }

function summaryText() {
  var c = current; if (!c) return '';
  var lines = [];
  lines.push(c.place.name + '  ' + (c.w.current.time || '').replace('T', ' ') + ' ' + (c.w.timezone_abbreviation || ''));
  lines.push('Wet-bulb ' + t1(c.wbC) + ' · Dry-bulb ' + t1(c.Tc) + ' · Dew ' + t1(c.Tdew) +
    ' · RH ' + Math.round(c.RH) + '%' + (finiteNum(c.P) ? ' · P ' + Math.round(c.P) + ' hPa (' + P.hpaToInHg(c.P).toFixed(2) + ' inHg)' : ''));
  var extra = ['Shade WBGT est ' + t1(P.wbgtShade(c.wbC, c.Tc))];
  if (finiteNum(c.apparent)) extra.push('Feels ' + t1(c.apparent));
  if (finiteNum(c.windSpd)) extra.push('Wind ' + Math.round(c.windSpd) + ' mph' + (finiteNum(c.windDir) ? ' ' + compass(c.windDir) : ''));
  lines.push(extra.join(' · '));
  return lines.join('\n');
}
function legacyCopy(text) {
  var t = document.createElement('textarea');
  t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.focus(); t.select();
  try { document.execCommand('copy'); } catch (e) {}
  t.remove();
}
function copyText(text, btn) {
  var done = function () { flashBtn(btn, 'Copied ✓'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
  } else { legacyCopy(text); done(); }
}
function flashBtn(btn, msg) {
  if (!btn) return;
  var o = btn.textContent; btn.textContent = msg; btn.disabled = true;
  setTimeout(function () { btn.textContent = o; btn.disabled = false; }, 1200);
}
function downloadCSV(btn) {
  if (!current || !current.series.length) return;
  var rows = [['time', 'dry_bulb_' + unit, 'wet_bulb_' + unit, 'dew_point_' + unit, 'rel_humidity_pct', 'pressure_hPa', 'type']];
  current.series.forEach(function (p) {
    rows.push([p.time, dC(p.tC).toFixed(1), dC(p.wbC).toFixed(1), dC(p.tdC).toFixed(1),
      finiteNum(p.rh) ? Math.round(p.rh) : '', finiteNum(p.pr) ? Math.round(p.pr) : '', p.fc ? 'forecast' : 'observed']);
  });
  var csv = rows.map(function (r) { return r.join(','); }).join('\n');
  var blob = new Blob([csv], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wetbulb_' + slug(current.place.name) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  flashBtn(btn, 'Downloaded ✓');
}

/* ---------- input handling ---------- */
function submitLoc() {
  var q = el.locInput.value.trim();
  if (!q) { setStatus('Type a ZIP or city first.', true); return; }
  resolveAndRun(q);
}
function resolveAndRun(q) {
  if (inFlight) inFlight.abort();
  var ctrl = new AbortController();
  inFlight = ctrl;
  loading('Looking up "' + q + '"…');
  var geocode = /^\d{5}$/.test(q) ? geocodeZip(q, ctrl.signal) : geocodeCity(q, ctrl.signal);
  return geocode.then(function (place) {
    place.query = q;
    run(place);
  }).catch(function (e) {
    if (e && e.name === 'AbortError') return;
    showError(e);
  });
}
function useGPS() {
  if (!navigator.geolocation) { setStatus('Geolocation not available in this browser.', true); return; }
  loading('Getting your location…');
  navigator.geolocation.getCurrentPosition(function (pos) {
    run({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Your location', detail: '' });
  }, function (err) {
    setStatus('Location denied or unavailable (' + err.message + '). Enter a ZIP instead.', true);
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
}
function refreshNow() { if (current) run(current.place); }
function setRefresh(min) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (min > 0) refreshTimer = setInterval(refreshNow, min * 60 * 1000);
}

/* ---------- units & theme ---------- */
function convAbs(input, newU) { var v = parseFloat(input.value); if (!isNaN(v)) input.value = (newU === 'C' ? P.fToC(v) : P.cToF(v)).toFixed(1); }
function convDelta(input, newU) { var v = parseFloat(input.value); if (!isNaN(v)) input.value = (newU === 'C' ? P.deltaFToC(v) : P.deltaCToF(v)).toFixed(1); }
function setUnit(newU, convertInputs) {
  if (newU !== 'F' && newU !== 'C') newU = 'F';
  if (convertInputs && newU !== unit) {
    convAbs(el.mTempIn, newU);
    convAbs(el.designWbIn, newU);       // an absolute wet-bulb temperature
    convDelta(el.approachIn, newU);     // deltas
    convDelta(el.manApproachIn, newU);
  }
  unit = newU;
  jset('wb_unit', unit);
  Array.prototype.forEach.call(el.unitSeg.querySelectorAll('button'), function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-u') === unit ? 'true' : 'false');
  });
  el.mTempUnit.textContent = '°' + unit;
  el.manApprUnit.textContent = '°' + unit;
  el.apprUnit.textContent = '°' + unit;
  el.designWbUnit.textContent = '°' + unit;
  updateManual();
  if (current) render();
}
function applyTheme(mode) {
  if (mode === 'dark' || mode === 'light') document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
  jset('wb_theme', mode);
  Array.prototype.forEach.call(el.themeSeg.querySelectorAll('button'), function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-theme') === mode ? 'true' : 'false');
  });
  if (current) drawChart();   // chart colors come from CSS variables
}

/* ---------- service worker ---------- */
function registerSW() {
  if ('serviceWorker' in navigator && window.location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
}

/* ---------- wire up ---------- */
function wireEvents() {
  el.goBtn.onclick = submitLoc;
  el.locInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitLoc(); });
  el.gpsBtn.onclick = useGPS;
  el.approachIn.addEventListener('input', updateTower);
  el.designWbIn.addEventListener('input', function () {
    if (current) {
      var v = parseFloat(el.designWbIn.value);
      if (!isNaN(v)) saveDesignWb(current.place, unit === 'F' ? P.fToC(v) : v);
    }
    updateTower();
  });
  el.refreshSel.addEventListener('change', function () { setRefresh(parseInt(this.value, 10)); });
  ['mTempIn','mRhIn','mPresIn','manApproachIn'].forEach(function (id) { el[id].addEventListener('input', updateManual); });
  el.copyBtn.onclick = function () { copyText(summaryText(), el.copyBtn); };
  el.shareBtn.onclick = function () { copyText(shareURL(), el.shareBtn); };
  el.csvBtn.onclick = function () { downloadCSV(el.csvBtn); };
  Array.prototype.forEach.call(el.unitSeg.querySelectorAll('button'), function (b) {
    b.onclick = function () { setUnit(b.getAttribute('data-u'), true); };
  });
  Array.prototype.forEach.call(el.themeSeg.querySelectorAll('button'), function (b) {
    b.onclick = function () { applyTheme(b.getAttribute('data-theme')); };
  });
}

/* ---------- boot ---------- */
function boot() {
  applyTheme(jget('wb_theme', 'auto'));
  var savedU = jget('wb_unit', 'F');
  if (savedU === 'C') setUnit('C', true); else setUnit('F', false);
  wireEvents();
  registerSW();
  setRefresh(parseInt(el.refreshSel.value, 10));
  updateManual();
  renderChips();
  // seed the recent datalist
  var r = jget('wb_recent', []);
  el.recentList.innerHTML = r.map(function (q) { return '<option value="' + escXml(q) + '">'; }).join('');

  var sp = new URLSearchParams(window.location.search);
  var uParam = sp.get('u');
  if (uParam === 'C' || uParam === 'F') setUnit(uParam, true);

  if (!navigator.onLine) {
    setStatus('You appear to be offline. The manual calculator below works without a connection.');
    return;
  }
  if (sp.get('loc')) { el.locInput.value = sp.get('loc'); resolveAndRun(sp.get('loc')); return; }
  var lat = parseFloat(sp.get('lat')), lon = parseFloat(sp.get('lon'));
  if (isFinite(lat) && isFinite(lon)) { run({ lat: lat, lon: lon, name: sp.get('n') || 'Shared location', detail: '' }); return; }

  var last = loadLast();
  if (last && isFinite(last.lat)) { el.locInput.value = last.query || ''; run(last); return; }
  el.locInput.value = '04101';
  resolveAndRun('04101');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
