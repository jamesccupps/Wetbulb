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
- **Offline manual calculator** — enter air temp, RH and pressure to get wet-bulb, dew point, WB depression and cold-water temp with no network at all. Pressure follows the unit toggle (inHg under °F, hPa under °C) and is range-checked, so a mixed-up unit is caught rather than silently returning wet-bulb ≈ dry-bulb.
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

- The psychrometric solve was validated against an independent **ASHRAE thermodynamic wet-bulb** (adiabatic-saturation) solver over T −10…45 °C × RH 10–99 % × P {1013, 850} hPa: **worst deviation 0.24 °C, typically under 0.10 °C.** The bias is consistently positive, as expected for a psychrometric rather than thermodynamic wet-bulb.
- Psychrometric and Stull results agree to **≈ 0.3 °C** typical and **≤ 0.85 °C** over ordinary conditions (T 0–45 °C, RH 20–95 %). They diverge much further in **cold, dry air**: at the −20 °C / 5 % RH corner of Stull's *own published envelope* the gap reaches **≈ 3.95 °C (7.1 °F)**. That is a limitation of the Stull fit, not of the value the app reports — when the Δ exceeds 1 °C the method note says so explicitly. Both bounds are pinned by the test suite.
- Results are the **ambient (shade) wet-bulb** from a modelled 2 m observation — not a substitute for a sling/aspirated psychrometer reading at the equipment, nor for an **ASHRAE 0.4 % / 1 % / 2 % design wet-bulb** when sizing a tower. Enter your site's design wet-bulb in the tower card to compare today's reading against it.
- **The heat-stress badge and the "shade WBGT" figure are wet-bulb-based estimates, not a measured WBGT.** OSHA/ACGIH heat-stress limits are stated in **WBGT**, which adds a globe-temperature (solar) load and runs several degrees higher in direct sun. Treat the shade WBGT (`0.7·Tw + 0.3·Tdb`) as an indoor/no-solar screening estimate only; use a measured WBGT meter for compliance decisions.
- **The shade-WBGT estimate is biased low, which is the unsafe direction.** The WBGT definition uses the *natural* wet bulb `Tnwb` (an unaspirated wick in ambient air); this substitutes the *psychrometric* wet bulb, which is what a well-aspirated sling reads. In still air `Tnwb` runs **above** `Tpwb`, so in a low-air-movement space — a mechanical room, an attic, an unventilated penthouse — the real WBGT is higher than the figure shown. It also substitutes dry-bulb for globe temperature, which holds only with no radiant load. Do not use it to clear someone for work near hot equipment.
- The heat-stress band edges (26 / 29 / 31 °C wet-bulb) are a **screening convention, not a published standard.** Only the 35 °C survivability figure is sourced (Sherwood & Huber 2010).
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

**1.1.0** — Audit fixes.

*Correctness*
- A corrupted or stale `wb_last` in `localStorage` no longer dead-ends the app. `isFinite()` coerces strings, so a stringified latitude passed the old guard and then threw in `placeKey()`; boot now validates lat/lon as real, in-range numbers and falls through to the default instead of stranding the user on a raw `TypeError` with no recovery path. Saved-site entries are filtered the same way.
- Clearing the **site design wet-bulb** now actually clears it. There was no delete path, so the next `computeAndRender` — i.e. within one auto-refresh — restored the old value and its margin callout.
- Manual-calculator pressure follows the unit toggle (inHg / hPa) and is range-checked against a plausible station-pressure envelope. Typing `1010` into the inHg field previously produced a wet bulb ≈ dry bulb with no warning.
- `hourlyNowIndex` scans the full hourly array instead of breaking on the first later stamp; local wall-clock stamps are not strictly increasing across the DST fall-back hour.
- Chart summary no longer prints `Infinity–-Infinity` when no observed hours are in range.

*Accessibility*
- **Heat-stress badge is legible in light theme.** `heatStress()` hardcoded two hex colors that were never theme-aware; "Caution" measured **1.29:1** and "Extreme" **1.93:1** against the badge background, and the three theme-aware bands only reached ~4.2:1. All five bands in both themes now measure **≥ 4.7:1** (WCAG AA).
- The location field's label used `display:none`, which drops it from the accessibility tree and leaves the field named by its placeholder. Replaced with a clip-based `.sr-only`.

*API*
- **Breaking:** `heatStress()` returns `{ t, level }` instead of `{ t, c }`. The core no longer emits CSS colors — callers map the `level` slug to a theme-aware custom property, which is what fixes the contrast bug at its root.
- **Breaking:** removed `windChillF()`; it was exported and tested but never used by the app.

*Service worker*
- `respondWith()` always settles with a real `Response`. A cold cache plus offline previously resolved it with `undefined`, surfacing as an opaque network error.
- The stale-while-revalidate refresh is registered with `waitUntil()` while the event is still active, so the worker is not killed before a redeploy self-heals.
- Cache version bumped to `wetbulb-v2` — this release changes the `psychro.js` API and the CSS tokens together, so a mixed old/new shell must not be served.

*Privacy*
- A GPS fix is written to the URL at 2 dp (~1.1 km) instead of 4 dp (~11 m). That URL lands in the address bar, in browser history, and in whatever "Copy link" is pasted into; 2 dp is coarser than Open-Meteo's own grid, so the reading is unchanged.

*Docs & tests*
- Corrected the Stull accuracy claim. The documented "≈ 0.85 °C at the corners of Stull's valid range" was the maximum over the *test* grid (T 0–45 °C, RH 20–95 %), not over the envelope `stullValid()` actually admits — at −20 °C / 5 % RH the gap is **≈ 3.95 °C**. Added tests that pin both the ordinary-conditions bound and the envelope-wide maximum, and the method note now flags a Δ over 1 °C in the UI.
- Documented that the shade-WBGT estimate is biased **low** (psychrometric wet bulb substituted for natural wet bulb), and that the heat-stress band edges below 35 °C are a screening convention rather than a published standard.
- Added the ASHRAE thermodynamic-wet-bulb validation result (worst deviation 0.24 °C).
- CSV export carries `timezone`, `tz_abbr` and `utc_offset_seconds` alongside the local timestamp.

**1.0.0** — First public release. Extracted a testable psychrometric core with a CI'd `node:test` suite; added multi-site pins, next-24h forecast peak, shareable links, copy/CSV export, dew-point chart series, barometric trend, shade-WBGT clarification, light/dark theming, PWA offline, and accessibility fixes (aria-live status, accessible unit toggle & chart, focus-visible, reduced-motion). Fixed a status-bar XSS, added null-field validation, and corrected approach-input reconversion across unit changes.

## License

[MIT](LICENSE) © 2026 James Cupps
