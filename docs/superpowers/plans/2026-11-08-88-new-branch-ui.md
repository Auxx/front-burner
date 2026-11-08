# New Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 88 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): **New
branch** in the branch list asks for a name, and creates the branch and switches
to it, with the reason next to the field when the name is refused.

**Architecture:** One small dialog, like `entry-name`. All name rules are the
backend's, as only git knows them (GA-38), so the dialog sends the name and
shows the refusal next to the field. Nothing is checked as the user types.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-38, AC-GIT-002.16).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Exact field errors: `branch-name-invalid` "This isn't a valid branch name.",
  `branch-exists` "A branch with this name already exists.",
  `branch-name-conflict` "This name clashes with another branch's name." Other
  failures show in the dialog's banner.
- **New branch** is unavailable before the first commit, with the reason "Make a
  commit first" (GA-42).
- Spaces around the name are trimmed; anything else goes to the backend as
  typed.

## Review Focus

- **Pressing Enter twice** creates one branch, and the second attempt must not
  say "already exists" about the first → Task 1 test `two quick submits create
  one branch`.
- **Uncommitted changes** stay and are not an obstacle: a new branch starts from
  the current commit → Task 1 test (end to end) `keeps the changes on the new
  branch`.
- **A refused name** keeps the dialog open with focus on the field, and the text
  kept → Task 1 test `keeps the name and the focus after a refusal`.
- **A waiting save** goes first, as a switch's does, so that the user's status
  is right afterwards → Task 1 test `sends a waiting save first`.

---

### Task 1: The dialog

**Files:**

- Create (with `toolkit-nx`): `dialogs/new-branch/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `dialogs/branch-list/*`,
  `services/branch-actions/branch-actions.service.ts` (+ spec),
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `docs/product/mvp.md`

**Interfaces:**

- Consumes: `GitApi.createBranch`, `BranchActionsService`.
- Produces: `BranchChoice` gains `{ kind: 'new' }`, which the list closes with.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-002.16: New branch creates a
      branch from the current commit and switches to it; the names bad..name and
      the name of an existing local branch are refused` (end to end); `two quick
      submits create one branch`; `keeps the changes on the new branch` (end to
      end); `keeps the name and the focus after a refusal`; `sends a waiting
      save first`; `is unavailable before the first commit`; `shows the new
      branch as Not published`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `new-branch-ui`, and
      removes GA-38. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): New branch`.
