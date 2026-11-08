# Fetch Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 68 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
engine can fetch and say what the upstream has that the branch does not.

**Architecture:** `git-engine.ts` is over 1,100 lines, and step 4's merge and
branch code would double it, so the local command helpers move to `LocalGit`,
which the later `GitMerge` and `GitBranches` classes also use _(plan's call)_.
`fetch` follows `push`: it takes no lock, and `runNetwork` checks the working
copy's config first (A-5.7).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-33's last sentence, GA-34's
counts); `docs/architecture/git-engine.md` A-5.2, A-5.3, A-5.7, A-5.10.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The command is `git <NO_LFS> fetch --prune --no-tags --no-recurse-submodules
  --no-write-fetch-head origin`, under `FRONT_BURNER_GIT_TIMEOUT`. No refspec: a
  single-branch clone's configuration says what it fetches (GA-41).
- A remote-tracking branch is always named by its full ref,
  `refs/remotes/origin/<branch>`.

## Review Focus

- **A local branch named `origin/main`** must not change what `incoming` counts
  → Task 2 test `counts the remote branch when a local branch has its name`.
- **A file renamed upstream** counts as touching both names, since **Changes**
  has no rename detection either → Task 2 test `a renamed file touches its old
  and its new path`.
- **A path that looks like pathspec magic,** such as `:(top)x`, is one name →
  Task 2 test `reads the path literally`.
- **A shallow single-branch clone** fetches without deepening or failing → Task
  2 test `fetches in a shallow single-branch clone`.
- **A working copy whose config could bypass the proxy** is refused before git
  connects (A-5.7) → Task 2 test `refuses an unsafe config`.

---

### Task 1: LocalGit

**Files:**

- Create: `libs/server/core/git/src/engine/local-git.ts`
- Modify: `libs/server/core/git/src/engine/git-engine.ts`,
  `libs/server/core/git/src/git.module.ts`, `libs/server/core/git/src/index.ts`

**Interfaces:**

- Produces: `LocalGit` (injectable), moved unchanged from `GitEngine`:
  - `run(cwd: string, args: string[], options?: LocalRunOptions):
    Promise<GitResult>` (was `runLocal`);
  - `checked(cwd: string, args: string[], options?: LocalRunOptions):
    Promise<string>` (was `runChecked`);
  - `configValues(cwd: string, key: string): Promise<string[]>`;
  - `upstreamOf(cwd: string, branch: string): Promise<string | null>`;
  - `removeStaleIndexLock(cwd: string, failure: unknown): Promise<void>`.
- Also exported: `LocalRunOptions`, `nulTerminated`, `LOCAL_TIMEOUT_MS`,
  `NO_LFS`.

- [ ] **Step 1: Move the helpers**; no test changes.
- [ ] **Step 2: Run the tests** — `npx nx test server-core-git`; all pass
      unchanged.
- [ ] **Step 3: Commit** — `refactor(git): LocalGit`

---

### Task 2: Fetch and incoming

**Files:**

- Modify: `libs/server/core/git/src/engine/git-engine.ts`,
  `libs/server/core/git/src/engine/git-engine.spec.ts`,
  `libs/server/core/git/src/index.ts`, `docs/architecture/git-engine.md`

**Interfaces:**

- Produces:
  - `FetchRequest`: `{ remoteUrl: string; credentials: GitCredentials;
    knownHosts: string[] }`.
  - `GitEngine.fetch(workingCopy: string, request: FetchRequest): Promise<{
    moved: boolean }>`. `moved` compares `git for-each-ref refs/remotes/origin`
    before and after, so that a fetch that found nothing causes no event.
  - `GitEngine.incoming(workingCopy: string, path?: string):
    Promise<IncomingChanges | null>`, with `IncomingChanges`: `{ upstream:
    string; commits: number; touchesPath: boolean }`; `null` on no branch, or
    with no upstream or one that is gone. `commits` is `git rev-list --count
    HEAD..<ref> --`. `touchesPath` is `git --literal-pathspecs diff --quiet
    --no-renames HEAD...<ref> -- <path>`, false without a path. Read-only, with
    `--no-optional-locks`.

- [ ] **Step 1: Write the failing tests**: `fetches new commits without changing
      the files or the branch`; `removes remote branches deleted on the remote`;
      `says when nothing moved`; `fetches no tags`; `fetches in a shallow
      single-branch clone`; `refuses an unsafe config`; `reports a refused token
      as auth-failed`; `counts what the upstream has`; `counts the remote branch
      when a local branch has its name`; `says whether the commits touch a
      path`; `a renamed file touches its old and its new path`; `reads the path
      literally`; `has nothing to say without an upstream`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.** A-5.10's list gets `incoming`.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(git): fetch, and what is incoming`.
