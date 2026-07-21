<!-- Houston Control — pull request checklist -->

## Summary
<!-- What changed and why. -->

## Release checklist
- [ ] **Automated checks are green** (the "PR validation" workflow: syntax, inline-script parsing, staging regression tests, whitespace check).
- [ ] **Staging commit matches the reviewed PR head** — `staging` was fast-forwarded to this PR's head commit.
- [ ] **Staging smoke test completed** on the isolated staging site (relevant flows exercised manually).
- [ ] **Production merge requires explicit authorization** — do not merge without a maintainer's explicit "authorize merge".
- [ ] **Production smoke test required after deployment** — verify the affected flow on production once Netlify finishes deploying `main`.

## Notes
<!-- Risks, roll-back plan (e.g. `git revert <merge-sha>`), follow-ups. -->
