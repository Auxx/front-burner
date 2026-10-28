# Repository Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 15 of [the step 2 index](2026-10-28-00-roadmap-step-2.md):
opening a repository from the dashboard shows the repository screen: one bar
with the product's icon, the repository name and the user menu, a file tree pane
(empty until plan 16) that collapses, resizes and becomes a drawer on phones,
and the editor area's empty state. A repository that cannot be opened shows its
status instead.

**Architecture:** A new lazy feature library, `web/feature-repository-screen`
(A-2.2a), is routed at `/repositories/:id` **outside** `ShellLayoutComponent`,
because its bar replaces the app header (NV-9). It builds that bar from parts
that `web/shell` now exports (A-2.5). One route with a custom `UrlMatcher`
serves both `/repositories/<id>` and `/repositories/<id>/files/<path>`, so that
the page component is reused when only the file changes, and `open` is called
once per visit (FB-11, DS-8). The panes are `ui-app-shell`'s side pane, drawer
and resizer.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/file-browser.md` (REQ-FILE-001: FB-1 to FB-3, FB-6
to FB-11; criteria 1, 3, 4 without the drawer closing on a file);
`docs/requirements/navigation.md` NV-1, NV-9 (without the branch, git and save
status), NV-13, NV-17; `docs/requirements/dashboard.md` DS-7, DS-8, DS-22;
`docs/architecture/web-client.md` A-8.1, A-8.14; `modules.md` A-2.2a, A-2.5.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- `RepositoriesApi.open(id)` is called exactly once per arrival at a repository,
  never on a change of the file in the route, a reload of the tree, or a
  reconnect (FB-11, DS-8).
- The bar has, from start to end: the product's icon as a link to `/`
  ("Dashboard"), the repository name, and the user menu (NV-9). The branch, git
  and save status arrive with later plans; leave no empty placeholders for them.
- Page title: `<repository name> · Front Burner` (NV-13). Plan 16 adds the file
  name in front.
- Landmarks: the bar is `banner`, the tree pane a region labelled "Files", the
  editor area `main` labelled "Editor" (NV-17).
- Per-device memory keys: `fb.<userId>.repositoryScreen.sideSize` and
  `.sideOpen` (FB-8).
- English texts:
  - empty state: "Choose a file from the tree, or create one" (FB-12);
  - not openable: "This repository is still being cloned." / "This repository's
    clone failed." / "This repository's working copy is missing." (by `status`
    and `error`), with the link **Repository settings** to
    `/repositories/<id>/settings` (FB-3, DS-22).

## Review Focus

- **`/repositories/new` and `/repositories/12/settings`** must not be caught by
  the repository screen's route → Task 2 tests `leaves /repositories/new to the
  Add repository page` and `leaves /repositories/12/settings to Page not found`.
- **Moving between two files of the same repository** must not call `open`
  again; going to another repository must → Task 3 test `opens once per
  repository visit`.
- **A repository ID that is not a number or not the user's** must show "Page not
  found", with no flash of the screen → Task 3 test `shows Page not found for a
  missing repository`.
- **`localStorage` that throws** must leave the default pane sizes → Task 4 test
  `works without localStorage`.
- **A 320 px wide phone** must show the drawer button and no side pane, and no
  horizontal scroll → Task 5 test `AC-FILE-001.4: opens the tree as a drawer on
  a phone`.

---

### Task 1: Shell parts for the combined bar

**Files:**

- Create (generated component): `libs/web/shell/src/shell/components/brand-link`
  (+ `.spec.ts`)
- Modify: `app-header.component.html` (uses `shell-brand-link`),
  `libs/web/shell/src/index.ts`

**Interfaces:**

- Produces (exported from `@front-burner/web-shell`):
  - `BrandLinkComponent` (`shell-brand-link`): the flame icon and "Front Burner"
    linking to `/` with `aria-current="page"` on the dashboard; input `compact:
    boolean` (icon only, the link's accessible name "Dashboard").
  - `UserMenuComponent` and `RouteAnnouncerComponent`, unchanged.

- [ ] **Step 1: Write the failing test**: `links to the dashboard and keeps its
      name when compact`.
- [ ] **Step 2: Run it and see it fail** — `npx nx test web-shell`.
- [ ] **Step 3: Implement** and switch the app header to it.
- [ ] **Step 4: Run the shell's tests and see them pass** — `npx nx test
      web-shell`.
- [ ] **Step 5: Commit** — `refactor(shell): export the parts of the app header`

---

### Task 2: `web/feature-repository-screen` and its route

**Files:**

- Create (generated): `libs/web/feature-repository-screen` (`npx nx g
  @nx/angular:library --directory=libs/web/feature-repository-screen
  --name=web-feature-repository-screen
  --importPath=@front-burner/web-feature-repository-screen --prefix=rs
  --unitTestRunner=vitest-angular --tags=scope:web,type:feature
  --no-interactive`), feature `repository-screen`, page `repository-screen`
- Create: `src/repository-screen/repository-screen.routes.ts`,
  `src/repository-screen/utils/repository-screen-matcher.ts` (+ `.spec.ts`)
- Modify: `apps/web/src/app/app.routes.ts` (+ `app.spec.ts`)

**Interfaces:**

- Produces:
  - `repositoryScreenMatcher: UrlMatcher` — matches `[]` and `['files',
    ...rest]` (at least one segment after `files`); consumes all of them;
    `posParams.path` is the rest joined with `/`, decoded, or `''`. Anything
    else → `null`.
  - `repositoryScreenRoutes`: `[{ matcher: repositoryScreenMatcher, component:
    RepositoryScreenPage }]`.
  - In `app.routes.ts`, a route before the shell layout: `{ path:
    'repositories/:id', canMatch: [ id is /^\d+$/ ], canActivate: [ authGuard ],
    loadChildren: … }`.
  - `RepositoryScreenPage` reads `id` and `path` as signals from the route.

- [ ] **Step 1: Write the failing tests**: matcher table (`[]` → `''`;
      `files/docs/guide.md` → `docs/guide.md`; `files/caf%C3%A9.md` → `café.md`;
      `files` alone, `settings` → no match); in `app.spec.ts`: `routes
      /repositories/12 and /repositories/12/files/a/b.md to the repository
      screen`; `leaves /repositories/new to the Add repository page`; `leaves
      /repositories/12/settings to Page not found`; `sends a visitor who is not
      logged in to the login page` (FB-1).
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      web-feature-repository-screen web`.
- [ ] **Step 3: Implement**; `npm run check:tags`.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): route the repository
      screen`

---

### Task 3: Opening the repository

**Files:**

- Create (generated service): `services/repository-session` (+ `.spec.ts`)
- Create (generated component): `components/not-openable` (+ `.spec.ts`)
- Modify: `pages/repository-screen/*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `RepositoriesApi.open(id)` (plan 14); `PageNotFoundPage` (shell).
- Produces:
  - `RepositorySession` (provided by the page, so one per visit): `state:
    Signal<'loading' | 'missing' | 'not-openable' | 'ready'>`, `repository:
    Signal<RepositorySummary | null>`; `start(id: number)` calls `open` once for
    that ID and ignores later calls with the same ID. A `404` becomes `missing`;
    any other failure shows the error text (A-8.6) with **Try again**, which
    calls `open` again.
  - `NotOpenableComponent` (input `repository`): FB-3's texts and link.
  - The page sets the document title to `<name> · Front Burner`.

- [ ] **Step 1: Write the failing tests**: `opens once per repository visit`
      (two route changes within repository 12 → one call; then repository 13 → a
      second call); `shows Page not found for a missing repository`;
      `AC-FILE-001.3: shows the status and the settings link for a cloning
      repository`; `offers Try again when opening fails`; `titles the page with
      the repository name`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): open a repository`

---

### Task 4: Bar and panes

**Files:**

- Create (generated components): `components/repository-bar`,
  `components/editor-area` (each + `.spec.ts`)
- Create (generated service): `services/pane-memory` (+ `.spec.ts`)
- Modify: `pages/repository-screen/*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `BrandLinkComponent`, `UserMenuComponent`, `RouteAnnouncerComponent`
  (Task 1); `ui-app-shell`, `uiAppShellSide`; `CurrentUserService`.
- Produces:
  - `PaneMemory`: `sideSize: WritableSignal<number>` (default 20), `sideOpen:
    WritableSignal<boolean>` (default `true`), each read once from and written
    back to `localStorage` under the keys of Global Constraints.
  - `RepositoryBarComponent` (inputs `repository`, `user`; output
    `toggleFiles`): the brand link (compact on narrow screens), the repository
    name, the **Files** drawer button on narrow screens only (FB-9), the user
    menu.
  - `EditorAreaComponent` (`main`, labelled "Editor"): for now, only the FB-12
    empty state. Plan 16 adds its other states.
  - The page: `ui-app-shell` with the bar, the side pane labelled "Files"
    (`resizeLabel` "Resize file tree"), and the editor area; `[(sideOpen)]`,
    `[(sideSize)]` bound to `PaneMemory`, `[(drawerOpen)]` local.

- [ ] **Step 1: Write the failing tests**: `remembers the pane size and the
      collapsed tree`; `works without localStorage`; `shows the bar's parts in
      order`; `shows the empty state`; `labels the regions` (NV-17).
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(repository-screen): add the bar and panes`

---

### Task 5: End-to-end tests and status

**Files:**

- Create: `apps/web-e2e/src/repository-screen.spec.ts`
- Modify: `apps/web-e2e/src/dashboard.spec.ts` (if a test expects "Page not
  found" for an openable repository), `docs/product/mvp.md`

- [ ] **Step 1: Write the tests** (repositories added as in
      `add-repository.spec.ts`; the cloning one stubbed with `page.route`):
      `AC-FILE-001.1: opens a repository from the dashboard and moves it to the
      top`; `AC-FILE-001.3: shows a cloning repository's status and link`;
      `AC-FILE-001.4: collapses, expands and resizes the tree with the keyboard`
      (desktop); `AC-FILE-001.4: opens the tree as a drawer on a phone` (320 px:
      drawer button, no horizontal scroll); `AC-APP-001.7: shows Page not found
      for another user's repository`; `has no axe violations` on the screen and
      on the not-openable state.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 3: Update the status**: REQ-FILE-001 adds FB-1, FB-3, FB-6 to FB-10
      (FB-9 without closing on a file) and FB-11, Built in `repository-screen`;
      REQ-DASH-001 drops "DS-7 (on opening)" and DS-8 from MVP points not built;
      REQ-APP-001 notes NV-9 as built without the branch, git and save status.
      Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit
      `test(repository-screen): cover opening a repository`.
