# Repository Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 22 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
repository name in the repository screen's bar opens the repository switcher,
which lists the user's other recent repositories with their status and links to
all repositories and this repository's settings. On narrow screens the bar
shortens long names and the switcher also offers **Dashboard**.

**Architecture:** The dashboard's status and warning badges move from
`web/feature-dashboard` into `web/shell` as one component, since web features
may not import each other (A-2.4) and the switcher needs the same labels (RM-6,
RM-8). The switcher is a `ui-menu` in `web/feature-repository-screen`, filled
from the dashboard's own API call (NV-10's note, DS-17), which gains an
`exclude` query parameter so that it still returns ten other repositories.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/navigation.md` (REQ-APP-001: NV-10, NV-11 without
the branch, git counts and save status); `docs/requirements/dashboard.md` DS-16,
DS-17, DS-20, DS-22; `repo-manage.md` RM-6, RM-8.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- The switcher lists up to **10** repositories other than the current one, in
  the dashboard's order (DS-16), each with its status badge. An openable one
  links to `/repositories/<id>`; a cloning or failed one links to its settings
  page, as on the dashboard (DS-22).
- Below the list, in this order: **All repositories** (`/repositories`) and
  **Repository settings** (`/repositories/<id>/settings`); on narrow screens,
  **Dashboard** (`/`) first (NV-11). Until REQ-REPO-003 the last two lead to
  "Page not found" (step 2 index, "Left out").
- On narrow screens the repository name is shortened with an ellipsis and its
  full name is shown on hover, focus and long press (`uiTooltip`) (NV-11).
- NV-12 (sending a waiting save before switching) comes with plan 25; there is
  nothing to save yet.
- Translation keys of the moved badges become
  `web-shell.RepositoryStatusComponent.status.<status>` and
  `.warning.<warning>`; the dashboard's old keys are removed.

## Review Focus

- **A user with exactly 11 repositories, the current one among the 10 most
  recent** must see the other 10, not 9 → Task 1 test `excludes the current
  repository and still returns ten`.
- **An `exclude` ID that is another user's repository** must change nothing and
  reveal nothing → Task 1 test `ignores another user's ID in exclude`.
- **The switcher's list failing to load** must leave **All repositories** and
  **Repository settings** usable, with the error and **Try again** → Task 3 test
  `keeps the links when the list fails`.
- **A very long repository name on a 320 px screen** must not push the user menu
  off the bar → Task 4 test `shortens a long name on a phone`.
- **The dashboard after the badge move** must look and read exactly as before →
  Task 2 test: the dashboard's existing badge tests pass unchanged except for
  the import.

---

### Task 1: `exclude` on the recent list

**Files:**

- Modify: `libs/shared/contracts/src/repositories/repository-summary.schema.ts`
  (+ spec), `libs/server/feature/repositories/src/repositories/*` (+ specs)

**Interfaces:**

- Produces: `RecentQuerySchema` (`id: 'RecentQuery'`): `{ exclude?: number }`;
  `GET /api/v1/repositories/recent?exclude=<id>` returns up to 10 of the user's
  repositories other than `exclude`; `RepositoryQueries.recent(userId, limit =
  10, exclude?: number)`.

- [ ] **Step 1: Write the failing tests**: `excludes the current repository and
      still returns ten`; `ignores another user's ID in exclude`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      server-feature-repositories`.
- [ ] **Step 3: Implement**; regenerate the client.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      shared-contracts server-feature-repositories`.
- [ ] **Step 5: Commit** — `feat(repositories): exclude one repository from the
      recent list`

---

### Task 2: Status badges in the shell

**Files:**

- Create (generated component):
  `libs/web/shell/src/shell/components/repository-status` (+ `.spec.ts`)
- Modify: `libs/web/shell/src/index.ts`,
  `libs/web/feature-dashboard/src/dashboard/components/repository-entry/*` (+
  spec), `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces: `RepositoryStatusComponent` (`shell-repository-status`), input
  `repository: RepositorySummary`: the status badge (none for `ready`) and one
  badge per warning, with the dashboard's looks and texts.

- [ ] **Step 1: Write the failing tests**: `shows no badge for a ready
      repository`; `shows the status and each warning`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-shell`.
- [ ] **Step 3: Implement**, switch the dashboard entry to it, move the keys.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      web-shell web-feature-dashboard`.
- [ ] **Step 5: Commit** — `refactor(shell): share repository status badges`

---

### Task 3: The switcher

**Files:**

- Create (generated component):
  `libs/web/feature-repository-screen/src/repository-screen/components/repository-switcher`
  (+ `.spec.ts`)
- Modify: `components/repository-bar/*` (+ spec), `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `RepositoriesApi.recent({ exclude })` (Task 1);
  `RepositoryStatusComponent` (Task 2); `uiMenuTrigger`, `ui-menu`, `uiTooltip`.
- Produces: `RepositorySwitcherComponent` (input `repository`): the bar's
  repository name as the menu's trigger (`aria-haspopup`); the list is fetched
  each time the menu opens, with a loading row, and on failure an error row with
  **Try again**.

- [ ] **Step 1: Write the failing tests**: `lists other repositories with their
      status`; `links a cloning repository to its settings`; `offers All
      repositories and Repository settings`; `offers Dashboard on narrow
      screens`; `keeps the links when the list fails`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): add the repository
      switcher`

---

### Task 4: End-to-end tests and status

**Files:**

- Modify: `apps/web-e2e/src/repository-screen.spec.ts`, `docs/product/mvp.md`

- [ ] **Step 1: Write the tests**: `AC-APP-001.6: opens the switcher with recent
      repositories, All repositories and Repository settings, and switches to
      another repository` (the new one moves to the top of the dashboard; the
      "edit typed just before is saved" half comes with plan 25); `shortens a
      long name on a phone` (320 px, the user menu visible, the full name on
      focus); `has no axe violations` with the switcher open.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 3: Update the status**: REQ-APP-001 removes NV-10 and NV-11 from
      MVP points not built, noting NV-11's branch, git counts and save status as
      still to come; Built in adds `repository-switcher`. Run `doc-ids.mjs
      criteria` and copy its result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit
      `test(repository-screen): cover the repository switcher`.
