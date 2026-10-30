# Surfaces and Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 34 of [the design pass index](2026-10-30-00-design-pass.md): in
dark mode islands are darker than the lighter canvas, as in WebStorm; headings
are styled once, IDE-sized; a field's label sits 8 px above its control; banner
buttons stay at the top; icons in buttons are never cropped.

**Architecture:** All in `libs/ui` (project `ui`): token SCSS, the base layer,
and three component stylesheets. No page changes yet; later plans build on the
new tokens.

**Tech Stack:** SCSS cascade layers, OKLCH primitives, Storybook, Vitest.

**Spec:** [design](../specs/2026-10-30-islands-design-pass-design.md) G1, G2,
G3, G6, G7; `docs/architecture/design-system.md` A-10.5, A-10.16 to A-10.19.

## Global Constraints

- The shared constraints of [the index](2026-10-30-00-design-pass.md) apply.
- Measured targets: **canvas ≈ `#26282c`** (`oklch(27.6% 0.008 264)`), **island
  ≈ `#191a1c`** (`oklch(21.8% 0.004 264)`), surface on an island ≈ `#222326`
  (`oklch(25.6% …)`), find panel ≈ `#2b2d30` (`oklch(29.6% …)`).
- Field: label → control **`--ui-space-2`**; control → hint/error stays
  **`--ui-space-1`**.

## Review Focus

- **An input, select or textarea on an island must still look like a control**
  after the swap: its fill differs from the island and its border meets the
  `border-default` pair. Task 1 adds `text-default on surface-sunken over
  surface-island` checks through the existing pairs and a screenshot of the
  field story.
- **Menus and popovers over the editor or a tile** must stand out:
  `surface-raised` is lighter than both the island and the new card surface
  (Task 1, `tokens try`).
- **A banner with no actions** must not change height or alignment (Task 4
  story).
- **A field without a label** (an `aria-label` only) must not gain 8 px of empty
  space above the control (Task 3 test).
- **The dark-mode selection colours** (`selected-inactive`, `editor-selection`)
  must stay visible on the darker island (Task 1, pairs).

---

### Task 1: Surface tokens

**Files:**

- Modify: `libs/ui/src/styles/tokens/_primitives.scss` (add `neutral-22`,
  `neutral-25`)
- Modify: `libs/ui/src/styles/tokens/_color.scss:8-15`
- Modify: `libs/ui/src/design-tokens/models/contrast-pairs.model.ts`
- Modify: `docs/architecture/design-system.md` (A-10.5, the surface row of the
  colour table)

**Interfaces:**

- Produces: `--ui-surface-card` (a surface on an island: tiles, code blocks).
  Later plans use `--ui-surface-card` and `--ui-surface-raised` (find panel).

- [ ] **Step 1: Try the values with the tool before editing**

Run:

```shell
node tools/ai-tools/src/bin/tokens.mjs try \
  surface-canvas@dark=neutral-27 surface-island@dark='oklch(22% 0.006 265)' \
  surface-raised@dark=neutral-30 surface-sunken@dark=neutral-23 \
  surface-card@light=neutral-98 surface-card@dark='oklch(25% 0.006 265)'
```

Expected: exit 0. If a pair fails, adjust only the failing token by one step and
note the change in the pull request.

- [ ] **Step 2: Add the primitives and change the tokens**

`--ui-neutral-22: oklch(22% 0.006 265)` and `--ui-neutral-25: oklch(25%
0.006 265)`, in order. Dark values: `surface-canvas` → `neutral-27`,
`surface-island` → `neutral-22`, `surface-raised` → `neutral-30`,
`surface-sunken` → `neutral-23` _(plan's call: a control on the island is
slightly lighter than it, as in the agreed mockup)_. New `surface-card:
(neutral-98, neutral-25)`, after `surface-island`. Light values of existing
tokens are unchanged.

- [ ] **Step 3: Add the pairs for the new surface**

In `contrast-pairs.model.ts`: `text-default`, `text-muted` and `text-link` on
`surface-card`; `text-default` and `text-muted` on `surface-card` over
`surface-hover`. Follow the file's `text(...)` helpers.

- [ ] **Step 4: Run the contrast check**

Run: `npx nx run ai-tools:test` Expected: PASS (the `ui-contrast` spec reads the
new token and pairs).

- [ ] **Step 5: Screenshot the token and field stories in dark mode**

Run: `npx nx run ui:build-storybook`, then `node
tools/ai-tools/src/bin/story.mjs shot <field story id> <app-shell story id>
--theme dark --viewport 1024x640` (ids from `story.mjs list field`, `story.mjs
list app-shell`). Expected: the island is darker than the canvas around it; an
input on the island is visibly a control.

- [ ] **Step 6: Update the docs**

A-10.5: "islands sit on a **lighter canvas**; in dark mode the islands are the
darker surface, as in WebStorm's Islands Dark; in light mode they are white on a
grey canvas." Add `card` to the Surface row of the colour table ("a surface on
an island: tiles, code blocks").

- [ ] **Step 7: Commit**

```bash
git add libs/ui/src/styles/tokens libs/ui/src/design-tokens docs/architecture/design-system.md
git commit -m "Swap dark canvas and island surfaces, add surface-card (plan 34)"
```

### Task 2: Global heading styles

**Files:**

- Modify: `libs/ui/src/styles/_base.scss`
- Modify: `libs/ui/src/styles/tokens/_typography.scss` (only if a size token is
  missing)

**Interfaces:**

- Produces: `h1`–`h6` in the `base` layer: `margin: 0`, `font-weight:
  var(--ui-font-weight-semibold)`, `line-height: var(--ui-line-height-tight)`;
  sizes `h1` `--ui-font-size-lg` (15 px), `h2` `--ui-font-size-md` (14 px),
  `h3`–`h6` `--ui-font-size-sm` (13 px) _(plan's call, within the design's "≈ 14
  / 13 px")_. Plans 35 and 36 delete the per-page copies that these replace;
  this task does not touch pages.

- [ ] **Step 1: Add the rules to `@layer base` in `_base.scss`**

Component and page styles are in later layers, so `ui-dialog`'s and
`ui-empty-state`'s own title sizes still win.

- [ ] **Step 2: Check that nothing in `libs/ui` changes size by accident**

Run: `npx nx run ui:build-storybook` and `story.mjs shot` the dialog and empty
state stories, `--theme dark`. Expected: their titles look as before.

- [ ] **Step 3: Run the ui tests**

Run: `npx nx run ui:test` Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add libs/ui/src/styles
git commit -m "Global heading styles in the base layer (plan 34)"
```

### Task 3: Field label gap

**Files:**

- Modify: `libs/ui/src/controls/components/field/field.component.scss`
- Test: `libs/ui/src/controls/components/field/field.component.stories.ts` (play
  function)

- [ ] **Step 1: Write the failing story test**

A play function on the default story with a label and a hint:

```ts
const label = canvasElement.querySelector('.label')!.getBoundingClientRect();
const control = canvasElement.querySelector('.control')!.getBoundingClientRect();
const hint = canvasElement.querySelector('.hint')!.getBoundingClientRect();
await expect(control.top - label.bottom).toBe(8);
await expect(hint.top - control.bottom).toBe(4);
```

And on a story without a visible label: the control's top equals the field's
top.

- [ ] **Step 2: Run it to see it fail**

Run: `npx nx run ui:test-storybook`. Expected: FAIL, 4 ≠ 8.

- [ ] **Step 3: Give the label `margin-block-end: calc(var(--ui-space-2) -
      var(--ui-space-1))`** (the host's gap stays `--ui-space-1`), only when the
      label is rendered.

- [ ] **Step 4: Run it to see it pass**, then commit:

```bash
git add libs/ui/src/controls/components/field
git commit -m "8 px between a field's label and its control (plan 34)"
```

### Task 4: Banner actions at the top

**Files:**

- Modify:
  `libs/ui/src/feedback/components/inline-banner/inline-banner.component.scss:82-94`
- Test:
  `libs/ui/src/feedback/components/inline-banner/inline-banner.component.stories.ts`

- [ ] **Step 1: Write the failing story test**

A story "Actions with a long message" at 600 px width whose message wraps to
three lines, with two small buttons. Play function: the actions' top is within 2
px of the message's top line box, not of its vertical centre:

```ts
const message = canvasElement.querySelector('.message')!.getBoundingClientRect();
const actions = canvasElement.querySelector('.actions')!.getBoundingClientRect();
await expect(Math.abs(actions.top - message.top)).toBeLessThanOrEqual(2);
```

- [ ] **Step 2: Run it to see it fail** (expected: the actions are centred).

- [ ] **Step 3: In the wide container query, set `align-items: start` for
      `.layout`**; centre the action buttons and the dismiss button on the first
      line the way `.icon` already does (`min-block-size: calc(1em *
      var(--ui-line-height-ui))`, with the small button height in mind).

- [ ] **Step 4: Run it to see it pass**; screenshot the story with one-line and
      three-line messages, `--theme light,dark`. Expected: a one-line banner
      looks as before.

- [ ] **Step 5: Commit**

```bash
git add libs/ui/src/feedback/components/inline-banner
git commit -m "Inline banner actions stay at the top (plan 34)"
```

### Task 5: Cropped icon in a button

**Files:**

- Modify: whichever `libs/ui` stylesheet the investigation finds (likely
  `libs/ui/src/controls/components/button/button.component.scss` or
  `libs/ui/src/content/components/icon/icon.component.scss`)
- Test: `libs/ui/src/controls/components/button/button.component.stories.ts`

- [ ] **Step 1: Reproduce in a story**

Use superpowers:systematic-debugging. Add a story "Ghost with icon and text"
(`<button uiButton variant="ghost"><ui-icon name="files" /> Files</button>`) and
a play function:

```ts
const icon = canvasElement.querySelector('ui-icon')!.getBoundingClientRect();
await expect([ icon.width, icon.height ]).toEqual([ 16, 16 ]);
```

Run it; expected FAIL with about `[19, 24]`, as on the repository screen.

- [ ] **Step 2: Find the cause** (computed styles of `ui-icon` and its `svg` in
      the story: which rule sets the size). Record it in the commit message.

- [ ] **Step 3: Fix it in `libs/ui`** so that `ui-icon` is always
      `--ui-icon-size` square in any button variant and size. Add the same
      assertion for `size="small"` and for `uiIconButton`.

- [ ] **Step 4: Run the story tests and `npx nx run ui:test`**, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/ui/src
git commit -m "Fix icons cropped inside buttons (plan 34)"
```

### Task 6: Finish the plan

- [ ] Run `npx nx affected -t lint,test,build` and `npx nx format:write`;
      expected: all pass.
- [ ] Set plan 34's row in the index to **Done** in the pull request.
