# Health Check Start Period Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 161 of [the step 6 index](2026-11-16-00-roadmap-step-6.md), Part
F: fix plan 152's finding, so that an instance at NF-1.3's scale never shows as
`unhealthy` while it starts. On the reference host, with 2,500 working copies,
the instance was ready after 46 s, 42 s of it recovery (NF-9.4). The image's
`HEALTHCHECK` (`tools/docker/Dockerfile`) allows a 20 s start period and then 3
failures 10 s apart: two had failed when it answered. A slower disk, more
repositories or a restore (spike 4: a stale index takes 14 s cold for one large
repository) goes past it, and the guide's "First start" tells the operator that
`unhealthy` means something is wrong.

**Architecture:**

- **A longer start period** _(plan's call)_: `--start-period=300s` in the
  Dockerfile. Docker reports `healthy` at the first check that passes, even
  during the start period, and failed checks in it do not count, so a fast start
  is still reported at once. `--start-interval=2s` makes the first `healthy`
  come soon after ready.
- **The guide** (`docs/wiki/deployment.md`, "First start"): the first start
  takes a few seconds; a start among many working copies can take a minute or
  more, as recovery visits each one, and shows `starting` meanwhile.
- Faster recovery (refreshing indexes in parallel) is not in this plan: with 2
  vCPU it would save little, and NF-9.3 sets no time.

**Spec:** `docs/architecture/non-functional.md` NF-9.3, NF-9.4, NF-10.8.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.

---

### Task 1: The start period

**Files:** `tools/docker/Dockerfile`, `docs/wiki/deployment.md`, and the
container suite (`apps/server-e2e/src/container.e2e.spec.ts`) if it relies on
the old timings.

- [x] **Step 1:** Change the `HEALTHCHECK` and the guide's text.
- [x] **Step 2:** Run the container suite (`npx nx run
      server-e2e:e2e-container`, or CI's `image` job).
- [x] **Step 3:** Update the NF-1.1 row of `docs/wiki/release-checks.md`; set
      this plan's row to **Done**; commit.
