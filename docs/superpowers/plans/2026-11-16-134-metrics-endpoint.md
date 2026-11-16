# Metrics Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 134 of [the step 6 index](2026-11-16-00-roadmap-step-6.md):
Prometheus metrics at `/api/metrics`, off by default and on when
`FRONT_BURNER_METRICS_TOKEN` (or `…_FILE`) is set, with the token as a bearer
token; HTTP latency by route and active sessions (NF-10.10, the first part of
NF-10.11). Plan 135 adds the job, git and disk metrics.

**Architecture:** `MetricsModule` in `server/core/observability` (modules.md)
owns one `prom-client` `Registry` and exports it as `METRICS_REGISTRY`, so that
other libraries register their own metrics. A controller at `/api/metrics`
(outside `api/v1`, like health, NF-10.7) answers `404` when metrics are off
_(plan's call: the endpoint does not exist then)_, `401` without the right
token, compared with `constantTimeEquals`. An interceptor times every API
request into `front_burner_http_request_duration_seconds{method, route,
status}`, where `route` is the Nest route pattern (`/api/v1/repositories/:id`),
never the raw path. `front_burner_active_sessions` is a gauge collected on
scrape from the sessions table. Node's default process metrics are on, with the
`front_burner_` prefix.

**Tech Stack:** `prom-client` (overview.md lists it). New production dependency;
Trivy scans it with the rest.

**Spec:** `docs/architecture/non-functional.md` NF-10.10, NF-10.11, NF-8.2,
NF-10.9; `docs/architecture/modules.md`; `docs/architecture/overview.md` (the
libraries).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- No metric has a per-user label, nor a repository ID or file path (NF-10.11):
  only fixed sets of values.
- The token is at least 16 characters _(plan's call, as the setup token)_; a
  shorter one stops the start with the other configuration errors.
- `/api/metrics` has no version header and is not rate limited per IP beyond the
  unauthenticated limit _(plan's call: a 15 s scrape is 4 a minute)_; it is left
  out of the OpenAPI document.

## Review Focus

- **An unknown path** (`/api/v1/repositories/123/files/secret.md`) never becomes
  a label value → test `labels requests by route pattern, not path`.
- **A 404 route** that matches nothing is one label, not one per path → test `an
  unmatched route is labelled as such`.
- **The wrong token** and **no token** get the same `401` → test `refuses a
  wrong token like a missing one`.
- **Metrics off** answers like an unknown route → test `the endpoint does not
  exist without a token`.

---

### Task 1: The endpoint and the token

**Files:**

- Create: `libs/server/core/observability/src/metrics/` (module, controller,
  `METRICS_REGISTRY`; + specs)
- Modify: `libs/server/core/config/src/config/` (+ spec; `metricsToken`),
  `libs/server/core/observability/src/index.ts`, the app module,
  `apps/server/src/startup/start-server.ts` (the path outside the prefix and the
  version header), `package.json`, `docs/architecture/api.md`

**Interfaces:**

- Produces: `Config.metricsToken: string | undefined`; `METRICS_REGISTRY:
  InjectionToken<Registry>`.

- [ ] **Step 1: Write the failing tests**: `reads FRONT_BURNER_METRICS_TOKEN and
      its _FILE`; `refuses a short token`; `the endpoint does not exist without
      a token`; `serves metrics with the right bearer token`; `refuses a wrong
      token like a missing one`; `has no version header`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-config`,
      `npx nx test server-core-observability`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same commands.
- [ ] **Step 5: Commit** — `feat(observability): metrics endpoint`

---

### Task 2: HTTP latency and sessions

**Files:**

- Create:
  `libs/server/core/observability/src/metrics/http-metrics.interceptor.ts` (+
  spec)
- Modify: `libs/server/feature/auth/src/sessions/` (the sessions gauge; + spec),
  `apps/server-e2e/src/api.e2e.spec.ts`

- [ ] **Step 1: Write the failing tests**: `times a request by method, route and
      status`; `labels requests by route pattern, not path`; `an unmatched route
      is labelled as such`; `counts active sessions on scrape`; end to end,
      `metrics show a request after it is made`, and `no metric label holds a
      user, repository or path`.
- [ ] **Step 2: Run them, implement, run them again** — `npx nx test
      server-core-observability`, `npx nx test server-feature-auth`, `npx nx e2e
      server-e2e`.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(observability): HTTP and session
      metrics`.
