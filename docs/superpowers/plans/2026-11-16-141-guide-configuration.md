# Guide: Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 141 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
guide's "Environment variables" lists every variable the backend reads, with its
default and meaning, and a test fails when a new variable is not documented.

**Architecture:** `server/core/config` exports `CONFIG_VARIABLES: readonly
string[]`, the names its schema reads (with their `…_FILE` variants), taken from
the schema itself rather than written twice _(plan's call)_. A spec reads
`docs/wiki/deployment.md` and checks that every name appears in it, and that
every `FRONT_BURNER_*` name in the guide is one the backend reads. The guide
gets the missing groups: data and repositories directories, git (timeouts, clone
concurrency, known hosts with the built-in entries listed, AR-32), key unlock,
proxies, logging, low disk, snapshots, metrics.

**Tech Stack:** Markdown; Vitest.

**Spec:** `docs/architecture/overview.md` A-1.15; `docs/architecture/
non-functional.md` NF-8.2, NF-10.2, NF-10.3;
`docs/requirements/repo-credentials.md` AR-32 (known hosts).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Variables meant only for tests or development
  (`FRONT_BURNER_LOG_FORMAT=pretty` is for development but documented; anything
  only tests set) are left out of the check by an explicit list in the spec,
  each with a comment saying why.
- Defaults in the guide are the schema's; the spec checks the defaults it can
  read from the schema against the guide's tables.
- The list comes from the schema, never from a search of the source for
  `FRONT_BURNER_`: many such strings are Nest injection tokens, not variables
  (`FRONT_BURNER_CONFIG`, `FRONT_BURNER_DATABASE`, `FRONT_BURNER_GIT_OPTIONS`,
  `FRONT_BURNER_SECRET_BOX`, `FRONT_BURNER_DATA_LAYOUT`, and others). Before
  writing the test, find out what `FRONT_BURNER_PROT` in the source is.
- The guide lists `FRONT_BURNER_SERVER_TIMING` (plan 150) with the logging and
  metrics variables, as off by default and meant for performance checks.

## Review Focus

- **A variable added later without documentation** fails the build → test `every
  variable the backend reads is in the deployment guide`.
- **A variable removed from the backend** but left in the guide → test `every
  variable in the deployment guide is read by the backend`.

---

### Task 1: The variable list and its test

**Files:**

- Modify: `libs/server/core/config/src/config/load-config.ts` (export the list),
  `libs/server/core/config/src/index.ts`, a new spec
  `libs/server/core/config/src/config/deployment-guide.spec.ts`

**Interfaces:**

- Produces: `CONFIG_VARIABLES: readonly string[]`.

- [ ] **Step 1: Write the failing tests**: `every variable the backend reads is
      in the deployment guide`; `every variable in the deployment guide is read
      by the backend`; `the guide's defaults are the schema's`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-config`.
- [ ] **Step 3: Commit the list** (the tests still fail until Task 2).

---

### Task 2: The guide

**Files:**

- Modify: `docs/wiki/deployment.md`, `docs/wiki/todo.md`, `docs/product/mvp.md`
  (the **Deployment guide** row)

- [ ] **Step 1: Write the missing tables**, grouped as above.
- [ ] **Step 2: Run the tests and see them pass** — `npx nx test
      server-core-config`.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs(deployment): every variable`.
