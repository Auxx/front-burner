# Guide: Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 144 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
guide tells the operator how to watch an instance and what to do when something
goes wrong: logs, request references, health checks, metrics, low and full disk,
orphaned working copies.

**Architecture:** Documents only. A "Monitoring" section: the log (JSON lines,
levels, fields, what is never logged, the `pretty` format), finding a user's
"reference" in the log (NF-10.6), the two health endpoints and what `degraded`
means, metrics with a Prometheus scrape example and the list of metric names
(copied from plans 134 and 135's tests), and the low-space threshold. The
"Troubleshooting" section gains: "Clones are refused: the server is running low
on storage", "Saves fail with 'Server storage is full'", "A folder appeared in
`orphans/`" (what it is and how to get work out of it with git), and "The
container stops at once and the log names a migration or a newer database".

**Tech Stack:** Markdown.

**Spec:** `docs/architecture/non-functional.md` NF-9.7, NF-9.8, NF-10.1 to
NF-10.11, NF-6.4, NF-7.1, NF-7.3.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Log messages quoted in the guide are copied from the code, and a short note in
  the code next to each quoted message says the guide quotes it _(plan's call)_.
- After this plan, `docs/wiki/todo.md` has no deployment guide items left; the
  section is removed.

## Review Focus

- **A metric name in the guide** that the code does not have → the scrape
  example is checked against a real `/api/metrics` response (step 2).
- **"Reference" in an error message** must be findable → the guide shows the
  exact `requestId` field and a `grep`/`jq` line.

---

### Task 1: Monitoring and troubleshooting

**Files:**

- Modify: `docs/wiki/deployment.md`, `docs/wiki/todo.md`, `docs/product/mvp.md`
  (the **Deployment guide** row), the code next to quoted log messages

- [ ] **Step 1: Write the sections.**
- [ ] **Step 2: Check them against a running instance**: start
      `tools/docker/compose.yaml` with a metrics token, scrape `/api/metrics`,
      and compare every metric name; cause a request error and find its
      reference with the guide's command.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs(deployment): monitoring`.
