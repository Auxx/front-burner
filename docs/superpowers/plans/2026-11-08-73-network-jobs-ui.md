# Network Jobs in the Web Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 73 of [the step 4 index](2026-11-08-00-roadmap-step-4.md):
`PushService` becomes a service that follows any network job, and a problem
knows which operation it belongs to, so that **Fetch** and **Pull** only add
their outcomes.

**Architecture:** A refactor with no new behaviour: the screen does what it did,
and the end-to-end tests stay. The job-following code does not depend on the
operation; what differs is which API call starts it and what its outcome says,
which become a small table keyed by operation. A problem's fix runs again the
operation that failed (RC-9).

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/git-advanced.md` (GA-9);
`docs/requirements/repo-credentials.md` (RC-4, RC-9, RC-17).

## Global Constraints

- The shared constraints of [the step 4 index](2026-11-08-00-roadmap-step-4.md)
  apply.
- `git mv` the files; text changes only where a name changes. Translation keys
  move with their component or service.

## Review Focus

- **Two operations at once:** starting one while another is running does
  nothing, as the backend would run them in turn and the screen could show only
  one → Task 1 test `starts nothing while another job runs`.
- **The operation of a job taken up from the status:** after a reload, **Try
  again** must run the job's own operation, not the last one pressed → Task 1
  test `retries the operation of a job taken up from the status`.

---

### Task 1: The service

**Files:**

- Move: `services/push/` to `services/network-job/network-job.service.ts` (+
  spec), `utils/push-problem/` to `utils/git-problem/git-problem.ts` (+ spec),
  all under `libs/web/feature-repository-screen/src/repository-screen/`
- Modify: `services/credential-fixes/credential-fixes.service.ts` (+ spec),
  `pages/repository-screen/repository-screen.page.*`,
  `components/push-button/*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Produces:
  - `NetworkJobService`: `start(operation: GitNetworkJobType): Promise<void>`;
    `retry(): Promise<void>`, the failed operation again; `running:
    Signal<GitNetworkJobType | null>`; `problem: Signal<GitProblem | null>`;
    `clearProblem(): void`; `unlockAndRetry(): Promise<void>`.
  - `GitProblem` (was `PushProblem`): as before, plus `operation:
    GitNetworkJobType`.
  - `gitProblem(code: string): GitProblemText` (was `pushProblem`), and `GitFix`
    (was `PushFix`).

- [ ] **Step 1: Move the code and specs**; adjust the specs to the names, and
      add `starts nothing while another job runs` and `retries the operation of
      a job taken up from the status`.
- [ ] **Step 2: Run them and see the two new ones fail** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Implement** the two.
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `refactor(repository-screen): follow any network job`

---

### Task 2: The banner

**Files:**

- Move: `components/push-problem/` to `components/git-problem/` under
  `repository-screen/`, selector `rs-git-problem`
- Modify: `pages/repository-screen/repository-screen.page.html`,
  `apps/web/public/i18n/en.json`

- [ ] **Step 1: Move the component** and adjust its spec.
- [ ] **Step 2: Run the tests** — `npx nx test web-feature-repository-screen`,
      then `npx nx e2e web-e2e`; all pass.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `refactor(repository-screen): the git
      problem banner`.
