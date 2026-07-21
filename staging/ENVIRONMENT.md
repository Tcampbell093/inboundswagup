# Staging environment variables (names only — no values, no secrets)

This lists the environment variables the Houston Control functions read, and how
to set them for an **isolated staging** deploy. **Never** put real values in this
repo, in chat, or in any commit — enter them only in the staging Netlify site's
environment settings.

Isolation model for staging:
- **Separate Netlify site** (`inboundswagup-staging`) built from the `staging` branch.
- **Separate, empty Neon project** (not a branch/copy of production).
- **Fully isolated Netlify Identity** on the staging site.
- **No external integrations** yet (email, invites, Gmail, Resend, Gemini, backups off).

## Required for staging

| Name | Purpose | Staging guidance |
|---|---|---|
| `DATABASE_URL` | Postgres/Neon connection string | The **staging** Neon pooled connection string. Never the production value. |
| `IDENTITY_URL` | Netlify Identity (GoTrue) base origin, e.g. `https://<site>/.netlify/identity` | Set to the **staging** site's Identity base so backend token verification uses staging Identity. Unset → defaults to the production URL (do **not** rely on the default in staging). Backend reads this in `_auth.js`, `users.js`, `chat.js`, `notifications.js`, `system-reset.js`, `workflow-sync.js`. |

> The **frontend** (`auth.js`, `login.html`) derives its Identity origin from
> `window.location.origin` at runtime, so it automatically uses the staging
> site's own Identity when served from the staging domain — no frontend env var
> needed.

## Recommended for staging

| Name | Purpose | Staging guidance |
|---|---|---|
| `FUNCTIONS_REQUIRE_AUTH` | Global on/off for the older feature-flagged `guard()` endpoints | `true` — enforce auth on non-P0 endpoints in staging. (P0 endpoints are always enforced regardless.) |
| `WORKFLOW_SYNC_REQUIRE_AUTH` | Enforce auth on `workflow-sync` | `true`. |
| `IDENTITY_USER_URL` | Explicit override of just the Identity `/user` endpoint | Normally leave unset; `IDENTITY_URL` + `/user` is derived automatically. |
| `SITE_URL` | Canonical site URL used for links | Staging site URL. Already env-parameterized (e.g. in `inventory.js`); production default otherwise. |
| `SITE_ID` | Netlify site id (used by the invite→Identity-admin path) | Staging site id, only if you later enable invites. |
| `OPS_METRICS_TZ` | Timezone label for metrics capture | Optional; cosmetic. |

## Deliberately LEFT UNSET in staging (keep external integrations off)

Leaving these unset disables the corresponding side effect (the code no-ops when
they are absent). Do not set them for this phase.

| Name | Disables |
|---|---|
| `RESEND_API_KEY` | Houston's **automated, app-driven** invite / temp-admin-expiry emails |
| `NETLIFY_PAT` | Houston's **automated** invite path that programmatically creates Netlify Identity users |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM` | Gmail-based notifications |
| `INVENTORY_NOTIFY_FROM`, `FROM_EMAIL` | Inventory / notification sender addresses |
| `GEMINI_API_KEY` | `meeting-summary` AI proxy |
| `ADMIN_EMAIL`, `BACKUP_EMAIL` | Recipients for backups / temp-admin notices (scheduled functions stay harmless against the empty DB) |

### Invitations — what stays off vs. what's allowed

- **Houston's automated invite/email integrations stay DISABLED** in staging: leave
  `RESEND_API_KEY`, the Gmail credentials (`GMAIL_*`), and `NETLIFY_PAT` **unset**.
  With these unset, the app's Settings "Invite user" flow and its automated emails do not run.
- **Manual Netlify Identity invitations ARE allowed** — but only for **staging test
  accounts you own or control**. Invite them from the staging site's Identity dashboard
  (Identity → Invite users), not through the app.
- **These manual Identity invitations may generate Netlify's own invitation emails** to
  those addresses. That is expected and fine for accounts you own.
- **Registration stays "Invite only"** on the staging Identity instance.
- **Never invite real employees or production users** into staging merely for testing.

## Build-injected (no action needed)

`BRANCH`, `COMMIT_REF` — set automatically by Netlify at build time and consumed by `build-version.js`.

## Never do

- Never copy production `DATABASE_URL` (or any production secret) into staging.
- Never print, echo, or commit any value for the names above.
- Never point staging at the production database or production Identity.
