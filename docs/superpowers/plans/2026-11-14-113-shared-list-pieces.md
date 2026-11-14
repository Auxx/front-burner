# Shared Repository List Pieces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 113 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): what
the dashboard and the repository management page both show moves from
`web/feature-dashboard` into `web/shell`, so that plan 114 can use it. No new
behaviour.

**Architecture:** A feature library never imports another, and `web/shell`
already holds `shell-repository-status`, which both lists use. Three pieces move
or are extracted there _(plan's call)_:

- `AddRepositoryGuideComponent`, DS-11's full guide (RM-5 shows it to a user
  with no repositories);
- `LastAccessedComponent`, "Last accessed" with the relative time and its exact
  time in a tooltip, taken out of `RepositoryEntryComponent`;
- `RepositoryListUpdates`, what the dashboard page does on `repository.status`
  and on a reconnect, as a helper that patches a list of summaries and asks for
  a reload, so that both pages follow clones without a reload (DS-23, RM-7).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/dashboard.md` (DS-11, DS-18, DS-23);
`docs/requirements/repo-manage.md` (RM-5, RM-7); A-2.2a in
`docs/architecture/modules.md`.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Translation keys move with their components, to the `web-shell` scope; the
  English text does not change.
- Every dashboard test passes unchanged, apart from imports and keys; the
  dashboard's Storybook stories and screenshots are unchanged.
- Move with `git mv` where a file moves whole, so that history follows it.

## Review Focus

- **No visible change** on the dashboard → its unit tests and
  `apps/web-e2e/src/dashboard.spec.ts` pass unchanged.
- **The helper** handles a reconnect as the page did → test `reloads after a
  reconnect`.
- **A status for a repository not in the list** (a new one added in another tab)
  asks for a reload rather than being dropped → test `asks for a reload for an
  unknown repository`.

---

### Task 1: Moving the pieces

**Files:**

- Create (with `toolkit-nx`): `components/last-accessed/` under
  `libs/web/shell/src/shell/`, `services/repository-list-updates/` under
  `libs/web/shell/src/shell/` (+ specs)
- Move:
  `libs/web/feature-dashboard/src/dashboard/components/add-repository-guide/` to
  `libs/web/shell/src/shell/components/add-repository-guide/`
- Modify: `libs/web/shell/src/index.ts`,
  `libs/web/feature-dashboard/src/dashboard/components/repository-entry/*`,
  `libs/web/feature-dashboard/src/dashboard/pages/dashboard/*`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces: `AddRepositoryGuideComponent` (`shell-add-repository-guide`),
  `LastAccessedComponent` (`shell-last-accessed`, input `at: string`),
  `RepositoryListUpdates`.

- [ ] **Step 1: Write the failing tests** for the new pieces in `web/shell`:
      `shows the relative time and the exact time on focus`; `patches the status
      of a listed repository`; `asks for a reload for an unknown repository`;
      `reloads after a reconnect`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-shell`.
- [ ] **Step 3: Implement**, then switch the dashboard to the moved pieces.
      Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test -p
      web-shell web-feature-dashboard`, then `npx nx e2e web-e2e`.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `refactor(shell): share the repository list
      pieces`.
