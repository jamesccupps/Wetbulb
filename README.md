# Wet-Bulb Calculator

Real-time, **pressure-corrected wet-bulb temperature** by ZIP, city, or GPS — with a cooling-tower approach reference, a shade-WBGT estimate, a 24-hour trend plus next-24h forecast peak, and a fully offline manual psychrometric calculator.

[![CI](https://github.com/jamesccupps/Wetbulb/actions/workflows/ci.yml/badge.svg)](https://github.com/jamesccupps/Wetbulb/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-38bdf8.svg)](https://jamesccupps.github.io/Wetbulb/)

**▶ Live demo: https://jamesccupps.github.io/Wetbulb/**

> Built for HVAC / facilities work: the wet-bulb temperature is the floor a cooling tower or evaporative process can chase, and it drives worker heat-stress screening. This tool computes it the way a psychrometer would, corrected for the actual station pressure — not a sea-level approximation.

![Wet-Bulb Calculator showing live conditions for Portland, Maine: a 63.6 °F wet-bulb reading with dry-bulb, dew point, humidity, depression and pressure metrics, a shade-WBGT note, a next-24h forecast peak, a 24-hour trend chart, and the cooling-tower approach reference.](assets/screenshot.png)

## Features

- **Live conditions** by US ZIP, city (worldwide), or one-tap GPS.
- **Pressure-corrected psychrometric wet-bulb** — solved iteratively, not a fixed-pressure fit, and cross-checked against the Stull (2011) approximation.
- **Cooling-tower reference** — theoretical minimum cold-water temperature (= ambient wet-bulb), achievable leaving-water temperature at your design *approach*, and margin-vs-**site design wet-bulb** (persisted per location).
- **Shade-WBGT estimate** with an honest note that it is *not* a measured WBGT (see [Accuracy & limitations](#accuracy--limitations)).
- **24-hour trend + next-24h outlook** — wet-bulb, dry-bulb and dew-point plotted from archived + forecast hourly data, with a forecast-peak callout to stage tower capacity ahead of the afternoon peak.
- **Multiple saved sites** — pin the buildings you manage and glance between them.
- **Barometric trend** (rising / falling over 3 h) and a WB-depression readout.
- **Offline manual calculator** — enter air temp, RH and pressure to get wet-bulb, dew point, WB depression and cold-water temp with no network at all.
- **Share & export** — copy a shareable deep link, copy a one-line summary for a work order/ticket, or download the 24 h series as CSV.
- **°F / °C toggle**, light / dark / auto theme, auto-refresh, installable PWA with offline shell caching.
- **Zero dependencies, no build step.** Plain HTML/CSS/vanilla JS.

## How the wet-bulb is computed

The wet-bulb temperature `Tw` is the root of the psychrometric equation

```
e(T, RH) = es(Tw) − γ · (T − Tw)
```

where

- `es(·)` is the saturation vapour pressure over water, using the **Alduchov & Eskridge (1996)** coefficients: `es(T) = 6.1094 · exp(17.625·T / (243.04 + T))` hPa;
- `e = es(T) · RH/100` is the actual vapour pressure;
- `γ = 6.65 × 10⁻⁴ · P` (hPa/°C) is the psychrometer constant at the **actual station pressure `P`** — this is the pressure correction, equivalent to the standard `0.665 × 10⁻³ · P[kPa]`.

Because `Tw` always lies between the dew point and the dry-bulb temperature, the root is bracketed and solved by bisection (60 iterations → sub-millidegree convergence). Dew point uses the exact Magnus inverse of the same `es` coefficients, so `esat`, dew point and the wet-bulb solve are all on one water phase (correct for a supercooled-wick wet-bulb below 0 °C, and consistent with Open-Meteo's over-water dew point).

The **Stull (2011)** empirical formula is shown as an independent cross-check. It is a sea-level fit valid for RH 5–99 % and T −20…50 °C; outside that envelope the app labels the cross-check as not applicable rather than reporting a misleading Δ.

## Accuracy & limitations

- Psychrometric and Stull results agree to **≈ 0.3 °C** across normal conditions, widening to **≈ 0.85 °C** at the corners of Stull's valid range and more below RH 5 %. See the test suite for the measured envelope.
- Results are the **ambient (shade) wet-bulb** from a modelled 2 m observation — not a substitute for a sling/aspirated psychrometer reading at the equipment, nor for an **ASHRAE 0.4 % / 1 % / 2 % design wet-bulb** when sizing a tower. Enter your site's design wet-bulb in the tower card to compare today's reading against it.
- **The heat-stress badge and the "shade WBGT" figure are wet-bulb-based estimates, not a measured WBGT.** OSHA/ACGIH heat-stress limits are stated in **WBGT**, which adds a globe-temperature (solar) load and runs several degrees higher in direct sun. Treat the shade WBGT (`0.7·Tw + 0.3·Tdb`) as an indoor/no-solar screening estimate only; use a measured WBGT meter for compliance decisions.
- Weather values are model output (Open-Meteo), not direct station observations, and update on the provider's cadence.

## Data sources & attribution

- Weather (current + hourly archive/forecast) © [**Open-Meteo**](https://open-meteo.com) — free, no API key.
- City geocoding via the [**Open-Meteo Geocoding API**](https://open-meteo.com/en/docs/geocoding-api).
- US ZIP geocoding via [**Zippopotam.us**](https://www.zippopotam.us) — free, no API key.

No API keys are used or committed; all requests are client-side over HTTPS.

## Running locally

Just open `index.html` in a browser — everything except the installable service worker works from `file://`, including the live API lookups and the offline manual calculator.

To exercise the PWA / service worker (which requires an `http(s)` origin), serve the folder:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Tests & CI

The psychrometric core (`js/psychro.js`) is a UMD module: the same file powers the browser **and** is imported by Node's built-in test runner — no bundler, no dev dependencies.

```bash
node --test          # or: npm test
```

CI runs the suite on Node 18/20/22 via GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Deploy to GitHub Pages

1. Push to `main`.
2. **Settings → Pages → Source: Deploy from a branch → `main` / root.**
3. The site is served at `https://jamesccupps.github.io/Wetbulb/`.

For rich link unfurls, upload `assets/social-card.svg` (or a PNG export of it) as the repo's social preview under **Settings → General → Social preview**.

## Project structure

```
index.html               markup only
css/styles.css           styles + light/dark theming
js/psychro.js            pure psychrometric core (browser + Node, UMD)
js/app.js                UI: fetch, render, chart, persistence, events
test/psychro.test.js     node:test suite for the core
sw.js                    service worker (offline shell; APIs stay network-only)
manifest.webmanifest     PWA manifest
assets/                  icon + social card
.github/workflows/ci.yml CI
```

## Changelog

**1.0.0** — First public release. Extracted a testable psychrometric core with a CI'd `node:test` suite; added multi-site pins, next-24h forecast peak, shareable links, copy/CSV export, dew-point chart series, barometric trend, shade-WBGT clarification, light/dark theming, PWA offline, and accessibility fixes (aria-live status, accessible unit toggle & chart, focus-visible, reduced-motion). Fixed a status-bar XSS, added null-field validation, and corrected approach-input reconversion across unit changes.

## License

[MIT](LICENSE) © 2026 James Cupps
