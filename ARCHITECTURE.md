# ARCHITECTURE.md

How the Warehouse Operations Hub is structured. For storage shape and key names see [STORAGE_KEYS.md](STORAGE_KEYS.md). For deploy verification see [SMOKE_TEST.md](SMOKE_TEST.md).

## Stack

- **No build step.** Plain HTML/CSS/JS served from the project root.
- **Vanilla JS, classic `<script>` tags.** No bundler, no modules, no framework. Each `.js` file is loaded by `index.html` in a defined order. Top-level `let`/`const` in one file is visible to all later-loaded files via shared script-scope.
- **Persistence:** `localStorage` for everything, plus an optional Netlify Functions backend (`/.netlify/functions/*`) for cross-device sync.
- **Deploy:** Static site to Netlify; auto-deploys from the linked GitHub repo on push.

## Script load order

`index.html` loads these in order. The order matters — later scripts depend on earlier ones.

```
1. history-client.js     — history log API client
2. navigation.js         — page switching
3. sidebar.js            — sidebar UI
4. storage.js            — loadJson/saveJson + assembly sync
5. state.js              — row arrays, storage keys, normalize/save fns, setters
6. helpers.js            — escapeHtml, escapeJs, renderPbLink, buildSalesforcePbLink
7. queue.js              — Pack Builder Queue logic
8. queue-command-center.js — queue card views + command bar
9. assembly.js           — Assembly Planner logic
10. script.js            — everything else (attendance, employees, errors, calendar, returns, home, bootstrap)
11. history-panel.js, sord.js, import-hub.js, revenue-tracker.js, …
12. attendance-remix.js, productivity-module.js, fulfillment-scan-prototype.js, …
13. huddle-module.js, meeting-hub.js, policy.js, help.js, cycle-count.js, …
14. auth.js, access.js, settings.js
```

**Why this order:**
- `storage.js` defines `loadJson`/`saveJson` — needed before any module that reads localStorage.
- `state.js` declares the row arrays (`assemblyBoardRows`, `availableQueueRows`, etc.) — must load before `queue.js`/`assembly.js` reference them.
- `helpers.js` defines `escapeHtml` etc. — used by every render function.
- `queue.js` defines `issueHoldQueueStorageKey` and exports `window.availableQueueRows` getters — `script.js` references both, so `script.js` loads last among the "core 4".

## Module responsibilities

| File | Owns | Notes |
|---|---|---|
| `state.js` | Row arrays + storage keys + normalize/save helpers + `set*` mutators | Single source of truth for queue/assembly state. Mutate via setters, not direct rebinding. |
| `helpers.js` | Pure utilities: `escapeHtml`, `escapeJs`, `renderPbLink`, `buildSalesforcePbLink` | Pure functions, no app state. |
| `storage.js` | `loadJson`, `saveJson`, assembly backend sync (`loadAssemblyFromBackend`, `syncAssemblyState`) | `saveJson` triggers a debounced sync when the key is in `assemblySyncKeys`. |
| `queue.js` | Pack Builder Queue page: render, import, schedule, hold, search/sort | Currently mutates `assemblyBoardRows` and `scheduledQueueRows` directly — see Coupling below. |
| `assembly.js` | Assembly Planner page: render board, date controls, focus list, stage handling | Currently mutates `scheduledQueueRows` directly — see Coupling below. |
| `script.js` | Everything else: attendance, employees, errors, calendar, home, returns, bootstrap, `safeRun`, `updateAllData` | Still the largest file. Long-term goal is to keep shrinking this. |
| `navigation.js` | Hash-based page switching (`#assemblyPage`, etc.) | |
| `sidebar.js` | Sidebar collapse, active-state highlighting | |
| `app.js` | Largest file in repo (~7.8k lines). Status unclear — investigate before relying on it. | |

## State ownership

All mutable row state lives in `state.js`. Cross-file mutations go through the setter functions:

```js
setAssemblyBoardRows(next);
setAvailableQueueRows(next);
setScheduledQueueRows(next);
setIncompleteQueueRows(next);
setQueueRawRowCount(next);
setRevenueReferenceRows(next);
```

Direct rebinding (`assemblyBoardRows = ...`) still works due to shared script scope, but the setters make the mutation explicit and grep-able. Prefer setters.

Other state (employees, attendance, errors, calendar) still lives in `script.js` as top-level `let` variables. Move to `state.js` opportunistically if you're already touching the surrounding code.

## Data flow

### On page load
1. `storage.js` defines `loadJson`/`saveJson` (sync helpers reference state.js arrays at call time, not parse time).
2. `state.js` calls `loadJson(...)` for each row key and initializes arrays.
3. `script.js` reaches `bootstrapWarehouseHub()` at the bottom of the file (line ~1995).
4. Bootstrap calls `loadAssemblyFromBackend()`, `loadEmployeesFromBackend()`, `loadAttendanceFromBackend()` in parallel.
5. If the backend returns state, `applyAssemblySyncPayload` overwrites the local arrays via direct reassignment in `storage.js` (this works because of shared script scope).
6. All `render*` functions run; UI is populated.

### On user action (e.g. unschedule)
1. Click handler in HTML calls a function (e.g. `removeAssemblyBoardRow(id)`).
2. Function mutates state via setters.
3. Function calls `updateAllData()` (or `updateAssemblyData()` for assembly-only changes).
4. `updateAllData` saves each array to localStorage and re-runs `render*` functions inside `safeRun()` blocks.
5. `saveJson` notices the key is in `assemblySyncKeys` and schedules a debounced POST to `/.netlify/functions/assembly`.

## Coupling and known tech debt

### Queue ↔ Assembly cross-mutation
`queue.js` rebinds `assemblyBoardRows`; `assembly.js` rebinds `scheduledQueueRows`. They share state through `state.js` but each module reaches into the other's domain. The next architectural step is either:
- Extract a thin event bus so each module only touches its own state and emits events the other can subscribe to, OR
- Collapse `queue.js` and `assembly.js` into a single "scheduling" module.

### `storage.js` rebinds state directly
`applyAssemblySyncPayload` in `storage.js` uses direct assignment (`assemblyBoardRows = ...`) instead of the setters. This works but inconsistent with the convention elsewhere. Low priority — `storage.js` is the only consumer.

### `script.js` is still the catch-all
~2.2k lines, mixed concerns: attendance + employees + errors + calendar + returns + home + bootstrap. Further splits possible (`attendance.js`, `errors.js`, etc.) — same pattern as the state.js/helpers.js extractions.

### `app.js` (~7.8k lines)
Status unclear. Investigate what it does and whether it's still used before touching it.

### No build step → no module system
Adding a real bundler (Vite, esbuild) would let us use ES modules with explicit `import`/`export`. Worth considering once the next person is onboard — until then, the classic-script pattern is simpler to debug.

### No automated tests
[SMOKE_TEST.md](SMOKE_TEST.md) is the current substitute. See its closing note for why this only catches regressions, not novel bugs.

## Conventions

- **Pure functions go in `helpers.js`.** If it takes inputs and returns outputs with no side effects, it doesn't belong in `script.js`.
- **State mutations go through setters.** `setAssemblyBoardRows(next)`, not `assemblyBoardRows = next`. Direct rebinding works but obscures the data flow.
- **Renders read from state, never from the DOM.** All `render*` functions should derive output from the current value of the row arrays.
- **Never delete a storage key.** Bump the version suffix (`_v2` → `_v3`) and migrate. See STORAGE_KEYS.md.
- **Don't introduce `var`.** Use `let`/`const`. Classic scripts already share scope.

## Recovery

Every commit in this repo is reversible. If a deploy breaks the app:

```bash
git log --oneline -5         # find the bad commit
git revert <hash>            # creates a new commit that undoes it
git push                     # Netlify auto-redeploys
```

The smoke test (SMOKE_TEST.md) should catch the failure before users do.
