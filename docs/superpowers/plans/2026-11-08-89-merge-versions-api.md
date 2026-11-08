# Merge Versions API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 89 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): `GET
…/git/merge/version` returns my version or their version of a conflicting
Markdown file, so that the user can compare them before choosing one.

**Architecture:** It reads the blob by the object ID that `GitMerge.conflicts`
found in the index's stages, also for a file already resolved (A-5.11).
Read-only, outside the working-tree lock.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-17);
`docs/requirements/editor.md` (ED-2's limit); `docs/architecture/git-engine.md`
A-5.11.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- `side` is `mine` or `theirs`, the words of the glossary.
- It refuses, with `409`: `no-merge-in-progress`, `not-conflicting` (the path is
  not one of the merge's conflicting files), and `version-not-readable` (not
  Markdown, a symbolic link, over `MAX_FILE_BYTES`, not valid UTF-8, or that
  side deleted it).

## Review Focus

- **A path that is not a conflict,** such as `.git/config` or a file outside the
  merge, is refused before any git command runs with it → Task 1 test `refuses a
  path that is not conflicting`.
- **A version larger than 1 MB** is refused from its size, not after reading it
  → Task 1 test `refuses a large version without reading it`.
- **A file already resolved** can still be compared → Task 1 test `reads a
  version of a resolved file`.
- **A file that is not valid UTF-8** must be refused, not sent with U+FFFD in it
  → Task 1 test `refuses a version that is not valid UTF-8`.

---

### Task 1: Reading a version

**Files:**

- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/shared/contracts/src/git/git-merge.schema.ts` (+ spec),
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/server/feature/sync/src/merge/merge-state.service.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.dto.ts`, `apps/web/public/i18n/en.json`,
  `docs/product/mvp.md`

**Interfaces:**

- Produces:
  - `GitMerge.readVersion(workingCopy: string, oid: string): Promise<string |
    null>`: `git cat-file blob <oid>`, or `null` when it does not decode.
  - `GET /api/v1/repositories/:id/git/merge/version?path=&side=`
    (`gitMergeVersion`, `GitMergeVersion`: `{ content: string }`).

- [ ] **Step 1: Write the failing tests**: `reads my version and their version`;
      `reads a version of a resolved file`; `refuses a path that is not
      conflicting`; `refuses a large version without reading it`; `refuses a
      version that is not valid UTF-8`; `refuses the side that deleted the
      file`; `refuses without a merge`; `answers another user's repository like
      a missing one`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-core-git server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `merge-versions-api`;
      GC-17 "(only the backend is built)". Run `doc-ids.mjs criteria` and copy
      its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): read a version of a
      conflicting file`.
