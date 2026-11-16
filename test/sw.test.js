'use strict';

// The service worker installs with cache.addAll(SHELL). One missing file
// rejects the whole install, registerSW() swallows the error, and the old
// worker keeps serving the old shell indefinitely. The reverse slip -- a file
// the page loads that is not in SHELL -- only shows up as a broken offline load.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function shellList() {
  const m = read('sw.js').match(/var SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, 'SHELL array not found in sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

test('every SHELL entry exists in the repo', () => {
  const shell = shellList();
  assert.ok(shell.length >= 5, `parsed only ${shell.length} SHELL entries`);
  for (const u of shell) {
    const rel = u === './' ? 'index.html' : u.replace(/^\.\//, '');
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${u} is in SHELL but ${rel} does not exist`);
  }
});

test('every local script, stylesheet, manifest and icon the page uses is in SHELL', () => {
  const shell = new Set(shellList().map(u => u.replace(/^\.\//, '')));
  const html = read('index.html');
  const refs = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<link[^>]+rel="(?:stylesheet|manifest)"[^>]*href="([^"]+)"/g)].map(m => m[1]),
    ...JSON.parse(read('manifest.webmanifest')).icons.map(i => i.src),
  ].filter(u => !/^(?:[a-z]+:|\/\/)/i.test(u));   // skip https:, data: and protocol-relative
  assert.ok(refs.length >= 6, `found only ${refs.length} local references`);
  for (const r of refs) assert.ok(shell.has(r), `${r} is used by the page but missing from SHELL`);
});
