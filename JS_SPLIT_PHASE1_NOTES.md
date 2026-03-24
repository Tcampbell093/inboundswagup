# JS Split Phase 1

This is the first safe JavaScript split.

## What changed
- Moved page navigation code into `navigation.js`
- Moved local storage + assembly sync helpers into `storage.js`
- Left the rest of the app logic in `script.js`

## Why this split is safe
- No business logic was intentionally changed
- Queue, Assembly, Attendance, Errors, Employees, Calendar logic still remain in `script.js`
- `index.html` now loads:
  1. `navigation.js`
  2. `storage.js`
  3. `script.js`

## What to test
- Page switching
- Data still loads
- Attendance buttons still work
- Queue/Assembly still render
- Any backend assembly sync still behaves the same
