# Step 6 Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 157 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
MVP's exit criteria 1 to 12 hold on a fresh instance set up by following the
deployment guide, in a desktop browser and on a phone, and the documents say the
MVP is done and ready to release.

**Architecture:** A last walkthrough and the documents. The operator, or the
agent with the operator watching, follows the deployment guide word by word on a
clean host, with the dry-run image of plan 139 (or the release candidate tag),
and walks the exit criteria in order, once on desktop and once on a phone.
Anything the guide gets wrong is fixed in it; anything the product gets wrong
stops the release and gets a plan (index, Part F). Then the documents are
closed.

**Tech Stack:** none new.

**Spec:** `docs/product/mvp.md` (exit criteria, "Implementation status",
"Risks"); `docs/wiki/release-checks.md`; `docs/wiki/deployment.md`.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Every plan of the index, Part F included, is **Done** before this one starts
  Task 2.
- Every row of `docs/wiki/release-checks.md` has a result, and none is a fail
  without a merged fix and a new result.

## Review Focus

- **The guide followed by someone who did not write it** → the walkthrough uses
  only what the guide says; every place the walker had to know something else is
  a guide fix.
- **Exit criterion 1 with OIDC** as well as with a password → both are walked,
  each on its own fresh instance.

---

### Task 1: The walkthrough

**Files:**

- Modify: `docs/wiki/deployment.md` (fixes), `docs/wiki/release-checks.md` (the
  "Exit criteria" section: each criterion, desktop and phone, with the date, the
  commit and the image digest)

- [ ] **Step 1: Write the walk sheet** in the checklist: each exit criterion as
      numbered steps.
- [ ] **Step 2: Ask the operator to walk it** with password onboarding and again
      with OIDC, on desktop and phone, and record the results.
- [ ] **Step 3: Fix the guide** where the walk needed something it does not say;
      file product problems in Part F.
- [ ] **Step 4: Commit** — `docs: step 6 walkthrough`

---

### Task 2: Closing the MVP

**Files:**

- Modify: `docs/product/mvp.md`, `docs/wiki/deployment.md` (status
  **Accepted**), `docs/architecture/non-functional.md` (status **Accepted** if
  the operator agrees), `docs/wiki/todo.md`, the index (status **Accepted**)

- [ ] **Step 1: Update `mvp.md`**: the **Deployment guide** row becomes
      **Done**, with every Part C pull request; section 10's status becomes
      **Accepted**; every risk is resolved or restated; run `doc-ids.mjs
      criteria` and copy its result; every row is checked against its State's
      definition. Only ED-10's limited point may remain.
- [ ] **Step 2: Tidy `todo.md`**: nothing about the deployment guide or the
      release checks is left; known gaps found in step 6 are added.
- [ ] **Step 3: Review the dependency findings** (NF-11.9, NF-11.10): every
      entry of `.trivyignore` still has a reason and has not passed its "until"
      date, and no Dependabot pull request for a production dependency with a
      security fix is left open. Record the result in the checklist.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs: the MVP is ready to release`. The
      operator then chooses the version and pushes the tag (the index's "Left
      out").
