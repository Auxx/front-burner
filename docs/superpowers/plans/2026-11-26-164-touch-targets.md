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
| The **Changes** tab's checkboxes                                                   | 24 × 24 px, in a 36 × 48 px label | the changes list's row (`rs-change-entry`)          |
| Breadcrumb links                                                                   | 18 px high                        | `ui-page`'s title bar (`*uiBreadcrumb`)             |
| **Edit**, the editor's tab on a phone, on the conflict screen                      | 43 × 44 px                        | `uiTab` (no minimum width)                          |

The density tokens already give 44 px on touch screens (`control-height`,
`row-height` in `libs/ui/src/styles/tokens/_density.scss`); these components do
not use them for their whole target:

- the segmented control is 44 px, but its 2 px padding is outside the segments,
  so a segment is `control-height - 2 × padding`;
- the changes row's label around its checkbox is padded to 36 px, not the
  control height;
- a breadcrumb link is a line of text;
- a tab, like a button, has a minimum height but no minimum width.

The end-to-end check this plan adds (Task 4) measures every page as the phone
check did, and found more than the hand run reached: standalone text links, 21
px high, on the dashboard (a repository's name, its **Settings**, **All
repositories**), on the repository management page (a repository's name) and on
Page not found (**Go to the dashboard**).

## Global Constraints

- The shared constraints of [the step 6 index](2026-11-16-00-roadmap-step-6.md)
  apply.
- Touch sizes: in compact density a target grows at most to the compact control
  height (28 px), and no text moves, so the desktop layout stays as it is.
- The fix is in `libs/ui`, not in the features, except where a feature's own
  layout cuts the target (the changes list's row) or uses a plain link.
- Each fix has a test first, failing before the fix: a Storybook interaction
  test at touch density that measures the target (`getBoundingClientRect`, at
  least 44 × 44), or, in a feature without stories, the end-to-end check.
- NF-12.4 still holds: nothing scrolls sideways at 320 px (`baseline.spec.ts`).

## Review Focus

- **The segmented control on a 320 px screen** with three long labels
  (credentials): the segments grow in height, never in width.
- **The bar of the repository screen** on a phone, which is 44 px: it must not
  grow ("the branch and counts stay in the one bar").
- **Larger targets, not overlapping ones**: breadcrumbs and standalone links
  grow with padding on touch screens, and their lines grow with them; negative
  margins would keep the lines, but make a wrapped breadcrumb's targets overlap
  (axe's `target-size`).

---

### Task 1: The segmented control

- [x] **Step 1: Test** — `segmented-control.component.stories.ts` ›
      `TouchTargets`: each segment is at least 44 × 44 at touch density.
- [x] **Step 2: Fix** — a density token, `--ui-control-inset` (2 px compact,
      none on touch), is the control's padding, so that on touch the segments
      have its whole height.

### Task 2: Tabs and short buttons

- [x] **Step 1: Test** — `tab-strip.component.stories.ts` and
      `button.component.stories.ts` › `TouchTargets`: a one-word tab and button
      are at least 44 × 44 at touch density.
- [x] **Step 2: Fix** — `uiTab` and `uiButton` get the control height as their
      minimum width (`control-height-small` for a small button).

### Task 3: Links and the changes row

- [x] **Step 1: Test** — `page.component.stories.ts` › `TouchTargets` (a
      one-letter breadcrumb) and `link.component.stories.ts` › `TouchTargets`.
- [x] **Step 2: Fix** — a mixin, `touch-target-text`, gives a link 44 px with
      padding on touch screens, from a density token, `--ui-text-target-size`
      (none in compact density); `Page` uses it for breadcrumbs, and a new
      `a[uiLink]` component for standalone links, used by the dashboard's
      entries and **All repositories**, the repository management page's names
      and Page not found. The changes row's label is at least the control height
      wide.

### Task 4: Check and record

- [x] **Step 1: The end-to-end check** — `baseline.spec.ts` › "NF-13.5: every
      control is at least 44 px on a phone": every page of its list with its
      dialog or menu, and the **Changes** tab with a change, in the phone
      projects, with the phone check's exclusions (visually hidden inputs and
      links, text fields' labels, the preview's links).
- [x] **Step 2: Verify** — as in the index's "Verifying", plus the end-to-end
      suite in Chromium on desktop and phone.
- [x] **Step 3: The real phone again** — the operator measured the build on the
      test instance: everything above passed, and line 53 found the editor's
      **Accept** buttons above a conflict at 24 px high. They are hidden from
      assistive technology, which the end-to-end check had skipped; it now
      counts every control that can be tapped, and the buttons take the small
      control height (`editor-theme.ts`), 44 px on touch screens.
- [x] **Step 4: Record** — update the NF-13.5 row and plan 155's results in
      `docs/wiki/release-checks.md`; set this plan's row to **Done**.
