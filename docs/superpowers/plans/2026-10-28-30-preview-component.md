# Preview Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 30 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
open file's live preview appears beside the editor on wide screens, updates as
the user types, opens links as ED-31 says, and says quietly when it removed
HTML. Its one component is the only place in the web client that writes rendered
HTML into the page, and an end-to-end test renders the XSS corpus under the real
Content Security Policy with no violation.

**Architecture:** In `web/markdown`, the `MarkdownPreviewComponent` keeps one
element per block of plan 29's layout. It runs DOMPurify (plan 28) only on new
blocks, assigns the `TrustedHTML` to each block's `innerHTML`, removes blocks
that are gone and inserts new ones without moving the rest (A-8.12, D-7.6).
After each patch it de-duplicates heading IDs and marks external links. Shiki's
CSS goes into one constructed stylesheet. The repository screen shows it beside
the editor in `ui-split-pane`, inside the editor pane's `@defer`.

**Tech Stack:** as before. No new packages.

**Spec:** `docs/requirements/editor.md` (REQ-EDIT-001: ED-26, ED-27, ED-28,
ED-30 to ED-33, ED-37, ED-39 for the preview; criteria 1, 14, 15, 16's preview
half, 18, 19, 24's preview half); `preview-html.md` (REQ-EDIT-002: SH-3, SH-4,
SH-17 to SH-22; criteria 13 to 16); `docs/architecture/decisions.md` D-7.6;
`web-client.md` A-8.12; `non-functional.md` NF-2.5, NF-11.1.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- **D-7.6**: no other code in the web client assigns `innerHTML`, `outerHTML` or
  `insertAdjacentHTML`, or uses `bypassSecurityTrust…`. A lint rule
  (`no-restricted-properties` / `no-restricted-syntax` in the root ESLint
  config) enforces it, with one disable comment in this component.
- **Blocks**: `<div class="md-block" dir="auto" data-from-line="…"
  data-to-line="…">` per layout entry (ED-30; the line attributes serve plan
  31). Blocks use `content-visibility: auto`; the preview pane has a fixed size
  with `contain: strict` (A-8.12).
- **Heading IDs**: after each patch, headings get unique IDs in document order
  (`user-content-install`, `user-content-install-1`, …), as GitHub numbers them.
- **Links** (ED-31):
  - `http:`, `https:` and `mailto:` links get `target="_blank"` and
    `rel="noopener noreferrer"` after purifying;
  - `#name` scrolls to `user-content-name` inside the preview (SH-14);
  - any other link is a path relative to the open file's folder (or to the root
    when it starts with `/`), and a click emits it, with its fragment, for the
    screen to open like a tree selection; a path that climbs above the root does
    nothing.
- **Removal notice** (SH-17 to SH-20): one line at the top of the preview, "Some
  HTML isn't shown in the preview." with **Details** and **Hide**. **Details**
  lists, by count: "`<iframe>` × 2"; "`style` attribute × 5"; "`javascript:`
  address × 1". **Hide** hides it until another file is opened. It is not a live
  region.
- Wide tables and code blocks scroll sideways inside the preview; the page never
  does (ED-33). The preview is a region labelled "Preview of <file
  name>" (ED-37).
- On narrow screens the preview is not on screen while typing (A-8.12); plan 31
  adds the **Preview** tab. Until then narrow screens show the editor only.

## Review Focus

- **Typing in one paragraph of a long file** must leave every other block's
  element untouched (no flicker, no lost selection in the preview, images not
  reloaded later) → Task 1 test `replaces only the changed block's element`.
- **Two headings with the same text in different blocks** must get different
  IDs, and a `#` link must go to the first → Task 1 test `numbers duplicate
  heading IDs in document order`.
- **A relative link that climbs above the repository root**
  (`../../../etc/passwd`) must do nothing, not emit a path → Task 2 test
  `ignores a link above the root`.
- **Any HTML the file contains** must not cause a CSP violation report when
  rendered: the first sanitising step must remove it before DOMPurify's inert
  document sees it → Task 4 test `AC-EDIT-002.16: renders the XSS corpus with no
  CSP violation`.
- **The notice while typing** must update but never be announced, and Hide must
  survive further typing → Task 3 test `stays hidden while typing after Hide`.

---

### Task 1: The preview component

**Files:**

- Create (generated component):
  `libs/web/markdown/src/markdown/components/markdown-preview` (+ `.spec.ts`)
- Create: `src/markdown/components/markdown-preview/patch-blocks.ts` (+
  `.spec.ts`), `src/markdown/styles/shiki-sheet.ts`
- Modify: `libs/web/markdown/src/index.ts`, the root `eslint.config.mjs`

**Interfaces:**

- Consumes: `PreviewRenderer`, `PreviewSource`, `PreviewState` (plan 29);
  `purifyHtml` (plan 28).
- Produces:
  - `patchBlocks(container: HTMLElement, state: PreviewState, purify: (html:
    string) => TrustedHTML | string): void` — the DOM patch of Global
    Constraints.
  - `MarkdownPreviewComponent` (`md-preview`): inputs `source: PreviewSource`
    (required), `path: string` (the open file), `label: string`; output
    `openPath: { path: string; fragment: string | null }` (Task 2). Each file
    change (`path`) resets the renderer.
  - `adoptShikiCss(css: string): void` — appends rules to one constructed
    stylesheet in `document.adoptedStyleSheets`.

- [ ] **Step 1: Write the failing tests**: `renders the blocks in layout order`;
      `replaces only the changed block's element`; `removes blocks that are
      gone`; `purifies only new blocks`; `numbers duplicate heading IDs in
      document order`; `sets dir auto on every block`; `adopts Shiki's CSS once
      per class`; `labels the region with the file name`; the lint rule:
      `innerHTML` in any other file fails `npx nx lint`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t lint test -p
      web-markdown`.
- [ ] **Step 5: Commit** — `feat(markdown): add the preview component`

---

### Task 2: Links

**Files:**

- Create: `src/markdown/components/markdown-preview/preview-links.ts` (+
  `.spec.ts`)
- Modify: `markdown-preview.component.ts`

**Interfaces:**

- Produces: `resolvePreviewLink(filePath: string, href: string): { kind:
  'external' } | { kind: 'fragment'; id: string } | { kind: 'path'; path:
  string; fragment: string | null } | { kind: 'none' }` (percent-decoded paths);
  a delegated click handler that acts on it and prevents the browser's own
  navigation for `fragment` and `path`.

- [ ] **Step 1: Write the failing tests**: `opens http, https and mailto in a
      new tab without a referrer or opener`; `scrolls to a prefixed heading`;
      `resolves ../guide.md from docs/a/b.md as docs/guide.md`; `resolves /x.md
      from the root`; `keeps the fragment of a path link`; `ignores a link above
      the root`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): follow links in the preview`

---

### Task 3: The removal notice

**Files:**

- Create (generated component): `src/markdown/components/removal-notice` (+
  `.spec.ts`)
- Modify: `markdown-preview.component.*`, `apps/web/public/i18n/en.json`

**Interfaces:**

- Consumes: `RemovalReport` (plan 28).
- Produces: `RemovalNoticeComponent` (`md-removal-notice`), input `removals:
  RemovalReport`, `hidden: boolean` model: the line, **Details** (a disclosure
  listing the counts in the texts of Global Constraints, sorted by count) and
  **Hide**.

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-002.13: says HTML was
      removed and lists it by count`; `goes away when nothing is removed`;
      `shows nothing for comments only`; `AC-EDIT-002.14: hides until another
      file is opened`; `stays hidden while typing after Hide`; `is not a live
      region`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): show the removal notice`

---

### Task 4: On the repository screen, and end-to-end tests

**Files:**

- Modify:
  `libs/web/feature-repository-screen/src/repository-screen/components/editor-pane/*`
  (+ spec), `services/open-files/*` (the `PreviewSource` of the open file),
  `pages/repository-screen/*` (`openPath` → navigation as in plan 16);
  `apps/web-e2e/src/support/fixtures/*` (a file holding the XSS corpus, built
  from `xss-corpus.ts`), `apps/web-e2e/src/preview.spec.ts` (create),
  `docs/product/mvp.md`

**Interfaces:**

- Produces: `OpenFile.preview: PreviewSource` (its `version` bumped on every
  document change by the editor pane); on wide screens the pane shows
  `ui-split-pane` with the editor and `md-preview`, both inside the existing
  `@defer`.

- [ ] **Step 1: Write the failing test**: `shows the preview beside the editor
      on wide screens and not on narrow ones`.
- [ ] **Step 2: Run it and see it fail, implement, see it pass** — `npx nx test
      web-feature-repository-screen`.
- [ ] **Step 3: Write the end-to-end tests**: `AC-EDIT-001.1: shows the preview
      beside the editor`; `AC-EDIT-001.14` in the browser; `AC-EDIT-001.15: runs
      no script or handler from the file`; `AC-EDIT-001.16: updates a 200 KB
      file's preview within 300 ms after typing stops` (Chromium, CPU slowed 4×,
      measured from the last keystroke to the block's DOM change with a
      `MutationObserver`); `AC-EDIT-001.18: follows a relative, a fragment and
      an external link`; `AC-EDIT-001.19: shows an Arabic paragraph right to
      left in the editor and the preview`; `AC-EDIT-002.13` and `AC-EDIT-002.14`
      in the browser; `AC-EDIT-002.15: shows removed tags in the editor and
      saves the file unchanged`; `AC-EDIT-002.16: renders the XSS corpus with no
      CSP violation` (`securitypolicyviolation` listener added with
      `page.addInitScript`; no dialog; in every browser of the matrix);
      `AC-EDIT-001.24: has no axe violations in the preview`.
- [ ] **Step 4: Run them** — `npx nx e2e web-e2e`; all pass in the NF-12.2
      matrix.
- [ ] **Step 5: Update the status**: REQ-EDIT-001 adds ED-26 to ED-28, ED-30 to
      ED-33, ED-37 and ED-39 (ED-34 to ED-36 come with plan 31); REQ-EDIT-002 →
      **Built** or **Done** as its criteria say; Built in adds
      `preview-component`. Run `doc-ids.mjs criteria` and copy its result.
- [ ] **Step 6: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit
      `feat(repository-screen): show the live preview`.
