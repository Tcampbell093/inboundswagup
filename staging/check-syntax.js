/* =========================================================================
   check-syntax.js — JavaScript syntax validation for the whole application.

   Discovers EVERY tracked *.js / *.mjs / *.cjs via `git ls-files` (so untracked
   local artifacts such as node_modules/, .netlify/, and generated version.js
   are never included), sorts deterministically, and runs `node --check` on each.
   node --check infers module kind by extension (.mjs = ESM, .cjs/.js = CJS).

   Production-isolated: no network, no database, no secrets, no writes — it only
   parses source files. Run: node staging/check-syntax.js
   ========================================================================= */

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

// Files that are GENUINELY generated or vendored and cannot be parsed directly.
// Keep EMPTY unless a real case appears — never silently drop normal Houston
// application files. Each entry MUST carry a reason. As of this commit every
// tracked JS/MJS/CJS parses cleanly, so there are no exclusions.
const EXCLUDE = new Map([
  // ['path/to/vendor.min.js', 'third-party minified bundle — not directly parseable'],
]);

// Representative application modules that MUST always be discovered. If any is
// missing, discovery has regressed (e.g. a broken glob) — fail loudly.
const MUST_INCLUDE = ['script.js', 'assembly.js', 'queue.js', 'settings.js', 'access.js'];

// ── Discover tracked JS via git, NUL-delimited + deterministically sorted ──
const out = execFileSync('git', ['ls-files', '-z', '*.js', '*.mjs', '*.cjs'], { cwd: root });
let files = out.toString('utf8').split('\0').filter(Boolean).sort();

// Regression assertions on the discovered set.
const missing = MUST_INCLUDE.filter((f) => !files.includes(f));
if (missing.length) {
  console.error('Discovery regression — expected modules not found: ' + missing.join(', '));
  process.exit(1);
}
if (!files.some((f) => /^netlify\/functions\/.+\.js$/.test(f))) {
  console.error('Discovery regression — no Netlify function was discovered.');
  process.exit(1);
}

// Apply documented exclusions.
const excluded = [];
files = files.filter((f) => { if (EXCLUDE.has(f)) { excluded.push(f); return false; } return true; });

// Must discover something.
if (files.length === 0) {
  console.error('No JavaScript files discovered — aborting (expected many).');
  process.exit(1);
}

// ── Validate each file ──
let fail = 0;
for (const rel of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' });
  } catch (e) {
    fail++;
    console.log('FAIL  ' + rel);
    const msg = (e.stderr && e.stderr.toString()) || e.message;
    console.log('      ' + msg.split('\n').slice(0, 3).join('\n      '));
  }
}

if (excluded.length) {
  console.log('Excluded (documented): ' + excluded.map((f) => f + ' — ' + EXCLUDE.get(f)).join('; '));
} else {
  console.log('Exclusions: none.');
}
console.log('Checked ' + files.length + ' tracked JS file(s).');
console.log(fail === 0 ? 'SYNTAX OK' : fail + ' FILE(S) FAILED SYNTAX');
if (fail) process.exit(1);
