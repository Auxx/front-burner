# Commit Author Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 119 of [the step 5 index](2026-11-14-00-roadmap-step-5.md): the
**Commit author** section of the settings page shows the author that commits in
this repository use, whether it is the default or an override, with **Use a
different author for this repository** or **Use my default** (RM-15, the second
bullet of CA-9).

**Architecture:** The API exists (plan 42): `GET`, `PUT` and `DELETE
/repositories/:id/commit-author`. The section reuses
`CommitAuthorSummaryComponent` and `ChangeCommitAuthorDialog` from
`web/repository-dialogs`, opened for the override only, and follows
`commit-author.changed`, so that a change of the default elsewhere shows here.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/commit-author.md` (CA-8, CA-9, AC-GIT-001.5);
`docs/requirements/repo-manage.md` (RM-15, AC-REPO-003.9).

## Global Constraints

- The shared constraints of [the step 5 index](2026-11-14-00-roadmap-step-5.md)
  apply.
- Text: "Commits use _Name &lt;email&gt;_", then "Your default commit author" or
  "Only for this repository" _(plan's call, matching the Preferences page's
  wording)_.
- **Use my default** asks nothing: the override is one click to set again, and
  the default stays as it is.
- Shown in every status, as an override can be set before the clone ends.
- _Changed while implementing:_ the author in use is the one line "Commits use
  _Name &lt;email&gt;_" rather than `CommitAuthorSummaryComponent`'s key-value
  list, which would say the same twice. `ChangeCommitAuthorDialog` gets an
  `overrideOnly` option, which hides its choice of the default and has its own
  heading, "Commit author for this repository". With an override, both buttons
  are shown: the first edits the override.

## Review Focus

- **The default changed on the Preferences page** in another tab shows here →
  test `follows a change of the default elsewhere`.
- **Commits** use what the section shows: an override in A, the default in B →
  end-to-end test `AC-GIT-001.5`, with real commits.

---

### Task 1: The Commit author section

**Files:**

- Create (with `toolkit-nx`): `components/repository-commit-author/` under
  `libs/web/feature-repositories/src/repositories/` (+ spec)
- Modify: `pages/repository-settings/*`, `apps/web/public/i18n/en.json`,
  `apps/web-e2e/src/repository-management.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `PreferencesApi` (or the tag's client) `getRepositoryCommitAuthor`,
  `setRepositoryCommitAuthor`, `deleteRepositoryCommitAuthor` (their generated
  names), `CommitAuthorSummaryComponent`, `ChangeCommitAuthorDialog`.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-003.9: the Commit author
      section shows the author in use and switches between an override and the
      default` (end to end); `AC-GIT-001.5: setting an override for repository A
      makes commits in A use it, while commits in repository B keep using the
      default; Use my default in A brings back the default` (end to end, with
      commits from the repository screen); `shows the default`; `shows an
      override`; `cancelling the dialog changes nothing`; `follows a change of
      the default elsewhere`; `says why saving failed`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repositories`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-003 adds `commit-author-section`;
      REQ-GIT-001 adds it, removes CA-9, and becomes **Done** if nothing else is
      left. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repositories): the commit author
      section`.
