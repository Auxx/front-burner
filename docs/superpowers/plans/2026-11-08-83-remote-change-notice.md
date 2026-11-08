# Remote-Change Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 83 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): when a
fetch finds new commits, a notice says "3 new commits on origin/main", adds
"This file changed too." when the open file is among them, and offers **Pull**.

**Architecture:** `RemoteChangesService` derives the notice from state: it reads
`GET …/git/incoming?path=<open file>` when `status.behind` or the open file
changes. Dismissing remembers the count, so that the notice comes back only when
more commits arrive (GA-34). The memory is per tab and per visit, like the
locked-key banner's.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-34, AC-GIT-002.13); D-4.2;
`docs/requirements/navigation.md` (NV-16).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Exact text: "1 new commit on origin/main" / "3 new commits on origin/main",
  then "This file changed too." with **Pull** and a dismiss button.
- Below the bar with the other notices (NV-16), a `ui-inline-banner` with
  `announce`. Not shown while `behind` is 0 or during a merge, and not while a
  pull runs.
- **Pull** here runs as in the bar, with its save first (plan 82).

## Review Focus

- **A failed read of `incoming`** still shows the count, which the status
  already has, without the second sentence → Task 1 test `shows the count when
  incoming cannot be read`.
- **Opening another file** changes "This file changed too." without a new notice
  or a new announcement → Task 1 test `reads again for the open file, quietly`.
- **Dismissed at 3, then 4 commits:** it comes back; dismissed at 3, then still
  3 after a reload of the status: it does not → Task 1 test `comes back only
  when more commits arrive`.
- **Commits pushed from this instance's other branch or a pull elsewhere** make
  `behind` fall to 0, and the notice goes → Task 1 test `goes when nothing is
  left to pull`.
- **A switch to another branch** must not keep the old branch's notice or
  dismissal → Task 1 test `forgets the dismissal on another branch`.

---

### Task 1: The notice

**Files:**

- Create (with `toolkit-nx`):
  `services/remote-changes/remote-changes.service.ts`,
  `components/remote-change-notice/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ specs)
- Modify: `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `GitApi.incoming`, `GitStatusStore`, `OpenFilesService.current`.
- Produces:
  - `RemoteChangesService`: `notice: Signal<{ commits: number; upstream: string;
    touchesOpenFile: boolean } | null>`, `dismiss(): void`. Provided by the
    page.
  - `RemoteChangeNoticeComponent` (`rs-remote-change-notice`): input `notice`,
    outputs `pull`, `dismissed`.

- [ ] **Step 1: Write the failing tests**: `says how many commits, and where`;
      `says This file changed too. for the open file`; `reads again for the open
      file, quietly`; `shows the count when incoming cannot be read`; `comes
      back only when more commits arrive`; `goes when nothing is left to pull`;
      `forgets the dismissal on another branch`; `shows nothing during a merge`;
      `Pull in the notice pulls`; `AC-GIT-002.13: while the repository is
      viewed, a commit pushed to the upstream from elsewhere shows 1 new commit
      on origin/main within about 2 minutes, with This file changed too. when it
      changes the open file; the user's files do not change until they pull`
      (end to end, with `test.setTimeout` of 150 seconds, as A-6.7 keeps the
      interval a constant).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `remote-change-notice`,
      and removes GA-33 and GA-34. REQ-APP-001 removes NV-16's remote-change
      notice. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): the remote-change
      notice`.
