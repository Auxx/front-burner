# Create and Rename API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 17 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
API creates empty Markdown files and folders, renames Markdown files and folders
in place, says what a folder holds before it is renamed or deleted, says whether
a new name would be ignored, and tells every open tab which folders changed.

**Architecture:** All in `server/feature/files`. Each change runs inside
`WorkingTreeLock.run` after the merge check (FB-26), then publishes
`files.changed` for the folders whose entries changed (A-3.11, FB-41). Names are
checked with plan 13's rules on both sides: the request schema refines with
`entryNameProblem`, and the service adds the sibling clash, which needs the
disk. The entry summary walks one folder's subtree without following links and
asks git once for its uncommitted files.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/file-browser.md` (REQ-FILE-001: FB-4, FB-26 to
FB-35, the counts of FB-38; criteria 14 and 25, and the API halves of 13, 15, 16
and 20); `docs/architecture/api.md` A-3.8, A-3.9, A-3.11; `git-engine.md` A-5.3.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- Only `create`, `rename` (and plan 18's `delete`) change the working tree.
  Nothing here stages, commits or pushes (D-1.2, the file browser's context).
- A new file is empty (zero bytes) and created with the exclusive flag, so that
  a race never overwrites a file (FB-30).
- A file's new name always ends in a Markdown extension
  (`withMarkdownExtension`); a folder's is used as typed. Both are stored in NFC
  (FB-28, FB-29, FB-35).
- Rename is offered for Markdown files and folders only; a non-Markdown file, a
  symbolic link or a submodule is refused with `400 entry-not-renamable` (FB-23,
  FB-35). Renaming never moves an entry to another folder.
- `files.changed` names folders by path; the root is `''`.
- New shared error code: `merge-in-progress` (409, FB-26). Feature code:
  `entry-not-renamable` (400). Field code on `name`: `name-taken` (FB-27), sent
  as the Add repository form's `name-taken` is (A-3.9). English texts: "A merge
  is in progress. Finish or abort it first.", "This can't be renamed.", "There
  is already a file or folder with this name here."

## Review Focus

- **Renaming `readme.md` to `README.md`** must succeed (its own name in another
  case), while creating `README.md` next to it must not → Task 3 test
  `AC-FILE-001.14: refuses a case-only clash but allows a case-only rename`.
- **A name typed with a decomposed accent** must be stored composed and must
  clash with a composed sibling → Task 3 test `AC-FILE-001.25: stores names in
  NFC`.
- **Renaming a folder onto a path through a symbolic link, or renaming a
  symbolic link** must be refused without touching the link's target → Task 3
  test `refuses to rename a symbolic link`.
- **A merge in progress** must refuse create and rename before the disk is
  touched, and must not hold the lock afterwards → Task 3 test `refuses changes
  during a merge`.
- **A folder with 20,000 files** must be summarised without git's output being
  cut at 1 MiB → Task 4 test `counts uncommitted files beyond 1 MiB of git
  output`.

---

### Task 1: Contracts and the event

**Files:**

- Create: `libs/shared/contracts/src/files/entry-actions.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/events/push-event.schema.ts` (+ spec),
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/shared/contracts/src/index.ts`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `entryNameProblem` (plan 13).
- Produces:
  - `EntryNameSchema`: a string whose `entryNameProblem` issue carries `params:
    { code: <problem> }`, as `RemoteUrlSchema` does.
  - `CreateEntryRequestSchema` (`id: 'CreateEntryRequest'`): `{ folder: string;
    name: EntryName; kind: 'file' | 'folder' }`.
  - `RenameEntryRequestSchema` (`id: 'RenameEntryRequest'`): `{ path: string;
    name: EntryName }`.
  - `EntryPathSchema` (`id: 'EntryPath'`): `{ path: string }` — the answer of
    create and rename.
  - `EntryQuerySchema` (`id: 'EntryQuery'`): `{ path: string }`.
  - `EntrySummarySchema` (`id: 'EntrySummary'`): `{ files: number; nonMarkdown:
    number; uncommitted: number }` (for a file: 1, 0 or 1, 0 or 1).
  - `IgnoreQuerySchema` (`id: 'IgnoreQuery'`): `{ path: string; kind: 'file' |
    'folder' }`; `IgnoreResultSchema` (`id: 'IgnoreResult'`): `{ ignored:
    boolean }`.
  - `PushEventSchema` gains `{ type: 'files.changed'; repositoryId: number;
    folders: string[] | 'all' }`.
  - `merge-in-progress` in `ERROR_CODES`; the English texts of Global
    Constraints.

- [ ] **Step 1: Write the failing tests**: ids; `reports each name problem as
      its code`; `parses a files.changed event with folders and with all`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-contracts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test shared-contracts`.
- [ ] **Step 5: Commit** — `feat(contracts): add entry actions and
      files.changed`

---

### Task 2: Uncommitted files and the ignore check in git

**Files:**

- Modify: `libs/server/core/git/src/engine/git-engine.ts` (+ its spec)

**Interfaces:**

- Produces:
  - `GitEngine.uncommittedUnder(workingCopy: string, path: string):
    Promise<number>` — the number of untracked and ignored files at or under
    `path` (`git status --porcelain=v1 -z --untracked-files=all
    --ignored=traditional -- <path>`, counting `??` and `!!` records), with
    `maxOutputBytes` of 64 MiB. Modified tracked files do not count: their
    committed version can be brought back (FB-38).
  - `GitEngine.ignoredAmong` (plan 14) is reused for the ignore check, with a
    trailing `/` on folder paths.

- [ ] **Step 1: Write the failing tests**: `counts untracked and ignored files
      but not modified tracked ones`; `counts files in untracked folders one by
      one`; `checks a folder path that does not exist yet against a folder rule`
      (`build/` rule, `build/` → ignored).
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test server-core-git`.
- [ ] **Step 5: Commit** — `feat(git): count uncommitted files under a path`

---

### Task 3: Create and rename

**Files:**

- Create: `libs/server/feature/files/src/actions/entry-actions.ts` (+
  `.spec.ts`), `src/actions/working-tree-guard.ts` (+ `.spec.ts`)
- Modify: `src/files/files.controller.ts`, `src/files/files.dto.ts`,
  `src/files.module.ts`

**Interfaces:**

- Consumes: `OpenableRepository.root`, `toFilesError` (plan 14);
  `resolveInWorkingCopy` (plan 13); `WorkingTreeLock`,
  `GitEngine.mergeInProgress` (plan 13); `sameEntryName`,
  `withMarkdownExtension`, `isMarkdownName` (plan 13); `EventsHub.publish`.
- Produces:
  - `WorkingTreeGuard.change<T>(repositoryId: number, root: string, task: () =>
    Promise<T>): Promise<T>` — takes the lock, refuses with `409
    merge-in-progress` inside it, then runs `task`. Plan 18 and the editor's
    save use it.
  - `EntryActions.create(userId, repositoryId, request: CreateEntryRequest):
    Promise<EntryPath>` and `.rename(userId, repositoryId, request:
    RenameEntryRequest): Promise<EntryPath>`; each publishes `files.changed`
    with the parent folder after success.
  - `POST /api/v1/repositories/:id/entries` (`createEntry`, `201`) and `POST
    /api/v1/repositories/:id/entries/rename` (`renameEntry`, `200`), both
    answering `EntryPath`.

- [ ] **Step 1: Write the failing tests** (on a temporary repository): `creates
      notes as an empty untracked notes.md` (git status shows `??`); `creates an
      empty folder`; `AC-FILE-001.14: refuses a case-only clash but allows a
      case-only rename`; `AC-FILE-001.25: stores names in NFC`; `renames
      guide.md to guide.txt as guide.txt.md`; `refuses to rename a non-Markdown
      file, a symbolic link or a submodule`; `refuses to rename a symbolic link`
      (its target unchanged); `refuses changes during a merge` (the next change
      after `merge --abort` succeeds); `refuses a missing parent folder with
      entry-not-found`; `publishes files.changed with the parent folder`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-files`.
- [ ] **Step 3: Implement**; regenerate the client.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-feature-files server`.
- [ ] **Step 5: Commit** — `feat(files): create and rename entries`

---

### Task 4: Entry summary and ignore check endpoints

**Files:**

- Create: `libs/server/feature/files/src/summary/entry-summaries.ts` (+
  `.spec.ts`)
- Modify: `src/files/files.controller.ts`, `src/files/files.dto.ts`,
  `src/files.module.ts`

**Interfaces:**

- Consumes: `GitEngine.uncommittedUnder`, `.ignoredAmong` (Task 2, plan 14).
- Produces:
  - `EntrySummaries.summary(root: string, path: string): Promise<EntrySummary>`
    — for a folder, walks its subtree with `opendir`, never following symbolic
    links and skipping `.git`; a symbolic link counts as a non-Markdown file
    _(plan's call)_; submodules count as nothing.
  - `GET /api/v1/repositories/:id/entries/summary?path=` (`entrySummary`) →
    `EntrySummary`.
  - `GET /api/v1/repositories/:id/entries/ignored?path=&kind=` (`isIgnored`) →
    `IgnoreResult`; the path may not exist yet, but its parent must (FB-31).

- [ ] **Step 1: Write the failing tests**: `summarises a file`; `counts files,
      non-Markdown files and uncommitted files in a folder`; `does not walk
      through a symbolic link folder`; `counts uncommitted files beyond 1 MiB of
      git output` (20,000 untracked files, test timeout 60 s); `says a new name
      inside an ignored folder is ignored`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-files`.
- [ ] **Step 3: Implement**; regenerate the client.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-feature-files server`.
- [ ] **Step 5: Commit** — `feat(files): summarise entries and check ignore
      rules`

---

### Task 5: API end-to-end tests and status

**Files:**

- Modify: `apps/server-e2e/src/files.e2e.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `creates, renames and lists a file over the
      API`; `refuses .git as a name and as a folder` (`name: '.Git'`, `folder:
      '.git'`); `refuses another user's repository like a missing one` for every
      new endpoint; `sends files.changed on the event stream after a create`
      (stream opened as in `events.e2e.spec.ts`).
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`; all pass.
- [ ] **Step 3: Update the status**: REQ-FILE-001 adds the backend halves of
      FB-26 to FB-35, Built in adds `create-rename-api`. Run `doc-ids.mjs
      criteria` and copy its result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `test(files): cover
      create and rename over the API`.
