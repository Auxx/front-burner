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
- `writeMarkers` writes only when `merge-file` exited below 128 (the number of
  conflicts) and its output has no U+FFFD. On a file with a NUL byte it exits
  255 with no output, which must never replace the file. It writes only a
  regular file, found through `resolveInWorkingCopy`.
- Before the merge, `merge` lists what it would newly write: `git diff-tree -r
  --name-only -z --no-renames --diff-filter=A HEAD <ref>`. The working copy is
  clean (GA-26), so anything already at one of those paths, or a file where a
  folder on the way must be, is ignored. Then it throws `merge-blocked` with
  `paths` (at most 20, one per line), before anything changes.
  `--no-overwrite-ignore` stays, but protects only a fast-forward: a true merge
  replaces the file without a word, and aborting can't bring it back.

## Review Focus

- **A file with a NUL byte and a Markdown name** must keep its content → Task 2
  test `leaves a Markdown file with a NUL byte as git wrote it`.
- **A local branch named `origin/main`** must not make the pull say "Already up
  to date" → Task 2 test `merges the remote branch when a local branch has its
  name`.
- **`merge.conflictStyle=zdiff3` in the working copy** gives plain markers both
  from the merge and from `writeMarkers` → Task 2 test `writes plain markers
  with branch names, whatever the config says`.
- **An ignored file the merge would overwrite** stops it, with everything as it
  was, in a fast-forward and in a true merge alike → Task 2 tests `a
  fast-forward does not overwrite an ignored file` and `a true merge does not
  overwrite an ignored file, or an ignored folder`.
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
  - `GitMerge.keepRecord(workingCopy: string, oid: string): Promise<void>`:
    points the ref at an earlier record again.
  - `GitMerge.resetTo(workingCopy: string, oid: string): Promise<void>`: `git
    reset -q --hard <oid>`, which also ends a merge. The caller knows the
    working copy was clean when the commit was recorded (GA-26).
  - `GitMerge.undoCutShort(workingCopy: string, oid: string): Promise<void>`,
    for a merge that git did not finish: removes `.git/index.lock`, as a killed
    git leaves it and `reset` then fails; then `resetTo`, then `git clean -fdq`,
    as a checkout killed partway leaves untracked files that `reset` keeps.
    `clean` without `-x` leaves ignored files, and the working copy had nothing
    else untracked (GA-26).

- [ ] **Step 1: Write the failing tests**: `records the current commit under a
      ref`; `keeps the commit from garbage collection`; `forgets the ref`;
      `resetTo ends a merge and puts every file back`, with a clean merged file,
      a **Both added** file and a **Deleted by them** file; `undoCutShort works
      with a stale lock, removes untracked files and keeps ignored ones`.
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
  - `GitMerge.isUpToDate(workingCopy: string, upstream: string):
    Promise<boolean>`: `git merge-base --is-ancestor <ref> HEAD`.
  - `GitMerge.hasRemoteBranch(workingCopy: string, branch: string):
    Promise<boolean>`: `git show-ref --verify --quiet
    refs/remotes/origin/<branch>`.
  - `GitMerge.adoptUpstream(workingCopy: string, branch: string):
    Promise<void>`: sets `branch.<branch>.remote` to `origin` and `.merge` to
    `refs/heads/<branch>` (plan 77).
  - The engine's error code `merge-blocked`, when the merge stopped before
    changing anything.

- [ ] **Step 1: Write the failing tests**: `says already up to date`;
      `fast-forwards and counts the commits`; `makes a merge commit with git's
      words, as the author`; `says into for a branch other than main`; `stops at
      a conflict and leaves MERGE_HEAD, with the same message`; `writes plain
      markers with branch names, whatever the config says`; `labels Both added
      too`; `leaves a file that is not valid UTF-8 as git wrote it`; `leaves a
      Markdown file with a NUL byte as git wrote it`; `leaves other files as git
      wrote them`; `merges the remote branch when a local branch has its name`;
      `merges in a shallow single-branch clone`; `merges unrelated histories`;
      `ignores merge.ff=only and merge.autoStash in the config`; `a fast-forward
      does not overwrite an ignored file`; `a true merge does not overwrite an
      ignored file, or an ignored folder`; `a file where a folder on the way
      must be stops the merge`; `removes a file both sides deleted`; `knows when
      a merge commit is needed`; `knows when there is nothing to merge`; `adopts
      an upstream, also for a branch with a dot in its name`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.** Read `merge-file`'s output with `LocalGit.run`.
      Remove each stage-1-only path with `git update-index --force-remove`.
      A-5.10 and A-5.12 say how markers are labelled and that a merge passes
      these options. Name AC-GIT-003.2 in plan 99, when the editor shows them.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Update the status**: REQ-GIT-003 is **In progress**, Built in
      `merge-engine`; points not built: all except GC-5. Run `doc-ids.mjs
      criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(git): the merge`.
