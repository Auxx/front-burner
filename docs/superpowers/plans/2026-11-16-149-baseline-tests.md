# Baseline Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 149 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): the
rows of the release checklist that a test can prove and none does yet get one.
Expected, from the audit for this index; plan 148's checklist is the actual
list:

- the exact CSP and other headers on `index.html`, a deep link and an error page
  (NF-11.1, NF-11.2);
- `429` with `Retry-After` for both limits, `413` for a 2 MB+ body (NF-11.4,
  NF-11.5);
- no page scrolls sideways at 320 CSS pixels, and each works in landscape on a
  phone viewport (NF-12.4, NF-12.6);
- axe on every page and dialog of the MVP, not only the ones that have it now
  (NF-13.8): the dashboard, the Add repository page, Preferences, the repository
  management and settings pages, login and onboarding;
- `prefers-reduced-motion` turns off animations (NF-13.7).

**Architecture:** Tests only, in the suites that already own each area:
`apps/server-e2e` for headers and limits, `apps/web-e2e` for pages. The page
checks are one spec, `apps/web-e2e/src/baseline.spec.ts`, that visits a list of
routes in a seeded instance _(plan's call: one list, so a new page is one line)_
and runs, for each, `axe(page)` (from `support/hands.ts`), the 320 px check
(`document.documentElement.scrollWidth <= 320`, preview code blocks and tables
excepted) and the landscape check. A problem found is fixed here when it is
small, otherwise it gets a plan (index, Part F).

**Tech Stack:** as before (Playwright, `@axe-core/playwright`, Vitest).

**Spec:** `docs/wiki/release-checks.md` (plan 148);
`docs/architecture/non-functional.md` NF-11.1, NF-11.2, NF-11.4, NF-11.5,
NF-12.4, NF-12.6, NF-13.7, NF-13.8.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- The CSP test compares the whole header with NF-11.1's text, the nonce replaced
  by a pattern; it does not check single directives.
- Each test's title starts with the NF ID it proves, so that the checklist can
  name it, for example `NF-12.4: no page scrolls sideways at 320 px`.

## Review Focus

- **A dialog** has its own layout and focus trap → the page list includes each
  dialog opened on its page, not only the pages.
- **A route only reachable in one state** (the conflict screen, a failed clone's
  settings) → the seed puts a repository in each such state.

---

### Task 1: Headers and limits

**Files:**

- Modify: `apps/server-e2e/src/api.e2e.spec.ts`

- [ ] **Step 1: Write the tests**: `NF-11.1: index.html, a deep link and an
      error page carry the exact CSP`; `NF-11.2: the other security headers`;
      `NF-11.4: 429 with Retry-After for a user and for an IP`; `NF-11.5: a JSON
      body over 2 MB is refused with 413`.
- [ ] **Step 2: Run them** — `npx nx e2e server-e2e`; fix what fails.
- [ ] **Step 3: Commit** — `test(server-e2e): security baseline`

---

### Task 2: Every page

**Files:**

- Create: `apps/web-e2e/src/baseline.spec.ts`
- Modify: `apps/web-e2e/src/support/` (the seed of states), `docs/wiki/
  release-checks.md` (the rows)

- [ ] **Step 1: Write the tests**: `NF-13.8: no axe violations on any page or
      dialog`; `NF-12.4: no page scrolls sideways at 320 px`; `NF-12.6: every
      page works in landscape on a phone`; `NF-13.7: reduced motion turns
      animations off`.
- [ ] **Step 2: Run them** — `npx nx e2e web-e2e`; fix what fails.
- [ ] **Step 3: Fill the checklist rows** with the test names and results.
- [ ] **Step 4: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `test(web-e2e): baseline on every page`.
