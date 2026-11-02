# Preferences Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 43 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): the
user menu has **Preferences**, and the page at `/preferences` shows and edits
the default commit author.

**Architecture:** The name and email fields are a component in a new
`web/repository-dialogs` library, because the commit form (plan 54) and later
the repository settings page need the same fields and web features may not
import each other (A-2.4). The page is a new lazily loaded
`web/feature-preferences` library, under the shell layout.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/commit-author.md` (the first bullet of CA-9, CA-10,
CA-11; criterion 7; the page's half of 12); `docs/requirements/navigation.md`
(the Preferences item of NV-7, NV-1's route); `docs/architecture/modules.md`.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- The hint is exactly: "Shown in the commit history to everyone who can read the
  repository. To keep your email private, use your provider's noreply address."
  with links to GitHub's and Bitbucket's help (CA-11):
  `https://docs.github.com/en/account-and-profile/reference/email-addresses-reference`
  and
  `https://support.atlassian.com/bitbucket-cloud/docs/configure-your-dvcs-username-for-commits/`.
  Links open in a new tab with `rel="noopener noreferrer"`.
- Tags: `repository-dialogs` is `scope:web`, `type:domain`;
  `feature-preferences` is `scope:web`, `type:feature` (A-2.5).

## Review Focus

- **The backend refusing a value the form let through** must show on the field,
  not as a general error → Task 1 test `shows the backend's field errors next to
  the fields`.
- **Saving twice quickly** must send one request → Task 2 test `disables Save
  while it is saving`.
- **A failed load** must offer **Try again**, not an empty form that could be
  saved over the real author → Task 2 test `offers Try again when loading
  fails`.
- **320 px wide**: the page does not scroll sideways, with a 254-character email
  → Task 3's end-to-end test.

---

### Task 1: The author form

**Files:**

- Create (generated): `libs/web/repository-dialogs` (`@nx/angular:library`, tags
  above); `src/repository-dialogs/components/commit-author-form/` (with
  `toolkit-nx`; + spec and story)
- Modify: `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces: `CommitAuthorFormComponent` (`dlg-commit-author-form`): `field =
  input.required<FieldTree<CommitAuthor>>()`, `serverErrors =
  input<ApiFieldError[]>([])`; shows the two fields, CA-11's hint and links.
  `commitAuthorForm(initial: CommitAuthor)` builds the signal form with
  `CommitAuthorSchema`.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-001.7: shows the reason next
      to the field for a name with <, an email without @ and an email with a
      space`; `shows the backend's field errors next to the fields`; `links the
      hint to the providers' help`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-repository-dialogs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(dialogs): the commit author form`

---

### Task 2: The Preferences page

**Files:**

- Create (generated): `libs/web/feature-preferences` with
  `src/preferences/pages/preferences/preferences.page.ts` (+ spec) and
  `preferences.routes.ts`
- Modify: `apps/web/src/app/app.routes.ts`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `PreferencesApi` (plan 42), `CommitAuthorFormComponent`.
- Produces: `preferencesRoutes`; `/preferences` in the shell layout under
  `authGuard`, with the title "Preferences". It uses the same full-island page
  layout and page header as the other pages (plan 36).
- The page shows the author read-only with **Edit** (CA-9); **Edit** shows the
  form with **Save** and **Cancel**. After **Save** it says "Saved"
  (`aria-live`).

- [ ] **Step 1: Write the failing tests**: `shows the default commit author with
      Edit`; `saves an edited author`; `disables Save while it is saving`;
      `offers Try again when loading fails`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-preferences`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(preferences): the Preferences page`

---

### Task 3: The user menu, end to end and status

**Files:**

- Modify:
  `libs/web/shell/src/shell/components/user-menu/user-menu.component.html` and
  `.ts` (+ spec), `apps/web/public/i18n/en.json`, `docs/product/mvp.md`
- Create: `apps/web-e2e/src/preferences.spec.ts`

- [ ] **Step 1: Write the tests**: unit: `offers Preferences, which leads to
      /preferences`; end to end: `edits the default commit author from the user
      menu` with axe-core and at 320 px.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-shell`.
- [ ] **Step 3: Implement**: **Preferences** comes above **Log out** (NV-7).
- [ ] **Step 4: Run them and see them pass** — `npx nx test web-shell && npx nx
      e2e web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-001 adds `preferences-page`,
      removes CA-11 and leaves the other two places of CA-9. REQ-APP-001: NV-7
      is now only the version line, and NV-1 no longer waits for this page. Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; `npm run check:tags`; commit
      `feat(shell): Preferences in the user menu`.
