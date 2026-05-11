// Writes version.js with the current build's git SHA, branch, and timestamp.
// Run by Netlify's build command (see netlify.toml). The generated file
// exposes `window.__BUILD_INFO` for the app to display in Settings.
const fs = require('fs');

const info = {
  sha: process.env.COMMIT_REF || 'unknown',
  branch: process.env.BRANCH || 'unknown',
  builtAt: new Date().toISOString(),
};

fs.writeFileSync('version.js', `window.__BUILD_INFO=${JSON.stringify(info)};\n`);
console.log('Wrote version.js:', info);
