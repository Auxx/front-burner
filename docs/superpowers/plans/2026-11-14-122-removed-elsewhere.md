# Removed Elsewhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 122 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): when
a repository is removed, every other tab and device that shows it goes to the
dashboard with "Repository _name_ removed.", without a reload; lists drop it at
once; and a device that finds a repository gone deletes its browser drafts
(RM-19, RM-20).

**Architecture:** One app-wide listener in `web/core`, `RemovedRepositories`,
handles `repository.removed`: if the current route belongs to that repository
(the repository screen or its settings page), it navigates to the dashboard with
the toast, and it deletes the device's drafts for it. The lists drop the entry
through `RepositoryListUpdates` (plan 113). A device that was offline learns it
on its next request: a `404 not-found` for a repository it holds drafts for
deletes them, as it would after the event _(plan's call)_.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-19, RM-20, AC-REPO-003.12);
NF-3.3; `docs/architecture/api.md` A-3.11.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- The name for the message is the one the tab already shows; a tab that has no
  name for it (it never listed it) shows nothing, as it shows nothing of it.
- A file with a waiting save on the repository screen is not saved: its
  repository is gone. The toast says so with the name, and its draft is deleted
  like the others _(plan's call: RM-19 deletes the drafts)_.
- The tab that removed the repository already went to the management page
  (plan 121) and ignores the event.
- The `unsavedChangesGuard` and the repository screen's own leave checks do not
  ask before this navigation.

## Review Focus

- **Two devices:** the second, on the repository screen with the file open, goes
  to the dashboard → end-to-end test `AC-REPO-003.12`.
- **A waiting save** on the second device is not sent to a removed repository
  and does not show an error loop → test `drops a waiting save`.
- **An offline device** deletes its drafts on its next `404` → test `deletes
  drafts on a 404 for that repository`.
- **The removing tab** does not navigate twice → test `ignores its own removal`.

---

### Task 1: Following a removal

**Files:**

- Create (with `toolkit-nx`): `services/removed-repositories/` under
  `libs/web/core/src/core/` (+ spec)
- Modify: `libs/web/core/src/core/providers/provide-core.ts`,
  `libs/web/shell/src/shell/services/repository-list-updates/*` (+ spec),
  `libs/web/feature-repository-screen/src/repository-screen/services/repository-session/*`
  (+ spec), `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-management.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: the event `repository.removed` (plan 111),
  `DraftStore.deleteRepository` (plan 121).

- [ ] **Step 1: Write the failing tests**: `AC-REPO-003.12: after removing, the
      repository is gone from every list, its working copy is deleted from disk,
      its saved credentials remain in the profile, and a second device that had
      it open goes to the dashboard` (end to end, two browser contexts); `goes
      to the dashboard from the settings page`; `drops the entry from the
      lists`; `drops a waiting save`; `deletes this device's drafts`; `deletes
      drafts on a 404 for that repository`; `ignores its own removal`; `ignores
      another repository's removal`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      web-core web-shell web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `removed-elsewhere`, and
      removes RM-17 to RM-21. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(core): follow a removal elsewhere`.
