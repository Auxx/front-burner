# Step 5 Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 126 of [the step 5 index](2026-11-14-00-roadmap-step-5.md):
end-to-end tests walk through exit criterion 11 on desktop and on a phone,
AC-REPO-003.14 gets its test, and the documents are brought up to date, so that
every MVP point is built and every MVP criterion has a test when step 6 starts.

**Architecture:** Tests and documents only. A problem these tests find is fixed
in this branch when it is small, and otherwise gets its own plan before this one
is merged.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/product/mvp.md` (exit criterion 11);
`docs/requirements/repo-manage.md` (RM-1, RM-3, AC-REPO-003.14);
`docs/architecture/non-functional.md` NF-12.5, NF-13.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- The walkthrough runs in the whole browser matrix of NF-12.2, as `web-e2e`
  does.
- AC-REPO-003.14 needs a second user, which the MVP cannot create: the server
  end-to-end suite adds one to the database directly, as its support code does
  for other fixtures, and checks every endpoint of REQ-REPO-003 (list, details,
  removal check, remove, clone again, credentials, commit author) for another
  user's repository against a missing one: same status, same body apart from the
  request ID.

## Review Focus

- **Touch alone on a phone** and **keyboard alone on desktop** for both pages
  and every dialog (RM-3) → Task 1's walkthroughs.
- **A clone that fails, then succeeds** after changing the credentials on the
  settings page → Task 1 test `exit criterion 11`, first round.
- **Credentials that stop working** (the token revoked on the test remote): the
  warning, its fix, the warning gone → Task 1, second round.
- **A removal with work to lose** and the second device → Task 1, third round.
- **Same answer** for another user's repository as for a missing one, on every
  endpoint → Task 2.

---

### Task 1: The walkthroughs

**Files:**

- Create: `apps/web-e2e/src/repository-management-walkthrough.spec.ts`
- Modify: `apps/web-e2e/src/support/` as needed

- [ ] **Step 1: Write the walkthroughs**: `exit criterion 11 on desktop, with
      the keyboard only`; `exit criterion 11 on a phone, by touch only`. Each: a
      clone that fails with wrong credentials, **Details**, **Change
      credentials**, **Retry clone**, **Open**; a token revoked, "Credentials
      refused", **Fix credentials**, the warning gone; a working copy deleted
      while stopped, **Clone again**; a removal with uncommitted files, the
      typed name, a second device sent to the dashboard.
- [ ] **Step 2: Run them**, and fix what fails — `npx nx e2e web-e2e`.
- [ ] **Step 3: Commit** — `test(web-e2e): step 5 walkthrough`

---

### Task 2: Another user's repositories, and the documents

**Files:**

- Modify: `apps/server-e2e/src/repositories.e2e.spec.ts`,
  `apps/server-e2e/src/support/` as needed, `docs/product/mvp.md`,
  `docs/architecture/data.md` (what `sync_state` holds now),
  `docs/architecture/api.md`, `docs/wiki/todo.md`

- [ ] **Step 1: Write the test**: `AC-REPO-003.14: a request for another user's
      repository settings, or to remove another user's repository, gets the same
      response as for a repository that does not exist`, over every endpoint of
      REQ-REPO-003.
- [ ] **Step 2: Run it**, and fix what fails — `npx nx e2e server-e2e`.
- [ ] **Step 3: Update the documents**: REQ-REPO-003 adds `step-5-walkthrough`,
      becomes **Done** when every criterion has a test, and has nothing in "MVP
      points not built". Every other row of the table is checked against its
      State's definition. Run `doc-ids.mjs criteria` and copy its result: only
      ED-10's limited point may remain anywhere. Known gaps found on the way go
      into `docs/wiki/todo.md`.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done** and the index's status to **Accepted** if it is not
      yet; commit `test: step 5 walkthrough and documents`.
