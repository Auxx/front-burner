# Credentials Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 118 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): the
**Credentials** section of the settings page shows the credentials in use, never
their secret, and **Change credentials** opens the repository credentials dialog
(the second half of RC-11).

**Architecture:** The section reads `GET /repositories/:id/credentials`, which
already answers `inUse` with the saved credentials' fields (step 3), and opens
`RepositoryCredentialsDialog` from `web/repository-dialogs` as the repository
screen's `CredentialFixesService` does, without an operation to run again: on
the settings page, saving the dialog is the end _(plan's call)_. The section
then reloads, and the page's store reloads the summary, since new credentials
clear "Can't push with these credentials" (plan 107).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-14, AC-REPO-003.8);
`docs/requirements/repo-credentials.md` (RC-7 to RC-11); A-10.50.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- A key-value list (A-10.50): for HTTPS credentials, "Name", "Kind" (HTTPS
  credentials) and "Username"; for an SSH key, "Name", "Kind" (SSH key), "Key
  type", "Fingerprint" (`SHA256:…`, in a monospace font that can wrap) and
  "Passphrase" (Protected or None). Without credentials: "No credentials (public
  repository)".
- **Change credentials** is offered in every status, including `error` and
  `cloning`, so that a failed clone can be retried with others (RM-11).
- The dialog's own behaviour (its choices, access check, unlock and host trust)
  does not change here.

## Review Focus

- **No secret** in the page: the DOM never holds a password, token or private
  key → test `never shows a secret`.
- **After saving** in the dialog, the section and the warnings are up to date
  without a reload → test `shows the new credentials after saving`.
- **A failed clone** can change its credentials → test `offers Change
  credentials for a failed clone`.

---

### Task 1: The Credentials section

**Files:**

- Create (with `toolkit-nx`): `components/credentials-in-use/` under
  `libs/web/feature-repositories/src/repositories/` (+ spec)
- Modify: `pages/repository-settings/*`, `services/repository-settings-store/*`,
  `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-management.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `RepositoriesApi.getCredentials` (or the existing operation's name),
  `RepositoryCredentialsDialog`.
- Produces: `CredentialsInUseComponent` with `change(): Promise<boolean>` (true
  when the dialog saved), which plan 120 reuses for its fixes.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-003.8: the Credentials
      section shows the credentials' name, kind and, for an SSH key, its
      fingerprint, never the secret; Change credentials opens the repository
      credentials dialog` (end to end); `shows HTTPS credentials with the
      username`; `shows an SSH key with its type, fingerprint and passphrase`;
      `shows a public repository`; `never shows a secret`; `shows the new
      credentials after saving`; `cancelling changes nothing`; `offers Change
      credentials for a failed clone`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `credentials-section`;
      REQ-REPO-002 adds it, and removes RC-11. Run `doc-ids.mjs criteria` and
      copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): the credentials
      section`.
