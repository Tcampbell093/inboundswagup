# Warehouse Operations Hub - Architecture

## 1. High-level shape
This app is a **single-page application in vanilla HTML/CSS/JavaScript**.

### File responsibilities
- `index.html`  
  App shell, sidebar navigation, page sections, and module containers

- `script.js`  
  Application state, storage, rendering, business logic, sync, exports, and event wiring

- `style.css`  
  Global design tokens, shell layout, tables, cards, buttons, and module styling

---

## 2. Runtime model

### Navigation model
The app uses a page-toggle system:
- sidebar buttons have `data-page`
- pages are `<section>` elements with class `page`
- one page is shown at a time via `.page.active`

Navigation state is also persisted in `localStorage` so the last active page can be restored.

### State model
State is loaded from browser storage at boot time into in-memory arrays such as:
- `attendanceRecords`
- `employees`
- `errorRecords`
- `assemblyBoardRows`
- `availableQueueRows`
- `scheduledQueueRows`
- `incompleteQueueRows`
- `revenueReferenceRows`

The app then renders UI from these in-memory collections.

### Persistence model
Writes are generally handled through helper methods that:
1. update in-memory state
2. save the updated value into `localStorage`
3. optionally trigger backend sync for Assembly-related data

---

## 3. Main modules

## Home
Purpose:
- read-only operational dashboard
- summarizes data already maintained in other modules

Depends on:
- employees
- attendance
- errors
- assembly board
- revenue reference

## Attendance
Purpose:
- attendance entry and department tracking
- employee history and demerit logic

Core behaviors:
- status marks
- auto-demerits
- employee summary
- search/sort/filter
- backup/undo for clear-all behavior

## Warehouse Errors
Purpose:
- log warehouse/department errors
- quantify operational misses

Core behaviors:
- expected vs received comparisons
- absolute variance
- rate calculation
- filtering and sorting

## Employees
Purpose:
- shared employee source used by multiple modules

Likely dependencies:
- Attendance
- Calendar
- Home

## Calendar
Purpose:
- date-based visibility including birthdays and assembly-related scheduling context

## Assembly
Purpose:
- manage the assembly planning board
- track stage/status, units, scheduling, and revenue references

Key characteristics:
- tightly coupled to queue data and revenue references
- one of the most important workflow modules
- part of the backend sync payload

## Available Queue
Purpose:
- manage queue items before/around assembly planning

Queue buckets:
- available
- scheduled
- incomplete

Key characteristics:
- uses PB/SO/account/unit metadata
- integrates with Salesforce/PDF link construction
- strongly connected to Assembly workflows

## QA Inbound
Purpose:
- separate workflow section with its own scoped styling region

---

## 4. Shared helpers and infrastructure

### Storage helpers
Core helper pattern:
- `loadJson(key, fallback)`
- `saveJson(key, value)`

These provide common serialization/deserialization and trigger assembly sync where needed.

### Sync helpers
Assembly-related data can sync to Netlify via:
- `assemblyApiRequest`
- `buildAssemblySyncPayload`
- `applyAssemblySyncPayload`
- `loadAssemblyFromBackend`
- `syncAssemblyState`

These are specific to Assembly-adjacent state.

### Normalization helpers
The app normalizes records on load so rendering can expect stable object shapes, including:
- employees
- attendance
- errors
- assembly rows
- queue rows
- scheduled queue rows
- revenue references

This is a strong foundation and should be preserved in any refactor.

### Link helpers
Salesforce/PDF open behavior is centralized through helpers like:
- `buildSalesforcePbLink`
- `getAssemblyOpenLink`

This is good architecture and should remain centralized.

---

## 5. Structural risks in the current version

## Monolithic `script.js`
The app currently keeps many concerns in one file:
- navigation
- storage
- sync
- module logic
- exports
- rendering
- event handlers

Risk:
Small edits can create side effects outside the intended module.

## Monolithic `style.css`
The stylesheet controls:
- app shell
- cards
- tables
- buttons
- calendar
- assembly
- queue
- workflow page styling

Risk:
A visual tweak for one workflow can unintentionally affect others.

## UI behavior tied to table structure
Queue and Assembly behavior appears to depend heavily on:
- exact row structure
- exact column order
- specific DOM assumptions

Risk:
Overlay and row-action changes are fragile unless isolated.

---

## 6. Recommended target architecture

## Front-end structure
### HTML
- keep a single-page shell unless the team later chooses a framework

### CSS
Split into:
- `styles/base.css`
- `styles/layout.css`
- `styles/attendance.css`
- `styles/errors.css`
- `styles/employees.css`
- `styles/calendar.css`
- `styles/assembly.css`
- `styles/queue.css`

### JS
Split into:
- `scripts/app.js`
- `scripts/navigation.js`
- `scripts/storage.js`
- `scripts/utils.js`
- `scripts/attendance.js`
- `scripts/errors.js`
- `scripts/employees.js`
- `scripts/calendar.js`
- `scripts/assembly.js`
- `scripts/queue.js`
- `scripts/ui-overlay.js`

---

## 7. Recommended refactor order

### Phase 1
Freeze stable baseline

### Phase 2
Document the system

### Phase 3
Split CSS first

### Phase 4
Split JS for:
- navigation
- storage
- assembly
- queue

### Phase 5
Standardize row renderers for Queue and Assembly

### Phase 6
Unify overlay behavior into one shared helper

### Phase 7
Add explicit data attributes for safer DOM targeting

---

## 8. Handoff guidance

A professional team should be told:
- the app already contains real business logic
- localStorage is currently the primary persistence layer
- Assembly sync is the only backend-connected area today
- Queue + Assembly are the most sensitive areas
- the best near-term win is structural cleanup without behavior changes

This makes the project easier to inherit and reduces the chance that the team feels they need to rebuild it from scratch.
