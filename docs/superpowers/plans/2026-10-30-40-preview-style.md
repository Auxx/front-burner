# GitHub-Style Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 40 of [the design pass index](2026-10-30-00-design-pass.md): the
live preview reads like a README on GitHub, with GitHub's spacing, sizes and
structure, in Front Burner's own colours.

**Architecture:** One stylesheet:
`libs/web/markdown/src/markdown/components/markdown-preview/markdown-preview.component.scss`,
the `::ng-deep` rules under `.blocks`. The rules are written here, not imported.
A new semantic token holds the inline code tint.

**Tech Stack:** SCSS, Playwright (computed styles), the running web client.

**Spec:** [design](../specs/2026-10-30-islands-design-pass-design.md) Per page:
Repository screen (Preview). ED-26 to ED-33, IM-11, A-8.12.

## Global Constraints

- The shared constraints of [the index](2026-10-30-00-design-pass.md) apply.
- Values (GitHub's, with our tokens for colour):
  - body: `--ui-font-size-prose` (16 px), `--ui-line-height-prose`; padding
    `--ui-space-4` × `--ui-space-6`;
  - `p`, `blockquote`, `ul`, `ol`, `dl`, `table`, `pre`, `details`: `margin: 0 0
    16px` (`--ui-space-4`); the first child of the body has no top margin and
    the last no bottom margin;
  - headings: `margin: 24px 0 16px` (`--ui-space-6` / `--ui-space-4`), semibold,
    `line-height: 1.25`; sizes `h1` 2em, `h2` 1.5em, `h3` 1.25em, `h4` 1em, `h5`
    0.875em, `h6` 0.85em in `--ui-text-muted`; `h1` and `h2` have
    `padding-bottom: 0.3em` and a bottom border in `--ui-border-subtle`;
  - lists: `padding-inline-start: 2em`; `li + li` margin-top 0.25em; nested
    lists no margin; task list items without bullets, checkbox margin `0 0.2em
    0.25em -1.4em`;
  - inline `code`: `font-size: 85%`, `padding: 0.2em 0.4em`, radius 6 px
    (`--ui-radius-popover`), background: a new semantic token
    `preview-code-background` = `(alpha(neutral-60, 25%), alpha(neutral-60,
    25%))` in `_color.scss` _(plan's call: GitHub's tint on our neutral; a
    semantic token, because the contrast tools do not read component tokens)_;
  - `pre`: `--ui-surface-card`, padding 16 px, radius 6 px, `font-size: 85%`,
    `line-height: 1.45`; `pre code` no background or padding, `font-size: 100%`;
  - `blockquote`: `padding: 0 1em`, `border-inline-start: 0.25em solid
    var(--ui-border-default)`, `--ui-text-muted`;
  - tables: borders `--ui-border-default`, cells `6px 13px`, `th` semibold,
    every even row `--ui-surface-card`;
  - `hr`: `height: 0.25em`, no border, `--ui-border-subtle`, margin `24px 0`;
  - `img`: unchanged (IM-11); links: `--ui-text-link`, no underline, underline
    on hover;
  - The removal notice and the remote-images button keep their own styles.
- The rules stay under `.blocks` (preview content only), so G2's UI headings
  never apply.
- New contrast pairs: every `syntax-*` token on `surface-card` (code blocks move
  there from `surface-sunken`), `text-default` on `surface-card`, and
  `text-default` on `surface-island` over `preview-code-background`.

## Review Focus

- **A code block with a very long line** scrolls sideways inside the block
  (ED-33), never widening the preview (Task 1 e2e: preview `scrollWidth ===
  clientWidth`).
- **A heading as the first block** has no top margin, so the preview does not
  start with a gap (Task 1 e2e).
- **Nested lists and task lists** keep their indentation and checkbox alignment
  (Task 1 screenshot of a fixture with both).
- **Light mode** keeps readable code blocks and inline code (Task 1 screenshot
  in light mode; the pairs cover contrast).
- **Content-visibility blocks** (`.md-block`) keep their margins between blocks:
  margins collapse across block wrappers as expected (Task 1 e2e measures the
  gap between two paragraphs in different blocks: 16 px).

---

### Task 1: Markdown body styles

**Files:**

- Modify:
  `libs/web/markdown/src/markdown/components/markdown-preview/markdown-preview.component.scss`
- Modify: `libs/ui/src/styles/tokens/_color.scss` (`preview-code-background`)
- Modify: `libs/ui/src/design-tokens/models/contrast-pairs.model.ts` (the pairs
  above; replace the `surface-sunken` syntax pairs if no other code uses sunken
  for code)
- Test: `apps/web-e2e/src/preview.spec.ts`
- Create: a fixture Markdown file for the e2e repository with headings,
  paragraphs, inline code, a long code block, a nested and a task list, a
  blockquote, a table and an `hr` (follow how `preview.spec.ts` provides its
  files)
- Modify: `docs/architecture/web-client.md` (A-8.12: one sentence that the
  preview follows GitHub's Markdown layout in the product's colours)

- [ ] **Step 1: Write the failing e2e test**

```ts
test('the preview lays out Markdown like GitHub', async ({ page }) => {
  // open the fixture in Preview
  const style = (selector: string, property: string) =>
    page.locator(`md-preview ${selector}`).first().evaluate(
      (el, p) => getComputedStyle(el).getPropertyValue(p), property);
  expect(await style('p', 'margin-bottom')).toBe('16px');
  expect(await style('h2', 'border-bottom-style')).toBe('solid');
  expect(await style('p code', 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
  expect(await style('pre', 'padding-top')).toBe('16px');
  expect(await style('blockquote', 'border-left-style')).toBe('solid');
});
```

Plus the Review Focus cases: first-block margin, gap between paragraphs in
different `.md-block`s, no sideways scroll with a long code line.

- [ ] **Step 2: Run it to see it fail**

Run: `npx nx run web-e2e:e2e --grep "like GitHub"` Expected: FAIL (`0px`
margins, transparent code background).

- [ ] **Step 3: Write the rules** of the Global Constraints; keep the existing
      `sk-*` classes, ED-33 overflow, IM-11 image and `contain: strict` rules.

- [ ] **Step 4: Run the contrast check and the e2e test**

Run: `npx nx run ai-tools:test`, then the e2e test. Expected: both PASS.

- [ ] **Step 5: Screenshot** the fixture in Preview and Split, dark and light,
      1440 × 900; compare with the preview half of `repo-screen-v2.html`.

- [ ] **Step 6: Finish**: `doc-ids.mjs check`; `npx nx affected -t
      lint,test,build`; `npx nx format:write`; index row **Done**.

- [ ] **Step 7: Commit**

```bash
git add libs/web/markdown libs/ui/src apps/web-e2e docs/architecture/web-client.md
git commit -m "GitHub-style Markdown layout in the preview (plan 40)"
```
