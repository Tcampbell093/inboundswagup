/* =========================================================================
   identity-origin.test.js — validates the frontend Identity-origin resolver
   used in auth.js and login.html. Dependency-free; run: node staging/identity-origin.test.js
   Mirrors the exact inline resolver so its four required behaviors are checked:
     production https  -> production Identity
     staging https     -> staging Identity
     deploy https      -> that site's Identity
     local file://     -> production Identity fallback (never "null/...")
   ========================================================================= */

// Keep this identical to the inline resolver in auth.js / login.html.
function resolveIdentityBase(loc) {
  var origin = loc && loc.origin;
  var proto  = loc && loc.protocol;
  var useOrigin = (proto === 'https:' || proto === 'http:') && !!origin && origin !== 'null';
  return (useOrigin ? origin : 'https://inboundswagup.netlify.app') + '/.netlify/identity';
}

var cases = [
  { name: 'production https',
    loc: { protocol: 'https:', origin: 'https://inboundswagup.netlify.app' },
    expect: 'https://inboundswagup.netlify.app/.netlify/identity' },
  { name: 'staging https',
    loc: { protocol: 'https:', origin: 'https://inboundswagup-staging.netlify.app' },
    expect: 'https://inboundswagup-staging.netlify.app/.netlify/identity' },
  { name: 'deploy URL https',
    loc: { protocol: 'https:', origin: 'https://6a5f906d70a018124f256b62--inboundswagup.netlify.app' },
    expect: 'https://6a5f906d70a018124f256b62--inboundswagup.netlify.app/.netlify/identity' },
  // file:// browsers report origin as the string "null" (and protocol file:)
  { name: 'local file:// (origin "null")',
    loc: { protocol: 'file:', origin: 'null' },
    expect: 'https://inboundswagup.netlify.app/.netlify/identity' },
  // Some engines expose no origin at all under file://
  { name: 'local file:// (origin absent)',
    loc: { protocol: 'file:', origin: '' },
    expect: 'https://inboundswagup.netlify.app/.netlify/identity' },
];

var failed = 0;
for (var i = 0; i < cases.length; i++) {
  var c = cases[i];
  var got = resolveIdentityBase(c.loc);
  var ok = got === c.expect && got.indexOf('null/.netlify/identity') === -1;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + c.name + '  -> ' + got);
  if (!ok) { failed++; console.log('      expected: ' + c.expect); }
}
console.log('\n' + (failed === 0 ? 'ALL PASS' : (failed + ' FAILED')));
if (failed) process.exit(1);
