# Baseline Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 149 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
rows of the release checklist that a test can prove and none does yet get one.
Plan 148's checklist is the list. Much is already tested, so this plan adds
little and rewrites nothing.

Already tested on `master` (found in the review of these plans; plan 148
confirms each by reading the test):

- `429` and `Retry-After`: the login, onboarding, files and add-repository
  suites of `apps/server-e2e`;
- `413` for a large body: `files.e2e.spec.ts`;
- the CSP header: `api.e2e.spec.ts`, though whether it compares the whole value
  is to be read;
- 320 CSS pixels: about ten specs of `apps/web-e2e`, including the dashboard,
  Preferences, login and onboarding;
- axe: the onboarding, Preferences, Add repository, repository management,
  editor, app header, commit and push, conflicts and repository screen specs.

The likely gaps, to be confirmed by the checklist:

- axe on the dashboard and the login page (NF-13.8);
- the CSP compared as a whole with NF-11.1's text, on `index.html`, a deep link
  and an error page, if the existing test checks less (NF-11.1);
- landscape on a phone viewport, on every page (NF-12.6);
- `prefers-reduced-motion` turning animations off (NF-13.7).

**Architecture:** Tests only, each in the spec that already owns its page or
area. A new spec, `apps/web-e2e/src/baseline.spec.ts`, holds only the checks
that apply to every page alike (landscape, reduced motion), with one list of
routes in a seeded instance _(plan's call: one list, so a new page is one
line)_. An existing test that already proves a rule is renamed to start with the
NF ID, not copied. A problem found is fixed here when it is small; otherwise it
gets a plan (index, Part F).

**Tech Stack:** as before (Playwright, `@axe-core/playwright`, Vitest).

**Spec:** `docs/wiki/release-checks.md` (plan 148);
`docs/architecture/non-functional.md` NF-11.1, NF-11.2, NF-11.4, NF-11.5,
NF-12.4, NF-12.6, NF-13.7, NF-13.8.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- No second test of something a test already proves. Where a test proves a rule
  but its title does not name it, the title gets the NF ID, as acceptance
  criteria do (`mvp.md`, "Implementation status").
- The CSP test compares the whole header with NF-11.1's text, the nonce replaced
  by a pattern; it does not check single directives.
- Each new test's title starts with the NF ID it proves, for example `NF-12.6:
  every page works in landscape on a phone`.

## Review Focus

- **A dialog** has its own layout and focus trap → the route list includes each
  dialog opened on its page, not only the pages.
- **A route only reachable in one state** (the conflict screen, a failed clone's
  settings) → the seed puts a repository in each such state.

---

### Task 1: Name what is tested, fill the server gaps

**Files:**

- Modify: the `apps/server-e2e` specs whose tests prove an NF rule (titles
  only), `apps/server-e2e/src/api.e2e.spec.ts` (the CSP test, if it checks less
  than the whole value), `docs/wiki/release-checks.md`

- [ ] **Step 1: Rename** the existing tests that prove NF-11.1, NF-11.2, NF-11.4
      and NF-11.5 so that each title starts with its NF ID.
- [ ] **Step 2: Write what is missing**, if the checklist says so: `NF-11.1:
      index.html, a deep link and an error page carry the exact CSP`.
- [ ] **Step 3: Run them** — `npx nx e2e server-e2e`; fix what fails.
- [ ] **Step 4: Commit** — `test(server-e2e): name the security baseline`

---

### Task 2: The page gaps

**Files:**

- Create: `apps/web-e2e/src/baseline.spec.ts`
- Modify: `apps/web-e2e/src/dashboard.spec.ts` and
  `apps/web-e2e/src/login.spec.ts` (axe), the `apps/web-e2e` specs whose tests
  prove NF-12.4 or NF-13.8 (titles only), `apps/web-e2e/src/support/` (the seed
  of states), `docs/wiki/release-checks.md` (the rows)

- [ ] **Step 1: Write the tests**: `NF-13.8: no axe violations on the
      dashboard`; `NF-13.8: no axe violations on the login page`; in
      `baseline.spec.ts`, `NF-12.6: every page works in landscape on a phone`
      and `NF-13.7: reduced motion turns animations off`. Rename the existing
      320 px and axe tests to start with NF-12.4 and NF-13.8.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; fix what fails.
- [ ] **Step 3: Fill the checklist rows** with the test names and results.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `test(web-e2e): baseline gaps`.
