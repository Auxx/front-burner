# Merge Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 76 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
engine merges the upstream into the current branch, keeps the commit it started
from, and leaves plain conflict markers labelled with branch names.

**Architecture:** A new `GitMerge` class holds the local merge operations, using
`LocalGit` (plan 68). `git merge` always writes `<<<<<<< HEAD`, whereas GC-5
wants `<<<<<<< main`, so after a merge that conflicted each conflicting Markdown
file is written again with `git merge-file --object-id -p`, from the index's
stages _(plan's call)_. Only Markdown files get this, as nothing shows the
markers of any other file (GC-15). It takes no locks: the caller holds the
working-tree lock.

**Tech Stack:** as before. No new packages. `merge-file --object-id` needs git
2.43, and A-5.7 already needs 2.47.

**Spec:** `docs/requirements/git-advanced.md` (GA-25, GA-27);
`docs/requirements/git-conflicts.md` (GC-5, AC-GIT-003.2's markers);
`docs/architecture/git-engine.md` A-5.10 to A-5.12; D-4.3, D-4.6.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The command: `git <NO_LFS> -c merge.conflictStyle=merge -c
  rerere.enabled=false -c commit.gpgsign=false merge --ff --no-squash --no-edit
  --no-autostash --no-stat --no-overwrite-ignore --allow-unrelated-histories
  --no-gpg-sign -m <message> refs/remotes/origin/<branch>`, under
  `FRONT_BURNER_GIT_TIMEOUT`.
- `<message>` is `Merge remote-tracking branch 'origin/<branch>'`, with ` into
  <current>` unless the current branch is `main` or `master`: git's default
  words for the short name (GC-20), which a full ref does not get.
- `--allow-unrelated-histories` _(plan's call)_: a repository cloned from an
  empty remote that someone else then pushed to has no common commit, and
  refusing would leave it stuck. The merge can be aborted, so nothing is lost.
- The record's ref is `refs/front-burner/pre-merge` (A-5.12).
- `writeMarkers` passes `-c merge.conflictStyle=merge`, since `merge-file` obeys
  a `zdiff3` in the working copy's config too, and uses the empty blob (`git
  hash-object -w -t blob --stdin`) as the base of **Both added**.

## Review Focus

- **A local branch named `origin/main`** must not make the pull say "Already up
  to date" → Task 2 test `merges the remote branch when a local branch has its
  name`.
- **`merge.conflictStyle=zdiff3` in the working copy** gives plain markers both
  from the merge and from `writeMarkers` → Task 2 test `writes plain markers
  with branch names, whatever the config says`.
- **An ignored file a fast-forward would overwrite** stops the merge, with
  everything as it was (only a true merge overwrites one, as git offers no
  option there) → Task 2 test `a fast-forward does not overwrite an ignored
  file`.
- **A file that is not valid UTF-8, or a symbolic link,** keeps what git left
  and is not corrupted by decoding → Task 2 test `leaves a file that is not
  valid UTF-8 as git wrote it`.
- **A file deleted by both sides of a rename** has only stage 1, no version to
  choose, and no one can resolve it → Task 2 test `removes a file both sides
  deleted`.

---

### Task 1: The record

**Files:**

- Create: `libs/server/core/git/src/engine/git-merge.ts`,
  `libs/server/core/git/src/engine/git-merge.spec.ts`
- Modify: `libs/server/core/git/src/git.module.ts`,
  `libs/server/core/git/src/index.ts`

**Interfaces:**

- Produces:
  - `GitMerge.record(workingCopy: string): Promise<string>`: the current commit,
    also kept by the ref.
  - `GitMerge.forgetRecord(workingCopy: string): Promise<void>`.
  - `GitMerge.resetTo(workingCopy: string, oid: string): Promise<void>`: `git
    reset -q --hard <oid>`, which also ends a merge. The caller knows the
    working copy was clean when the commit was recorded (GA-26).

- [ ] **Step 1: Write the failing tests**: `records the current commit under a
      ref`; `keeps the commit from garbage collection`; `forgets the ref`;
      `resetTo ends a merge and puts every file back`, with a clean merged file,
      a **Both added** file and a **Deleted by them** file.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(git): record the commit before a merge`

---

### Task 2: The merge

**Files:**

- Modify: `libs/server/core/git/src/engine/git-merge.ts` (+ spec),
  `libs/server/core/git/src/engine/git-errors.ts`,
  `libs/server/core/git/src/index.ts`, `docs/architecture/git-engine.md`

**Interfaces:**

- Produces:
  - `MergeRequest`: `{ branch: string; upstream: string; author: { name: string;
    email: string } }`, where `upstream` is such as `origin/main`.
  - `MergeResult`: `{ kind: 'up-to-date' } | { kind: 'fast-forward'; commits:
    number } | { kind: 'merged'; commits: number; oid: string } | { kind:
    'conflicted'; commits: number }`, `commits` being what the upstream had that
    the branch did not.
  - `GitMerge.merge(workingCopy: string, request: MergeRequest):
    Promise<MergeResult>`. Git's exit code says only "failed": `MERGE_HEAD`
    tells a conflict from anything else.
  - `GitMerge.needsMergeCommit(workingCopy: string, upstream: string):
    Promise<boolean>`: neither is an ancestor of the other.
  - `GitMerge.writeMarkers(workingCopy: string, path: string, labels: { mine:
    string; theirs: string }): Promise<void>`, for plan 92 too.
  - The engine's error code `merge-blocked`, when git stopped before changing
    anything.

- [ ] **Step 1: Write the failing tests**: `says already up to date`;
      `fast-forwards and counts the commits`; `makes a merge commit with git's
      words, as the author`; `says into for a branch other than main`; `stops at
      a conflict and leaves MERGE_HEAD, with the same message`; `writes plain
      markers with branch names, whatever the config says`; `labels Both added
      too`; `leaves a file that is not valid UTF-8 as git wrote it`; `leaves
      other files as git wrote them`; `merges the remote branch when a local
      branch has its name`; `merges in a shallow single-branch clone`; `merges
      unrelated histories`; `ignores merge.ff=only and merge.autoStash in the
      config`; `a fast-forward does not overwrite an ignored file`; `removes a
      file both sides deleted`; `knows when a merge commit is needed`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.** Read `merge-file`'s output with `LocalGit.run`;
      output with U+FFFD means it did not decode, and the file is left alone.
      Remove each stage-1-only path with `git update-index --force-remove`.
      A-5.10 and A-5.12 say how markers are labelled and that a merge passes
      these options. Name AC-GIT-003.2 in plan 99, when the editor shows them.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(git): the merge`.
