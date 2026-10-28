# Open a Repository and List Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 14 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): a
client can fetch one repository, open it (which sets its last access time once)
and list any folder of its working copy, one folder at a time, with each entry's
kind, size, Markdown and ignored flags.

**Architecture:** `server/feature/repositories` gets `GET /repositories/:id` and
`POST /repositories/:id/open`, and exports `RepositoryQueries` for other
features. A new `server/feature/files` library owns the folder listing:
`readdir` and `lstat` for the entries, plus two git calls scoped to the one
folder (submodules from the index, ignored entries from `git check-ignore`),
never a walk of the working copy (FB-15, NF-2.10). Listing does not take the
working-tree lock (A-5.3).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/file-browser.md` (REQ-FILE-001: FB-2 to FB-5,
FB-11, FB-15 to FB-20b; criteria 2, 7, 8, 11, 24 and the backend half of 1);
`docs/requirements/dashboard.md` DS-7, DS-8; `docs/architecture/api.md` A-3.3,
A-3.8; `security.md` A-7.6.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- A listing returns at most **5,000** entries; `more` counts the rest (FB-18).
- Order: folders first, then every other kind, each group by `compareEntryNames`
  (plan 13), sorted by the backend (FB-17).
- `.git` is never listed, in any folder and in any case (FB-5, FB-19); every
  other dot-entry is (FB-19).
- A tracked file is never `ignored`, even if a rule matches it; everything
  inside an ignored folder is `ignored` (FB-20b, the glossary's "Ignored
  entry").
- Opening sets `last_accessed_at` from the backend's clock, only for a `ready`
  repository, and nothing else in this plan sets it (DS-8, DS-9, FB-11).

## Review Focus

- **A folder ignored by a `build/` rule and the files inside it** — no rule
  names the files, but they must come back `ignored: true` (FB-20b) → Task 4
  test `marks everything inside an ignored folder as ignored`.
- **A tracked file that a later `.gitignore` rule matches** must come back
  `ignored: false` → Task 2 test `does not report tracked files`.
- **A submodule (gitlink) whose folder is empty on disk** must be listed as
  `submodule`, not as an empty folder → Task 4 test `lists a gitlink as a
  submodule`.
- **A file name with a newline, quotes or non-ASCII characters** must survive
  the git calls (they must use `-z`) → Task 2 test `handles names with newlines
  and quotes`.
- **Opening a repository that is still cloning** must not change its last access
  time, and must still return its status for FB-3 → Task 3 test `does not mark a
  cloning repository as opened`.

---

### Task 1: Listing contracts and error codes

**Files:**

- Create: `libs/shared/contracts/src/files/folder-listing.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/index.ts`,
  `libs/shared/contracts/src/errors/error-codes.ts`,
  `libs/shared/contracts/src/repositories/repository-summary.schema.ts`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces:
  - `ENTRY_KINDS = ['folder', 'file', 'symlink', 'submodule'] as const`; type
    `EntryKind`.
  - `EntrySchema` (`id: 'Entry'`): `{ name: string; kind: EntryKind; size:
    number | null` (bytes, files only) `; markdown: boolean` (files only) `;
    ignored: boolean; empty: boolean` (folders only) `}`.
  - `FolderListingSchema` (`id: 'FolderListing'`): `{ path: string; ignored:
    boolean` (the folder itself) `; entries: Entry[]; more: number }`.
  - `FolderQuerySchema` (`id: 'FolderQuery'`): `{ path: string }`, default `''`.
  - `RepositoryParamsSchema` (`id: 'RepositoryParams'`): `{ id: number }`
    (`z.coerce.number().int().positive()`), in the repositories file.
  - Shared error codes: `path-refused` (400, params `{ reason }`),
    `entry-not-found` (404), `repository-not-openable` (409, params `{ status
    }`). English texts under `errors.<code>`: "This path can't be used.", "This
    file or folder doesn't exist.", "This repository can't be opened yet."

- [ ] **Step 1: Write the failing tests**: ids; `defaults the path to the root`;
      `refuses an unknown kind`; `coerces the id`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-contracts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx test shared-contracts`.
- [ ] **Step 5: Commit** — `feat(contracts): add folder listings`

---

### Task 2: Folder-scoped git queries

**Files:**

- Modify: `libs/server/core/git/src/engine/git-engine.ts` (+ its spec)

**Interfaces:**

- Produces:
  - `GitEngine.ignoredAmong(workingCopy: string, paths: string[]):
    Promise<Set<string>>` — `git check-ignore --stdin -z` with the paths on
    stdin; exit 1 means none; exit 128 throws. Tracked paths are never reported
    (git's default without `--no-index`). An empty list returns an empty set
    without running git.
  - `GitEngine.gitlinksIn(workingCopy: string, folder: string):
    Promise<Set<string>>` — the names (not paths) of index entries with mode
    `160000` directly inside `folder`, from `git ls-files --stage -z --
    ':(glob)<folder>/*'` (`':(glob)*'` for the root). The glob's `*` does not
    cross `/`, so the index is not listed beyond the folder.

- [ ] **Step 1: Write the failing tests** (a temporary repository with
      `.gitignore` containing `build/` and `*.log`, a committed `keep.log`, an
      untracked `out.log`, a `build/` folder, and a gitlink added with `git
      update-index --add --cacheinfo 160000,<sha>,vendor/lib`): `reports ignored
      untracked paths` (`out.log`, `build`); `does not report tracked files`
      (`keep.log`); `handles names with newlines and quotes`; `lists gitlinks
      directly inside a folder` (`vendor` → `{'lib'}`; root → `{}`).
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-git`.
- [ ] **Step 3: Implement** both through `GitRunner.run` with the engine's
      existing local-command options (no network, short timeout).
- [ ] **Step 4: Run them and see them pass** — `npx nx test server-core-git`.
- [ ] **Step 5: Commit** — `feat(git): add folder-scoped ignore and gitlink
      queries`

---

### Task 3: Get and open a repository

**Files:**

- Modify:
  `libs/server/feature/repositories/src/repositories/repository-queries.ts`,
  `repositories.controller.ts`, `repositories.dto.ts` (+ specs),
  `repositories.module.ts`, `libs/server/feature/repositories/src/index.ts`

**Interfaces:**

- Consumes: `RepositoryParamsSchema` (Task 1).
- Produces:
  - `RepositoryQueries.find(userId: number, id: number): Repository | undefined`
    — filtered by user (FB-2).
  - `RepositoryQueries.markOpened(userId: number, id: number, now: Date):
    Repository | undefined` — sets `lastAccessedAt = now` only when the status
    is `ready`; returns the row either way.
  - `GET /api/v1/repositories/:id` (`get`) and `POST
    /api/v1/repositories/:id/open` (`open`, `200`): both answer
    `RepositorySummary`, or `404 not-found`.
  - `RepositoriesModule` exports `RepositoryQueries`; the library's `index.ts`
    exports `RepositoriesModule` and `RepositoryQueries`.

- [ ] **Step 1: Write the failing tests**: `finds only the user's own
      repository`; `AC-FILE-001.1: opening a ready repository moves it to the
      top of the recent list`; `does not mark a cloning repository as opened`
      (status returned, time unchanged); `answers another user's repository like
      a missing one` (same status and body apart from the request ID).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 3: Implement**; regenerate the client (`npx nx run
      web-api-client:generate`).
- [ ] **Step 4: Run them and see them pass** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 5: Commit** — `feat(repositories): get and open a repository`

---

### Task 4: `server/feature/files` and the folder listing

**Files:**

- Create (generator): `libs/server/feature/files` with `npx nx g
  @nx/nest:library --directory=libs/server/feature/files
  --name=server-feature-files`, tags `scope:server`, `type:feature`; Vitest
  config copied from `apps/server/vitest.config.mts`.
- Create: `src/files.module.ts`; `src/repository/openable-repository.ts` (+
  spec); `src/listing/folder-lister.ts` (+ spec);
  `src/files/files.controller.ts`, `src/files/files.dto.ts`;
  `src/files/files-errors.ts`
- Modify: `apps/server/src/app/app.module.ts`; `docs/architecture/modules.md`
  only if a line is wrong.

**Interfaces:**

- Consumes: `resolveInWorkingCopy`, `PathRefusedError` (plan 13);
  `compareEntryNames`, `isMarkdownName` (plan 13); `GitEngine.ignoredAmong`,
  `gitlinksIn` (Task 2); `RepositoryQueries.find` (Task 3); `DataLayout`.
- Produces:
  - `OpenableRepository.root(userId: number, id: number): string` — the working
    copy path of a `ready` repository; throws `404 not-found` or `409
    repository-not-openable` (`{ status }`) (FB-2, FB-3). Later plans use it for
    every files endpoint.
  - `toFilesError(error: unknown): never` — `PathRefusedError` with `not-found`
    → `404 entry-not-found`; other reasons → `400 path-refused` with `{ reason
    }`; anything else rethrown.
  - `FolderLister.list(root: string, path: string): Promise<FolderListing>` —
    resolves `path` (a non-folder → `entry-not-found`); reads the folder with
    `readdir({ withFileTypes: true })`, drops `.git` in any case; kinds from the
    dirent, gitlinks becoming `submodule`; `size` from `lstat` for files;
    `empty` from reading at most one entry of each sub-folder (`opendir`);
    `ignored` from one `ignoredAmong` call, or `true` for all when the folder
    itself is ignored; sorts and caps at 5,000.
  - `GET /api/v1/repositories/:id/folder?path=` (`listFolder`) →
    `FolderListing`.

- [ ] **Step 1: Write the failing tests** (lister spec, on a temporary
      repository): `AC-FILE-001.7: sorts folders first in natural order`;
      `AC-FILE-001.8: lists .github and .claude but never .git`;
      `AC-FILE-001.11: lists a symbolic link as such without following it` (`etc
      -> /etc`; listing `etc` is refused with `symlink`); `lists a gitlink as a
      submodule`; `marks everything inside an ignored folder as ignored`; `marks
      empty folders`; `flags Markdown files in any case`; `AC-FILE-001.24: lists
      the first 5,000 of 6,000 entries and counts the rest`; `AC-FILE-001.7:
      lists 1,000 entries within 300 ms in a repository of 100,000 files`
      (fixture built once in `beforeAll` with `git update-index --index-info`
      rather than 100,000 `git add`s; the timing is the median of five runs;
      test timeout 120 s). Openable spec: `refuses a cloning repository with its
      status`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-files`.
- [ ] **Step 3: Implement** the module (imports `RepositoriesModule`,
      `GitModule`, `StorageModule`), the lister and the controller; register
      `FilesModule` in `AppModule`; regenerate the client.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-feature-files server`; `npm run check:tags`.
- [ ] **Step 5: Commit** — `feat(files): list one folder at a time`

---

### Task 5: API end-to-end tests and status

**Files:**

- Create: `apps/server-e2e/src/files.e2e.spec.ts`
- Modify: `docs/product/mvp.md` (Implementation status)

- [ ] **Step 1: Write the tests** (repositories set up as in
      `repositories.e2e.spec.ts`): `AC-FILE-001.2: refuses a visitor who is not
      logged in and answers another user's repository like a missing one` (for
      `GET`, `open` and `folder`); `AC-FILE-001.8: refuses paths inside .git`
      (`.git`, `.git/config`, `a/.GIT`); `AC-FILE-001.11: refuses listing
      through a symbolic link`; `refuses ../ paths with path-refused`.
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`; all pass.
- [ ] **Step 3: Update the status**: REQ-FILE-001 → **In progress**, Built in
      `folder-listing`; MVP points not built: everything except FB-2, FB-4,
      FB-5, FB-15 to FB-19 and the backend halves of FB-3, FB-11 and FB-20a.
      REQ-DASH-001 stays as it is until plan 15 calls `open`. Run `node
      tools/ai-tools/src/bin/doc-ids.mjs criteria` and copy its REQ-FILE-001
      result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `test(files): cover
      the folder listing API`.
