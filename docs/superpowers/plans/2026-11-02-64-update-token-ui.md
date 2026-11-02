# Update a Saved Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 64 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): when
the remote refuses saved HTTPS credentials, **Fix credentials** offers to update
their token in place, saying how many repositories use them.

**Architecture:** Two choices at the top of plan 63's dialog; only the first is
new. The default shows the username and a new token field and calls plan 62's
token endpoint; the second shows the choices the dialog already has.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-credentials.md` (RC-12, RC-13, the web half of
RC-14; criteria 4, 5).

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- The choices are **Update the token of _&lt;credentials name&gt;_**, the
  default, and **Use other credentials for this repository** (RC-12).
- "Used by 4 of your repositories", from `inUse.usedBy`, with Transloco's plural
  for 1.
- The **Password or token** field is masked and required, with
  `autocomplete="off"`. The username is prefilled, and can be changed (RC-12,
  AR-20).
- It is offered only when the refused credentials are saved HTTPS credentials
  (RC-14); `offerTokenUpdate` is set only by **Fix credentials**, not by **Use
  other credentials**.

## Review Focus

- **A token pasted with a trailing newline or spaces** is what the field sends,
  as tokens have none; trim it _(plan's call)_ → test `trims a pasted token`.
- **A failed update** stays in the dialog, shows the error, and keeps the
  username → test `AC-REPO-002.5: an update whose check fails shows the error`.
- **Credentials used by one repository** must say "Used by 1 of your
  repositories" → test `says how many repositories use the credentials`.
- **Switching to Use other credentials and back** must not send a token typed in
  the other choice → test `sends only the chosen choice's fields`.

---

### Task 1: Update the token

**Files:**

- Modify:
  `libs/web/repository-dialogs/src/repository-dialogs/dialogs/repository-credentials/*`
  (+ spec),
  `libs/web/feature-repository-screen/src/repository-screen/services/credential-fixes/credential-fixes.service.ts`
  (+ spec), `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `apps/server-e2e/src/git.e2e.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `RepositoriesApi.updateRepositoryToken` (plan 62),
  `RepositoryCredentialsInfo`.
- Produces: `RepositoryCredentialsDialogData.offerTokenUpdate?: boolean`.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-002.4: with an expired saved
      token used by four repositories, a push offers Update the token, and after
      updating, pushes from all four use the new token` (over the API for the
      four pushes, end to end for the dialog); `AC-REPO-002.5: an update whose
      check fails shows the error`; `says how many repositories use the
      credentials`; `offers the update only for saved HTTPS credentials`; `Use
      other credentials shows the choices of the protocol`; `trims a pasted
      token`; `sends only the chosen choice's fields`; `runs the push again
      after updating`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      web-repository-dialogs web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e && npx nx e2e server-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-002 adds `update-token-ui`, and
      removes RC-12 and RC-13. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `feat(dialogs):
      update a saved token in place`.
