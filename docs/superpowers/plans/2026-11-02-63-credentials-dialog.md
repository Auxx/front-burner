# Repository Credentials Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 63 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): **Add
credentials**, **Fix credentials** and **Use other credentials** open a dialog
with the same choices as the Add repository page, and after saving, the push
runs again by itself.

**Architecture:** `RepositoryCredentialsDialog` in `web/repository-dialogs`
wraps plan 61's `CredentialsSectionComponent` and calls plan 62's endpoint. The
screen's page connects `PushProblemComponent.fixSelected` to it and calls
`PushService.retry()` when it closes with a change. **Fix credentials** of saved
HTTPS credentials gets its extra choices in plan 64.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/repo-credentials.md` (RC-4's fixes, RC-7 to RC-11's
first half, RC-14, RC-25; criteria 1, 3, 7); `docs/requirements/repo-add.md`
AR-19 to AR-32, AR-42.

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- The dialog shows the repository's name and remote (as DS-18 does), the
  credentials in use, if any (their name, and for a key its type and
  fingerprint), and the choices of the remote's protocol. The protocol cannot
  change (RC-7).
- It says "Make sure these credentials can also push." (RC-8).
- A refused SSH key shows "Check that this key is still added to your git
  server, or use another key." (RC-14).
- While the access check runs, **Save** shows progress and Cancel stays usable;
  a Cancel ignores the answer _(plan's call)_. If the check fails, the dialog
  stays open and shows the error as on the Add repository page (RC-8).
- An unknown host key in the access check opens plan 61's `TrustHostDialog`,
  then checks again, as the Add repository page does (AR-32).
- **Save** is not sent while a generate or unlock runs
  (`SessionKeysService.busy`, AR-7).

## Review Focus

- **Closing with Cancel** must neither change anything nor run the push again →
  Task 2 test `Cancel leaves the push alone`.
- **A retried push that fails again** with a new problem must show the new
  problem → Task 2 test `shows the next problem when the retried push fails`.
- **A generated key:** the user must see its public key to add it on the server
  before the access check can pass, and closing must not lose it, since it is
  already saved → Task 1 test `a generated key is in the saved keys when the
  dialog is opened again`.
- **Keyboard and focus:** the long form must scroll inside the dialog at 320 px,
  with focus on its first field, and focus must return on closing (RC-25) → Task
  1 test and the end-to-end run on a phone.
- **A pasted key or a token left in the form after closing** must be gone: the
  form's state belongs to the dialog instance → Task 1 test `opening the dialog
  again starts empty`.

---

### Task 1: The dialog

**Files:**

- Create (with `toolkit-nx`): `dialogs/repository-credentials/` under
  `libs/web/repository-dialogs/src/repository-dialogs/` (+ spec and story)
- Modify: `libs/web/repository-dialogs/src/index.ts`,
  `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `CredentialsSectionComponent`, `SessionKeysService`,
  `SubmitFailuresService`, `TrustHostDialog` (plan 61),
  `RepositoriesApi.repositoryCredentials`, `.replaceRepositoryCredentials`
  (plans 59, 62), `CredentialsApi.list`.
- Produces: `RepositoryCredentialsDialog`: data
  `RepositoryCredentialsDialogData` = `{ repository: RepositorySummary; hint?:
  'refused-key' }`; closes with `true` after saving, and `undefined` when
  cancelled. Plan 64 extends the data with `offerTokenUpdate`.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-002.7: an SSH repository
      offers only SSH choices, and a refused key shows the hint`; `offers the
      HTTPS choices, with No credentials`; `shows the credentials in use`; `says
      to make sure the credentials can push`; `shows a failed check as on the
      Add repository page, and stays open`; `asks to trust an unknown host, and
      checks again`; `a generated key is in the saved keys when the dialog is
      opened again`; `opening the dialog again starts empty`; `moves focus to
      the first field, and returns it on closing`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-repository-dialogs`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(dialogs): the repository credentials dialog`

---

### Task 2: From a failed push

**Files:**

- Create (with `toolkit-nx`):
  `services/credential-fixes/credential-fixes.service.ts` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `pages/repository-screen/repository-screen.page.*`,
  `services/push/push.service.ts`, `services/locked-key/locked-key.service.ts`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `apps/web-e2e/src/support/git-http-server.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `PushProblem.fix`, `RepositoryCredentialsDialog`,
  `PushService.retry`.
- Produces: `CredentialFixesService.run(fix: PushProblem['fix']):
  Promise<void>`, the one place that connects a fix to its dialog; plans 64 and
  66 add theirs. After a save it reads the locked key again, as the new key may
  be locked.

- [ ] **Step 1: Write the failing tests**: `AC-REPO-002.1: pushing a public
      repository added without credentials says so, and after adding credentials
      the push runs again` (end to end); `AC-REPO-002.3: pushing with a
      read-only token says so, and Use other credentials fixes it` (end to end);
      `Cancel leaves the push alone`; `shows the next problem when the retried
      push fails`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-REPO-002 adds `credentials-dialog`, and
      removes RC-4's first three fixes, RC-7, RC-8, RC-9, RC-10 and RC-14; RC-11
      keeps its management page half for step 5. Run `doc-ids.mjs criteria` and
      copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; `npm run check:tags`; commit
      `feat(repository-screen): fix credentials from a failed push`.
