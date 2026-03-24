# Assembly Split Phase

This package performs the next safe split.

## What changed
- Moved the Assembly module out of `script.js` into `assembly.js`
- Updated `index.html` to load:
  1. navigation.js
  2. storage.js
  3. queue.js
  4. assembly.js
  5. script.js

## What stayed the same
- CSS files are unchanged
- queue.js is unchanged
- Home, Attendance, Errors, Employees, Calendar remain in script.js

## What was moved
- Assembly DOM hooks
- Assembly date controls
- Assembly render/update/edit/remove functions
- Assembly event listeners and quick date controls

## What to test
- Page switching
- Assembly page loads
- Add Assembly row
- Edit / Save / Cancel on Assembly
- Stage changes
- Remove / Reschedule / Hold from Assembly
- Queue > View in Assembly
- Home still reflects Assembly stats
- Calendar still opens Assembly for a selected day
