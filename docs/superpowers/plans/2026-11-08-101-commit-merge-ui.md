# Commit Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 101 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): when
every file is resolved, **Commit merge** shows the message and who commits, and
commits; the screen goes back to normal, and a notice offers **Push**.

**Architecture:** **Commit merge** goes in `rs-merge-summary`. Its dialog reuses
`dlg-commit-author-summary` and `CommitAuthorGate`, as the commit form does, so
that the first-commit question (CA-14) is the same one. The notice follows
state, not the commit's response: it shows while `GitStatus.undoableMerge` is
true, so that it also shows after a reload and on another device (AC-GIT-003.11)
_(plan's call)_. It can be dismissed for the visit.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-conflicts.md` (GC-6's **Commit merge**, GC-20
to GC-22, AC-GIT-003.11); `docs/requirements/commit-author.md` (CA-9, CA-12,
CA-14); `docs/requirements/navigation.md` (NV-16).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- **Commit merge** is unavailable until every file is resolved, with the reason
  "Resolve every file first" on hover, focus or tap (GA-8's way). A merge with
  no conflicting file left is ready at once.
- The message starts as `GitMergeState.message`, can be edited, and must not be
  empty after trimming. "Committing as _Name &lt;email&gt;_" with **Change**
  (CA-9).
- Exact notice: "Merge committed. Push to publish it." with **Push**. **Undo
  merge** comes in plan 102.
- **Push** in the notice runs as in the bar.

## Review Focus

- **The user's first commit ever** is this merge: the question comes before the
  dialog commits, and cancelling leaves the merge in progress → Task 1 test
  `asks for the author first, and cancelling leaves the merge`.
- **A file reopened as unresolved on another device** while the dialog is open:
  the backend refuses with `merge-unresolved`, the dialog says so and stays →
  Task 1 test `says when a file became unresolved`.
- **The message edited, then a failure:** it must still be there for a retry
  (GC-27) → Task 1 test `keeps the message after a failure`.
- **The merge finished on another device while the dialog is open** closes it,
  and says nothing frightening → Task 1 test `closes when the merge ends
  elsewhere`.
- **A notice pressed Push while the notice is about to go:** the push's own
  banner and toast still work after the notice has gone → Task 2 test `pushes,
  and the notice goes`.

---

### Task 1: The dialog

**Files:**

- Create (with `toolkit-nx`): `dialogs/commit-merge/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `components/merge-summary/*`,
  `services/merge-actions/merge-actions.service.ts` (+ spec),
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `GitApi.commitMerge`, `CommitAuthorGate.ready`,
  `CommitAuthorGate.author`, `CommitAuthorGate.change`,
  `CommitAuthorSummaryComponent`.
- Produces: `MergeActionsService.commit(): Promise<void>`;
  `MergeSummaryComponent` output `commit`.

- [ ] **Step 1: Write the failing tests**: `is unavailable until every file is
      resolved, with the reason`; `is ready at once with no conflicting file
      left`; `starts with git's message`; `refuses an empty message`; `says who
      commits, and Change changes it`; `asks for the author first, and
      cancelling leaves the merge`; `says when a file became unresolved`; `keeps
      the message after a failure`; `closes when the merge ends elsewhere`;
      `moves focus to the message, and returns it`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): commit a merge`

---

### Task 2: The notice

**Files:**

- Create (with `toolkit-nx`): `components/merge-committed/` under
  `repository-screen/` (+ spec)
- Modify: `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Produces: `MergeCommittedComponent` (`rs-merge-committed`), outputs `push`,
  `dismissed`. Plan 102 adds `undo`.

- [ ] **Step 1: Write the failing tests**: `commits with git's message, as
      edited, and the screen returns to normal on every device, with the notice`
      (end to end; plan 102 names AC-GIT-003.11, when the notice also offers
      **Undo merge**); `pushes, and the notice goes`; `shows after a reload`;
      `stays dismissed for the visit`; `goes when the merge is pushed
      elsewhere`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-003 adds `commit-merge-ui`, and
      removes GC-6, GC-20 to GC-22. REQ-GIT-001 adds it, and removes CA-14 and
      CA-9's commit screen part. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): the merge
      committed notice`.
