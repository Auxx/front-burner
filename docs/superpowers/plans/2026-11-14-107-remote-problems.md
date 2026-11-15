# Remote Problems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 107 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): the
backend remembers the credential problems of the last operations with the
remote, of pushes apart from fetches and pulls, and forgets each exactly when
RM-8 says, so that plan 108 can turn them into repository warnings.

**Architecture:** `sync_state.fetch_problem` already holds a fetch's problem. A
new column, `push_problem`, holds a push's, because a refused push must outlive
a successful fetch (AC-REPO-003.6). A pull stores its problem in
`fetch_problem`, since it fetches first. Only the three problems that are
warnings are kept in `push_problem`: `credentials-refused`, `push-not-allowed`
and `host-key-changed` _(plan's call)_; a rejected push (non-fast-forward) is
not a warning.

**As built:** `fetch_problem` must keep a network failure for GA-35, which would
drop a kept `credentials-refused` there, so a fetch's or pull's warning went
into a second new column, `fetch_warning`, and `fetch_problem` is left as it was
(A-4.5d). `SyncStateStore.remoteProblems(repositoryId)` reads both;
`remoteFailed` and `remoteSucceeded` take `'fetch' | 'push'`, a pull being a
fetch. The credentials change is told through `RepositoryCredentialsChanges` (an
RxJS subject, as `SessionLifecycle`), which `server/feature/sync` already may
import.

**Tech Stack:** as before; a drizzle migration. No new packages.

**Spec:** `docs/requirements/repo-manage.md` (RM-8, AC-REPO-003.6);
`docs/requirements/repo-credentials.md` (RC-4, RC-6); A-4.2 and A-4.5a in
`docs/architecture/data.md`.

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- When each problem goes away (RM-8):
  - a fetch's or pull's `credentials-refused` and `host-key-changed`: when any
    operation with the remote succeeds, a push included;
  - a push's `credentials-refused` and `host-key-changed`: only when a push
    succeeds;
  - `push-not-allowed`: when a push succeeds or the repository's credentials are
    changed (`PUT …/credentials` or `PUT …/credentials/token`).
- A fetch that fails for another reason, such as the network, leaves the stored
  problems as they are: nothing proved them fixed _(plan's call)_. The quiet
  fetch status (GA-35) still reads the fetch's own last problem, as now.
- `SyncStateStore` reports whether a stored value changed, as `setFetchProblem`
  does, so that plan 108 publishes only real changes.
- Removing a repository deletes its row with the rest (A-4.5b); nothing more
  here.

## Review Focus

- **A refused push, then a successful background fetch:** the push problem stays
  → test `a fetch does not clear a push's problem`.
- **A refused fetch, then a successful push:** the fetch problem goes → test `a
  push clears a fetch's problem`.
- **Push not allowed, then new credentials:** it goes without any push → test
  `changing the credentials clears push-not-allowed`.
- **A pull refused** is stored like a fetch → test `a refused pull is stored as
  the fetch problem`.
- **A network failure** clears nothing → test `a network failure keeps the
  stored problems`.

---

### Task 1: Storing and clearing

**Files:**

- Create: a migration under `libs/server/core/database/src/migrations/`
- Modify: `libs/server/core/database/src/schema/sync-state.ts`,
  `libs/server/feature/sync/src/state/sync-state.store.ts` (+ spec),
  `libs/server/feature/sync/src/push/push.job.ts` (+ spec),
  `libs/server/feature/sync/src/pull/pull.job.ts` (+ spec),
  `libs/server/feature/sync/src/fetch/` (the fetch jobs, + specs),
  `libs/server/feature/repositories/src/credentials/repository-credentials.service.ts`
  (+ spec), `docs/architecture/data.md`

**Interfaces:**

- Produces:
  - `sync_state.push_problem` (JSON `{ code, params }`, nullable).
  - `SyncStateStore.pushProblem(repositoryId): GitProblemState | null`,
    `setPushProblem(repositoryId, problem | null): boolean`,
    `remoteSucceeded(repositoryId, kind: 'fetch' | 'pull' | 'push'): boolean`,
    `credentialsChanged(repositoryId): boolean`.

`repository-credentials.service.ts` is in `server/feature/repositories`, which
must not import `server/feature/sync`: it publishes an internal
`repository.credentials-changed` event that `server/feature/sync` handles, as
the libraries' boundaries allow _(plan's call; the implementer may pick the
workspace's existing pattern for this if one exists)_.

- [ ] **Step 1: Write the failing tests**: `a refused push is stored`; `a
      rejected push is not a problem`; `a fetch does not clear a push's
      problem`; `a push clears a fetch's problem`; `a successful push clears its
      own problem`; `changing the credentials clears push-not-allowed`;
      `changing the credentials keeps credentials-refused of a fetch`; `a
      refused pull is stored as the fetch problem`; `a network failure keeps the
      stored problems`; `reports whether anything changed`.
- [ ] **Step 2: Run them and see them fail** — `npx nx run-many -t test -p
      server-feature-sync server-feature-repositories`.
- [ ] **Step 3: Implement**, with the migration generated by drizzle-kit.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      server-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `remote-problems`.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(sync): remember remote problems per
      kind`.
