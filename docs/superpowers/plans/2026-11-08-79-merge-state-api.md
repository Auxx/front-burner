# Merge State API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 79 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): `GET
…/git/merge` says what is merging into what, which files conflict and how, which
are resolved, and what merged by itself.

**Architecture:** Everything is read from git, as A-4.5 asks, so any device can
carry on and a restart changes nothing. `git ls-files -u -z` gives the
unresolved files' stages, and `git ls-files --resolve-undo -z` the same for the
ones that were resolved. The stages say the kind. It reads without the
working-tree lock, and with `--no-optional-locks` (A-5.3).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-1, GC-4, GC-6, GC-7, GC-15's
"cannot be edited", GC-17's sizes, GC-20's message);
`docs/requirements/editor.md` ED-2; `docs/architecture/git-engine.md` A-5.11.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The kind, from the stages that exist:

  | Stages     | Kind              |
  | ---------- | ----------------- |
  | 1, 2, 3    | `both-changed`    |
  | 2, 3       | `both-added`      |
  | 1, 3, or 3 | `deleted-by-me`   |
  | 1, 2, or 2 | `deleted-by-them` |

- An entry with only stage 1 is left out: both sides deleted the file, and plan
  76 removed it from the index, which leaves that resolve-undo entry behind.
- A file is `editable` when it is Markdown (`isMarkdownName`), of kind
  `both-changed` or `both-added`, both versions are regular files (mode `100644`
  or `100755`), and the file on disk, found through `resolveInWorkingCopy`, is a
  regular file of at most `MAX_FILE_BYTES` and valid UTF-8 (ED-2, GC-9).
- `message` is `.git/MERGE_MSG` without lines starting with `#` and trailing
  blank lines: git's "# Conflicts:" list is not part of the message (GC-20).
- `into` is the branch and `from` its upstream, from the status.

## Review Focus

- **The upstream pruned during the merge:** `from` still names it, as the config
  keeps it → Task 1 test `names the upstream after a fetch pruned it`.
- **A path with a tab, a line break or non-ASCII letters,** since `-z` output
  must be parsed by its NUL and first tab → Task 1 test `reads every kind of
  name`.
- **A rename on one side and a change on the other** gives odd stages; the file
  must still have a kind that offers a way out → Task 1 test `gives a kind to a
  file with one stage`.
- **A file resolved, then the list read:** its kind stays what it was, from the
  resolve-undo stages → Task 1 test `keeps the kind of a resolved file`.
- **No merge in progress** answers `409 no-merge-in-progress`, and another
  user's repository `404`, as for every git endpoint (GA-1) → Task 2 test
  `answers no merge and another user's repository`.

---

### Task 1: The engine

**Files:**

- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/server/core/git/src/index.ts`

**Interfaces:**

- Produces:
  - `ConflictKind`: `'both-changed' | 'both-added' | 'deleted-by-me' |
    'deleted-by-them'`.
  - `ConflictEntry`: `{ path: string; kind: ConflictKind; resolved: boolean;
    mineOid: string | null; theirsOid: string | null; mineMode: string | null;
    theirsMode: string | null; mineSize: number | null; theirsSize: number |
    null }`.
  - `GitMerge.conflicts(workingCopy: string): Promise<ConflictEntry[]>`, sorted
    by path. Sizes come from one `git cat-file --batch-check`.
  - `GitMerge.mergedWithoutConflicts(workingCopy: string, conflicting:
    ReadonlySet<string>): Promise<string[]>`, from `git diff-index --cached
    --name-only -z --no-renames HEAD`.
  - `GitMerge.mergeMessage(workingCopy: string): Promise<string>`.

- [ ] **Step 1: Write the failing tests**: `lists unresolved files with their
      kinds and sizes`; `lists resolved files too`; `keeps the kind of a
      resolved file`; `gives a kind to a file with one stage`; `leaves out a
      file both sides deleted`; `reads every kind of name`; `lists what merged
      without conflicts`; `leaves the comment lines out of the message`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(git): read a merge's conflicts`

---

### Task 2: The endpoint

**Files:**

- Create: `libs/shared/contracts/src/git/git-merge.schema.ts` (+ spec),
  `libs/server/feature/sync/src/merge/merge-state.service.ts` (+ spec)
- Modify: `libs/shared/contracts/src/index.ts`,
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/git/git.dto.ts`,
  `libs/server/feature/sync/src/sync.module.ts`, `apps/web/public/i18n/en.json`,
  `apps/server-e2e/src/git.e2e.spec.ts`

**Interfaces:**

- Produces:
  - `GET /api/v1/repositories/:id/git/merge` (`gitMerge`, `GitMergeState`: `{
    into: string; from: string; files: GitConflictFile[]; otherFiles: string[];
    message: string }`).
  - `GitConflictFile`: `{ path: string; kind: GitConflictKind; resolved:
    boolean; editable: boolean; mineSize: number | null; theirsSize: number |
    null }`.
  - Error code `no-merge-in-progress`, `409`.

- [ ] **Step 1: Write the failing tests**: `says what merges into what`; `names
      the upstream after a fetch pruned it`; `marks a Markdown file editable`;
      `a PNG, a large file, a file that is not valid UTF-8, a symbolic link and
      a file through a linked folder are not editable`; `a file one side deleted
      is not editable`; `answers no merge and another user's repository`; end to
      end, `a pull that conflicts is readable from another session`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-sync`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `merge-state-api`; GC-6
      and GC-7 "(only the backend is built)". Run `doc-ids.mjs criteria` and
      copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): read a merge in progress`.
