# Status at 100,000 Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 45 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): spike
4 gets its findings, so that plan 46 knows how often **Changes** may refresh,
and the engine knows which git settings it needs. No product code unless the
findings call for it.

**Architecture:** Time the exact commands the engine runs, on a Linux kernel
checkout, cold and warm, with and without `core.untrackedCache` and
`core.fsmonitor`. Record the numbers and one decision in the documents.

**Tech Stack:** `git`, `hyperfine` if installed, otherwise a shell loop with
`time`. Everything stays in the session's scratchpad and is deleted afterwards.

**Spec:** `docs/architecture/spikes.md` (spike 4);
`docs/architecture/git-engine.md` A-5.14; `docs/requirements/git-advanced.md`
GA-12; `docs/architecture/non-functional.md` NF-1.4, NF-2.3, NF-2.6, NF-2.10.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- Measure the command from plan 44 exactly, plus a commit of two files through
  `git add --pathspec-from-file` and `git commit`, the way plan 52 does it.
- Spike 4 asks for the reference host in `non-functional.md`. If this machine is
  not that host, the findings say so and give this machine's CPU and disk type;
  the numbers are then re-checked with the release checks (step 6).
- `core.fsmonitor` starts a daemon per repository. It is only acceptable if the
  numbers without it fail the targets.

## Review Focus

- **A cold page cache** is what a phone user meets after the server idled; time
  it (`echo 3 > /proc/sys/vm/drop_caches` needs root; if that is not possible,
  say that only warm numbers were taken) → Task 1, step 2.
- **Many untracked files** (10,000 new files in one folder), the worst case for
  `--untracked-files=all` → Task 1, step 2.
- **A setting written to a working copy's config** must pass the engine's safety
  check (A-5.7) → Task 1, step 4.

---

### Task 1: Measure and decide

**Files:**

- Modify: `docs/architecture/spikes.md` (spike 4's **Findings**),
  `docs/architecture/git-engine.md` (A-5.14), `docs/product/mvp.md` ("Large
  repositories" under Risks), and
  `libs/server/core/git/src/engine/git-engine.ts` only if the findings need a
  setting
- Produces, for plan 46: the constant `STATUS_REFRESH_MS`, the wait after the
  last `files.changed` before status is read again. It defaults to **2,000 ms**.
  Raise it to the warm status time × 2 if that is larger, and at most to 5,000
  ms, which is GA-12's "within a few seconds".

- [ ] **Step 1: Prepare** — in the scratchpad, `git clone --depth 1
      https://github.com/torvalds/linux.git`; check that it has at least 80,000
      files with `git ls-files | wc -l`. If it has fewer than 100,000, the
      findings say the count.
- [ ] **Step 2: Time** the status command, clean, with 10 changed files and with
      10,000 new files, cold and warm; the same with `core.untrackedCache=true`
      and then with `core.fsmonitor=true`; `git diff HEAD` of one file; the
      commit of two files. Five runs each; keep the median and the worst.
- [ ] **Step 3: Decide** against NF-2.3, NF-2.6 and NF-2.10: which settings are
      needed, if any, and `STATUS_REFRESH_MS`.
- [ ] **Step 4: If a setting is needed**, pass it as `-c` on the status command
      in `GitEngine.status` rather than writing it to the working copy, with a
      test that the option is passed; `npx nx test server-core-git`.
- [ ] **Step 5: Write the findings** in `spikes.md`, as a table with the machine
      named; update A-5.14 from "Pending spike 4" to the decision; update the
      "Large repositories" risk in `mvp.md`.
- [ ] **Step 6: Clean up, format and commit** — delete the checkout; `npx dprint
      fmt && npx dprint check`; `node tools/ai-tools/src/bin/doc-ids.mjs check`;
      commit `docs: spike 4, git status at 100,000 files`.
