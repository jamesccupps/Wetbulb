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

// ---- getJson: hedged retry inside one deadline ----
// A fake fetch that follows a per-call plan and honours its abort signal the
// way a real fetch does (the body read too). Timings are scaled down: hedge
// 40 ms, deadline 250 ms.
function fakeFetch(plan) {
  const calls = [];
  const fn = (url, { signal }) => {
    const b = plan[Math.min(calls.length, plan.length - 1)];
    const call = { aborted: false, done: false };
    calls.push(call);
    const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { if (!call.done) { call.aborted = true; reject(abortErr()); } });
      if (b === 'hang') return;
      setTimeout(() => {
        if (signal.aborted) return;
        if (b.error) { call.done = true; return reject(new TypeError(b.error)); }
        resolve({
          status: b.status || 200, ok: (b.status || 200) < 400,
          json: () => b.body === 'hang-body'
            ? new Promise((_, rej) => signal.addEventListener('abort', () => { call.aborted = true; rej(abortErr()); }))
            : (call.done = true, b.body === 'html' ? Promise.reject(new SyntaxError('Unexpected token <')) : Promise.resolve(b.body))
        });
      }, b.after || 0);
    });
  };
  fn.calls = calls;
  return fn;
}
const FAST = { hedgeMs: 40 };
const within = ms => ({ ...FAST, deadline: Date.now() + ms });
const OK = { status: 200, body: { v: 1 } };

test('a prompt reply is returned as is, with one request', async () => {
  const f = fakeFetch([OK]);
  assert.deepEqual(await L.getJson(f, 'u', within(250)), { status: 200, ok: true, json: { v: 1 } });
  assert.equal(f.calls.length, 1);
});

test('a stalled request is hedged: a second attempt wins and the first is aborted', async () => {
  const f = fakeFetch(['hang', OK]);
  const t0 = Date.now();
  const r = await L.getJson(f, 'u', within(250));
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].aborted, 'stalled attempt aborted');
  assert.ok(Date.now() - t0 < 150, 'answered soon after the hedge, not at the deadline');
});

test('a slow-but-working first attempt can still win after the hedge starts', async () => {
  // The case a plain "time out at N s, then retry" gets wrong on a slow link.
  const f = fakeFetch([{ after: 90, ...OK, body: { first: true } }, 'hang']);
  const r = await L.getJson(f, 'u', within(250));
  assert.deepEqual(r.json, { first: true });
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[1].aborted, 'the losing hedge is aborted');
});

test('both attempts stalled: TimeoutError at the deadline, both aborted', async () => {
  const f = fakeFetch(['hang', 'hang']);
  const t0 = Date.now();
  await assert.rejects(L.getJson(f, 'u', within(150)), e => e.name === 'TimeoutError');
  const took = Date.now() - t0;
  assert.ok(took >= 140 && took < 400, `failed at the deadline (${took} ms)`);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(c => c.aborted));
});

test('the deadline covers the body read', async () => {
  const f = fakeFetch([{ status: 200, body: 'hang-body' }]);
  await assert.rejects(L.getJson(f, 'u', within(150)), e => e.name === 'TimeoutError');
});

test('a fast network error retries at once, not at the hedge', async () => {
  const f = fakeFetch([{ error: 'Failed to fetch' }, OK]);
  const t0 = Date.now();
  assert.equal((await L.getJson(f, 'u', { hedgeMs: 200, deadline: Date.now() + 500 })).status, 200);
  assert.ok(Date.now() - t0 < 100, 'retried immediately');
  assert.equal(f.calls.length, 2);
});

test('5xx is retried once; if both are 5xx the last reply is returned', async () => {
  assert.equal((await L.getJson(fakeFetch([{ status: 503, body: {} }, OK]), 'u', within(250))).status, 200);
  const f = fakeFetch([{ status: 503, body: {} }, { status: 502, body: 'html' }]);
  const r = await L.getJson(f, 'u', within(250));
  assert.equal(r.status, 502);
  assert.equal(r.json, undefined);
  assert.equal(f.calls.length, 2);
});

test('4xx is not retried (a repeated 429 is just another 429)', async () => {
  for (const status of [429, 404, 400]) {
    const f = fakeFetch([{ status, body: { error: true } }]);
    const r = await L.getJson(f, 'u', within(250));
    assert.equal(r.status, status);
    assert.equal(r.ok, false);
    await new Promise(res => setTimeout(res, 60));   // past the hedge: still one request
    assert.equal(f.calls.length, 1, `HTTP ${status} retried`);
  }
});

test('never more than two attempts: two network errors reject with the last one', async () => {
  const f = fakeFetch([{ error: 'Failed to fetch' }, { error: 'Network changed' }]);
  await assert.rejects(L.getJson(f, 'u', within(250)), e => e instanceof TypeError && e.message === 'Network changed');
  assert.equal(f.calls.length, 2);
});

test('an unreadable body resolves with json undefined', async () => {
  const r = await L.getJson(fakeFetch([{ status: 200, body: 'html' }]), 'u', within(250));
  assert.deepEqual(r, { status: 200, ok: true, json: undefined });
});

test("the caller's abort (a newer search) rejects AbortError and aborts every attempt", async () => {
  const f = fakeFetch(['hang', 'hang']);
  const ctrl = new AbortController();
  const p = L.getJson(f, 'u', { ...within(250), signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 60);
  await assert.rejects(p, e => e.name === 'AbortError');
  assert.ok(f.calls.every(c => c.aborted));
});

test('already aborted or past the deadline: no request at all', async () => {
  const ctrl = new AbortController(); ctrl.abort();
  const f1 = fakeFetch([OK]);
  await assert.rejects(L.getJson(f1, 'u', { ...within(250), signal: ctrl.signal }), e => e.name === 'AbortError');
  const f2 = fakeFetch([OK]);
  await assert.rejects(L.getJson(f2, 'u', { ...FAST, deadline: Date.now() - 1 }), e => e.name === 'TimeoutError');
  assert.equal(f1.calls.length + f2.calls.length, 0);
});

test('defaults: 4 s hedge, 12 s budget', () => {
  assert.equal(L.HEDGE_MS, 4000);
  assert.equal(L.BUDGET_MS, 12000);
});
