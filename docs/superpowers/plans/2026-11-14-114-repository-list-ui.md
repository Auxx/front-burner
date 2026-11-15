# Repository Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 114 of [the step 5 index](2026-11-14-00-roadmap-step-5.md):
`/repositories` lists all of the user's repositories with a filter, **Add
repository** and **Open**, and follows clones without a reload. The
**Repositories** link of the app header and the dashboard's **All repositories**
link get their page.

**Architecture:** A page in `web/feature-repositories`, on `GET /repositories`
(plan 104), built from the pieces of plan 113 and `shell-repository-status`. The
route `''` of `repositoriesRoutes` is the page; the app's `canMatch` that kept
`/repositories` itself out goes. Each entry's name links to its settings page
(plan 115), so until plan 115 is merged the link leads to Page not found; plan
115 is next in its wave _(plan's call: a link in place now keeps RM-5's layout
final)_.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-3 to RM-5, RM-7, AC-REPO-003.1
to AC-REPO-003.3); `docs/requirements/navigation.md` (NV-1, NV-5, NV-13);
`docs/requirements/dashboard.md` (DS-11, DS-18, DS-24).

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- The heading is "Repositories" and the tab title "Repositories · Front Burner"
  (NV-13).
- The filter matches the name and the remote's display form, ignoring case, as
  the user types, with no request. It is a search field with a visible label;
  "No repositories match _x_." when nothing does _(plan's call)_.
- Each entry: the name (a link to `/repositories/<id>/settings`), the status and
  warnings (`shell-repository-status`), the remote, "Last accessed", and
  **Open** for an openable repository, to `/repositories/<id>`.
- A user with no repositories sees `shell-add-repository-guide` instead of the
  list and the filter.
- Loading and a failed load behave as on the dashboard (DS-25, DS-26).
- The list is not paged (RM-5).

## Review Focus

- **Order** is the backend's: the page does not sort again → test `keeps the
  order of the response`.
- **The filter** matches the remote too, and is announced to screen readers (the
  count of matches) → test `filters by name and remote`.
- **A clone that ends** makes the entry **Ready** with **Open**, without a
  reload → test `AC-REPO-003.3: a cloning repository shows its progress without
  a reload, and becomes Ready with Open when the clone ends` (end to end).
- **Phones:** no sideways scroll at 360 px, every action reachable by touch →
  test `fits a phone`.

---

### Task 1: The page

**Files:**

- Create (with `toolkit-nx`): `pages/repositories/`,
  `components/repository-list-entry/` under
  `libs/web/feature-repositories/src/repositories/` (+ specs)
- Modify:
  `libs/web/feature-repositories/src/repositories/repositories.routes.ts`,
  `apps/web/src/app/app.routes.ts`, `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/` (a new `repository-management.spec.ts`),
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `RepositoriesApi.list` (plan 104), `RepositoryListUpdatesService`,
  `LastAccessedComponent`, `AddRepositoryGuideComponent` (plan 113).
- Produces: `RepositoriesPage` at `/repositories`.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-003.1: the repository
      management page lists all repositories sorted by name, with name, remote,
      last access time and status, filters them as the user types, and Add
      repository opens the Add repository page` (end to end); `AC-REPO-003.2:
      the dashboard's All repositories link opens this page, and its link for a
      repository in error opens that repository's settings page` (end to end);
      `AC-REPO-003.3: …` (end to end, as above); `keeps the order of the
      response`; `filters by name and remote`; `says when nothing matches`;
      `shows the guide without repositories`; `offers Open only for openable
      repositories`; `shows a failed load with Try again`; `fits a phone`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `repository-list-ui`, and
      REQ-APP-001 removes the `/repositories` route from NV-1's pages not built.
      Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): the repository
      management page`.
