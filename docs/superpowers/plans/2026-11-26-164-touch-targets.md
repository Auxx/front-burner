# Touch Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 164 of [the step 6 index](2026-11-16-00-roadmap-step-6.md), Part
F: plan 155's phone check measured controls under NF-13.5's 44 px on a real
Android phone (`docs/wiki/release-checks.md`, "Plan 155: phones", "Results"),
all in shared components:

| Control                                                                            | Measured                          | Where it is drawn                                   |
| ---------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| Segments of `ui-segmented-control` (credentials, clone mode, Split, Edit, Preview) | 40 px high                        | `libs/ui/src/controls/components/segmented-control` |
| The **Changes** tab's checkboxes                                                   | 24 × 24 px, in a 36 × 48 px label | `ui-checkbox` and the changes list's row            |
| Breadcrumb links                                                                   | 18 px high                        | `ui-page`'s title bar (`*uiBreadcrumb`)             |
| A short text button, **Edit**, on the conflict screen                              | 43 × 44 px                        | `uiButton` (no minimum width)                       |

The density tokens already give 44 px on touch screens (`control-height`,
`row-height` in `libs/ui/src/styles/tokens/_density.scss`); these components do
not use them for their whole target:

- the segmented control is 44 px, but its 2 px padding is outside the segments,
  so a segment is `control-height - 2 × padding`;
- the checkbox's target is `max(icon-size, 1.5rem)`, 24 px, the WCAG 2.5.8
  minimum, not the touch one;
- a breadcrumb link is a line of text;
- a button has a minimum height but no minimum width.

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Touch sizes only: on a fine pointer (`data-density` compact) nothing changes
  size, so the desktop layout and its screenshots stay as they are.
- The fix is in `libs/ui`, not in the features, except where a feature's own
  layout cuts the target (the changes list's row).
- Each fix has a test first: a Storybook interaction test at touch density that
  measures the target (`getBoundingClientRect`, at least 44 × 44), failing
  before the fix.
- NF-12.4 still holds: nothing scrolls sideways at 320 px (`baseline.spec.ts`).

## Review Focus

- **The segmented control on a 320 px screen** with three long labels
  (credentials): the segments grow in height, never in width.
- **The bar of the repository screen** on a phone, which is 44 px and holds the
  view mode's segmented control: it must not grow ("the branch and counts stay
  in the one bar").
- **A larger target without a larger look**: the checkbox and the breadcrumb
  links can grow their hit area (padding, or a pseudo-element) without moving
  the text.

---

### Task 1: The segmented control

- [ ] **Step 1: Test** — touch density: each segment is at least 44 px high.
- [ ] **Step 2: Fix** — on touch, the segments take the whole control height
      (the padding inside the segment's hit area, or no padding).

### Task 2: Checkboxes

- [ ] **Step 1: Test** — touch density: `ui-checkbox`'s target is 44 × 44; the
      changes list's row keeps it whole.
- [ ] **Step 2: Fix** — `--ui-checkbox-target` at touch density from
      `control-height`; the changes list's row gives it room.

### Task 3: Breadcrumbs and short buttons

- [ ] **Step 1: Test** — touch density: a breadcrumb link and a one-word
      `uiButton` are at least 44 × 44.
- [ ] **Step 2: Fix** — breadcrumb links get the control height as their hit
      area; `uiButton` gets `min-inline-size: var(--ui-control-height)`.
- [ ] **Step 3: Find the conflict screen's Edit button** (plan 155's line 53)
      and check that the fix covers it.

### Task 4: Check and record

- [ ] **Step 1: Verify** — as in the index's "Verifying", plus `npx nx e2e
      web-e2e` in the phone project.
- [ ] **Step 2: Record** — measure again on the test instance (plan 155's
      _measure_ lines, with its console snippet), and update the NF-13.5 row and
      plan 155's results in `docs/wiki/release-checks.md`; set this plan's row
      to **Done**.
