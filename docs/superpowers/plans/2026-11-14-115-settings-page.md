# Repository Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 115 of [the step 5 index](2026-11-14-00-roadmap-step-5.md):
`/repositories/:id/settings` shows the repository's name, remote, status and
warnings, **Open** when it is openable, the breadcrumbs, and the **Clone
details** section. Plans 116 to 121 add the other sections to it.

**Architecture:** A page in `web/feature-repositories` on `GET
/repositories/:id/details` (plan 106), with a `RepositorySettingsStore` provided
by the page that holds the details, reloads them on `repository.status`,
`repository.warning`, `key.locked`, `key.unlocked` and a reconnect, and that the
later sections read. Sections are components in the order of RM-9, so that each
plan adds one without touching the others.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-1, RM-3, RM-9, RM-16,
AC-REPO-003.10); `docs/requirements/navigation.md` (NV-1, NV-13, NV-14,
AC-APP-001.10); A-10.50.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Breadcrumbs "Repositories › _name_ › Settings", the first two links: to
  `/repositories` and to the repository screen when it is openable, else to this
  page _(plan's call: the name always links somewhere useful)_. The tab title is
  "Settings · _name_ · Front Burner" (NV-13).
- A repository that does not exist, or another user's, shows Page not found
  (RM-1), as the repository screen does (FB-2). A malformed ID too.
- **Clone details** is a key-value list (A-10.50): "Clone mode" (**Full clone**,
  or **Single branch** with "Single branch: _main_"), "Git control level"
  (Advanced with AR-38's description), "Added" (the date, with the exact time on
  focus, as "Last accessed").
- The route is a child of the existing `repositoriesRoutes`, so it has the app
  header (NV-5).

## Review Focus

- **A missing or foreign ID** shows Page not found, not an empty page → test
  `shows Page not found for a repository that does not exist`.
- **A status change while the page is open** shows at once → test `follows the
  status without a reload`.
- **Focus after navigation** goes to the heading (NV-17) → test `moves focus to
  the heading`.

---

### Task 1: The page and Clone details

**Files:**

- Create (with `toolkit-nx`): `pages/repository-settings/`,
  `components/clone-details/`, `services/repository-settings-store/` under
  `libs/web/feature-repositories/src/repositories/` (+ specs)
- Modify:
  `libs/web/feature-repositories/src/repositories/repositories.routes.ts`,
  `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-management.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `RepositoriesApi.details` (plan 106).
- Produces: `RepositorySettingsPage` at `/repositories/:id/settings`;
  `RepositorySettingsStore` with `details: Signal<RepositoryDetails |
  undefined>` and `reload(): void`.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-003.10: Clone details shows
      "Single branch: main" for a single-branch clone, and the git control
      level` (end to end); `AC-APP-001.10: the repository settings page shows
      "Repositories › handbook › Settings", and the first two items are links`
      (end to end); `shows the name, remote, status and warnings`; `offers Open
      only when openable`; `shows Page not found for a repository that does not
      exist`; `follows the status without a reload`; `reloads after a
      reconnect`; `moves focus to the heading`; `has the tab title`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `settings-page`, and
      REQ-APP-001 removes the settings route from NV-1's pages not built. Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): the repository
      settings page`.
