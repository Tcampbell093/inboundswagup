# Houston Control — Staging setup & testing runbook

Stand up a **fully isolated** staging environment (separate Netlify site,
separate empty Neon project, separate Netlify Identity) for safe authenticated
role testing. Production is never touched.

> All infrastructure/credential steps below are performed **by you** in the
> Netlify and Neon dashboards. This repo/branch only contains the code changes
> that make staging isolation possible (see "What this branch changed").

## What this branch (`agent/p1a-staging-isolation`) changed
- Every hardcoded production Netlify Identity URL is now **parameterized**:
  - Backend functions read `process.env.IDENTITY_URL` (default = production URL, so production is unchanged): `_auth.js`, `users.js`, `chat.js`, `notifications.js`, `system-reset.js`, `workflow-sync.js`.
  - Frontend (`auth.js`, `login.html`) derives the Identity origin from `window.location.origin`, so each site uses its own Identity automatically.
- Added `staging/ENVIRONMENT.md` (env-var names), `staging/staging-seed.sql` (synthetic data), and this runbook.
- **No** site, database, env var, credential, deploy, or production change was made.

## Prerequisites (decisions already made for this phase)
- Separate Netlify site: **`inboundswagup-staging`**
- Separate, **empty** Neon project (not a branch/copy of production)
- Fully isolated Netlify Identity on the staging site
- Deploy branch: **`staging`**
- Env vars entered **manually** in Netlify
- **No** email / invites / Gmail / Resend / Gemini / backups yet
- **Synthetic** test data only

## Step 1 — Create the `staging` branch
```
git checkout main && git pull --ff-only origin main
git switch -c staging
# merge or cherry-pick agent/p1a-staging-isolation once its PR is approved
git push -u origin staging
```
(Do this after the P1A PR is merged, so staging includes the parameterization.)

## Step 2 — Create the empty Neon staging project
1. Neon console → **New Project** → name `houston-staging` (do **not** branch from production).
2. Copy the **pooled** connection string → this becomes staging `DATABASE_URL`.
3. Leave it empty; the app self-creates most tables. `hc_users` is created by the seed.

## Step 3 — Create the staging Netlify site
1. Netlify → **Add new site → Import from GitHub** → `Tcampbell093/inboundswagup`.
2. Site name: `inboundswagup-staging` (URL `https://inboundswagup-staging.netlify.app`).
3. **Production branch = `staging`** (Site config → Build & deploy → Branches).
4. Build settings come from `netlify.toml` (command `node build-version.js`, functions `netlify/functions`).

## Step 4 — Enable isolated Netlify Identity on the staging site
1. Staging site → **Identity → Enable Identity** (this is a *separate* Identity instance from production).
2. **Registration = Invite only** (prevents open signup).
3. **External providers → enable Google** (login is Google OAuth).
4. Note the Identity base URL: `https://inboundswagup-staging.netlify.app/.netlify/identity`.

## Step 5 — Set staging environment variables (names only — see ENVIRONMENT.md)
In the **staging** site's environment settings, set:
- `DATABASE_URL` = staging Neon pooled string
- `IDENTITY_URL` = `https://inboundswagup-staging.netlify.app/.netlify/identity`
- `FUNCTIONS_REQUIRE_AUTH` = `true`
- `WORKFLOW_SYNC_REQUIRE_AUTH` = `true`
- (optional) `SITE_URL` = staging URL

**Leave unset** (keeps integrations off): `RESEND_API_KEY`, `NETLIFY_PAT`, `GMAIL_*`,
`INVENTORY_NOTIFY_FROM`, `FROM_EMAIL`, `GEMINI_API_KEY`, `ADMIN_EMAIL`, `BACKUP_EMAIL`.

Never copy production secret values.

## Step 6 — Deploy staging
- Trigger a deploy of the `staging` branch from the staging site (push to `staging` or "Trigger deploy").
- This is the staging site's normal deploy — not a production deploy of the main site.

## Step 7 — Seed synthetic data
1. Edit `staging/staging-seed.sql`: replace the `*@example.com` placeholders with the **real Google accounts** you'll test with (emails must match, lowercase).
2. In the **staging** Neon SQL editor (confirm you are on the staging project!):
   ```sql
   CREATE TABLE __staging_confirmed ();   -- opt-in guard; staging only
   ```
3. Run `staging-seed.sql`. Confirm the row-count summary at the end.
4. Invite the same test Google accounts into the staging **Identity** (Identity → Invite users), so they can sign in. Roles come from `hc_users` (seeded), not Identity.

## Step 8 — Role-testing checklist (browser, against the staging URL)
Sign in as each account and confirm nav + a representative endpoint result.

| Persona (seed account) | Expected |
|---|---|
| Admin | Settings visible; user list + audit load; `employees` GET full; admin endpoints 200 |
| Manager | No Settings nav; `employees`/attendance/productivity 200; `users?action=update` **403**; `users?action=list` 200 |
| L1 / L2 | No attendance/productivity/settings nav; `employees` GET **roster-only** (no birthday/rate); `attendance` **403**; `productivity-sync` **403**; `po-lookup` 200 |
| External | Flight tracker only; `employees` GET **403**; photo GET/POST 200; photo **DELETE 403** |
| Active temp-admin | Behaves as Admin (Settings visible; admin endpoints 200) |
| Expired temp-admin | Behaves as base L1 (no Settings; admin endpoints 403; roster-only employees) |
| Suspended | Blocked at login / P0 endpoints 403 |
| Not-invited (`invited=false`) | P0 endpoints 403 |
| Unauthenticated / invalid token | P0 endpoints 401 |
| DB unreachable (optional) | P0 endpoints 503 (fail-closed) |

Authenticated writes/deletes are safe here (isolated DB) — exercise POST/DELETE freely.

## Rollback / cleanup
- Staging is fully additive; nothing to roll back in production.
- Tear down: delete the staging Netlify site, delete the Neon `houston-staging`
  project, delete the `staging` branch (`git push origin --delete staging`).
- Because staging holds only synthetic data, deletion carries no privacy exposure.

## Guardrails recap
- Verify `DATABASE_URL` and `IDENTITY_URL` point at **staging** before any test.
- Never create `__staging_confirmed` on production.
- Keep all secrets only in the staging site's env config — never in the repo or chat.
