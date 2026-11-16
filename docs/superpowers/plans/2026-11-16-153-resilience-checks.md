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
job. A kill is `docker kill --signal KILL`, not a stop. The upgrade test needs
an older image: it builds the image of the merge base with the previous release
tag, or, before the first release, of `master` at plan 129's merge _(plan's
call)_, with an extra migration added in a throwaway build so that a migration
is pending. The full disk uses a small `tmpfs` (`size=64m`) as the repositories
volume, with `FRONT_BURNER_REPOS_DIR` (plan 127).

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
      space freed, the save goes through`.
- [ ] **Step 2: Run them** as plan 138 says; fix what fails, or plan it (index,
      Part F).
- [ ] **Step 3: Commit** — `test(server-e2e): kills and a full disk`

---

### Task 2: Backup, restore and upgrade

**Files:**

- Modify: `apps/server-e2e/src/container-resilience.e2e.spec.ts`,
  `apps/server-e2e/src/support/container.ts` (building the older image),
  `docs/wiki/deployment.md` (fixes to procedures), `docs/wiki/
  release-checks.md`

- [ ] **Step 1: Write the tests**: `NF-6.2: a copy of a running instance
      restores from its snapshot`; `NF-6.5: a stopped copy restores as it was`;
      `NF-6.4: a restore moves newer working copies to orphans`; `NF-7.1: an
      upgrade writes a pre-upgrade snapshot and migrates`; `NF-7.3: the old
      image refuses the upgraded database and starts from the pre-upgrade
      snapshot`.
- [ ] **Step 2: Run them**; fix what fails.
- [ ] **Step 3: Fill the checklist rows.**
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `test(server-e2e): backup, restore and
      upgrade`.
