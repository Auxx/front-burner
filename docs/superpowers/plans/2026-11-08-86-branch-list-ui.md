# Branch List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 86 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
branch in the bar becomes a button that opens the branch list, with a filter,
and in a single-branch clone a note. Selecting a branch comes in plan 87.

**Architecture:** The list is a dialog, not a menu: a filter field in a menu
breaks the ARIA menu pattern (NV-19), and a dialog works the same way on a phone
_(plan's call)_. It reads `GET …/git/branches` each time it opens, so it can't
be out of date. It closes with a result that says which branch was chosen.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-6, GA-7's button, GA-36,
GA-41, AC-GIT-002.18); `docs/requirements/navigation.md` (NV-11's shortened
names).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The filter is on the name, ignoring case, for local and remote branches alike;
  it is always shown. _(Plan's call: no threshold for "many branches".)_
- The current branch is marked in words as well as with an icon (NF-13.7). Exact
  text: "This is a single-branch clone, so other remote branches aren't
  available."
- The button's accessible name says what it does: "Branch main: open the branch
  list". While the status has no branch (a detached `HEAD`), it says "No branch"
  and opens the list too, as that is the way back.

## Review Focus

- **A read that fails** says why, with **Try again**, and does not show an empty
  list → Task 1 test `says why the list cannot be read`.
- **A filter that matches nothing** says so → Task 1 test `says when nothing
  matches`.
- **Thousands of branches** must open without freezing the phone: only the first
  200 matches are rendered, followed by "Filter to find the other 4,800" → Task
  1 test `shows the first 200 of 5,000 branches, and says to filter`.
- **A very long branch name** wraps or shortens without a sideways scroll → Task
  1 test `shows a long name without scrolling sideways`.
- **The bar's button during a merge** is gone, with the status it belongs to
  (plan 81) → Task 2 test `shows no branch button during a merge`.

---

### Task 1: The dialog

**Files:**

- Create (with `toolkit-nx`): `dialogs/branch-list/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `GitApi.gitBranches`.
- Produces: `BranchListDialog`, data `{ repositoryId: number }`, which closes
  with `BranchChoice | undefined`: `{ kind: 'local' | 'remote'; name: string }`
  (a remote one's `name` without `origin/`). Plan 87 uses it; plans 88 and 102
  add to it.

- [ ] **Step 1: Write the failing tests**: `lists local branches with the
      current one marked, then remote ones`; `filters by name, ignoring case`;
      `says when nothing matches`; `says why the list cannot be read`; `shows
      the first 200 of 5,000 branches, and says to filter`; `shows a long name
      without scrolling sideways`; `shows the note in a single-branch clone`;
      `moves focus to the filter, and works with the keyboard alone`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): the branch list`

---

### Task 2: The button

**Files:**

- Modify: `components/git-status-summary/*`, `components/repository-bar/*`,
  `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Produces: `GitStatusSummaryComponent` output `openBranches`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-002.18: in a single-branch
      clone, the branch list shows the single-branch note` (end to end); `opens
      the list from the branch`; `opens the list on a phone`; `returns focus to
      the button`; `shows no branch button during a merge`; `shortens a long
      name, with the full name on hover, focus or long press`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Selecting a branch only closes the list until
      plan 87.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `branch-list-ui`, and
      removes GA-7's branch list, GA-36 and GA-41. Run `doc-ids.mjs criteria`
      and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): the branch
      button`.
