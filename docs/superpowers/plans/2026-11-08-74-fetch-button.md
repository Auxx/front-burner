# Fetch Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 74 of [the step 4 index](2026-11-08-00-roadmap-step-4.md):
**Fetch** is in the bar next to **Push**, shows progress, updates the counts,
and says plainly when it fails.

**Architecture:** `rs-push-button` becomes `rs-git-actions`, which holds all
three actions, and the menu on narrow screens (GA-7). The reasons for an action
being unavailable become a util, with one function per action. A failed
**Fetch** the user pressed shows in the same banner as a failed push (RC-4), and
the fix runs the fetch again (RC-9).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-7, GA-9, GA-33's **Fetch**,
GA-43); `docs/requirements/repo-credentials.md` (RC-4, RC-9, RC-17);
`docs/requirements/navigation.md` (NV-9, NV-11).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- **Fetch** is offered whenever the status has been read, and unavailable while
  another network job runs (GA-9). From plan 81, the merge bar replaces these
  actions during a merge (GC-6), though the API still allows a fetch (GC-3).
- While it runs: a spinner and "Fetching…", and the status says so to screen
  readers.
- A fetch the user pressed that moved nothing shows a toast, "No new commits",
  as otherwise nothing shows that it ran; one that moved only another branch
  shows "No changes received for this branch"; one that moved the upstream
  updates the counts _(plan's call)_. Only the tab that started it says so.
- RC-4's first row says "Add credentials to push." for a push; a private
  repository that refuses an anonymous fetch shows the same words, as the fix is
  the same.

## Review Focus

- **Another tab's fetch** disables the actions here, and its failure is shown
  only quietly (as a push's) → Task 2 test `shows another tab's fetch as
  running`.
- **A locked key** opens the dialog at once and the fetch carries on (RC-4,
  RC-17) → Task 1 test `asks for a locked key, then fetches`.
- **A fetch with `moved: false` after a reload** must not say "No new commits"
  in a tab that did not press **Fetch** → Task 1 test `says nothing for a fetch
  taken up from the status`.
- **The phone's menu** must keep its reasons readable, and close after a choice
  → Task 2 test `moves Fetch and Push into a menu on a phone`.
- **A failed fetch that the user retried** clears the old banner at once → Task
  1 test `clears the problem when it runs again`.

---

### Task 1: Following a fetch

**Files:**

- Modify: `services/network-job/network-job.service.ts` (+ spec) under
  `libs/web/feature-repository-screen/src/repository-screen/`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `GitApi.fetch` (plan 70), `NetworkJobService` (plan 73).
- Produces: `NetworkJobService.start('fetch')`, and the outcome `fetched`.

- [ ] **Step 1: Write the failing tests**: `starts a fetch and follows its job`;
      `says No new commits when nothing moved`; `says nothing for a fetch taken
      up from the status`; `asks for a locked key, then fetches`; `clears the
      problem when it runs again`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): follow a fetch`

---

### Task 2: The actions in the bar

**Files:**

- Move: `components/push-button/` to `components/git-actions/` under
  `repository-screen/`, selector `rs-git-actions`
- Create: `utils/git-action-reasons/git-action-reasons.ts` (+ spec)
- Modify: `components/repository-bar/*`,
  `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Produces:
  - `GitActionsComponent`: inputs `status: GitStatus | null`, `running:
    GitNetworkJobType | null`, `narrow: boolean`; outputs `fetch`, `push`.
  - `fetchUnavailableReason(status: GitStatus | null): string | null` and
    `pushUnavailableReason`, moved from the component.

- [ ] **Step 1: Write the failing tests**: `offers Fetch once the status is
      read`; `disables the others while one runs, with progress on the one that
      runs`; `shows another tab's fetch as running`; `moves Fetch and Push into
      a menu on a phone`; end to end, `Fetch brings the counts of a commit
      pushed elsewhere`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `fetch-button`, and
      removes **Fetch** from GA-7, GA-9 and GA-33. REQ-APP-001 adds it; NV-9 and
      NV-11 keep **Pull**. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): the Fetch
      button`.
