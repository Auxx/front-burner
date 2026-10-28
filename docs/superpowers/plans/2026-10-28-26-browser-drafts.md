# Browser Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 26 of [the step 2 index](2026-10-28-00-roadmap-step-2.md):
unsaved edits survive a reload, a crashed tab or a lost connection. They are
kept in the browser until the backend confirms the save, offered back when the
file is opened again, deleted on logout, and closing a tab with unsaved edits
asks first.

**Architecture:** A `DraftStore` in `web/core` (A-8.10) keeps drafts in
IndexedDB, keyed by user, repository and path, with the native API and no
package; it watches the login state and clears every draft when the session
ends. The repository screen's `OpenFiles` (plan 25) writes a draft whenever its
saver reads content to send, and deletes it once the newest content is
confirmed. Opening a file looks for a draft and, if one differs from the file,
shows the offer and keeps the editor read-only until the user chooses. The store
is created at start-up, so that a tab that never opened the editor still clears
drafts on logout.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/editor.md` (REQ-EDIT-001: ED-7, ED-20, ED-22,
FB-39's draft; criteria 6, 7, 8); `navigation.md` NV-8 (AC-APP-001.3's drafts
half); `docs/architecture/web-client.md` A-8.10; `non-functional.md` NF-3.3 to
NF-3.5.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- IndexedDB database `front-burner`, object store `drafts`, key
  `<userId>/<repositoryId>/<path>`. A draft is `{ content: string; savedAt:
  string (ISO) }`. No secret is ever in a draft.
- A draft is written each time the saver reads the content to send it, and on
  `pagehide`; it is deleted when a save confirms the content that is newest at
  that moment _(plan's call: an edit made in the last 1.5 s before a crash can
  be lost; writing up to 1 MB on every keystroke would slow typing, NF-2.4)_.
- A draft is **offered, never applied** (NF-3.4): "You have unsaved changes from
  {time}" (the time in the browser's locale) with **Restore** and **Discard**.
  Until the user chooses, the editor shows the file as on disk and is read-only
  (ED-7). **Restore** puts the draft into the editor as one undoable edit and
  saves it at once; **Discard** deletes the draft. A draft equal to the file's
  content is deleted without asking _(plan's call)_.
- Drafts are deleted: all of them when the user logs out, when the session ends
  and cannot be refreshed, and when another tab logs out (NF-3.5, NV-8); one
  when this tab's own file tree deletes the file or a folder holding it (FB-39).
  A rename made from this tab moves the draft to the new path. A file deleted or
  changed elsewhere never loses its draft (FB-42, ED-21).
- Closing or reloading the tab while any open file has unsaved edits makes the
  browser ask (`beforeunload`, ED-22). Navigating inside the web client does not
  (the waiting save is sent at once, plan 25).
- Where IndexedDB is missing or throws (private windows, storage turned off),
  drafts are skipped and everything else works.

## Review Focus

- **Logging out in another tab** must delete the drafts this tab would otherwise
  write a moment later → Task 3 test `stops writing drafts once the session
  ends`.
- **A confirmed save of older content arriving after newer typing** must not
  delete the draft of the newer content → Task 2 test `keeps the draft while
  newer content is unsaved`.
- **A draft for a file that was deleted elsewhere** must survive opening the
  repository again → Task 2 test `keeps a draft whose file is gone`.
- **IndexedDB throwing on open** must not break opening files or saving → Task 1
  test `works without IndexedDB`.
- **Choosing Restore while offline** must keep the draft and show "Not saved —
  offline, retrying", not lose the content → Task 2 test `keeps the draft when a
  restored save cannot be sent`.

---

### Task 1: The draft store

**Files:**

- Create: `libs/web/core/src/core/saving/draft-store.ts` (+ `.spec.ts`)
- Install: `fake-indexeddb` as a dev dependency (`npm install --save-dev
  --save-exact`), since jsdom has no IndexedDB; the specs import
  `fake-indexeddb/auto`.
- Modify: `libs/web/core/src/index.ts`

**Interfaces:**

- Produces:
  - `interface DraftKey { userId: number; repositoryId: number; path: string }`;
    `interface Draft { content: string; savedAt: string }`.
  - `DraftStore` (`providedIn: 'root'`): `put(key, draft): Promise<void>`,
    `get(key): Promise<Draft | null>`, `delete(key): Promise<void>`, `move(from:
    DraftKey, to: DraftKey): Promise<void>`, `clearAll(): Promise<void>`;
    `available: boolean`. Every method resolves, never rejects, when IndexedDB
    fails.

- [ ] **Step 1: Write the failing tests**: `stores, reads and deletes a draft`;
      `keeps drafts of users, repositories and paths apart`; `moves a draft`;
      `clears every draft`; `works without IndexedDB`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-core`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(core): keep drafts in IndexedDB`

---

### Task 2: Drafts on the repository screen

**Files:**

- Create (generated component):
  `libs/web/feature-repository-screen/src/repository-screen/components/draft-offer`
  (+ `.spec.ts`)
- Modify: `libs/web/core/src/core/saving/file-saver.ts` (+ spec),
  `services/open-files/*` (+ spec), `services/entry-commands/*` (+ spec),
  `components/editor-pane/*`, `pages/repository-screen/*`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `DraftStore` (Task 1); `FileSaver` (plan 25); `setReadOnly` (plan
  24).
- Produces:
  - `FileSaver` gains `sending: Observable<string>` (the content of each save as
    it is sent).
  - `OpenFile` gains `draft: WritableSignal<Draft | null>` (the offer, until the
    user chooses); `OpenFiles.restoreDraft(path)` and `.discardDraft(path)`.
  - `DraftOfferComponent` (input `draft: Draft`; outputs `restore`, `discard`):
    the offer of Global Constraints, as an inline banner above the editor; its
    buttons are reachable by keyboard.
  - The page listens to `beforeunload` and asks while `OpenFiles.anyUnsaved()`.

- [ ] **Step 1: Write the failing tests**: `writes a draft when a save is sent
      and deletes it when confirmed`; `keeps the draft while newer content is
      unsaved`; `offers a draft and keeps the editor read-only`; `restores a
      draft as one undoable edit and saves it`; `keeps the draft when a restored
      save cannot be sent`; `discards a draft`; `deletes a draft that equals the
      file`; `deletes the draft when the tree deletes the file`; `moves the
      draft when the tree renames the file`; `keeps a draft whose file is gone`;
      `asks before the tab closes with unsaved edits`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      web-core web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): offer browser drafts`

---

### Task 3: Deleting drafts when the session ends

**Files:**

- Modify: `libs/web/core/src/core/saving/draft-store.ts` (+ spec),
  `libs/web/core/src/core/providers/provide-core.ts` (+ spec)

**Interfaces:**

- Consumes: `AuthSessionService.loggedIn` (a signal that turns false on logout,
  on an ended session and on a logout in another tab).
- Produces: `DraftStore` clears every draft, with an `effect`, whenever
  `loggedIn()` turns false; `put` does nothing while it is false, so a save
  queue still running after the session ended writes no more drafts.
  `provideCore()` creates the store at start-up
  (`provideEnvironmentInitializer`). `AuthSessionService` does not change, so
  the two services never inject each other.

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-001.7: deletes every draft
      on logout`; `deletes drafts when the session expires`; `deletes drafts
      when another tab logs out`; `stops writing drafts once the session ends`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-core`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(core): delete drafts when the session ends`

---

### Task 4: End-to-end tests and status

**Files:**

- Modify: `apps/web-e2e/src/editor.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `AC-EDIT-001.6: offers an offline edit after
      a reload and restores it`; `AC-EDIT-001.7: deletes drafts on logout`
      (IndexedDB read with `page.evaluate`); `AC-EDIT-001.8: asks before closing
      a tab with unsaved edits` (Playwright's `beforeunload` dialog with
      `page.close({ runBeforeUnload: true })`); `AC-APP-001.3: deletes browser
      drafts when logging out` (with the other parts of the criterion that
      exist); `has no axe violations` with the offer shown.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 3: Update the status**: REQ-EDIT-001 adds ED-7, ED-20 and ED-22,
      Built in adds `browser-drafts`; REQ-FILE-001 completes FB-39. Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `test(editor): cover
      browser drafts`.
