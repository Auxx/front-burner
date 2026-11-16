# Screen Timings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 151 of [the step 6 index](2026-11-16-00-roadmap-step-6.md): a
tool that measures the screen targets of NF-2 in a throttled browser: the first
load usable within 5 s on slow 4G (NF-2.7), a 100 KB file's editor usable within
1 s on broadband and 2 s on slow 4G (NF-2.2), a folder of 1,000 entries shown
within 1 s on slow 4G (NF-2.1), and the preview refreshed within 300 ms after
typing stops in a 200 KB file (NF-2.5).

**Architecture:** `tools/ai-tools/src/bin/perf-screen.mjs`, next to
`typing-test.mjs` and built the same way (Playwright's Chromium, a CDP session).
Slow 4G is Chrome DevTools' preset, set with `Network.emulateNetworkConditions`
to its published values, plus a 4× CPU slowdown for the phone runs, as
`typing-test.mjs` uses _(plan's call)_. "Usable" is a mark the web client
already has or gets here: `performance.mark('fb:editor-ready')` when the editor
accepts input, `fb:tree-folder-shown` when the folder's entries are in the DOM,
`fb:preview-updated` after a render, and `fb:app-ready` when the first route's
page has rendered _(plan's call: marks cost nothing and make the numbers the
app's own)_. Each measure runs 20 times in a fresh context; the output is the
same table as `perf-api.mjs`.

**Tech Stack:** Playwright, from the workspace. No new packages.

**Spec:** `docs/architecture/non-functional.md` NF-2.1, NF-2.2, NF-2.5, NF-2.7,
"Reference host"; `docs/wiki/typing-test.md`.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- The marks are added in the production build too, and named in
  `docs/architecture/web-client.md`.
- The first-load measure uses a cold browser cache each run; a second measure
  with a warm cache is printed for information.

## Review Focus

- **The service of the web client itself** (compression, cache headers) → the
  first load is measured against the production image, not `nx serve` (plan
  152); the local run says it is indicative.
- **A mark set too early** (the editor shown but not yet taking input) → the
  editor mark is set after CodeMirror's view is created and focused.

---

### Task 1: The marks

**Files:**

- Modify: the web client's app component, the tree, the editor and the preview
  components (+ specs), `docs/architecture/web-client.md`

- [ ] **Step 1: Write the failing tests**: `marks fb:app-ready after the first
      page renders`; `marks fb:editor-ready when the editor takes input`; `marks
      fb:tree-folder-shown when a folder's entries are shown`; `marks
      fb:preview-updated after each render`.
- [ ] **Step 2: Run them, implement, run them again** — each project's `test`
      target.
- [ ] **Step 3: Commit** — `feat(web): performance marks`

---

### Task 2: The tool

**Files:**

- Create: `tools/ai-tools/src/bin/perf-screen.mjs`
- Modify: the `ai-tools` skill's tool list, `docs/wiki/release-checks.md`

- [ ] **Step 1: Write the tool** with `--help`, `--runs`, `--url`, `--profile
      desktop|phone`.
- [ ] **Step 2: Run it** against a local production build and record the result
      in the checklist as "indicative".
- [ ] **Step 3: Check and commit** — as in the index's "Verifying"; set this
      plan's row to **Done**; commit `feat(ai-tools): perf-screen`.
