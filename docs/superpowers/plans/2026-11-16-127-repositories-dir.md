# Repositories Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 127 of [the step 6 index](2026-11-16-00-roadmap-step-6.md):
`FRONT_BURNER_REPOS_DIR` puts the working copies on another volume, with `tmp/`
and `orphans/` beside them, while the database stays in `/data` (NF-5.4).

**Architecture:** `DataLayout` gets a second root. Without the variable, the
root is the data directory, as now. With it, the variable names a directory that
holds `repos/`, `tmp/` and `orphans/` _(plan's call: the same three names on
both volumes, so the guide describes one layout)_. `tmp/` sits on the same file
system as `repos/` by construction (NF-5.3). `prepareDataDir` proves every
folder writable and names the one that is not (NF-5.6). `orphans/` is created
here and filled by plan 128.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/architecture/non-functional.md` NF-5.1, NF-5.3, NF-5.4, NF-5.6;
`docs/architecture/overview.md` A-1.15.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- A relative `FRONT_BURNER_REPOS_DIR` resolves against the working directory, as
  `FRONT_BURNER_DATA_DIR` does.
- Moving existing working copies between the two layouts is the operator's job,
  with the container stopped; the backend never moves them itself. A repository
  whose working copy is then missing is "missing or damaged" (RM-6), as now.

## Review Focus

- **The variable set to the data directory itself** works and changes nothing →
  test `the data directory as the repositories directory is the default layout`.
- **A repositories directory that is not writable** stops the start, naming that
  path → test `throws naming the repositories directory when it is not
  writable`.
- **A clone's final rename** stays on one file system → test end to end `a clone
  lands under FRONT_BURNER_REPOS_DIR`.

---

### Task 1: The layout and the variable

**Files:**

- Modify: `libs/server/core/config/src/config/` (model, loader, + spec),
  `libs/server/core/storage/src/layout/data-layout.ts` (+ spec),
  `apps/server/src/startup/prepare-data-dir.ts` (+ spec), every `new
  DataLayout(` caller, `docs/architecture/overview.md` (A-1.15's table),
  `docs/architecture/non-functional.md` (NF-5.4: the three folders)

**Interfaces:**

- Produces: `Config.reposRoot: string` (absolute; the data directory when the
  variable is not set); `new DataLayout(dataDir: string, reposRoot = dataDir)`
  with `reposDir`, `tmpDir` and the new `orphansDir: string`;
  `prepareDataDir(dataDir: string, reposRoot: string)`.

- [ ] **Step 1: Write the failing tests**: `reads FRONT_BURNER_REPOS_DIR as an
      absolute path`; `the repositories root is the data directory by default`;
      `puts repos, tmp and orphans under the repositories root`; `creates
      orphans`; `empties tmp under the repositories root on start`; `throws
      naming the repositories directory when it is not writable`; `the data
      directory as the repositories directory is the default layout`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test server-core-config`,
      `npx nx test server-core-storage`, `npx nx test server`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same commands.
- [ ] **Step 5: Commit** — `feat(server): FRONT_BURNER_REPOS_DIR`

---

### Task 2: End to end

**Files:**

- Modify: `apps/server-e2e/src/startup.e2e.spec.ts`,
  `apps/server-e2e/src/support/server-process.ts` (an option for the variable)

- [ ] **Step 1: Write the test**: `a clone lands under FRONT_BURNER_REPOS_DIR`,
      and nothing is written to `<data>/repos`.
- [ ] **Step 2: Run it** — `npx nx e2e server-e2e`.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `test(server-e2e): a separate repositories
      directory`.
