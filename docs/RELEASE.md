# Houston Control — release flow

The approved path from change to production. Each arrow is a gate; do not skip.

```
feature branch
   → draft PR (base: main)
   → automated checks (GitHub Actions: PR validation)
   → staging deployment (staging branch → inboundswagup-staging)
   → manual staging smoke test
   → explicit merge authorization (maintainer)
   → production deployment (merge to main → inboundswagup)
   → production smoke test
```

## Steps

1. **Feature branch** — branch from the current `main` (`agent/...` or `claude/...`). Never commit to `main` directly.
2. **Draft PR** — open a draft PR targeting `main`. Fill in the checklist in the PR template.
3. **Automated checks** — the `PR validation` workflow (`.github/workflows/pr-validation.yml`) runs automatically on the PR on **Node.js 24 (LTS)**. It is **production-isolated validation with no application external calls**: the checks use no production secrets, make no database connection, no Netlify change, send no email, make no production API calls, and perform no application writes. (GitHub Actions itself uses network to check out the repo and set up Node — that is infrastructure, not application access.) It runs:
   - JavaScript syntax validation of **every tracked `*.js`/`*.mjs`/`*.cjs`** (`staging/check-syntax.js`)
   - `index.html` / `login.html` inline-script parsing (`staging/check-inline-scripts.js`)
   - staging regression tests (`staging/*.test.js`)
   - a whitespace / conflict-marker check on the PR diff (`git diff --check`)

   **Local reproduction:** `npm test` runs the first three groups (syntax, inline-script parsing, staging regression tests). It does **not** run the PR-range whitespace check — run that separately against the base branch:
   ```
   git fetch origin main
   git diff --check origin/main...HEAD
   ```
4. **Staging deployment** — fast-forward the `staging` branch to the reviewed PR head commit (only when it is a clean fast-forward; never force-push). The isolated `inboundswagup-staging` Netlify site auto-deploys from `staging`. Staging has its own database and Identity — no production data is touched.
5. **Manual staging smoke test** — exercise the affected flows on the staging site while signed in with staging test accounts (see `staging/RUNBOOK.md`). Write/delete testing is safe on staging.
6. **Explicit merge authorization** — a maintainer explicitly authorizes the production merge. Verify: PR open & mergeable, PR head == reviewed commit, base `main` == expected known-good commit, `staging` == reviewed commit.
7. **Production deployment** — merge the PR into `main` with a normal GitHub merge commit. Merging `main` triggers Netlify's own production deploy of `inboundswagup`. No manual `--prod` deploy is run.
8. **Production smoke test** — after the production deploy completes, verify the affected flow on `https://inboundswagup.netlify.app`. If anything regresses, revert with `git revert <merge-sha>` via a new PR.

## Guarantees
- The CI gate never has access to secrets/production. Its application checks are production-isolated with no application external calls — they only parse source and run offline tests. (Actions' own checkout/Node-setup use GitHub-hosted network access; that is infrastructure, not application access.)
- Staging and production are fully isolated (separate Netlify sites, separate Neon databases, separate Netlify Identity).
- `main` is only advanced through reviewed, authorized merges.

## Recommended `main` branch protection (NOT applied — for separate authorization)

Tuned for the **current single-maintainer** workflow (GitHub does not allow a PR
author to approve their own PR, so requiring an approval now would hard-block all
merges):

- Require a pull request before merging (block direct pushes to `main`).
- Require the **`Validate PR (offline application checks)`** status check to pass; require branches to be up to date before merging.
- Require conversation resolution before merging.
- Block force pushes to `main` and block branch deletion.
- **Required approving reviews: 0 for now.** Raise to **1 once a second trusted reviewer** with repository access is added.
- Optionally enforce the rules for administrators after a short trial period.

Do **not** enable "Require linear history": the approved release process uses
normal GitHub **merge commits**, which linear history forbids (it would force a
switch to squash or rebase merging).
