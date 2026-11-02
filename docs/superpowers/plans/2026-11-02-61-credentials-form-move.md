# Move the Credentials Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 61 of [the step 3 index](2026-11-02-00-roadmap-step-3.md): the
choices of the Add repository page's **Credentials** section, and its trust
dialog, move to `web/repository-dialogs`, so that the repository credentials
dialog (plan 63) can use them. The Add repository page behaves exactly as
before.

**Architecture:** A pure move, in one pull request and with no behaviour change,
so it is quick to review. Web features may not import each other (A-2.4), and
`modules.md` already says that these dialogs belong in `repository-dialogs`. The
form model is split in two: the credentials half moves, and the rest of the Add
repository form stays.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/architecture/modules.md` (`repository-dialogs`, A-2.4, A-2.5);
`docs/requirements/repo-add.md` AR-16 to AR-32 (unchanged).

## Global Constraints

- The shared constraints of [the step 3 index](2026-11-02-00-roadmap-step-3.md)
  apply.
- No test changes what it asserts. A moved spec moves with its component, and
  only its imports and translation keys change. If a test needs anything more,
  the move has changed behaviour: stop and look.
- Move with `git mv`, so that history follows the files.
- Selectors change from `repo-` to `dlg-` and translation keys from
  `web-feature-repositories.<Component>` to
  `web-repository-dialogs.<Component>`. The English text is unchanged.

## Review Focus

- **Translations:** a key missed in the move would show the raw key →
  `apps/web/src/app/translations.spec.ts` and the Add repository end-to-end
  suite.
- **`SubmitFailuresService`** is injected optionally, and is provided by the
  page. It must keep working through the library boundary, with the token
  exported → the Add repository page's specs.
- **The bundle:** the new library is shared by two lazy features; it must not be
  pulled into the main bundle → compare `npx nx build web` chunk sizes before
  and after, and check against NF-2.9's budget.
- **Tags:** a `type:domain` library can't import a feature → `npm run
  check:tags` and lint.

---

### Task 1: Move

**Files:**

- Move to
  `libs/web/repository-dialogs/src/repository-dialogs/credentials-form/`, from
  `libs/web/feature-repositories/src/repositories/`:
  `components/credentials-section/`, `components/https-credentials/`,
  `components/ssh-credentials/`, `components/generated-key/`,
  `services/session-keys/`, `services/submit-failures/`, `dialogs/trust-host/`,
  `utils/field-error-code.ts`
- Split: `models/add-repository-form.model.ts` →
  `credentials-form/credentials-form.model.ts` (`CredentialsModel`,
  `CredentialsChoice`, `defaultCredentials`, `toRepositoryCredentials`), and
  `utils/add-repository-errors.ts` → `credentials-form/credentials-errors.ts`
  (`shownError` and what it needs)
- Modify: `libs/web/repository-dialogs/src/index.ts`, every importer in
  `libs/web/feature-repositories`, `apps/web/public/i18n/en.json`,
  `libs/web/feature-repositories/src/testing/*`, as needed

**Interfaces:**

- Produces, from `@front-burner/web-repository-dialogs`:
  `CredentialsSectionComponent` (`dlg-credentials-section`), `TrustHostDialog`,
  `SessionKeysService`, `SubmitFailuresService`, `CredentialsModel`,
  `defaultCredentials`, `toRepositoryCredentials`, with the signatures they have
  today.

- [ ] **Step 1: Run the tests before the move** — `npx nx run-many -t test -p
      web-feature-repositories web-repository-dialogs`; note the number of
      tests.
- [ ] **Step 2: Move and split**; update imports, selectors and translation
      keys.
- [ ] **Step 3: Run the tests** — the same command; the total is the same, all
      pass.
- [ ] **Step 4: Run everything that could notice** — `npx nx affected -t lint
      test build`; `npm run check:tags`; `npx nx e2e web-e2e`.
- [ ] **Step 5: Format and commit** — `npx dprint fmt && npx dprint check`;
      commit `refactor(dialogs): move the credentials form to
      repository-dialogs`. No status row changes: nothing a user can reach is
      new.
