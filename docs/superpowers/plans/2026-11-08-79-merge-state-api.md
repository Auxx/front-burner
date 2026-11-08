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
  | 1, 3, or 3 | `deleted-by-us`   |
  | 1, 2, or 2 | `deleted-by-them` |

- An entry with only stage 1 is left out: both sides deleted the file, and plan
  76 removed it from the index, which leaves that resolve-undo entry behind.
- A file is `editable` when it is Markdown (`isMarkdownName`), of kind
  `both-changed` or `both-added`, both versions are regular files (mode `100644`
  or `100755`), `FileContents.readTracked` reads the file on disk (ED-2, GC-9)
  and git can merge the versions as text _(implementation's call: the editor's
  own limits, through `resolveInWorkingCopy`, without the hash and a git command
  per file. A file with a conflict marker needs no more; another asks `git
  merge-file`, as one the user took the markers out of must stay editable, and a
  NUL byte in either version leaves the file with no markers, where **Mark as
  resolved** would silently drop a version)_. A file that can't be checked for
  any other reason is logged and not editable, so that it can't keep the user
  from the merge.
- There is no merge when `MERGE_HEAD` is missing, also during a rebase, which
  `GitEngine.mergeInProgress` answers yes to.
- `message` is `.git/MERGE_MSG` without lines starting with `#` and trailing
  blank lines: git's "# Conflicts:" list is not part of the message (GC-20). A
  merge passes `-c core.commentChar=#`, so that the working copy's configuration
  can't change that. It is empty when the file is missing _(implementation's
  call: the user can still write one)_.
- `into` is the branch and `from` its upstream, from `symbolic-ref` and the
  configuration _(review's call: the status scans the whole working tree, which
  can time out and hide the merge)_. A merge that has neither, which a pull
  never leaves, reads as `HEAD` and `MERGE_HEAD` _(implementation's call: the
  user must still be able to read it to get out of it)_.
- The API and code say ours and theirs, as the glossary has it _(review's call:
  this plan first said `mineSize` and `deleted-by-me`)_.
- A submodule's version has no size _(implementation's call: `cat-file` reports
  its commit's, which is not the file's)_.

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
  - `ConflictKind`: `'both-changed' | 'both-added' | 'deleted-by-us' |
    'deleted-by-them'`.
  - `ConflictEntry`: `{ path: string; kind: ConflictKind; resolved: boolean;
    baseOid: string | null; oursOid: string | null; theirsOid: string | null;
    oursMode: string | null; theirsMode: string | null; oursSize: number | null;
    theirsSize: number | null }`.
  - `GitMerge.canWriteMarkers(workingCopy: string, entry: ConflictEntry):
    Promise<boolean>`, `GitMerge.branchAndUpstream(workingCopy: string)` and the
    public `GitMerge.mergeInProgress(workingCopy: string)`.
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
    boolean; editable: boolean; oursSize: number | null; theirsSize: number |
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
