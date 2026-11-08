# Whole Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 96 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): every
conflicting file can be resolved with a whole version, or kept or deleted, and
the screen moves on to the next unresolved file.

**Architecture:** `rs-conflict-file` offers what the file's kind allows, from
one pure function, so that the table is tested once. After this plan, any merge
can be finished through the API, and resolved on screen, though Markdown files
can't yet be edited.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-8, GC-15, GC-16, GC-17's
sizes, GC-19, GC-27, AC-GIT-003.7, AC-GIT-003.12); D-6.2, D-6.5.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Offers by kind:

  | Kind                         | Offers                                    |
  | ---------------------------- | ----------------------------------------- |
  | `both-changed`, `both-added` | **Use my version**, **Use their version** |
  | `deleted-by-me`              | **Keep the file**, **Delete the file**    |
  | `deleted-by-them`            | **Keep the file**, **Delete the file**    |

- Exact words: "You deleted this file; _origin/main_ changed it." and
  "_origin/main_ deleted this file; you changed it."
- The size of each version is shown, with `ui`'s size format, or "Deleted" for a
  version that does not exist.
- A choice resolves at once, without a question (GC-15). A resolved file shows
  **Resolved**; **Start over** comes in plan 100.
- After a resolve the selection moves to the next unresolved file after it, in
  list order, and wraps round; with none left, it stays.

## Review Focus

- **A waiting save of the file** must not land after **Use their version** →
  Task 1 test `drops the file's waiting save first`.
- **Pressing twice, or from two devices:** the second gets `not-conflicting`,
  which is not an error to show, as the file is resolved → Task 1 test `treats a
  second resolve as done`.
- **A failed resolve** says why and leaves the selection (GC-27) → Task 1 test
  `says why a resolve failed, and stays`.
- **The last file resolved** must not move the selection to nothing → Task 1
  test `stays on the last file`.
- **An open file resolved with a whole version** must show the new content when
  the merge ends, not its old content from memory → Task 1 test (end to end)
  `shows the chosen version after the merge`.

---

### Task 1: The choices

**Files:**

- Create: `utils/conflict-offers/conflict-offers.ts` (+ spec) under
  `libs/web/feature-repository-screen/src/repository-screen/`
- Modify: `components/conflict-file/*`,
  `services/merge-actions/merge-actions.service.ts` (+ spec),
  `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `GitApi.resolveConflict`, `MergeStore`, `OpenFilesService`.
- Produces:
  - `conflictOffers(file: GitConflictFile): GitResolution[]`.
  - `MergeActionsService.resolve(path: string, resolution: GitResolution):
    Promise<void>`.
  - `ConflictFileComponent` output `resolve` (`GitResolution`).

- [ ] **Step 1: Write the failing tests**: `AC-GIT-003.7: a conflicting PNG
      offers only Use my version and Use their version; a file deleted on the
      remote and changed locally offers Keep the file and Delete the file,
      saying which side deleted it` (end to end); `AC-GIT-003.12: Abort merge
      after resolving some files puts the branch and every file back exactly as
      before the pull; git status shows no merge in progress` (end to end);
      `offers what each kind allows`; `says which side deleted the file`; `shows
      the size of each version`; `moves on to the next unresolved file, and
      wraps round`; `stays on the last file`; `drops the file's waiting save
      first`; `treats a second resolve as done`; `says why a resolve failed, and
      stays`; `shows the chosen version after the merge` (end to end).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `whole-version-ui`, and
      removes GC-8, GC-15, GC-16, GC-19, GC-27 and GC-17's sizes. Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): resolve with a
      whole version`.
