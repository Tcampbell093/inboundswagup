# Rotation Module — Build Spec

Houston Control module for fair distribution of garbage duty and labor-share loans.

*(Name it whatever fits — "Rotation" reads neutral. Avoid anything that sounds like a scoreboard on people.)*

> **Status:** phases 1–2 built (schema, person identity layer, ranking endpoint,
> people/merge endpoint). Phases 3+ not started. This copy of the spec is the
> living one — it reflects decisions made during the build, most notably the
> person identity model in §4.

---

## 1. Problem

Associates report "you always send me" for two assignments: garbage duty and being
loaned to another department. There is currently no record of who was sent where, so
the complaint can't be answered and leads can't self-check.

The goal is **not** to win arguments after the fact. It's to make assignment
non-discretionary and visible before it happens.

Success looks like: tomorrow's assignments are posted the afternoon before, next to
everyone's running totals, and nobody has to argue.

---

## 2. Scope

Two mechanics, one module, one roster.

| | Garbage | Labor Share |
|---|---|---|
| Unit | Count of turns | Hours out of department |
| Duration | Fixed | Variable — ends when work ends |
| Planned | Day-of or standing order | Day before |
| Ends | Same day | Open-ended; needs a close event |
| After | — | Returns to home dept **or** goes to a project |

### Out of scope for v1
- Any other task types (design tables so more can be added, don't build them)
- Payroll or timeclock integration
- Mobile-specific views beyond responsive
- Automatic UPH adjustment in Daily Productivity (v2 — see §8)

---

## 3. Core rules

**Garbage ranking:** next up = lowest turn count in the rolling window, tie-break by
longest time since last turn. Do not store an explicit order pointer; derive it. That
way adds, terminations, and leaves don't corrupt the rotation.

**Labor-share ranking:** rank by **loaned hours + project hours combined**, ascending.
Not by count. A two-hour loan and a full shift are not the same imposition.

**Open blocks cap at shift end.** An open block counts its elapsed time in the
ranking, but never past its service-date's shift end (`ROTATION_SHIFT_END`, default
17:00, in `ROTATION_TZ`, default America/New_York). The autoclose job stamps blocks
at shift end; the cap means a block the job misses can't balloon overnight and
poison someone's total. A block opened *after* shift end is an anomaly the next
autoclose sweeps — until then it accrues real elapsed time.

**Rolling window:** default 90 days, configurable. Long enough to be fair, short
enough that someone who was out on leave six months ago isn't punished for it.

**Rank within department, not warehouse-wide.** The sending department absorbs the
gap, so a global pool can quietly drain Prep three days running while Rec is untouched.
Also track a department-level loaned-hours total.

**History belongs to people, not names.** Every history row keys to a stable
person id (`hc_rotation_people`). Roster names are looked up through an alias
table on write, creating a person for unseen names; a rename gets repaired with a
merge (§5), not lost. Fairness math over a 90-day window has to survive a roster
edit. See §4 for why roster ids can't do this job.

**Skips need a reason.** Leads will override the ranking — person called out, mid-job,
whatever. Silent skips make the rotation fake within a week. Picking someone outside
the top 3 of the ranking prompts a reason code. Skipped person stays at the front of
the ranking, not the back.

**Everything is visible to associates**, not just leads. A read-only floor view is the
feature, not a nice-to-have.

---

## 4. Data model (Neon Postgres)

Follow existing `hc_` table naming. Canonical DDL lives in
`netlify/functions/_rotation-schema.js` (auto-applied on first call) with a
standalone copy in `docs/rotation-schema.sql` for direct Neon use.

### Why not roster employee IDs

The obvious key — the roster's employee `id` — does not exist in practice:

- The frontend roster normalizer (`script.js` `normalizeEmployees()`) maps each
  employee to `{name, adpName, department, birthday, size, active}` — **no `id`
  field** — and it runs on every load, edit, and sync. The server would preserve
  an incoming id, but none ever arrives, so `employees_sync_state` stores
  `id: ""` for every employee.
- The roster sync is a full-replace POST (no merge), so even a properly
  introduced id would be clobbered by any client running older code or holding
  a stale localStorage copy.
- The floor-safe GET (l1/l2 roles) strips `id` by design; the codebase's real
  employee key is the **name** (dedup, lookups, attendance, and history logs are
  all name-keyed).
- Names are mutable: the roster editor renames in place, which would silently
  detach any name-keyed history.

So the module owns its identity:

```
hc_rotation_people          one row per human; SERIAL id is the stable key
  id, display_name, active, merged_into, created_at

hc_rotation_person_aliases  every roster spelling ever seen
  name_key (PK, lowercased), display_name, person_id -> people, created_at
```

Writes resolve roster name → person via the alias table (`resolvePersonId()` in
`_rotation-people.js`), creating a person for an unseen name. The alias primary
key makes creation race-safe and enforces one-person-per-name at the database.
A rename shows up as a "new" person until an admin merges it (§5); the merge
folds aliases **and** history into the surviving person and leaves the old row
deactivated with `merged_into` set, so nothing dangles.

### History tables

```sql
-- Task types, so v2 can add more without a migration
CREATE TABLE hc_rotation_tasks (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,   -- 'garbage' | 'labor_share'
  label_en        TEXT NOT NULL,
  label_es        TEXT NOT NULL,
  unit            TEXT NOT NULL,          -- 'count' | 'hours'
  active          BOOLEAN DEFAULT TRUE
);

-- Garbage and any future count-based duty
CREATE TABLE hc_rotation_turns (
  id              SERIAL PRIMARY KEY,
  task_code       TEXT NOT NULL REFERENCES hc_rotation_tasks(code),
  person_id       INT NOT NULL REFERENCES hc_rotation_people(id),
  employee_name   TEXT NOT NULL,          -- snapshot as written at assignment time
  department      TEXT NOT NULL,          -- snapshot at assignment time
  service_date    DATE NOT NULL,
  status          TEXT NOT NULL,          -- 'assigned' | 'completed' | 'skipped'
  skip_reason     TEXT,
  off_ranking     BOOLEAN DEFAULT FALSE,  -- TRUE if picked outside top 3
  off_ranking_reason TEXT,
  assigned_by     TEXT NOT NULL,          -- hc_users email
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Labor share + project time: any block of time out of home department
CREATE TABLE hc_assignment_blocks (
  id              SERIAL PRIMARY KEY,
  block_type      TEXT NOT NULL,          -- 'loan' | 'project'
  person_id       INT NOT NULL REFERENCES hc_rotation_people(id),
  employee_name   TEXT NOT NULL,          -- snapshot as written at assignment time
  home_department TEXT NOT NULL,          -- snapshot
  to_department   TEXT,                   -- for loans
  project_name    TEXT,                   -- for projects
  service_date    DATE NOT NULL,
  planned_start   TIMESTAMPTZ,            -- set the day before
  actual_start    TIMESTAMPTZ,
  actual_end      TIMESTAMPTZ,
  auto_closed     BOOLEAN DEFAULT FALSE,  -- TRUE if closed by the shift-end job
  outcome         TEXT,                   -- 'returned' | 'project'
  parent_block_id INT REFERENCES hc_assignment_blocks(id),  -- chains project to its loan
  off_ranking     BOOLEAN DEFAULT FALSE,
  off_ranking_reason TEXT,
  assigned_by     TEXT NOT NULL,          -- hc_users email
  closed_by       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_blocks_open ON hc_assignment_blocks (service_date)
  WHERE actual_end IS NULL;
CREATE INDEX idx_blocks_person ON hc_assignment_blocks (person_id, service_date);
CREATE INDEX idx_turns_person ON hc_rotation_turns (person_id, service_date);
```

**Snapshot department AND name on the row.** People transfer and get renamed.
Historical fairness math must reflect where — and who — they were at the time,
not what the roster says now. `assigned_by`/`closed_by` are hc_users emails
(the only durable caller identity in this app).

**Chaining:** loan finishes → if outcome is `project`, insert a new block with
`block_type='project'` and `parent_block_id` = the loan. Both count toward the
person's out-of-department hours.

---

## 5. Endpoints (Netlify functions)

Auth-gated the same way as existing functions — check `hc_users`, no public endpoints.
Reads allow every invited user (associate visibility is the feature); writes and the
merge are role-gated.

| Method | Function | Purpose |
|---|---|---|
| GET | `rotation-ranking` | `?task=&department=&window=90` → ranked roster with totals *(built)* |
| GET | `rotation-people` | People with their known names (aliases) *(built)* |
| POST | `rotation-people` | `{action:'merge', from_person_id, to_person_id}` — folds aliases + history into the target for renames; admin/manager only *(built)* |
| GET | `rotation-turns` | Garbage history, date-filterable |
| POST | `rotation-assign-turn` | Assign garbage; captures off-ranking reason |
| POST | `rotation-skip-turn` | Skip with reason; person stays front of ranking |
| GET | `rotation-loans` | `?date=` → planned + active loans for a date |
| POST | `rotation-plan-loan` | Create tomorrow's loan (planned_start, to_department) |
| POST | `rotation-start-loan` | Stamp actual_start |
| POST | `rotation-close-loan` | Body: `outcome`. If `project`, creates chained project block |
| GET | `rotation-out-now` | Everyone currently out, where, since when |
| GET | `rotation-summary` | Per-person and per-department totals for the window |

Every write endpoint resolves its roster name through `resolvePersonId()`
(creating people for unseen names) and stamps the `employee_name` snapshot.

**Scheduled function — `rotation-autoclose`.** Runs at shift end. Any block with
`actual_end IS NULL` closes at shift-end time with `auto_closed = TRUE`. A slightly
wrong number beats a blank row, and the flag shows which rows to distrust. Surface the
count of auto-closed blocks on the dashboard so it's visible if it becomes a habit.
(The ranking's shift-end cap in §3 is the belt to this suspenders: totals stay sane
even when a run is missed.)

---

## 6. UI

New page, sidebar entry alongside existing modules. **Bilingual EN/ES throughout** —
same toggle pattern as Cycle Count. Modal-based interactions, DM Sans + DM Mono,
Tabler icons, cache-busting query string on the CSS link.

### Tab: Today
- Who has garbage today
- Currently Out list — name, department, destination, since when, elapsed
- Close button on each open block → modal with two choices: **Back to department** /
  **Assign to project** (project name field)

### Tab: Plan Tomorrow
- Date picker, defaults to next business day
- Ranked roster per department, lowest hours first, showing running totals
- Assign → picks employee + destination department + planned start time
- Picking outside top 3 opens the reason modal
- **Publish button** → locks the plan and makes it visible on the floor view

### Tab: Balance
- Per person: garbage turns, loaned hours, project hours, combined, last assigned
- Per department: total hours loaned out, total received
- Window selector (30 / 90 / YTD)
- Print/export — this is the view that goes to leadership
- Admin affordance for the people registry: spotting a "new" person who is really
  a rename, and merging them (rotation-people POST)

### Floor view (read-only, no login)
- Tomorrow's published assignments
- Everyone's running totals, same department grouped together
- Bilingual, large type, readable on a wall-mounted screen or printed

The floor view is what actually solves the problem. Build it in v1, not later.

---

## 7. Build order

Don't one-shot this. Suggested phases, each independently testable:

1. **Schema + seed** the two task rows. Verify against Neon directly. ✔ built
2. **Ranking endpoint alone.** Get `rotation-ranking` returning correct order against
   seeded fake history before any UI exists. This is the piece most likely to be
   subtly wrong, so test it in isolation. ✔ built (with the person layer and
   rotation-people merge, verified against seeded local Postgres)
3. **Garbage flow end to end** — assign, skip, history. Simplest complete loop.
4. **Loan lifecycle** — plan, start, close, project chaining. Test the chain carefully.
5. **Autoclose scheduled function.** Verify with a deliberately unclosed block.
6. **Balance tab + floor view.**
7. **EN/ES pass** across everything.

---

## 8. v2 candidates

- Feed loaned/project hours into Daily Productivity so UPH denominators adjust for
  time out of department. This is the change that makes leads want the tool rather
  than tolerate it.
- Additional task types via `hc_rotation_tasks` (weekend coverage, overtime offers)
- Alert when one person's combined hours exceed the department median by some margin
- Slack post of the published plan

---

## 9. Note for whoever builds this

The data will probably show that the complaints are accurate — leads send the fast,
reliable, agreeable people repeatedly, because that's what works under pressure. Build
the reporting so it reads as "here's how we distribute fairly going forward" rather
than "here's proof about the past." That's a UI copy decision as much as a data one.
