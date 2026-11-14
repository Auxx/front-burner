# Clone Status Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 116 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): the
**Status** section of the settings page shows a clone's progress, or the error's
label with a **Details** section that holds git's error and the request ID.

**Architecture:** One component, shown only for `cloning` and `error` (RM-9).
Progress reuses what the lists show (`shell-repository-status` with its progress
bar, DS-23); the page's store (plan 115) reloads the details when the status
changes, so the error record appears when a clone fails while the page is open.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-7, RM-9, RM-10, AC-REPO-003.4's
first half); AR-52, AR-53; NF-10.6.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- **Details** is a disclosure, closed by default, whose content is git's error
  as plain text in a preformatted block that wraps on a phone, never as HTML
  (RM-10), and "Request ID: _id_" with a **Copy** button _(plan's call)_.
- Without a detail (a timeout, an interrupted clone, a working copy found
  missing on start): "No message from git was recorded." and the request ID if
  any.
- "Waiting for other clones to finish" while the clone waits its turn (AR-52),
  as the lists say it.
- No action here: **Retry clone** and **Clone again** are plan 117's.

## Review Focus

- **Markup in git's error** (`<img src=x onerror=…>`) is shown as text → test
  `shows git's error as text`.
- **A long error** wraps and does not widen the page on a phone → test `fits a
  phone`.
- **A clone that fails while the page is open** shows its error and details
  without a reload → test `shows the error of a clone that fails while open`.

---

### Task 1: The Status section

**Files:**

- Create (with `toolkit-nx`): `components/clone-status/` under
  `libs/web/feature-repositories/src/repositories/` (+ spec)
- Modify: `pages/repository-settings/*`, `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-management.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `RepositorySettingsStore` (plan 115).

- [ ] **Step 1: Write the failing tests**: `shows progress while cloning`; `says
      it is waiting for other clones`; `shows the error's label`; `keeps Details
      closed at first`; `shows git's error as text`; `shows the request ID with
      Copy`; `says when git recorded no message`; `shows the error of a clone
      that fails while open`; `is hidden for a ready repository`; `fits a
      phone`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `clone-status-ui`.
      AC-REPO-003.4 is named by plan 117, with **Retry clone**.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): show a clone's status
      and error`.
