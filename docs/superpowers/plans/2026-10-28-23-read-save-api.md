# Read and Save API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 23 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
API reads a Markdown file for the editor, saves it back without changing
anything the user did not change, recreates a file deleted elsewhere, and tells
other tabs the new content hash, so that they can tell their own saves from
changes made elsewhere.

**Architecture:** In `server/feature/files`. A small codec turns a file's bytes
into what the editor edits (text with `\n` line breaks, no byte order mark) and
back, remembering the line ending and the byte order mark (ED-12). Reading goes
straight to the disk without the lock; saving and recreating run inside plan
17's `WorkingTreeGuard.change`, write to `tmp/` and rename onto the file, so
that a crash never leaves half a file. `files.changed` gains the hash of each
saved file (A-3.11's note).

**Tech Stack:** as before. No new packages (`node:crypto` for SHA-256).

**Spec:** `docs/requirements/editor.md` (REQ-EDIT-001: ED-2, ED-6, ED-12, ED-19,
ED-21; criteria 9 and the API halves of 10, 11 and 13); `file-browser.md`
FB-21's open-time checks (criteria 10, 11); `docs/architecture/decisions.md`
D-1; `api.md` A-3.11; `non-functional.md` NF-1.5, NF-5.3, NF-11.5.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- The limit is **1 MB = 1,048,576 bytes** of the file as stored, for reading and
  for saving (ED-2, ED-19, NF-1.5).
- Only Markdown files (`isMarkdownName`) can be read, saved or recreated;
  symbolic links never (they are refused by `resolveInWorkingCopy`'s rules,
  A-7.6). A read opens the file through plan 14's descriptor helper
  (`O_NOFOLLOW`, real path checked), never by path, since reads take no lock;
  saves and recreates run inside the lock and need not.
- **Line endings** (ED-12): the file's line ending is `crlf` when it has more
  `\r\n` than lone `\n`, else `lf` (a tie, or no line break, is `lf`). The
  editor gets the text with every `\r\n` turned into `\n`; a save turns every
  `\n` back into the file's line ending. A lone `\r` is left as it is.
- **Byte order mark**: a UTF-8 BOM is removed from the text and `bom: true` is
  returned; a save with `bom: true` writes it back.
- **Hash**: SHA-256 of the bytes on disk, lower-case hex.
- A save **never creates** a file: a missing file is `404 entry-not-found`
  (ED-21). **Recreate** creates the file and is refused with `409 entry-exists`
  when it exists, or another entry has its name in another case or form. It also
  creates the folders on the path that are gone, each checked as **New folder**
  checks a name (FB-27, FB-32) and never where a submodule is _(plan's call,
  after review)_.
- While a merge is in progress every save is refused with `409
  merge-in-progress` (ED-19). The exception for the merge's conflicting files
  (GC-12) comes with step 4.
- New shared error codes and texts: `file-too-large` (`413`, params `{ limit
  }`): "This file is too large to edit (the limit is 1 MB)."; `file-not-utf8`
  (`422`): "This file isn't UTF-8 text, so it can't be edited safely.";
  `entry-not-editable` (`400`): "Only Markdown files can be opened in Front
  Burner."; `entry-exists` (`409`): "A file with this name exists again."

## Review Focus

- **A file with mixed line endings** (more `\r\n` than `\n`) must be saved with
  `\r\n` everywhere after an edit, and an unedited uniform file must round-trip
  byte for byte → Task 1 tests `uses the most common line ending` and
  `round-trips uniform files byte for byte`.
- **Content that is under 1 MB as text but over it with `\r\n` and a BOM** must
  be refused, since the limit is on the stored bytes → Task 3 test `measures the
  limit on the bytes written`.
- **A save to a file deleted a moment ago** must not create it again → Task 3
  test `refuses to save a missing file`.
- **A crash during a save** (simulated by a failing rename) must leave the old
  content, not an empty or half-written file → Task 3 test `keeps the old file
  when the rename fails`.
- **An executable Markdown file** (`chmod +x`) must stay executable after a
  save, since the save replaces the file → Task 3 test `keeps the file mode`.

---

### Task 1: The Markdown codec

**Files:**

- Create: `libs/server/feature/files/src/content/markdown-codec.ts` (+
  `.spec.ts`)

**Interfaces:**

- Produces:
  - `type LineEnding = 'lf' | 'crlf'` (exported from contracts in Task 2 and
    re-used here).
  - `decodeMarkdown(bytes: Buffer): { content: string; lineEnding: LineEnding;
    bom: boolean } | 'not-utf8'` — `TextDecoder('utf-8', { fatal: true,
    ignoreBOM: true })`.
  - `encodeMarkdown(text: { content: string; lineEnding: LineEnding; bom:
    boolean }): Buffer`.
  - `hashBytes(bytes: Buffer): string`.

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-001.9: keeps CRLF, the BOM,
      tabs and a missing final newline after an edit`; `round-trips uniform
      files byte for byte` (LF, CRLF, BOM, no final newline, empty file); `uses
      the most common line ending`; `treats a tie as LF`; `leaves a lone CR
      alone`; `reports Latin-1 bytes as not UTF-8` (`caf\xe9`); `hashes the
      bytes`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-files`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(files): decode and encode Markdown files`

---

### Task 2: Contracts

**Files:**

- Create: `libs/shared/contracts/src/files/file-content.schema.ts` (+
  `.spec.ts`)
- Modify: `libs/shared/contracts/src/events/push-event.schema.ts` (+ spec),
  `errors/error-codes.ts`, `index.ts`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces:
  - `LINE_ENDINGS = ['lf', 'crlf'] as const`; type `LineEnding`.
  - `FileQuerySchema` (`id: 'FileQuery'`): `{ path: string }`.
  - `FileContentSchema` (`id: 'FileContent'`): `{ path: string; content: string;
    lineEnding: LineEnding; bom: boolean; hash: string; size: number }`.
  - `SaveFileRequestSchema` (`id: 'SaveFileRequest'`): `{ path: string; content:
    string; lineEnding: LineEnding; bom: boolean }`; also the body of recreate.
  - `FileStateSchema` (`id: 'FileState'`): `{ hash: string; size: number }`; the
    answer of save, recreate and the state endpoint.
  - `files.changed` gains `files?: { path: string; hash: string }[]`: the files
    whose new content is known, after a save or a recreate.
  - The four error codes and texts of Global Constraints.

- [ ] **Step 1: Write the failing tests**: ids; `parses files.changed with and
      without files`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test shared-contracts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(contracts): add file contents`

---

### Task 3: Read, state, save and recreate

**Files:**

- Create: `libs/server/feature/files/src/content/file-contents.ts` (+
  `.spec.ts`)
- Modify: `src/files/files.controller.ts`, `src/files/files.dto.ts`,
  `src/files.module.ts`

**Interfaces:**

- Consumes: the codec (Task 1); `OpenableRepository.root`, `toFilesError` (plan
  14); `WorkingTreeGuard.change` (plan 17); `resolveInWorkingCopy`,
  `isMarkdownName` (plan 13); `DataLayout.tmpDir`; `EventsHub.publish`.
- Produces:
  - `FileContents.read(root, path): Promise<FileContent>`, `.state(root, path):
    Promise<FileState>`, `.save(userId, repositoryId, request):
    Promise<FileState>`, `.recreate(userId, repositoryId, request):
    Promise<FileState>`. A write goes to `tmp/save-<uuid>`, gets the old file's
    mode, and is renamed onto the path; save and recreate publish
    `files.changed` with the parent folder (and each restored folder and its
    parent) and `files: [{ path, hash }]`.
  - `GET /api/v1/repositories/:id/file?path=` (`readFile`) → `FileContent`; `GET
    …/file/state?path=` (`fileState`) → `FileState`; `PUT …/file` (`saveFile`) →
    `FileState`; `POST …/file/recreate` (`recreateFile`, `201`) → `FileState`.

- [ ] **Step 1: Write the failing tests**: `reads a file with its line ending,
      BOM and hash`; `AC-FILE-001.10: refuses a 2 MB file and a Latin-1 file`;
      `AC-FILE-001.11: refuses to read through a symbolic link`; `refuses a
      non-Markdown file`; `saves and returns the new hash`; `measures the limit
      on the bytes written`; `refuses to save a missing file`; `keeps the old
      file when the rename fails`; `keeps the file mode`; `refuses saves during
      a merge`; `recreates a deleted file and refuses an existing one`;
      `publishes files.changed with the saved hash`; `does not stage or commit`
      (`git status` shows the file as modified, the index unchanged).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-files`.
- [ ] **Step 3: Implement**; regenerate the client.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      server-feature-files server`.
- [ ] **Step 5: Commit** — `feat(files): read and save Markdown files`

---

### Task 4: API end-to-end tests and status

**Files:**

- Modify: `apps/server-e2e/src/files.e2e.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `saves a 1 MB file within the 2 MB body
      limit` (a file of exactly 1,048,576 bytes with CRLF line endings);
      `AC-EDIT-001.10: refuses a save over 1 MB and accepts it once smaller`;
      `AC-EDIT-001.11: refuses a save after the file was deleted and recreates
      it`; `AC-EDIT-001.13: refuses saves while a merge is in progress`;
      `answers another user's repository like a missing one` for every new
      endpoint.
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`; all pass.
- [ ] **Step 3: Update the status**: REQ-EDIT-001 → **In progress**, Built in
      `read-save-api`, MVP points not built: everything except ED-2, ED-6, ED-12
      and the backend halves of ED-19 and ED-21; REQ-FILE-001 adds FB-21's
      open-time checks on the backend. Run `doc-ids.mjs criteria` and copy its
      result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `test(files): cover
      reading and saving over the API`.
