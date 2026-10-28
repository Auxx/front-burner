# Working Copy Paths and Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 13 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
backend gets the three safety pieces every file operation needs: the rules for
entry names, one function that turns a client path into a file system path, and
one lock per working copy.

**Architecture:** Name rules are pure functions in `shared/util`, so that the
web client (plan 19) and the backend check names the same way (FB-4). Path
resolution is the one function A-7.6 asks for, in `server/core/storage`, next to
`DataLayout`. The working-tree lock and merge detection go into
`server/core/git`, since the git operations of steps 3 and 4 take the same lock.
Nothing here has an endpoint yet; plan 14 is the first user.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/file-browser.md` (REQ-FILE-001: FB-5, FB-17, FB-26
to FB-29); `docs/architecture/security.md` A-7.6;
`docs/architecture/git-engine.md` A-5.3.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- Markdown extensions are exactly `.md`, `.markdown`, `.mdx`, ignoring case
  (glossary, FB-21).
- The 255-byte limit is measured in UTF-8 bytes of the NFC form (FB-27, FB-28).
- `.git` is refused ignoring case, both as a new name (FB-27) and as any path
  segment (FB-5), so that `.GIT/config` is refused on every file system.
- The resolver never follows a symbolic link, in any segment (A-7.6). It does
  not normalise paths: a path names an entry as it is on disk, which may not be
  NFC if the remote put it there.

## Review Focus

- **A path whose middle segment is a symbolic link to a folder outside the
  working copy** (`docs -> /etc`, then `docs/passwd`) must be refused, not just
  a link at the leaf → Task 2 test `refuses a path through a symbolic link
  folder`.
- **Obfuscated parent steps**: `a/../../x`, `./a`, `a//b`, a trailing `/`, a
  leading `/` and a NUL must all be refused before the file system is touched →
  Task 2 test `refuses malformed paths` (table-driven).
- **`.Git` in other cases and as a middle segment** (`sub/.GIT/hooks`) must be
  refused → Task 2 test `refuses .git in any case and position`.
- **A task that throws inside the lock** must release it, so the next save is
  not blocked forever → Task 3 test `releases the lock when a task throws`.
- **Names with a decomposed accent** must count their bytes and compare to
  siblings in NFC (`café.md` typed as `e` + U+0301 clashes with an existing
  `café.md`) → Task 1 tests `compares names in NFC ignoring case` and `counts
  bytes in NFC`.

---

### Task 1: Entry name rules

**Files:**

- Create: `libs/shared/util/src/entry-name/entry-name.ts` (+ `.spec.ts`)
- Modify: `libs/shared/util/src/index.ts`

**Interfaces:**

- Produces:
  - `MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const`.
  - `isMarkdownName(name: string): boolean` — case-insensitive extension check.
  - `withMarkdownExtension(name: string): string` — returns `name` if it is a
    Markdown name, else `name + '.md'` (FB-29: `notes` → `notes.md`, `notes.txt`
    → `notes.txt.md`).
  - `ENTRY_NAME_PROBLEMS = ['empty', 'dot', 'separator', 'control',
    'edge-space', 'git', 'too-long'] as const`; type `EntryNameProblem`.
  - `entryNameProblem(name: string): EntryNameProblem | null` — checks the NFC
    form against FB-27's rules except the sibling clash, in the order of the
    list (`''` → `empty`; `.`/`..` → `dot`; `/` or `\` → `separator`; U+0000 to
    U+001F or U+007F → `control`; leading or trailing space → `edge-space`;
    `.git` ignoring case → `git`; more than 255 UTF-8 bytes → `too-long`).
  - `sameEntryName(a: string, b: string): boolean` — equal after NFC and
    lower-casing (FB-27's clash rule).
  - `compareEntryNames(a: string, b: string): number` — FB-17's order within a
    group: an `Intl.Collator(undefined, { numeric: true, sensitivity: 'accent'
    })`, ties broken by plain code-unit order so the order is total and stable.

- [ ] **Step 1: Write the failing tests**: `recognises Markdown extensions in
      any case` (`A.MD`, `b.Markdown`, `c.mdx` yes; `d.txt`, `md`, `.md.bak`
      no); `appends .md as FB-29 says`; `reports each problem` (one row per
      problem, plus `'a\u0000b'`, `' a'`, `'a '`, `'.GIT'`, a 256-byte name of
      `é`s); `counts bytes in NFC` (128 decomposed `é` = 128 × 2 bytes in NFC,
      accepted); `compares names in NFC ignoring case` (`'Café.md'` vs
      `'café.MD'` → true; `'a.md'` vs `'b.md'` → false); `sorts numbers
      naturally` (`['10-deploy.md', '2-setup.md', 'B.md', 'a.md']` →
      `['2-setup.md', '10-deploy.md', 'a.md', 'B.md']`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-util`.
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Run them and see them pass** — `npx nx test shared-util`.
- [ ] **Step 5: Commit** — `feat(util): add entry name rules`

---

### Task 2: Path resolution

**Files:**

- Create: `libs/server/core/storage/src/paths/resolve-in-working-copy.ts` (+
  `.spec.ts`)
- Modify: `libs/server/core/storage/src/index.ts`;
  `docs/architecture/modules.md` (the `storage/` line no longer says "arrives
  with REQ-FILE-001")

**Interfaces:**

- Produces:
  - `type EntryType = 'file' | 'folder' | 'symlink' | 'other' | 'missing'`.
  - `interface ResolvedPath { relative: string; absolute: string; type:
    EntryType }` — `relative` is the client path as given; `''` is the root.
  - `class PathRefusedError extends Error { readonly reason: 'malformed' |
    'inside-git' | 'symlink' | 'not-found' }`.
  - `resolveInWorkingCopy(root: string, path: string, options?: { mayBeMissing?:
    boolean; symlinkLeaf?: boolean }): Promise<ResolvedPath>`:
    1. `malformed`: a leading or trailing `/`, an empty, `.` or `..` segment, or
       a NUL anywhere;
    2. `inside-git`: any segment equal to `.git` ignoring case;
    3. walks the segments with `lstat`: a symbolic link before the last segment
       → `symlink`; a missing segment before the last → `not-found`;
    4. the last segment: missing → `not-found` unless `mayBeMissing` (then
       `type: 'missing'`); a symbolic link → `symlink` unless `symlinkLeaf`
       (then `type: 'symlink'`).

- [ ] **Step 1: Write the failing tests** (a temporary folder per test with
      `docs/guide.md`, `link-out -> /etc`, `docs/link.md -> ../README.md`):
      `resolves the root and a nested file`; `refuses malformed paths` (`'/a'`,
      `'a/'`, `'a//b'`, `'./a'`, `'a/./b'`, `'a/../../x'`, `'..'`, `'a\u0000'`);
      `refuses .git in any case and position` (`.git`, `.git/config`,
      `sub/.GIT/hooks`); `refuses a path through a symbolic link folder`
      (`link-out/passwd` → `symlink`); `refuses a symbolic link leaf unless
      asked` (`docs/link.md` → `symlink`; with `symlinkLeaf` → `type:
      'symlink'`); `reports a missing leaf only when allowed`; `refuses a
      missing parent even when the leaf may be missing` (`nope/new.md` →
      `not-found`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-core-storage`.
- [ ] **Step 3: Implement** `resolveInWorkingCopy` with `node:fs/promises`
      `lstat`, joining with `node:path` only after the checks.
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      server-core-storage`.
- [ ] **Step 5: Commit** — `feat(storage): resolve client paths in a working
      copy`

---

### Task 3: Working-tree lock and merge detection

**Files:**

- Create: `libs/server/core/git/src/lock/working-tree-lock.ts` (+ `.spec.ts`)
- Modify: `libs/server/core/git/src/engine/git-engine.ts` (+ its spec),
  `libs/server/core/git/src/git.module.ts`, `libs/server/core/git/src/index.ts`

**Interfaces:**

- Produces:
  - `@Injectable() class WorkingTreeLock` (provided and exported by
    `GitModule`): `run<T>(repositoryId: number, task: () => Promise<T>):
    Promise<T>` — tasks for one repository run one at a time, in the order they
    arrived; different repositories do not wait for each other. A task that
    throws or rejects releases the lock and its error reaches only its caller.
    An in-memory map of promise chains, entries removed when idle (A-5.3); `get
    size(): number` counts repositories with queued or running tasks.
  - `GitEngine.mergeInProgress(workingCopy: string): Promise<boolean>` — true
    when `.git/MERGE_HEAD`, `.git/rebase-merge` or `.git/rebase-apply` exists.

- [ ] **Step 1: Write the failing tests**: `runs tasks for one repository one at
      a time in order` (three tasks with staggered delays record start/end; no
      overlap, order 1-2-3); `does not make other repositories wait`; `releases
      the lock when a task throws` (the next task runs and the thrown error
      reaches only the first caller); `forgets idle repositories` (`size` is 0
      after the last task); in the engine spec: `reports a merge in progress` (a
      real conflicting `git merge` in a temporary repository → true; after `git
      merge --abort` → false).
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement** `WorkingTreeLock` and `mergeInProgress`; register
      and export the lock in `GitModule`.
- [ ] **Step 4: Run them and see them pass** — `npx nx test server-core-git`.
- [ ] **Step 5: Format, check and commit** — `npx dprint fmt && npx nx run-many
      -t lint test -p shared-util server-core-storage server-core-git`; commit
      `feat(git): add the working-tree lock`.

No row of the "Implementation status" table changes: nothing here is visible
yet. The pull request names FB-5, FB-27 and FB-28 as prepared, not built.
