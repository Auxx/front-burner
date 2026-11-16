# Release Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 148 of [the step 6 index](2026-11-16-00-roadmap-step-6.md):
`docs/wiki/release-checks.md` lists every rule of NF-1 to NF-14 that is in the
MVP (or limited in it), says what proves it, and says which plan of Part E
checks what is not yet proven. It is the record that the other check plans fill
in and that plan 157 closes.

**Architecture:** Documents only. One table per NF area, in the order of
`non-functional.md`, with the columns **Rule**, **How it is checked** (**Test**
with the test's file and title; **Hand** with the plan that does it;
**Measured** with the plan and the tool; **Document** for rules an operator
follows, with the guide's section), **Result**, **Date**, **Commit**. Rows
already proven by a test are filled now, with **Result** "Pass" and today's CI
run. Rows that are not get the plan that will check them (149 to 156). A rule
that is not in the MVP is left out, as `mvp.md` says.

`doc-ids.mjs` checks that every NF ID it names exists. _(Plan's call: no new
tool; if checking that every MVP NF ID has a row turns out worth automating, it
becomes a `doc-ids.mjs` subcommand in plan 157.)_

**Tech Stack:** Markdown.

**Spec:** `docs/architecture/non-functional.md`; `docs/product/mvp.md` (section
11 of "In scope", which says which NF rules are in the MVP).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- A rule proven only in part by a test has the rest named and assigned, as for
  acceptance criteria (the step 3 index explains why a partial test does not
  count).
- Rules decided by design and visible in code only (for example NF-4.2, a single
  process) are **Document** rows pointing at the architecture.
- NF-3 (unsaved edits) and NF-14 (localisation) have no check plan of their own
  in the index: their rows are filled from the tests that steps 2 and 1 wrote. A
  rule there with no test goes to plan 149, or to Part F if a test is not
  enough.
- The "already tested" list in plan 149 comes from a quick search: each item is
  confirmed here by reading the test, and plan 149's gap list is corrected to
  match.

## Review Focus

- **A rule with a test that does not test it** (for example a CSP test that
  checks the header exists, not its value) → each **Test** row is read, not only
  named; a weak test becomes a plan 149 row.
- **A rule nobody owns** → after this plan, every row has either a result or a
  plan.

---

### Task 1: The checklist

**Files:**

- Create: `docs/wiki/release-checks.md`
- Modify: `docs/product/mvp.md` ("Implementation status": the non-functional
  requirements are tracked in the checklist), `docs/wiki/todo.md` (the spike 4
  repeat now lives in the checklist), plans 149 to 156 if a row needs a check
  they do not list yet

- [ ] **Step 1: Write the tables** and fill the rows a test proves.
- [ ] **Step 2: Assign every other row** to one of plans 149 to 156.
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `docs: release checklist`.
