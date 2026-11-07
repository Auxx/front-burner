# Step 3 Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 67 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): one
end-to-end test walks through exit criterion 7 on desktop and on a phone, the
criteria that span the whole step get their tests, and the documents are brought
up to date.

**Architecture:** Tests and documents only. A problem these tests find is fixed
in this branch when it is small, and otherwise gets its own plan before this one
is merged.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/product/mvp.md` (exit criterion 7, exit criterion 10 for push);
`docs/requirements/git-advanced.md` (GA-6, criterion 21);
`docs/requirements/repo-credentials.md` (RC-25, criterion 14);
`docs/architecture/non-functional.md` NF-12.5, NF-13.8.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- The walkthrough runs in the whole browser matrix of NF-12.2, as `web-e2e`
  does.
- Criteria that wait for step 4 stay in the table; do not name them here:
  AC-GIT-001.9, AC-GIT-002.1, AC-GIT-002.9, AC-GIT-002.11, AC-GIT-002.13 to
  AC-GIT-002.18, AC-GIT-002.20, AC-REPO-002.2, AC-REPO-002.8, AC-REPO-002.13,
  AC-APP-001.5. So do the ones of later steps and earlier leftovers:
  AC-GIT-001.5 (step 5), REQ-GIT-003 and REQ-REPO-003, and the other rows of
  AC-APP-001, AC-DASH-001 and AC-FILE-001 that the table lists today.

## Review Focus

- **A secret in a log at any level** must fail the test, including `debug`, with
  the secrets of a real push: a token, a pasted key's private part, a passphrase
  and the password → Task 1 test `AC-REPO-002.14`.
- **A secret in a job row** (`payload`, `result`) must fail too, since jobs are
  stored for 7 days → Task 1 test, reading the `jobs` table.
- **Touch alone on a phone:** no action may depend on hover; the disabled
  reasons must be reachable by tap (GA-8) → Task 2's walkthrough uses `tap`
  only.
- **Keyboard alone on desktop:** every step, with focus visible, and no trap in
  a dialog → Task 2's walkthrough uses the keyboard only.
- **A reload at each step** must keep the state the user expects → Task 2 test
  `a reload keeps the ticks, the counts and a running push`.

---

### Task 1: No secret anywhere

**Files:**

- Modify: `apps/server-e2e/src/git.e2e.spec.ts`, `apps/server-e2e/src/support/`
  as needed

- [x] **Step 1: Write the test**: `AC-REPO-002.14: no API response contains a
      password, token, private key or passphrase, and none appears in the logs`:
      start the instance at log level `debug`; add a repository with a token and
      another with a protected pasted key; unlock, commit, push, refuse a push,
      replace credentials and update the token. Search every response body, the
      captured log and the `jobs` table for each secret.
- [x] **Step 2: Run it** — `npx nx e2e server-e2e`; it passes, or the leak is
      fixed here.
- [x] **Step 3: Commit** — `test(sync): no secret in responses, logs or jobs`

---

### Task 2: The walkthrough, and accessibility

**Files:**

- Create: `apps/web-e2e/src/commit-and-push.spec.ts`

- [x] **Step 1: Write the tests**:
  - `exit criterion 7, on desktop with the keyboard alone`, and `exit criterion
    7, on a phone by touch alone`: edit two files and delete one; see **Changes
    (3)** and each diff; discard one; confirm the author; commit one of the two
    with a message; push; see the counts go; make the push fail with a read-only
    token and fix it from the banner.
  - `AC-GIT-002.21: every action can be done by touch alone and with the
    keyboard alone, and axe-core reports no violations in the header, Changes
    and the diff`.
  - `RC-25: the dialogs move focus to their first field and return it, and the
    banner is announced once`, for the unlock, credentials and changed host key
    dialogs, with axe-core on each.
  - `a reload keeps the ticks, the counts and a running push`.
- [x] **Step 2: Run them** — `npx nx e2e web-e2e`; all pass, in every browser of
      the matrix. Fix small problems here; a larger one gets its own plan.
- [x] **Step 3: Commit** — `test(repository-screen): walk through commit and
      push`

---

### Task 3: Documents

**Files:**

- Modify: `docs/product/mvp.md`,
  `docs/superpowers/plans/2026-11-02-00-roadmap-step-3.md`, `docs/README.md` if
  it lists the indexes

- [x] **Step 1: Check the status table** against "Keeping it up to date":
      REQ-GIT-001, REQ-REPO-002 and REQ-GIT-002 are **In progress**, each with
      only the parts this index's "Left out" section names; REQ-APP-001 no
      longer lists NV-9's and NV-11's branch and counts. Run `node
      tools/ai-tools/src/bin/doc-ids.mjs criteria` and copy its result into
      **MVP criteria without a test**.
- [x] **Step 2: Compare** that result with the list in Global Constraints above.
      Anything else left is a gap: add its test here, or write down why it can
      wait.
- [x] **Step 3: Set this plan's row in the index** to **Done**. Add anything
      found along the way to its "Left out" section.
- [x] **Step 4: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `node tools/ai-tools/src/bin/doc-ids.mjs check`; `npx nx affected
      -t lint test build`; commit `docs: step 3 is finished`.
