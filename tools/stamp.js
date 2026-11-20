#!/usr/bin/env node
'use strict';

// Content stamps for the offline shell.
//
// index.html loads each script and the stylesheet as "file?v=<stamp>", where
// the stamp is the first 8 hex digits of the file's SHA-256, and sw.js caches
// exactly those URLs under a cache name derived from the whole shell.
//
// Why: index.html is always fetched from the network, but assets were cached
// under plain URLs, so the first load after a deploy ran the new page with the
// old scripts. Every API change between files then needed a hand-bumped cache
// VERSION, and forgetting it could kill the page at boot ("P.rhFromDew is not
// a function" was seen locally). With stamps a changed file is a new URL, so
// the page can only load the scripts it was written for, and the cache name
// changes by itself whenever anything in the shell does.
//
//   node tools/stamp.js           rewrite the stamps in index.html and sw.js
//   node tools/stamp.js --check   exit 1 if a stamp is stale (test/sw.test.js
//                                 runs the same check, so CI catches it)
//
// Zero dependencies: node's own fs, path and crypto.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// Loaded by index.html, so stamped in its URLs.
const STAMPED = ['css/styles.css', 'js/psychro.js', 'js/geo.js', 'js/live.js', 'js/app.js'];
// In the shell but not stamped (the page itself, the manifest and its icons):
// still folded into the cache name, so editing one re-caches the shell.
const UNSTAMPED = ['index.html', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon-maskable.svg'];

const read = f => fs.readFileSync(path.join(ROOT, f));
const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stampsFor() {
  const s = {};
  for (const f of STAMPED) s[f] = hash(read(f));
  return s;
}

// The two files as they should be: every stamped reference carries its
// current stamp, and VERSION names the cache after the stamped shell.
function render() {
  const s = stampsFor();
  let index = read('index.html').toString('utf8');
  for (const f of STAMPED) {
    index = index.replace(new RegExp('((?:src|href)=")' + esc(f) + '(?:\\?v=[0-9a-f]*)?(")', 'g'), '$1' + f + '?v=' + s[f] + '$2');
  }
  let sw = read('sw.js').toString('utf8');
  for (const f of STAMPED) {
    sw = sw.replace(new RegExp("('\\./)" + esc(f) + "(?:\\?v=[0-9a-f]*)?(')", 'g'), '$1' + f + '?v=' + s[f] + '$2');
  }
  // index.html is hashed as it will be written, so the cache name follows the
  // page's own edits too, without a cycle (the page never contains VERSION).
  const shell = STAMPED.map(f => f + '?v=' + s[f])
    .concat(UNSTAMPED.map(f => f + '#' + hash(f === 'index.html' ? Buffer.from(index, 'utf8') : read(f))));
  sw = sw.replace(/var VERSION = '[^']*';/, "var VERSION = 'wetbulb-" + hash(shell.join('\n')) + "';");
  return { index, sw, stamps: s };
}

// Files whose stamps are out of date ([] when all are current).
function stale() {
  const want = render();
  const out = [];
  if (want.index !== read('index.html').toString('utf8')) out.push('index.html');
  if (want.sw !== read('sw.js').toString('utf8')) out.push('sw.js');
  return out;
}

function write() {
  const want = render();
  fs.writeFileSync(path.join(ROOT, 'index.html'), want.index);
  fs.writeFileSync(path.join(ROOT, 'sw.js'), want.sw);
  return want.stamps;
}

module.exports = { STAMPED, UNSTAMPED, render, stale, write };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const s = stale();
    if (s.length) { console.error('Stale stamps in ' + s.join(', ') + ' -- run: node tools/stamp.js'); process.exit(1); }
    console.log('Stamps are current.');
  } else {
    const st = write();
    for (const f of STAMPED) console.log(f.padEnd(16) + st[f]);
  }
}
