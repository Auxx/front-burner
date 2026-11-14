# Navigation and Dashboard Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 125 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): the
criteria of REQ-APP-001 and REQ-DASH-001 that no test names yet get their tests,
now that every page they speak of exists, and DS-20, listed as not built since
plan 15, is checked and finished.

**Architecture:** Tests first. DS-20 looks built (an openable repository's name
links to the repository screen, which opens it and sets its last access time),
so the first step is to find what plan 15 left out: if the dashboard entry must
open on a click anywhere on it, as the switcher's entries do (NV-10), that is
built here; if nothing is missing, the status table is corrected. A problem
these tests find is fixed in this branch when it is small, and otherwise gets
its own plan before this one is merged.

**Tech Stack:** as before; `@axe-core/playwright`, already used by `web-e2e`
(check, and add only if it is not).

**Spec:** `docs/requirements/navigation.md` (NV-1 to NV-6, NV-17 to NV-19,
AC-APP-001.1, AC-APP-001.2, AC-APP-001.4, AC-APP-001.12, AC-APP-001.13);
`docs/requirements/dashboard.md` (DS-7 to DS-9, DS-20, AC-DASH-001.6,
AC-DASH-001.11).

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- AC-APP-001.10 is plan 115's and AC-APP-001.11 plan 124's: not named here.
- The tests run in the whole browser matrix of NF-12.2, as `web-e2e` does, and
  the phone criteria (AC-APP-001.4) at 360 px wide.
- axe-core runs on the app header of the dashboard, the repository management
  page, the settings page, the Add repository page and the Preferences page.

## Review Focus

- **The current page's link** is marked for screen readers (`aria-current`),
  also inside the phone's **Menu** → test `AC-APP-001.2`.
- **Opening the management page** does not change the dashboard's order → test
  `AC-DASH-001.6`.
- **Focus after navigation** is on the page's heading on every page → test
  `AC-APP-001.12`.

---

### Task 1: The tests, and DS-20

**Files:**

- Modify: `apps/web-e2e/src/app-header.spec.ts`,
  `apps/web-e2e/src/dashboard.spec.ts`, and what DS-20 needs if anything in
  `libs/web/feature-dashboard/src/dashboard/components/repository-entry/*` (+
  spec), `docs/product/mvp.md`

- [ ] **Step 1: Find what DS-20 lacks**: read plan 15
      (`2026-10-28-15-repository-screen.md`) and pull request #42 for why DS-20
      stayed open, and write down the answer in this plan's pull request.
- [ ] **Step 2: Write the failing tests**: `AC-APP-001.1: every page that needs
      a login has the app header with Dashboard, Repositories and the user menu;
      the login page has no app header`; `AC-APP-001.2: Dashboard leads to the
      dashboard and Repositories to the repository management page; the current
      page's link is marked as current`; `AC-APP-001.4: on a phone, the links
      are in a Menu button, and nothing scrolls sideways`; `AC-APP-001.12: Skip
      to content is the first element reached with Tab; after moving to another
      page, focus is on its heading and a screen reader announces its title`;
      `AC-APP-001.13: the menus open and close with the keyboard, Esc returns
      focus to their button, and axe-core reports no violations in the app
      header`; `AC-DASH-001.6: opening a repository in the editor moves it to
      the top of the list the next time the dashboard is shown; opening the
      dashboard or the repository management page does not change the order`;
      `AC-DASH-001.11: clicking an openable repository opens it in the editor`.
      All end to end.
- [ ] **Step 3: Run them**, and fix what fails — `npx nx e2e web-e2e`.
- [ ] **Step 4: Update the status**: REQ-DASH-001 adds `navigation-tests`,
      removes DS-20 and becomes **Done**; REQ-APP-001 adds it, and becomes
      **Done** when plans 123 and 124 are merged too. Run `doc-ids.mjs criteria`
      and copy its result.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `test(web-e2e): navigation and dashboard
      criteria`.
