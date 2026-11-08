# Background Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 72 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
backend fetches every 2 minutes for each repository a tab is viewing, and when a
file is opened, and never for a key that is locked.

**Architecture:** `FetchScheduler` looks at `EventsHub.viewers()` every 5
seconds and queues what is due, so that a tab that goes away stops causing
fetches by itself. The first look at a repository fetches at once, which also
tells a user coming back what changed _(plan's call)_. A background fetch has
its own job type, so that the status does not report it as a network job and
**Fetch** does not flicker every 2 minutes (GA-9 is about what the user started)
_(plan's call)_.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-33, GA-35);
`docs/requirements/repo-credentials.md` (RC-15's fetch clause, RC-19, RC-20);
`docs/architecture/git-engine.md` A-5.5; `docs/architecture/jobs.md` (the table,
A-6.7); `docs/architecture/non-functional.md` NF-9.5.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The job type is `sync.fetch-background`, dedupe key `fetch:<repositoryId>`,
  `onInterrupted: 'requeue'`, `maxAttempts: 1`, and it reuses `FetchStep`. It is
  not in `GIT_JOB_TYPES`.
- `FETCH_INTERVAL_MS = 120_000`, a constant (A-6.7). `FILE_OPENED_MIN_MS =
  30_000` per repository (GA-33).
- A background fetch uses the unlock of a session viewing the repository,
  without resetting its idle timer (A-5.5, D-2.7), and never one of the user's
  other sessions. With no such unlock it is skipped and records nothing: the
  banner of RC-15 already says why, and it is per session (RC-20).

## Review Focus

- **A key that stays unlocked only because a tab is open** breaks D-2.7: a
  background fetch must not touch the unlock → Task 1 test `does not keep a key
  unlocked`.
- **A repository ID in the stream that is not the user's, or one still
  cloning,** is ignored and queues nothing → Task 1 test `ignores a repository
  that is not the user's or not ready`.
- **A requeued job after a restart has no key copy:** it must end quietly and
  record no problem → Task 1 test `skips a requeued job whose key is gone`.
- **Many tabs on one repository** cause one fetch per interval → Task 1 test
  `fetches once for two tabs`.
- **A file opened again and again** fetches at most once in 30 seconds, also
  through two tabs → Task 2 test `fetches at most once in 30 seconds`.

---

### Task 1: The scheduler

**Files:**

- Create: `libs/server/feature/sync/src/fetch/fetch-scheduler.ts` (+ spec)
- Modify: `libs/server/feature/sync/src/fetch/fetch.job.ts` (+ spec),
  `libs/server/feature/sync/src/sync.module.ts`,
  `libs/server/feature/credentials/src/saved/saved-credentials.service.ts` (+
  spec), `apps/server-e2e/src/git.e2e.spec.ts`, `docs/architecture/jobs.md`

**Interfaces:**

- Consumes: `EventsHub.viewers`, `RepositoryQueries.find`, `JobRunner.enqueue`,
  `JobKeys.hold`, `FetchStep.run`.
- Produces:
  - `SavedCredentialsService.keyForBackgroundJob(userId: number, sessionId:
    string, id: number): { usable: boolean; key: UnlockedKey | undefined }`,
    with `touch: false`. `usable` is false only for a protected key not unlocked
    in that session. A missing secret is usable, so that the job reports it.
  - `FetchScheduler.enqueueIfUnlocked(userId: number, repositoryId: number,
    sessionIds: string[]): boolean`, which Task 2 also uses.

- [ ] **Step 1: Write the failing tests** with fake timers: `fetches at once
      when a repository is first viewed`; `fetches again after 2 minutes`;
      `stops when no stream views it`; `fetches once for two tabs`; `ignores a
      repository that is not the user's or not ready`; `does not fetch for a
      locked key`; `uses the unlock of a session viewing it, and of no other`;
      `does not keep a key unlocked`; `fetches as soon as the key is unlocked`;
      `skips a requeued job whose key is gone`; end to end, `a background fetch
      updates the counts and changes no file`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-sync server-feature-credentials`.
- [ ] **Step 3: Implement.** The `jobs.md` row says that the fetch job the user
      starts has a type of its own.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Commit** — `feat(sync): fetch in the background`

---

### Task 2: On opening a file

**Files:**

- Modify: `libs/server/feature/sync/src/git/git.controller.ts` (+ spec),
  `libs/server/feature/sync/src/fetch/fetch-scheduler.ts` (+ spec),
  `libs/web/feature-repository-screen/src/repository-screen/pages/repository-screen/repository-screen.page.ts`
  (+ spec), `docs/product/mvp.md`

**Interfaces:**

- Produces: `POST /api/v1/repositories/:id/git/fetch/file-opened`
  (`fetchOnFileOpened`, `204`). The backend decides whether it fetches, so that
  the 30 seconds hold for every client. It never refuses a locked key, since
  nobody is asking for this fetch (GA-35).

- [ ] **Step 1: Write the failing tests**: `fetches when a file is opened`;
      `fetches at most once in 30 seconds`; `says nothing for a locked key`;
      `answers another user's repository like a missing one`; on the page, `asks
      for a fetch when a file is opened`, `ignores a failure to ask`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-sync web-feature-repository-screen`.
- [ ] **Step 3: Implement**; `npx nx run web-api-client:generate`.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `background-fetch`;
      GA-33's background part is built. REQ-REPO-002 adds it and removes RC-15's
      fetch clause. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): fetch when a file is opened`.
