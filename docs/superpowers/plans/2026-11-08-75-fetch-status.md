# Quiet Fetch Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 75 of [the step 4 index](2026-11-08-00-roadmap-step-4.md): a
background fetch that failed says so quietly in the bar, with the reason, the
fix and **Try again**, and opens nothing by itself.

**Architecture:** `rs-fetch-status` reads `GitStatus.fetchProblem`, which is
state and survives a reload, and `LockedKeyService.key()`, since a locked key
records no problem (plan 72) and is per session (RC-20). Its fix runs through
`CredentialFixesService`, which until now took the fix of the banner's problem
and now takes the problem to fix, so that a host key dialog gets its keys from
`fetchProblem` _(plan's call)_.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-35, AC-GIT-002.14);
`docs/requirements/repo-credentials.md` (RC-6's first half, RC-15, RC-20,
AC-REPO-002.8, AC-REPO-002.13); `docs/requirements/navigation.md` (NV-11).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- Exact text: "Couldn't check for remote changes", followed by the reason:
  `errors.<code>`. For a locked key the whole text is "Unlock _&lt;key name&gt;_
  to check for remote changes.": fetches may be running on another session's
  unlock (RC-20), so "Couldn't check" could be false _(review's call)_.
- An unlock that ends by its idle time publishes `key.locked` to its session, as
  otherwise nothing would say why fetches stopped until a reload _(review's
  call)_.
- It is never an alert: no focus change, no dialog, no `announce` (GA-35). On
  narrow screens it is an icon button whose tap shows the text and the actions,
  and the bar keeps NV-11's order.
- A failed fetch the user pressed still shows the banner of plan 74, and this
  status also, as the problem is the last fetch's.

## Review Focus

- **A credential problem on a background fetch** opens no dialog, in every kind
  of RC-4 → Task 1 test `AC-REPO-002.13`, one row per problem, with an assertion
  that no dialog opened.
- **A backend restart:** the problem is still in `sync_state`, the key is locked
  again, and the bar must say the key, not the old cause, since fetches are not
  running → Task 1 test `a locked key comes before a stored problem`.
- **A problem fixed in another tab or device** goes away here without a reload,
  as `git.changed` makes the status read again → Task 1 test `goes away when the
  next fetch succeeds`.
- **The banner dismissed** must not take this status with it: **Unlock** stays
  reachable (RC-15) → Task 1 test `stays after the banner is dismissed`.
- **A long reason on a phone** must not push the save status out of the bar
  (NV-11) → Task 1 test `shows the text only after a tap on a phone`.

---

### Task 1: The status

**Files:**

- Create (with `toolkit-nx`): `components/fetch-status/` under
  `libs/web/feature-repository-screen/src/repository-screen/` (+ spec)
- Modify: `services/credential-fixes/credential-fixes.service.ts` (+ spec),
  `components/git-problem/*`, `components/repository-bar/*`,
  `pages/repository-screen/repository-screen.page.*`,
  `apps/web/public/i18n/en.json`, `apps/web-e2e/src/changes.spec.ts`,
  `apps/server-e2e/src/git.e2e.spec.ts`, `docs/product/mvp.md`

**Interfaces:**

- Consumes: `GitStatus.fetchProblem` (plan 70), `LockedKeyService.key`,
  `gitProblem`, `NetworkJobService.start('fetch')`.
- Produces:
  - `FetchStatusComponent` (`rs-fetch-status`): inputs `problem: GitProblemState
    | null`, `lockedKeyName: string | null`, `narrow: boolean`; outputs `retry`,
    `fix` (`GitProblemState`), `unlock`.
  - `CredentialFixesService.runFetchFix(problem: GitProblemState)`, beside
    `run(fix: GitFix)` _(review's call)_.
  - `NetworkJobService.startWhenFree(operation, { background? })`: what a fix
    runs again waits for a running job rather than being dropped _(review's
    call)_.

- [ ] **Step 1: Write the failing tests**: `AC-GIT-002.14: a failed background
      fetch shows Couldn't check for remote changes in the header and opens no
      dialog`; `AC-REPO-002.13: a background fetch that meets any credential
      problem shows it only in the header's quiet status and opens no dialog`;
      `AC-REPO-002.8: after a restart, a locked key shows the banner and no
      background fetch runs; unlocking makes fetches resume and removes the
      banner from every repository that uses the key` (end to end, with a
      protected key on the SSH server); `a locked key comes before a stored
      problem`; `goes away when the next fetch succeeds`; `stays after the
      banner is dismissed`; `shows the text only after a tap on a phone`; `Try
      again fetches`; `the fix opens the dialog for its code`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement.** Follow the `angular-templates` skill.
- [ ] **Step 4: Run them and see them pass** — same command, then `npx nx e2e
      web-e2e`.
- [ ] **Step 5: Update the status**: REQ-GIT-002 adds `fetch-status`, and
      removes GA-35 and criterion 14. REQ-REPO-002 adds it, and removes RC-6's
      first half, so that "RC-6 (elsewhere, step 5)" and RC-11 remain. Run
      `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(repository-screen): the quiet fetch
      status`.
