/* =========================================================================
   check-syntax.js — JavaScript syntax validation for the app files covered by
   the release checks. Runs `node --check` on each. Offline, no deps, no writes.
   Run: node staging/check-syntax.js
   ========================================================================= */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const list = [];

// All Netlify functions.
const fnDir = path.join(root, 'netlify', 'functions');
for (const f of fs.readdirSync(fnDir)) {
  if (f.endsWith('.js')) list.push(path.join('netlify', 'functions', f));
}
// Core front-end app files exercised by the release checks.
for (const f of ['auth.js', 'access.js', 'settings.js', 'auth-fetch.js', 'navigation.js']) {
  if (fs.existsSync(path.join(root, f))) list.push(f);
}
// The staging test/check scripts themselves.
for (const f of fs.readdirSync(path.join(root, 'staging'))) {
  if (f.endsWith('.js')) list.push(path.join('staging', f));
}

let fail = 0;
for (const rel of list) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' });
    console.log('OK    ' + rel);
  } catch (e) {
    fail++;
    console.log('FAIL  ' + rel);
    const msg = (e.stderr && e.stderr.toString()) || e.message;
    console.log('      ' + msg.split('\n').slice(0, 3).join('\n      '));
  }
}
console.log('\n' + (fail === 0 ? 'SYNTAX OK (' + list.length + ' files)' : fail + ' FILE(S) FAILED SYNTAX'));
if (fail) process.exit(1);
