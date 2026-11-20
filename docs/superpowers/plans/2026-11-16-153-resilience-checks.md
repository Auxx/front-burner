# Resilience Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 153 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
real container survives what NF-6, NF-7 and NF-9 promise: being killed in the
middle of a clone, a pull and a merge waiting for resolution; a backup and
restore by the guide; an upgrade from the previous image and going back; and a
full disk.

**Architecture:** More tests in plan 138's container suite, in a file of their
own, `apps/server-e2e/src/container-resilience.e2e.spec.ts`, run by the same CI
job. A kill is `docker kill --signal KILL`, not a stop. The full disk uses a
small `tmpfs` (`size=64m`) as the repositories volume, with
`FRONT_BURNER_REPOS_DIR` (plan 127).

The upgrade test needs two images, one with a migration the other lacks _(plan's
call)_:

- **old:** the image the job already built (`front-burner:test`), as it is;
- **new:** the same source plus one throwaway migration (a harmless new table,
  `upgrade_test`), built from a copy of the workspace in a temporary folder with
  `--build-arg FRONT_BURNER_VERSION=0.0.0-upgrade-test`, so that the two
  versions differ. Nothing of it is committed, and the build reuses the job's
  layer cache up to the server's build.

The test then: starts **old** and makes data; stops it and starts **new**, which
writes the pre-upgrade snapshot and migrates; stops it and starts **old** on the
upgraded volume, which refuses with NF-7.3's message naming
`0.0.0-upgrade-test`; restores the pre-upgrade snapshot as the guide says, and
starts **old** again with the data made before the upgrade. Building the second
image makes this the slowest test, so it runs on pushes to `master` and in plan
139's release workflow, not on pull requests _(plan's call)_.

**Tech Stack:** as plan 138.

**Spec:** `docs/architecture/non-functional.md` NF-6.2, NF-6.4, NF-6.5, NF-7.1,
NF-7.3, NF-9.4, NF-9.5, NF-9.8; `docs/wiki/deployment.md` (plans 142 and 144:
the procedures this follows).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Backup, restore and upgrade follow the guide's procedures step by step; a step
  the test can't follow as written is a fix to the guide.
- Each test names the NF rule it proves, as plan 149's do.

## Review Focus

- **A kill in the middle of a pull's merge** leaves the branch exactly as before
  after the next start (D-4.6) → test `NF-9.5: a pull killed mid-merge is undone
  on start`.
- **A merge waiting for resolution** survives a kill → test `NF-9.5: a merge
  waiting for resolution survives a kill`.
- **A restore of an older snapshot** next to newer working copies → test
  `NF-6.4: a restore moves newer working copies to orphans`.
- **Going back after an upgrade** → test `NF-7.3: the old image refuses the
  upgraded database and starts from the pre-upgrade snapshot`.

---

### Task 1: Kills and the full disk

**Files:**

- Create: `apps/server-e2e/src/container-resilience.e2e.spec.ts`
- Modify: `apps/server-e2e/src/support/container.ts` (`kill()`, a tmpfs
  repositories volume)

- [ ] **Step 1: Write the tests**: `NF-9.5: a clone killed mid-way is failed and
      removed on start`; `NF-9.5: a pull killed mid-merge is undone on start`;
      `NF-9.5: a merge waiting for resolution survives a kill`; `NF-9.4: a stale
      index.lock is removed on start`; `NF-9.8: a full repositories volume
      refuses a save with storage-full and the file is unchanged`; `NF-9.8:
      space freed, the save goes through`; `NF-10.1: the data volume holds no
      log file after the runs` _(plan 148's addition: the container suite proves
      the read-only root, not what lands in `/data`)_.
- [ ] **Step 2: Run them** as plan 138 says; fix what fails, or plan it (index,
      Part F).
- [ ] **Step 3: Commit** — `test(server-e2e): kills and a full disk`

---

### Task 2: Backup, restore and upgrade

**Files:**

- Modify: `apps/server-e2e/src/container-resilience.e2e.spec.ts`,
  `apps/server-e2e/src/support/container.ts` (building the **new** image with
  the throwaway migration), `.github/workflows/ci.yml` (the upgrade test on
  pushes to `master` only), `.github/workflows/release.yml` (the same test
  before pushing), `docs/wiki/deployment.md` (fixes to procedures),
  `docs/wiki/release-checks.md`

**Interfaces:**

- Produces: `buildUpgradeImage(baseImage: string): Promise<string>` (the new
  image's tag).

- [ ] **Step 1: Write the tests**: `NF-6.2: a copy of a running instance
      restores from its snapshot` (the first snapshot is written a moment after
      the start, plan 129); `NF-6.5: a stopped copy restores as it was`;
      `NF-6.4: a restore moves newer working copies to orphans`; `NF-7.1: an
      upgrade writes a pre-upgrade snapshot and migrates`; `NF-7.3: the old
      image refuses the upgraded database and starts from the pre-upgrade
      snapshot`.
- [ ] **Step 2: Run them**; fix what fails.
- [ ] **Step 3: Fill the checklist rows**, including NF-9.1, NF-9.2 and NF-11.13
      from the CI `image` job's run of the whole container suite, which plan 148
      could not run locally.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `test(server-e2e): backup, restore and
      upgrade`.
