# Warning Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 120 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): each
repository warning of RM-8 is shown on the settings page with its fix, and on
the dashboard and the repository management page as a label that leads to it.
This also shows a background fetch's credential problem outside the repository
screen (the second half of RC-6).

**Architecture:** The warnings come with every summary since plan 108, and
`shell-repository-status` already shows their labels. The settings page adds a
**Warnings** block under its header, one line per warning with its fix:

| Warning                             | Fix                       | Opens                                                                 |
| ----------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| "Credentials refused"               | **Fix credentials**       | the credentials dialog in its RC-12 mode, through plan 118's `change` |
| "Can't push with these credentials" | **Use other credentials** | the credentials dialog (RC-7)                                         |
| "Server identity changed"           | **Review the new key**    | `ChangedHostKeyDialog` (RC-21)                                        |
| "Key locked"                        | **Unlock**                | `UnlockKeyDialog` (RC-16)                                             |

A fix on this page runs no git operation afterwards: the warning goes when the
next operation of its kind succeeds (RM-8), and a fetch runs at once after **Fix
credentials**, **Review the new key** and **Unlock**, through `POST
…/git/fetch`, so that a fetch's warning can go without opening the repository
_(plan's call)_. **Review the new key** needs the new key: the push or fetch
problem's params hold it (RC-21), so the summary's warning alone is not enough;
the details endpoint (plan 106) gains the stored problems' params for this
_(plan's call)_.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-8, AC-REPO-003.6,
AC-REPO-003.7); `docs/requirements/repo-credentials.md` (RC-4, RC-6, RC-12,
RC-15, RC-16, RC-21).

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- On the dashboard and the management page, a warning is a label next to the
  status, and the entry's name or **Settings** link leads to the fix _(plan's
  call: no dialogs open from a list)_. An openable repository stays openable
  (RM-8).
- After a fix, the store reloads; a warning that a fetch cleared goes on
  `repository.warning`.
- Colour is never the only signal (NF-13.7): each warning has its text and an
  icon.

## Review Focus

- **A refused push** shows "Credentials refused" on all three pages, and a
  successful background fetch does not remove it; the next push does →
  end-to-end test `AC-REPO-003.6`.
- **After a restart**, "Key locked" with **Unlock**, which unlocks and makes the
  warning go → end-to-end test `AC-REPO-003.7`.
- **Review the new key** shows the new key's fingerprint, from the stored
  problem → test `shows the new key from the stored problem`.

---

### Task 1: The stored problems in the details

**Files:**

- Modify: `libs/shared/contracts/src/repositories/repository-details.schema.ts`,
  `libs/server/feature/repositories/src/repositories/repositories.controller.ts`
  (+ spec), `apps/server-e2e/src/repositories.e2e.spec.ts`,
  `docs/architecture/api.md`

**Interfaces:**

- Produces: `RepositoryDetails.remoteProblems: { fetch: GitProblemState | null;
  push: GitProblemState | null }`, the stored problems with their params, which
  never hold a secret.

- [ ] **Step 1: Write the failing tests**: `answers the stored problems with
      their params`; `answers none for a repository in error`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repositories): the stored remote problems in
      the details`

---

### Task 2: The fixes

**Files:**

- Create (with `toolkit-nx`): `components/repository-warnings/` under
  `libs/web/feature-repositories/src/repositories/` (+ spec)
- Modify: `pages/repository-settings/*`, `components/credentials-in-use/*`,
  `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-management.spec.ts`,
  `apps/web-e2e/src/dashboard.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `CredentialsInUseComponent.change` (plan 118), `UnlockKeyDialog`,
  `ChangedHostKeyDialog`, `GitApi.fetch`.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-003.6: a repository whose
      last push was refused shows "Credentials refused" on the dashboard, this
      page and its settings page, and can still be opened; a successful
      background fetch does not remove the warning, and the next successful push
      does` (end to end); `AC-REPO-003.7: after a backend restart, a repository
      with a passphrase-protected key shows "Key locked" with Unlock` (end to
      end); `offers each warning's fix`; `fetches after a fix`; `shows the new
      key from the stored problem`; `cancelling a fix changes nothing`; `an
      openable repository with warnings has Open`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `warning-fixes`, and
      removes RM-8; REQ-REPO-002 adds it, removes RC-6, and becomes **Done** if
      nothing else is left. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): fix repository
      warnings`.
