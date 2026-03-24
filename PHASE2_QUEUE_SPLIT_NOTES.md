# Phase 2 Queue Split

This package performs the next safe refactor step.

## What changed
- `navigation.js` contains page switching logic
- `storage.js` contains localStorage + assembly sync helpers
- `queue.js` now contains queue-related DOM hooks, issue-hold flow, revenue-reference import, queue render logic, queue import logic, scheduling flow, and related event wiring
- `script.js` keeps the rest of the app

## Load order
`index.html` now loads:
1. `navigation.js`
2. `storage.js`
3. `queue.js`
4. `script.js`

## What to test
- Page switching
- Queue page loads
- Search/sort on Queue page
- Queue import still works
- Hold / Schedule / Unschedule / View in Assembly
- Home still loads
- Assembly still loads
