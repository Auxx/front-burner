# Preview Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 29 of [the step 2 index](2026-10-28-00-roadmap-step-2.md): the
preview's rendering runs in a Web Worker, block by block, with fenced code
highlighted by Shiki as CSS classes. On each update only the blocks the page
does not hold yet are rendered, so a 200 KB file's preview can follow typing
within NF-2.5.

**Architecture:** In `web/markdown`. A line scanner splits the source into
top-level blocks keyed by a hash of their text (A-8.12). The worker renders new
blocks through plan 28's pipeline plus Shiki and heading IDs, and answers with
the new layout (keys and line ranges), the HTML of new blocks, the file's
removal report and any new CSS classes. A `PreviewRenderer` on the main thread
debounces updates, talks to the worker through a Trusted Types policy (A-8.13),
and drops answers that a newer update has overtaken. DOMPurify and the DOM are
plan 30's.

**As built:** the renderer is `PreviewRendererService` (the service generator's
name). It keeps the HTML of an overtaken answer, since the worker will not send
those blocks again, and shows only the latest answer. Each `SourceBlock` also
lists its `footnotes` (label, number in the file, first reference), and a
block's key includes them, so a renumbered footnote re-renders the blocks that
use it. `createBlockRenderer` takes the on-demand languages as an option, so a
test can make one fail to load. Footnote IDs and labels are normalised as remark
does, with `micromark-util-normalize-identifier` and
`micromark-util-sanitize-uri`; heading slugs come from `github-slugger`. The 1
MB test takes the best of a few runs and allows linear growth on a busy machine,
since a bare 50 ms limit failed under load.

**Tech Stack:** `shiki` (`shiki/core`, the JavaScript regex engine) and
`@shikijs/rehype`, installed with `npm install --save-exact`.

**Spec:** `docs/requirements/editor.md` (REQ-EDIT-001: ED-26 to ED-29; criteria
14 and 17 at the HTML level); `preview-html.md` SH-5;
`docs/architecture/decisions.md` D-7.3 to D-7.5; `web-client.md` A-8.12, A-8.13.

## Global Constraints

- The shared constraints of [the step 2 index](2026-10-28-00-roadmap-step-2.md)
  apply.
- **Blocks** (A-8.12): a block ends before a non-indented line after a blank
  line, unless that line continues a list item, and before an ATX heading; never
  inside a fenced code block or a multi-line raw HTML block. Front matter at the
  start is not a block. Every link reference definition of the file is appended
  to every block when it is rendered, and a block's key is the hash of its text
  plus the definitions it uses, so a changed definition re-renders the blocks
  that use it.
- **Footnotes** _(plan's call: per-block rendering would number them from 1 in
  every block and repeat the list)_: the worker numbers footnote references in
  the order they first appear in the whole file; each block is rendered with the
  definitions it references, with those numbers, and without a footnote list;
  one last block, keyed by the definitions and their order, renders the list of
  every footnote.
- **Heading IDs**: GitHub's slugs with the `user-content-` prefix, computed per
  block; plan 30's component de-duplicates them in document order.
- **Shiki** (D-7.5): `shiki/core`, `createJavaScriptRegexEngine`, one
  highlighter created once in the worker, `@shikijs/rehype` with its `cache`.
  Themes `github-light` and `github-dark`. Bundled languages: `javascript`,
  `typescript`, `json`, `yaml`, `shellscript`, `html`, `css`, `markdown`; every
  other language of Shiki's bundled list is loaded on demand when a block names
  it; an unknown language (such as `mermaid`) stays a plain code block. A
  transformer of our own replaces every token's colours with a class `sk-<n>`,
  one per (light, dark) colour pair, and the worker sends the CSS rule `.sk-<n>
  { color: light-dark(<light>, <dark>) }` once per new class. Shiki runs after
  sanitising, so the file can never pass for its classes (SH-5).
- **Debounce** (A-8.12): 100 ms after the last change for files up to 256 KB, 1
  s above.
- **Worker** (A-8.13): created as `new Worker(new URL('./preview.worker',
  import.meta.url), { type: 'module' })` with `Worker` shadowed by a subclass
  that passes the URL through the Trusted Types policy `fb-worker`, which allows
  only same-origin `worker-*.js` URLs. `apps/web`'s build gets the export
  conditions `["module", "worker"]`, so that the worker loads the packages'
  worker builds.

## Review Focus

- **A fenced code block with a blank line and an unindented line inside** must
  stay one block, so the preview never shows half a code block → Task 1 test
  `never splits a fenced code block`.
- **A link reference definition at the end of the file used at the start** must
  resolve, and changing its URL must re-render only the blocks that use it →
  Task 1 test `re-keys only the blocks that use a changed definition`.
- **Two answers from the worker arriving out of order** (a slow first render of
  a big file, then a quick second) must not show the older one → Task 3 test
  `drops an answer overtaken by a newer update`.
- **A code block in a language that fails to load** must still render, as plain
  code, and not stop the rest of the preview → Task 2 test `renders a code block
  whose language fails to load as plain code`.
- **Footnotes referenced in two blocks** must be numbered 1 and 2 in file order
  and listed once at the end → Task 2 test `numbers footnotes across blocks and
  lists them once`.

---

### Task 1: Splitting into blocks

**Files:**

- Create: `libs/web/markdown/src/markdown/blocks/split-blocks.ts` (+ `.spec.ts`)

**Interfaces:**

- Produces:
  - `interface SourceBlock { key: string; text: string; fromLine: number;
    toLine: number }` (lines are 1-based and inclusive, in the whole file).
  - `interface SplitSource { blocks: SourceBlock[]; definitions: string;
    footnotes: FootnoteIndex }`; `splitBlocks(source: string): SplitSource`.
    `FootnoteIndex` maps each label to its number in file order and holds the
    definitions' text.

- [ ] **Step 1: Write the failing tests**: one per rule of Global Constraints
      (`ends a block at a blank line`, `keeps a list item's continuation`,
      `starts a block at an ATX heading`, `never splits a fenced code block`,
      `never splits a multi-line HTML block`, `skips front matter`); `gives
      equal text equal keys`; `re-keys only the blocks that use a changed
      definition`; `numbers footnotes in file order`; `splits a 1 MB file within
      50 ms` (desktop; a guard against a quadratic scanner).
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): split the source into blocks`

---

### Task 2: Rendering blocks with Shiki

**Files:**

- Create: `src/markdown/render/render-block.ts`,
  `src/markdown/render/shiki-classes.ts`, `src/markdown/render/footnotes.ts`
  (each + `.spec.ts`)
- Modify: `src/markdown/pipeline/render-safe-html.ts` (shared steps)

**Interfaces:**

- Consumes: plan 28's pipeline steps and `collectRemovals`; Task 1.
- Produces:
  - `interface RenderedBlock { key: string; html: string; removals: [RemovalKey,
    number][] }`.
  - `createBlockRenderer(): Promise<BlockRenderer>`; `BlockRenderer.render(
    block: SourceBlock, split: SplitSource): Promise<RenderedBlock>`;
    `BlockRenderer.renderFootnotes(split: SplitSource): Promise<RenderedBlock |
    null>`; `BlockRenderer.takeCss(): string` (the rules of classes created
    since the last call).

- [ ] **Step 1: Write the failing tests**: `AC-EDIT-001.14: renders headings,
      lists, tables, task lists, strikethrough, autolinks, footnotes and
      highlighted code, without front matter, and a mermaid block as code`;
      `uses classes, never style attributes, for highlighting`; `creates one
      class per colour pair and its CSS once`; `loads a language on demand`;
      `renders a code block whose language fails to load as plain code`;
      `numbers footnotes across blocks and lists them once`; `prefixes heading
      IDs`; `AC-EDIT-001.17: shows mdx import lines as text`.
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass** — same command.
- [ ] **Step 5: Commit** — `feat(markdown): render blocks with Shiki`

---

### Task 3: The worker and the renderer

**Files:**

- Create: `src/markdown/worker/preview.worker.ts`,
  `src/markdown/worker/preview-protocol.ts`,
  `src/markdown/worker/preview-session.ts` (+ `.spec.ts`),
  `src/markdown/worker/create-preview-worker.ts` (+ `.spec.ts`),
  `src/markdown/services/preview-renderer.ts` (+ `.spec.ts`)
- Modify: `apps/web/project.json` (export conditions),
  `libs/web/markdown/src/index.ts`

**Interfaces:**

- Produces:
  - Protocol: `PreviewRequest = { type: 'update'; id: number; source: string } |
    { type: 'reset' }`; `PreviewResponse = { type: 'update'; id: number; layout:
    { key: string; fromLine: number; toLine: number }[]; rendered:
    RenderedBlock[]; removals: [RemovalKey, number][]; css: string } | { type:
    'error'; id: number; message: string }`.
  - `PreviewSession` — the worker's logic without the worker: `update(source):
    Promise<PreviewResponse>`; remembers the keys of its last layout and renders
    only keys that are new; `reset()` forgets them (a new file, or a page that
    dropped its blocks).
  - `createPreviewWorker(): Worker` — A-8.13's policy and URL.
  - `interface PreviewSource { version: Signal<number>; read: () => string }` —
    the editor bumps `version` on each change; the text is read only when the
    debounce ends, so typing never copies a 1 MB string (NF-2.4).
  - `PreviewRenderer` (not provided in root; one per preview): `connect(source:
    PreviewSource): Signal<PreviewState | null>` where `PreviewState = { layout;
    rendered: ReadonlyMap<string, string>; removals: RemovalReport; css: string;
    id: number }`; debounces as Global Constraints say; drops overtaken answers;
    `reset()` when the file changes; terminates the worker when destroyed.

- [ ] **Step 1: Write the failing tests**: session: `renders only new blocks`;
      `renders everything again after reset`; `reports the whole file's
      removals`; renderer (fake worker): `waits 100 ms, or 1 s above 256 KB`;
      `reads the text once per update, not per change`; `drops an answer
      overtaken by a newer update`; `terminates the worker`; worker factory:
      `refuses a worker URL from another origin` (the policy).
- [ ] **Step 2: Run them and see them fail** — `npx nx test web-markdown`.
- [ ] **Step 3: Implement**; add the export conditions.
- [ ] **Step 4: Run them and see them pass** — `npx nx run-many -t test build -p
      web-markdown web`.
- [ ] **Step 5: Commit** — `feat(markdown): render the preview in a worker`

---

### Task 4: Status

**Files:**

- Modify: `docs/architecture/web-client.md` (A-8.12: the footnote and heading ID
  decisions), `docs/product/mvp.md`

- [ ] **Step 1: Record the decisions**: add to A-8.12 that footnotes are
      numbered across blocks by the worker and listed in one last block, and
      that heading IDs are de-duplicated by the preview component.
- [ ] **Step 2: Update the status**: REQ-EDIT-001 notes ED-26 to ED-29 as built
      in the library, shown from plan 30. Run `doc-ids.mjs check` and
      `doc-ids.mjs criteria` and copy the latter's result.
- [ ] **Step 3: Format, check and commit** — `npx dprint fmt && npx dprint
      check`; `npx nx affected -t lint test build`; commit `docs: record the
      preview pipeline's decisions`.
