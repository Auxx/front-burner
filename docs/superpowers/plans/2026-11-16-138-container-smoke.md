# Container Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 138 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): CI
starts the built image under NF-11.13's hardening (read-only root, `/tmp` as
tmpfs, `cap_drop: ALL`, `no-new-privileges`) and proves that it becomes ready,
that onboarding, login, a clone and a save work, that a session survives a
restart, and that it stops cleanly on `SIGTERM` within the grace period (NF-5.6,
NF-9.1 to NF-9.3, NF-10.9, NF-11.13, exit criterion 2).

**Architecture:** A Vitest suite, `apps/server-e2e/src/container.e2e.spec.ts`,
skipped unless `E2E_IMAGE` names an image _(plan's call: the server suite's API
helpers are reused; no new project)_. It drives `docker compose` with a compose
file of its own, `apps/server-e2e/src/support/container-compose.yaml`, which has
the hardening of `tools/docker/compose.yaml` and the guide's restart policy and
`stop_grace_period: 30s`. The clone uses the suite's HTTPS git server, reached
from the container with `FRONT_BURNER_BLOCK_PRIVATE_NETWORKS=false` and the test
certificate mounted read-only and named by `GIT_SSL_CAINFO`, which `GitRunner`
passes through to git, and by `NODE_EXTRA_CA_CERTS` for the backend's own HTTPS
calls _(plan's call)_. The suite talks to the instance over plain HTTP on
`localhost`, with no HTTPS terminator in front (plan 140). The `image` job of
plan 137 runs the suite after its scan, with `E2E_IMAGE=front-burner:test`.

**Tech Stack:** Docker Compose v2 on the runner. No new packages.

**Spec:** `docs/architecture/non-functional.md` NF-5.6, NF-9.1 to NF-9.3,
NF-10.7 to NF-10.9, NF-11.13; `docs/product/mvp.md` exit criteria 1 and 2.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- The suite cleans up its containers and volumes even when a test fails.
- The secrets in the compose file are test-only values, as in
  `tools/docker/compose.yaml`.
- Docker's own `HEALTHCHECK` is what the suite waits on (`docker inspect
  --format '{{.State.Health.Status}}'`), not a poll of its own: it proves the
  image's health check works.

## Review Focus

- **A data volume owned by another UID** stops the container with a log line
  naming the path and UID 1000 → test `an unwritable /data stops the start and
  names the UID`.
- **`SIGTERM` during a running clone** ends within 30 s and the clone is failed
  on the next start (NF-9.5) → test `stops within the grace period during a
  clone`.
- **A restart** keeps the session and the working copy → test `a session
  survives a restart`.
- **Writes outside `/data` and `/tmp`** would fail under a read-only root; the
  whole suite runs under it, so any such write fails a test.

---

### Task 1: The suite

**Files:**

- Create: `apps/server-e2e/src/container.e2e.spec.ts`,
  `apps/server-e2e/src/support/container-compose.yaml`,
  `apps/server-e2e/src/support/container.ts` (start, stop, logs, health)
- Modify: `apps/server-e2e/project.json` or its Vitest config if a separate
  target is needed (`e2e-container`)

**Interfaces:**

- Produces: `startContainer(options?: { env?: Record<string, string>;
  dataOwner?: number }): Promise<Container>` with `url`, `logs():
  Promise<string>`, `restart()`, `stop(): Promise<{ seconds: number; exitCode:
  number }>`, `remove()`.

- [ ] **Step 1: Write the tests**: `the hardened container becomes healthy`;
      `the health endpoints answer without a version`; `onboarding, login, a
      clone and a save work`; `a session survives a restart`; `stops within the
      grace period during a clone`; `the clone interrupted by a stop is failed
      after the next start`; `an unwritable /data stops the start and names the
      UID`.
- [ ] **Step 2: Run them** — `docker build -f tools/docker/Dockerfile -t
      front-burner:test .`, then `E2E_IMAGE=front-burner:test npx nx run
      server-e2e:e2e-container` (or the target chosen). Fix what fails; a fix
      larger than this branch gets its own plan (index, Part F).
- [ ] **Step 3: Commit** — `test(server-e2e): container smoke test`

---

### Task 2: In CI

**Files:**

- Modify: `.github/workflows/ci.yml` (the `image` job), `docs/architecture/
  non-functional.md` (NF-11.13: what proves it)

- [ ] **Step 1: Run the suite in the `image` job** after the scan.
- [ ] **Step 2: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `ci: container smoke test`. The pull
      request's `image` job is the proof.
