# Warehouse Operations Hub

## Overview
Warehouse Operations Hub is a single-page internal operations app for warehouse workflows. It combines multiple operational modules into one browser-based interface so supervisors can manage daily work, review status, and export summaries from a single place.

## Current modules
- Home dashboard
- Attendance
- Warehouse Errors
- Employees
- Calendar
- Assembly
- Available Queue
- QA Inbound

## How it works
The app is a browser-first single-page application:
- `index.html` contains the app shell and page sections
- `script.js` contains navigation, storage, rendering, business logic, and export behavior
- `style.css` contains the global styling for the app shell and module layouts

Navigation is handled inside the page. Clicking a sidebar button switches the active page rather than loading a new HTML file.

## Data storage
Most app data is stored in browser `localStorage`.

### Primary storage keys
- `ops_hub_attendance_records_v2`
- `ops_hub_employees_v1`
- `ops_hub_attendance_backup_v2`
- `ops_hub_errors_records_v2`
- `ops_hub_assembly_board_v2`
- `ops_hub_available_queue_v1`
- `ops_hub_scheduled_queue_v1`
- `ops_hub_incomplete_queue_v1`
- `ops_hub_revenue_reference_v1`

## Sync behavior
Assembly-related data has optional Netlify backend sync through:
- `/.netlify/functions/assembly`

The sync payload currently covers:
- assembly board
- available queue
- scheduled queue
- incomplete queue
- revenue reference

If backend sync is unavailable, the app falls back to browser storage.

## Key workflow areas
### Assembly
Assembly handles pack-builder planning, stage/status handling, revenue reference lookups, and day-based summaries.

### Available Queue
Queue data is split into:
- available
- scheduled
- incomplete

Queue items include PB/SO/account/qty/products/units/IHD and Salesforce/PDF link support.

### Attendance
Attendance supports:
- department views
- employee history
- automatic demerits by status
- sorting/filtering
- summary rollups

### Errors
Warehouse Errors tracks:
- department
- associate
- PO/link identifiers
- expected vs received quantity
- absolute variance
- error rate
- notes

## Important implementation notes
- This is currently a **prototype with real operational logic**
- The codebase is functionally strong but structurally monolithic
- Queue and Assembly are the most tightly coupled parts of the system
- Broad edits to `script.js` or `style.css` can create side effects across unrelated modules

## Recommended next steps before professional handoff
1. Freeze one stable baseline version
2. Split `script.js` into module files
3. Split `style.css` into base/layout/module styles
4. Standardize overlay behavior in one shared UI helper
5. Add project documentation:
   - `ARCHITECTURE.md`
   - `STORAGE_KEYS.md`
   - `HANDOFF_NOTES.md`
   - `CHANGELOG.md`

## Intended handoff outcome
The eventual goal is a seamless professional handoff where engineers can:
- understand the system quickly
- modify one module without breaking others
- preserve behavior while refactoring structure
- adopt the project without needing to undo the core design
