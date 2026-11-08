# Start Over API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 92 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): `POST
…/git/merge/start-over` puts a resolved file back as it was when the merge
stopped, with its conflict markers, and the merge state says whether the user
had edited it.

**Architecture:** `git update-index --unresolve` brings the stages back from the
index's resolve-undo record. The file on disk is then written as the merge left
it: a Markdown file with `GitMerge.writeMarkers`, so that its labels are the
branch names again, and any other file as my version, which nothing can edit
anyway, or their version if I deleted it. `git checkout -m` is not used: it
labels markers `ours` and `theirs`, which breaks GC-5 _(plan's call; it updates
A-5.10)_.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-5, GC-18's backend half,
GC-19, GC-27); `docs/architecture/git-engine.md` A-5.10.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- `edited` is true for a resolved file when its stage-0 blob (`git ls-files -s`)
  is neither my version nor theirs, so a file resolved with a whole version asks
  nothing (GC-18). A `delete` has no stage-0 entry, and is not edited.
- A file that is not resolved is `409 not-resolved`; nothing changes.

## Review Focus

- **A file resolved with `delete`** comes back on disk with its stages → Task 1
  test `brings back a file that was deleted`.
- **A Markdown file that does not decode** has no markers to write, and gets my
  version rather than breaking → Task 1 test `gives my version of a file that
  does not decode`.
- **Labels after starting over** are the branch names, not `ours` and `theirs`,
  also with `zdiff3` in the config → Task 1 test `writes the same markers as the
  merge`.
- **Another file's resolution** is not disturbed (GC-19) → Task 1 test `leaves
  the other files alone`.
- **`edited` after line-ending normalisation:** a whole version that
  `.gitattributes` changes when added looks edited, and only causes one more
  question, the safe way → Task 1 test `asks when in doubt`.

---

### Task 1: Starting over

**Files:**

- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/shared/contracts/src/git/git-merge.schema.ts` (+ spec),
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/server/feature/sync/src/merge/merge-state.service.ts` (+ spec),
  `libs/server/feature/sync/src/merge/merge-actions.service.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.dto.ts`, `apps/web/public/i18n/en.json`,
  `docs/architecture/git-engine.md`, `docs/product/mvp.md`

**Interfaces:**

- Produces:
  - `GitMerge.startOver(workingCopy: string, entry: ConflictEntry, labels: {
    mine: string; theirs: string }): Promise<void>`.
  - `ConflictEntry.edited: boolean`, and `GitConflictFile.edited: boolean`.
  - `POST /api/v1/repositories/:id/git/merge/start-over` (`startConflictOver`,
    `204`, `GitConflictPath`: `{ path: string }`).
  - Error code `not-resolved`.

- [ ] **Step 1: Write the failing tests**: `brings back the markers and marks
      the file unresolved`; `writes the same markers as the merge`; `brings back
      a file that was deleted`; `brings back my version of a binary file`;
      `gives my version of a file that does not decode`; `brings back their
      version of a file I deleted`; `says when the user edited it`; `says
      nothing for a whole version`; `asks when in doubt`; `refuses a file that
      is not resolved`; `leaves the other files alone`; `publishes files.changed
      and git.changed`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`. In A-5.10,
      "`git checkout -m`" becomes "`git update-index --unresolve`, then the
      markers".
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `start-over-api`; GC-18
      "(only the backend is built)". Run `doc-ids.mjs criteria` and copy its
      result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): start a file over`.
