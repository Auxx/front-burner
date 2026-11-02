# Author on the Commit Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 54 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): the
commit form says "Committing as _Name &lt;email&gt;_" with **Change**, and the
user's very first commit first asks them to confirm or change it.

**Architecture:** Two dialogs in `web/repository-dialogs`, built on plan 43's
form. `CommitService.commit` asks a new `CommitAuthorGate.ready(repositoryId)`
before anything else. The API's `409 commit-author-not-confirmed` opens the same
question and then retries once, so that a confirmation state that has moved on,
or a client started before it did, ends in the same place (CA-13).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/commit-author.md` (the third bullet of CA-9, CA-11,
CA-12, CA-13; criteria 2, 6, 10, 12); `docs/requirements/git-advanced.md` GA-18.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- The question offers **Commit as _Name &lt;email&gt;_** and **Change**, with
  CA-11's explanation; cancelling cancels the commit, keeping the message
  (CA-12).
- **Change** edits the author, "for this repository" or "as my default", with
  the user's choice in the same dialog; "for this repository" is the first
  choice when the repository already has an override, "as my default" otherwise
  _(plan's call)_.
- After **Change** in the question: `PUT` the default, which confirms; or `PUT`
  the override and then `POST …/confirm`, which plan 42 keeps separate.
- The dialogs move focus to their first field or button and return it when they
  close (NF-13).

## Review Focus

- **A name that needs escaping** (`O'Brien & "Sons"`) in "Commit as" must show
  as text → Task 1 test `shows the author as text`.
- **Saving the author failing after the question was answered** must not commit
  as the old author → Task 2 test `does not commit when saving the author
  fails`.
- **Two tabs both on a first commit:** the second tab's state is stale, and its
  API answer must not produce a second question once confirmed → Task 2 test
  `asks once when the API refuses, and retries once`.
- **A changed override** must update "Committing as" in every tab → Task 2 test
  `reads the author again on git.changed and after Change`. `PUT` publishes
  `git.changed` for an override; the default affects all, so each tab also reads
  on (re)connect.
- **Very long name and email at 320 px** must wrap and stay readable → the
  end-to-end run at 320 px.

---

### Task 1: The dialogs

**Files:**

- Create (with `toolkit-nx`): `dialogs/confirm-commit-author/`,
  `dialogs/change-commit-author/` under
  `libs/web/repository-dialogs/src/repository-dialogs/` (+ specs and stories)
- Modify: `libs/web/repository-dialogs/src/index.ts`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `CommitAuthorFormComponent`, `PreferencesApi` (plan 42).
- Produces:
  - `ChangeCommitAuthorDialog`: data `{ repositoryId: number; current:
    RepositoryCommitAuthor }`; closes with the new `RepositoryCommitAuthor`, or
    `undefined`.
  - `ConfirmCommitAuthorDialog`: data as above; closes with `'confirmed'` or
    `undefined`. It opens the change dialog's form in place for **Change**.

- [ ] **Step 1: Write the failing tests**: `offers Commit as the author, and
      Change`; `Change saves as the default or for this repository`; `shows a
      refusal next to the field`; `shows the author as text`; `explains the
      email, with the providers' links`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-repository-dialogs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(dialogs): confirm and change the commit author`

---

### Task 2: On the commit form

**Files:**

- Create (with `toolkit-nx`):
  `services/commit-author-gate/commit-author-gate.service.ts` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `components/commit-form/*`, `services/commit/commit.service.ts` (+
  spec),
  `libs/server/feature/preferences/src/commit-author/commit-author.controller.ts`
  (+ spec; `git.changed` after an override changes),
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `CommitService`, `PreferencesApi.repositoryCommitAuthor`, the two
  dialogs.
- Produces: `CommitAuthorGate` (provided by the page): `author:
  Signal<RepositoryCommitAuthor | null>`, `ready(): Promise<boolean>`,
  `change(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-001.2: the first commit asks,
      and cancelling makes no commit; the second commit, in any repository, does
      not ask` (end to end); `AC-GIT-001.6: the form shows Committing as, and
      Change updates it, as the default or for this repository`; `AC-GIT-001.10:
      the API refuses a user who has not confirmed, and the web client asks`
      (end to end); `does not commit when saving the author fails`; `asks once
      when the API refuses, and retries once`; `reads the author again on
      git.changed and after Change`; `AC-GIT-001.12: editing the default before
      the first commit means the first commit does not ask` (end to end).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-001 adds `commit-author-dialogs`;
      what is left is CA-9's repository management page (step 5), CA-14 (step 4)
      and CA-15's push error (plan 57). REQ-GIT-002 removes the author line of
      GA-18. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit
      `feat(repository-screen): the commit author on the commit form`.
