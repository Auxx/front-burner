# Mark as Resolved and Start Over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 100 of [the step 4 index](2026-11-08-00-roadmap-step-4.md):
**Mark as resolved** finishes an edited file, asking first when markers are
left, and **Start over** brings a resolved file back to where the merge stopped.

**Architecture:** The backend decides whether markers are left (plan 91): the
client sends the file's save first, asks for the resolve, and only on `409
conflict-markers-left` asks the question and sends it again with `force`. A
resolved file is no longer shown in the editor, as saves to it are refused (plan
90): it shows **Resolved** and **Start over**, and **Show mine** and **Show
theirs**.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-8, GC-14, GC-18, GC-27,
AC-GIT-003.6, AC-GIT-003.8).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Exact text: "This file still has conflict markers. Mark it as resolved
  anyway?" For **Start over**, when `edited`: "Start this file over? Your edits
  to it are lost."
- A failed save stops the resolve, as the file on disk is not what the user
  sees.
- **Start over** drops the file's waiting save and browser draft, and reloads
  it, with no question of ED-24, as the user asked for it (as GA-24 does for a
  discard).

## Review Focus

- **A waiting save, then Mark as resolved:** the content committed must be what
  the user sees (GC-14) → Task 1 test `sends a waiting save first`.
- **A save that fails first** stops it, and says why → Task 1 test `does not
  resolve when the save failed`.
- **A browser draft left behind** must not be offered after the file is resolved
  or started over → Task 1 test `leaves no draft behind`.
- **Marked resolved on another device while editing here:** this tab's next save
  is refused and the file shows as resolved; the text is kept in the browser
  draft (ED-20) → Task 2 test `keeps what was typed when another device resolved
  the file`.
- **Start over on a file that isn't open** works without opening an editor first
  → Task 2 test `starts over a file that is not open`.

---

### Task 1: Mark as resolved

**Files:**

- Create (with `toolkit-nx`): `dialogs/markers-left/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `components/conflict-file/*`,
  `services/merge-actions/merge-actions.service.ts` (+ spec),
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`

**Interfaces:**

- Produces: `MergeActionsService.markResolved(path: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-003.6: Mark as resolved with
      a marker left asks to confirm; without markers it marks the file resolved
      at once` (end to end); `sends a waiting save first`; `does not resolve
      when the save failed`; `cancelling the question changes nothing`; `leaves
      no draft behind`; `moves on to the next file`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Commit** — `feat(repository-screen): mark a file as resolved`

---

### Task 2: Start over

**Files:**

- Create (with `toolkit-nx`): `dialogs/start-over/` under `repository-screen/`
  (+ spec)
- Modify: `components/conflict-file/*`,
  `services/merge-actions/merge-actions.service.ts` (+ spec),
  `services/open-files/open-files.service.ts` (+ spec),
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `GitApi.startConflictOver`, `GitConflictFile.edited`.
- Produces: `MergeActionsService.startOver(path: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-003.8: Start over on a
      resolved file brings back its conflict markers and marks it unresolved`
      (end to end); `asks when the user edited it`; `does not ask for a whole
      version`; `reloads the open file`; `starts over a file that is not open`;
      `keeps what was typed when another device resolved the file`; `says why it
      failed, and the file stays resolved`; `shows Resolved instead of the
      editor`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `mark-resolved-ui`, and
      removes GC-14 and GC-18. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): start a file
      over`.
