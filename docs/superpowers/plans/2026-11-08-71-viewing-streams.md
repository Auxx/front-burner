# Viewing Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 71 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): the
backend knows which repository each tab is viewing, as plan 72's background
fetches need.

**Architecture:** As A-3.12 says, the client opens the stream with
`?repository=<id>` and reopens it when that changes. `EventsHub` keeps the ID on
each stream and lists them. It does not check the ID: `server/core/events` knows
nothing of repositories, and the stream only ever carries the user's own events,
so a wrong ID gives nothing away. Plan 72 ignores an ID that is not the user's.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/architecture/api.md` A-3.10 to A-3.12.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- A `repository` that is not a positive integer is ignored, like no parameter at
  all, since nothing on this stream depends on it.
- Reopening counts as a reconnect: `reconnected` fires, and services read their
  state over REST (A-3.11).

## Review Focus

- **Rapid switching between repositories** must end with one open stream, on the
  last → Task 2 test `keeps one stream, on the last repository`.
- **Calling `view` with the repository already viewed,** as happens on every
  file opened, must not reopen the stream → Task 2 test `does not reopen for the
  same repository`.
- **Leaving the screen** must stop the viewing, or a closed page keeps causing
  fetches → Task 2 test `stops viewing when the page goes`.
- **Logging out and in** must not carry the last repository over, as it may not
  be the next user's → Task 2 test `forgets the repository on logout`.
- **A reconnect after the auth token expires** (A-3.10) must keep viewing, or
  fetches stop without a word → Task 2 test `keeps the repository through a
  reconnect`.

---

### Task 1: The backend

**Files:**

- Modify: `libs/server/core/events/src/events/events.controller.ts` (+ spec),
  `libs/server/core/events/src/events/events-hub.ts` (+ spec),
  `apps/server-e2e/src/events.e2e.spec.ts`

**Interfaces:**

- Produces: `EventStream.repositoryId: number | null`, and `EventsHub.viewers():
  { userId: number; sessionId: string; repositoryId: number }[]`, one entry per
  stream that views a repository.

- [ ] **Step 1: Write the failing tests**: `lists a stream that views a
      repository`; `leaves out a stream that views none`; `forgets a stream that
      closed`; `ignores a repository that is not a positive integer`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-events`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Commit** — `feat(events): know what a stream views`

---

### Task 2: The web client

**Files:**

- Modify: `libs/web/core/src/core/services/push-channel/push-channel.service.ts`
  (+ spec),
  `libs/web/feature-repository-screen/src/repository-screen/pages/repository-screen/repository-screen.page.ts`
  (+ spec)

**Interfaces:**

- Produces: `PushChannelService.view(repositoryId: number | null): void`. The
  URL is `/api/v1/events?repository=<id>`, or without a parameter for `null`.

- [ ] **Step 1: Write the failing tests**: `opens the stream for the
      repository`; `reopens the stream when the repository changes, and says it
      reconnected`; `keeps one stream, on the last repository`; `does not reopen
      for the same repository`; `forgets the repository on logout`; on the page,
      `views the open repository` and `stops viewing when the page goes`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      web-core web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(core): tell the backend what is
      viewed`.
