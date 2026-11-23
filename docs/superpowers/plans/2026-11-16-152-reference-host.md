# Reference Host Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 152 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
performance targets of NF-2 are measured on the reference host (2 vCPU, 4 GB
RAM, SSD) running the release image, and spike 4's status and commit timings are
repeated there with the image's git, as `docs/wiki/todo.md` and
`docs/product/mvp.md` ("Risks": large repositories) ask.

**Architecture:** A run, not code. **The operator provides the host** (a cloud
VM of that size is enough) and runs the commands; the agent prepares the run
sheet and turns the output into the checklist and, if a target is missed, a
plan. The run sheet, in `docs/wiki/release-checks.md`'s "Reference host"
section, says:

1. start the image of plan 137 with the guide's compose example (plan 140), a
   metrics token and `FRONT_BURNER_SERVER_TIMING=true` (plan 150), which is
   removed again after the run;
2. on the host itself, with the container on the host's network and
   `GIT_SSL_CAINFO` set to the test certificate (plan 150's `perf-api` section
   in the `ai-tools` skill: the tool serves the remotes on `127.0.0.1`, and
   `Server-Timing` already leaves the network out): `node
   tools/ai-tools/src/bin/perf-api.mjs run --large …`, then with `--cold` as
   root, then `scale` with the instance stopped, `ready` while it starts, and
   `run --users 10` (NF-1.1 to NF-1.3, plan 148's addition);
3. `node tools/ai-tools/src/bin/perf-screen.mjs run --email …` with `--profile
   desktop` and `--profile phone` against the instance's HTTPS address, on the
   host too: like `perf-api.mjs`, it serves its own remote with the test
   certificate (plan 151's `perf-screen` section in the `ai-tools` skill);
4. record the host's CPU model, memory, disk, kernel, Docker and git versions.

**Tech Stack:** plans 150 and 151's tools.

**Spec:** `docs/architecture/non-functional.md` NF-2, "Reference host";
`docs/architecture/spikes.md` (spike 4, "NF-2.8: … The release checks decide");
`docs/product/mvp.md` ("Risks").

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- A missed target is not argued away: it becomes a plan (index, Part F), or a
  decision recorded in `non-functional.md` with the operator's agreement, as
  spike 3 did for highlighting (ED-9a).
- NF-2.8's question is answered in `spikes.md` under spike 4: whether a cold
  status or commit stays under 2 seconds, and if not, which operations become
  jobs.

## Review Focus

- **A cold cache after a restore** (spike 4's 14 s status) → the run includes a
  restart after `--cold` and times the start, which refreshes each index.
- **The phone profile on the real network** → screen timings are taken from a
  machine outside the host, over the instance's real HTTPS.

---

### Task 1: The run sheet

**Files:**

- Modify: `docs/wiki/release-checks.md` (the "Reference host" section)

- [ ] **Step 1: Write the run sheet** above as numbered commands.
- [ ] **Step 2: Commit** — `docs: reference host run sheet`, and ask the
      operator to run it and paste the output into the pull request.

---

### Task 2: The results

**Files:**

- Modify: `docs/wiki/release-checks.md`, `docs/architecture/spikes.md` (spike
  4's release repeat), `docs/product/mvp.md` ("Risks": large repositories),
  `docs/wiki/todo.md` (remove the item), the index's Part F if needed

- [ ] **Step 1: Record the results** in the checklist, each row with the host.
- [ ] **Step 2: Answer NF-2.8's question** in `spikes.md`.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs: reference host results`.
