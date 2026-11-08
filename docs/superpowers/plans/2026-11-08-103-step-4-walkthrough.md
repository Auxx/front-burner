# Step 4 Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 103 of [the step 4 index](2026-11-08-00-roadmap-step-4.md):
end-to-end tests walk through exit criteria 8, 9 and 10 on desktop and on a
phone, the criteria that span the whole step get their tests, and the documents
are brought up to date.

**Architecture:** Tests and documents only. A problem these tests find is fixed
in this branch when it is small, and otherwise gets its own plan before this one
is merged.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/product/mvp.md` (exit criteria 8, 9 and 10);
`docs/requirements/git-conflicts.md` (GC-28, AC-GIT-003.10, AC-GIT-003.15);
`docs/requirements/git-advanced.md` (GA-6);
`docs/architecture/non-functional.md` NF-12.5, NF-13.2, NF-13.8.

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- The walkthrough runs in the whole browser matrix of NF-12.2, as `web-e2e`
  does.
- Criteria of later steps and earlier leftovers stay in the table; do not name
  them here: AC-GIT-001.5 (step 5), REQ-REPO-003 (step 5), and AC-APP-001.1,
  AC-APP-001.2, AC-APP-001.4, AC-APP-001.10 to AC-APP-001.13, AC-DASH-001.6,
  AC-DASH-001.11.

## Review Focus

- **Touch alone on a phone:** no action may depend on hover; the reasons of
  unavailable actions must be reachable by tap, and the conflict widgets and the
  bar must both work → Task 1's walkthrough uses `tap` only.
- **Keyboard alone on desktop:** every step, with focus visible and no trap in
  the editor: the conflict bar is how the keyboard accepts → Task 1's
  walkthrough uses the keyboard only.
- **A reload at each step of a merge** keeps the state: the list, resolved
  files, saved edits → Task 1 test `a reload at each step keeps the merge`.
- **An ignored file the remote now tracks** is still there after a refused pull
  → Task 1 test `exit criterion 9`, in a third round.
- **"Exactly as they were" after an abort** is compared by hash, on every file,
  and on `git status`, `HEAD` and the index → Task 1 tests `exit criterion 9`.
- **A key that locks in the middle** (a restart during a merge): unlocking
  carries on, and the merge and the fetch both resume → Task 1 test `exit
  criterion 10`.

---

### Task 1: The walkthroughs

**Files:**

- Create: `apps/web-e2e/src/pull-and-conflicts.spec.ts`
- Modify: `apps/web-e2e/src/support/` as needed

- [ ] **Step 1: Write the tests**:
  - `exit criterion 8, on desktop with the keyboard alone`, and `exit criterion
    8, on a phone by touch alone`: create a branch; switch away and back; track
    a remote branch; pull.
  - `exit criterion 9, on desktop with the keyboard alone`, and `exit criterion
    9, on a phone by touch alone`: a commit pushed elsewhere shows the notice;
    **Pull** conflicts on a Markdown file and a PNG; resolve the first with
    **Accept theirs** and an edit, and the second with **Use my version**;
    **Commit merge**; **Push**. In a second round, **Abort merge** and compare
    every file, `HEAD`, the index and `git status` with how they were before the
    pull. In a third round, the remote starts tracking a file the user has
    ignored: **Pull** refuses, names it, and the file is unchanged.
  - `exit criterion 10, on desktop`: restart the backend with a protected key;
    the banner shows and no fetch runs; **Pull** asks for the passphrase and
    carries on; a restart during a merge keeps it.
  - `AC-GIT-003.10: resolving one file on a phone and the other on a desktop,
    then committing, works; no lease expires in between`, in two contexts.
  - `AC-GIT-003.15: the conflict list, the conflict bar and the buttons work
    with the keyboard alone and by touch alone, and axe-core reports no
    violations`, covering GC-28's announcements, the conflict file, the dialogs
    and the notices, in light and dark.
  - `a reload at each step keeps the merge`.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass, in every browser of
      the matrix. Fix small problems here; a larger one gets its own plan.
- [ ] **Step 3: Commit** — `test(repository-screen): walk through pulling and
      conflicts`

---

### Task 2: Documents

**Files:**

- Modify: `docs/product/mvp.md`,
  `docs/superpowers/plans/2026-11-08-00-roadmap-step-4.md`

- [ ] **Step 1: Check the status table** against "Keeping it up to date":
      REQ-GIT-002 and REQ-GIT-003 are **Done**, and no row names a step 4 point.
      REQ-REPO-002 lists only RC-6's second half and RC-11's second half (step
      5). REQ-GIT-001 lists only CA-9's repository management page (step 5).
      REQ-EDIT-001 lists only ED-10. REQ-APP-001 lists only NV-1, NV-7 and
      NV-15. Run `node tools/ai-tools/src/bin/doc-ids.mjs criteria` and copy its
      result into **MVP criteria without a test**.
- [ ] **Step 2: Compare** that result with the list in Global Constraints above.
      Anything else left is a gap: add its test here, or write down why it can
      wait.
- [ ] **Step 3: Set this plan's row in the index** to **Done**. Add anything
      found along the way to its "Left out" section.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; commit
      `docs: step 4 is finished`.
