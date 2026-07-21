/* =========================================================================
   check-inline-scripts.js — parse-validate inline <script> blocks in the HTML
   entry points, using the project's existing method (new Function(code)).
   Offline, no deps, no writes. Run: node staging/check-inline-scripts.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = ['index.html', 'login.html'];

let fail = 0;
for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  // Only inline blocks: <script> ... </script> with no src attribute.
  const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  let ok = true;
  blocks.forEach((b, i) => {
    const code = b.replace(/^<script>/, '').replace(/<\/script>$/, '');
    try { new Function(code); }
    catch (e) { ok = false; fail++; console.log('FAIL  ' + file + ' inline #' + i + ': ' + e.message); }
  });
  console.log((ok ? 'OK    ' : 'FAIL  ') + file + ' (' + blocks.length + ' inline scripts)');
}
console.log('\n' + (fail === 0 ? 'INLINE SCRIPTS OK' : fail + ' INLINE SCRIPT(S) FAILED'));
if (fail) process.exit(1);
