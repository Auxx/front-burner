# Low-space Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 132 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): an
administrator sees a banner while the server is low on storage, and a refused
clone shows NF-9.7's message on the Add repository page and the settings page
(NF-9.7, web half).

**Architecture:** `GET /instance/storage` _(plan's call)_, `@AdminOnly()`,
answers `{ low: boolean }` from `DiskMonitor` (plan 131). A `StorageStatus`
service in `web/core` reads it for administrators on start and after a
reconnect, and follows `storage.low`. `AppBanners` (plan 124) shows a warning
banner from it, below the version and offline banners. `low-storage` gets its
text in the API error map, so the clone forms show it with the other errors.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/architecture/non-functional.md` NF-9.7;
`docs/requirements/navigation.md` NV-15 (banners);
`docs/architecture/web-client.md` A-8.7.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Banner text _(plan's call; NF-9.7 gives none)_: "The server is running low on
  storage. New repositories can't be added until space is freed." It can't be
  dismissed: it goes when the space comes back.
- A user who is not an administrator never calls the endpoint and never sees the
  banner; the MVP's one user is an administrator.
- The banner is announced politely (`role="status"`), as the offline banner is.

## Review Focus

- **Space that comes back** removes the banner without a reload → test `hides
  the banner on storage.low false`.
- **A reconnect after missing the event** reads the state again → test `reads
  the state again after a reconnect`.
- **A user who is not an administrator** gets `403` and no request is made →
  tests `the endpoint is for administrators only` and `does not ask for a user`.

---

### Task 1: The endpoint

**Files:**

- Modify: `libs/server/core/storage/src/` or the observability library (a small
  controller; + spec), `apps/server-e2e/src/api.e2e.spec.ts`,
  `docs/architecture/api.md`

**Interfaces:**

- Consumes: `DiskMonitor.isLow()` (plan 131).
- Produces: `GET /api/v1/instance/storage` → `{ low: boolean }`.

- [ ] **Step 1: Write the failing tests**: `answers whether storage is low`;
      `the endpoint is for administrators only`.
- [ ] **Step 2: Run them, implement, run them again** — the library's `test`
      target, then `npx nx e2e server-e2e`; `npx nx run
      web-api-client:generate`.
- [ ] **Step 3: Commit** — `feat(server): storage state for administrators`

---

### Task 2: The banner and the clone error

**Files:**

- Create: `libs/web/core/src/core/services/storage-status/` (with `toolkit-nx`;
  - spec)
- Modify: `libs/web/shell/src/shell/components/app-banners/*` (+ spec),
  `libs/web/core/src/core/services/api-error-text/*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/app-header.spec.ts`,
  `apps/web-e2e/src/add-repository.spec.ts`

- [ ] **Step 1: Write the failing tests**: `shows the low-space banner to an
      administrator`; `hides the banner on storage.low false`; `reads the state
      again after a reconnect`; `does not ask for a user`; end to end, with a
      high threshold, `adding a repository on low space shows the message`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-core`, `npx nx
      test web-shell`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same commands, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(shell): low-space banner`.
