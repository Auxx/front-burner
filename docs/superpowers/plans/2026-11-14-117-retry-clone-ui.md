# Retry Clone and Clone Again Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 117 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): the
**Status** section offers **Retry clone** for a failed, timed out or interrupted
clone, and **Clone again**, after a warning, for a working copy that is missing
or damaged. A locked key is unlocked first.

**Architecture:** Both call `POST /repositories/:id/clone` (plan 112). On `409
key-locked` the page opens `UnlockKeyDialog` from `web/repository-dialogs` and
sends again once the key is unlocked, as the Add repository page does (RC-16).
The status turns **Cloning** from the response at once, and the store follows
the clone from there (plan 115).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-11 to RM-13, AC-REPO-003.4,
AC-REPO-003.5); `docs/requirements/repo-credentials.md` (RC-16).

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- **Clone again** opens a confirmation dialog: "Clone _name_ again? Any changes
  and commits that were only in the old working copy are lost." with **Clone
  again** and **Cancel** (RM-12). **Retry clone** needs no question: nothing is
  lost.
- The button is busy while the request runs; a second press does nothing.
- The rate limit and clone limit refusals show their messages from the error
  codes, as on the Add repository page.
- The section names the credentials in use, with a link to the **Credentials**
  section, so the user can change them first (RM-11) _(plan's call)_. _Changed
  while implementing:_ the section says in one line that the clone uses the
  credentials shown under **Credentials**, which can be changed first. That
  section, just below, already names them and has **Change credentials**; naming
  them twice would read the credentials twice and keep two copies up to date.
- _Changed while implementing:_ the warning of **Clone again** is
  `DialogService.confirm()` with the `danger` variant, as other confirmations
  are, rather than a new `dialogs/clone-again/` dialog: it is a heading, one
  sentence and two buttons. The unlock reads the repository's credentials for
  the key's type and fingerprint, since `409 key-locked` names only its ID and
  name, and asks once per press.

## Review Focus

- **A locked key** is asked for, and the clone starts after it is unlocked →
  test `unlocks the key first`.
- **Cancel** on the unlock dialog or the warning changes nothing → test
  `cancelling changes nothing`.
- **Two quick presses** send one request → test `sends one request`.

---

### Task 1: Retry and clone again

**Files:**

- Create (with `toolkit-nx`): `dialogs/clone-again/` under
  `libs/web/feature-repositories/src/repositories/` (+ spec)
- Modify: `components/clone-status/*`, `services/repository-settings-store/*` (+
  spec), `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-management.spec.ts`, `apps/web-e2e/src/support/`
  (a failing remote for the clone, and stopping the backend to delete a working
  copy, as the step 4 walkthrough restarts it), `docs/product/mvp.md`

**Interfaces:**

- Consumes: `RepositoriesApi.cloneAgain` (plan 112), `UnlockKeyDialog`.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-003.4: a failed clone shows
      "Clone failed" and, under Details, the git error without secrets and with
      the request ID; Retry clone clones again with the same settings, and
      changing the credentials first is possible` (end to end); `AC-REPO-003.5:
      deleting a working copy's directory while the backend is stopped shows
      "Working copy is missing or damaged" after the next start; Clone again
      warns about lost work, clones it, and keeps the repository's name and
      commit author override` (end to end); `unlocks the key first`; `cancelling
      changes nothing`; `sends one request`; `shows a limit's refusal`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `retry-clone-ui`, and
      removes RM-11 to RM-13. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): retry a clone`.
