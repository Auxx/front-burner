# Editor Gutter and Colours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 38 of [the design pass index](2026-10-30-00-design-pass.md): the
editor shows line numbers and marks soft-wrapped lines in its gutter; a **Wrap**
toggle in the toolbar turns soft wrap off and on for the whole screen; dark mode
uses Darcula's syntax colours in the editor and the preview's code.

**Architecture:** `web/code-editor` gets two new extensions (CodeMirror's
`lineNumbers` and a small wrap-marker `gutter`) and a soft-wrap `Compartment`,
switched like highlighting (`setSoftWrap`, as `setHighlighting`). The editor
pane applies a screen-level setting from a new `EditorSettingsService` to every
state it shows, so the choice carries over between files and can later be backed
by the user preference. Darcula's colours become primitives and the dark values
of the syntax and editor tokens. Because A-8.11 says every new extension is
measured, the `typing-test` page gets the same extensions and is re-measured.

**Tech Stack:** CodeMirror 6 (`@codemirror/view` gutters, already installed),
Angular signals, SCSS tokens, `tools/ai-tools`.

**Spec:** [design](../specs/2026-10-30-islands-design-pass-design.md) Per page:
Repository screen (Editor content), Documentation (`editor.md`). ED-10, new
ED-10a, A-8.11, A-10.14, NF-2.4.

## Global Constraints

- The shared constraints of [the index](2026-10-30-00-design-pass.md) apply.
- **Line numbers** always on, in the gutter, in `--ui-editor-line-number`; the
  cursor's line number in `--ui-editor-line-number-active`.
- **Soft wrap** on by default. **Wrap** toggle: a small ghost button with the
  `word-wrap` icon and the text "Wrap", `aria-pressed`, in the toolbar's end
  group before the view modes, shown while the editor is shown. The choice lasts
  until reload, carries over between files, and is one setting for the screen.
- **Wrap marker**: while soft wrap is on, a narrow gutter after the line numbers
  shows the `word-wrap` glyph (or `↪`, builder's call) beside every line whose
  block is taller than one line; nothing while wrap is off. It is `aria-hidden`.
- **Darcula** (IntelliJ's scheme) for the dark values only; keep each colour's
  hue and chroma and raise its lightness only as far as needed for the contrast
  pairs (`colour solve`). Light values do not change.

  | Token(s)                                                 | Darcula                     |
  | -------------------------------------------------------- | --------------------------- |
  | `syntax-heading`, `syntax-keyword`, `syntax-list-marker` | `#CC7832` (keyword, orange) |
  | `syntax-string`, `syntax-quote`                          | `#6A8759` (string, green)   |
  | `syntax-number`                                          | `#6897BB`                   |
  | `syntax-comment`, `syntax-punctuation`                   | `#808080`                   |
  | `syntax-function`                                        | `#FFC66D`                   |
  | `syntax-meta`, `syntax-type`                             | `#BBB529` (metadata)        |
  | `syntax-html-tag`                                        | `#E8BF6A` (markup tag)      |
  | `syntax-html-attribute`                                  | `#BABABA`                   |
  | `syntax-link`, `syntax-url`                              | `#287BDE` (hyperlink)       |
  | `syntax-code`                                            | `#A5C25C`                   |
  | `syntax-strong`, `syntax-emphasis`                       | `text-default` (unchanged)  |
  | `editor-cursor`                                          | `#BBBBBB`                   |
  | `editor-selection`                                       | `#214283`                   |

  _(Plan's call: Darcula has no Markdown-specific colours for most of these;
  this mapping follows how its general colours read.)_ Measured on the new
  island (`#191a1c`): `#6A8759` 4.33, `#808080` 4.41, `#287BDE` 4.13 — these
  three need lightening; the rest pass at 4.5 before the active-line, selection
  and match overlays are checked.

## Review Focus

- **A 1 MB file on a phone** must still type within NF-2.4 with line numbers and
  the wrap marker (Task 5, emulation; the person at the phone repeats it).
- **Toggling Wrap off in a file with a very long line** scrolls sideways inside
  the editor, never the page (Task 3 e2e: page `scrollWidth` equals its
  `clientWidth`).
- **Opening another file after turning Wrap off** keeps it off; reopening the
  first file keeps it off too (Task 3 test).
- **Undo history survives toggling Wrap** (Task 1 test, as for highlighting).
- **Resizing the editor narrower** updates which lines show the wrap marker
  (Task 2 test triggers `geometryChanged`).

---

### Task 1: Line numbers and the soft-wrap compartment

**Files:**

- Modify: `libs/web/code-editor/src/code-editor/state/editor-state.ts`
- Modify: `libs/web/code-editor/src/code-editor/theme/editor-theme.ts`
  (`.cm-gutters` on `--ui-editor-background`, no border; `.cm-lineNumbers`
  colours; `.cm-activeLineGutter`)
- Modify: `libs/web/code-editor/src/index.ts`
- Test: `libs/web/code-editor/src/code-editor/state/editor-state.spec.ts`

**Interfaces:**

- `EditorStateOptions.softWrap?: boolean` (default `true`).
- `setSoftWrap(on: boolean): TransactionSpec`
- `isSoftWrapping(state: EditorState): boolean`
- `lineNumbers()` and `highlightActiveLineGutter()` join A-8.11's list.

- [ ] **Step 1: Failing tests**

```ts
it('wraps by default and can stop without losing the undo history', () => {
  let state = createEditorState({ content: 'a', highlight: true, label: 'x' });
  expect(isSoftWrapping(state)).toBe(true);
  state = state.update({ changes: { from: 1, insert: 'b' } }).state;
  state = state.update(setSoftWrap(false)).state;
  expect(isSoftWrapping(state)).toBe(false);
  expect(undoDepth(state)).toBe(1);
});
it('starts unwrapped when asked', ...);       // softWrap: false
it('shows line numbers', ...);                 // EditorView in the DOM: .cm-lineNumbers has "1", "2"
```

- [ ] **Step 2: Run** `npx nx run web-code-editor:test`; expected FAIL.
- [ ] **Step 3: Implement**: a `softWrap` compartment holding
      `EditorView.lineWrapping` or `[]`; update the comment above
      `createEditorState` (A-8.11 list). **Run**; expected PASS.
- [ ] **Step 4: Commit** `git commit -m "Line numbers and switchable soft wrap
      in the editor state (plan 38)"`.

### Task 2: Wrap marker gutter

**Files:**

- Create: `libs/web/code-editor/src/code-editor/state/wrap-marker.ts`
- Test: `libs/web/code-editor/src/code-editor/state/wrap-marker.spec.ts`
- Modify: `editor-state.ts` (the marker lives in the soft-wrap compartment, so
  it goes away with wrapping)

**Interfaces:**

- `wrapMarker(): Extension` — a `gutter({ class: 'cm-wrapMarkers', lineMarker,
  lineMarkerChange: update => update.geometryChanged || update.docChanged })`
  whose marker is shown when `view.lineBlockAt(line.from).height >
  view.defaultLineHeight * 1.5`.

- [ ] **Step 1: Failing test**: in an `EditorView` 200 px wide with one short
      and one 500-character line, the gutter has exactly one marker, beside the
      second line; with `setSoftWrap(false)` the gutter is gone. (jsdom has no
      layout: stub `lineBlockAt` heights or mark the test as a story/e2e test if
      the existing specs do that; follow how `line-direction` is tested.)
- [ ] **Step 2: Run**; expected FAIL. **Implement**; **run**; expected PASS.
- [ ] **Step 3: Commit** `git commit -m "Soft-wrap marker in the gutter (plan
      38)"`.

### Task 3: The Wrap toggle

**Files:**

- Create (generator, service):
  `libs/web/feature-repository-screen/src/repository-screen/services/editor-settings/editor-settings.service.ts`
  (+ spec)
- Modify: `components/editor-pane/editor-pane.component.{ts,html}` (state
  creation at `:362` passes `softWrap`; the existing `update(...)` adds
  `setSoftWrap` when it differs, as for highlighting)
- Modify: `libs/ui/src/content/models/icon-name.model.ts`, `icons.mjs sprite
  --write` (adds `word-wrap`)
- Modify: `apps/web/public/i18n/en.json`
  (`web-feature-repository-screen.EditorPaneComponent.wrap` = "Wrap")
- Test: `editor-pane.component.spec.ts`, `apps/web-e2e/src/editor.spec.ts`

**Interfaces:**

- `EditorSettingsService` with `readonly softWrap: WritableSignal<boolean>`
  (initially `true`), provided where `ViewModeService` is provided, so it lives
  as long as the repository screen.

- [ ] **Step 1: Failing tests**: the toolbar has a "Wrap" button with
      `aria-pressed="true"`; clicking it sets `aria-pressed="false"` and the
      shown state stops wrapping; opening another file keeps it off; the Review
      Focus e2e (no page-level sideways scroll with a long line, Wrap off).
- [ ] **Step 2: Run**; expected FAIL. **Implement**; **run**; expected PASS.
- [ ] **Step 3: Screenshot** with Wrap on and off; compare with
      `repo-screen-v2.html`.
- [ ] **Step 4: Commit** `git commit -m "Wrap toggle in the editor toolbar (plan
      38)"`.

### Task 4: Darcula colours

**Files:**

- Modify: `libs/ui/src/styles/tokens/_primitives.scss` (a `darcula-*` group:
  `darcula-orange`, `darcula-green`, `darcula-blue`, `darcula-grey`,
  `darcula-yellow`, `darcula-olive`, `darcula-gold`, `darcula-silver`,
  `darcula-link`, `darcula-lime`, `darcula-caret`, `darcula-selection`, as
  OKLCH)
- Modify: `libs/ui/src/styles/tokens/_syntax.scss`, `_color.scss` (editor
  tokens)
- Modify: `tools/ai-tools/src/lib/*` only if the tokens parser refuses the named
  primitives (with a spec)
- Modify: `docs/architecture/design-system.md` A-10.14

- [ ] **Step 1: Find the lightness each colour needs**

For each of the three failing colours: `node tools/ai-tools/src/bin/colour.mjs
solve surface-island editor-selection --hue <h> --chroma <c> --min 4.5 --scheme
dark` (h and c from `colour.mjs convert`). Take the lowest passing lightness.

- [ ] **Step 2: `tokens.mjs try`** the full mapping
      (`syntax-string@dark=darcula-green`, …, with candidate values set by
      `--set`); expected exit 0.
- [ ] **Step 3: Edit the SCSS**; run `npx nx run ai-tools:test`; expected PASS.
- [ ] **Step 4: Screenshot** the editor and a preview code block in dark mode.
- [ ] **Step 5: A-10.14**: "Dark syntax colours follow IntelliJ's Darcula
      scheme, lightened where the contrast pairs need it; light colours are
      unchanged."
- [ ] **Step 6: Commit** `git commit -m "Darcula syntax colours in dark mode
      (plan 38)"`.

### Task 5: Typing check and requirements

**Files:**

- Modify: `tools/ai-tools/src/lib/typing-test.mjs`, `typing-test-site.mjs`,
  `typing-test.spec.mjs` (add `linenumbers` and `wrapmarker` to `SWITCHES`, both
  on by default; `SETUPS` adds `['linenumbers', 'wrapmarker']`)
- Modify: `.claude/skills/ai-tools/references/tools.md` (`typing-test` switches)
- Modify: `docs/architecture/spikes.md` (spike 3: a dated note with the new
  emulation numbers), `docs/architecture/web-client.md` (A-8.11 extension list)
- Modify: `docs/requirements/editor.md` (ED-10, new ED-10a, Out of scope)
- Modify: `docs/product/mvp.md` "Implementation status", if ED-10 is listed

- [ ] **Step 1: Failing spec**: `SWITCHES` has `linenumbers` and `wrapmarker`;
      every `SETUPS` entry names known switches (the existing check covers it).
      **Run** `npx nx run ai-tools:test`; FAIL; **implement**; PASS.
- [ ] **Step 2: Measure in emulation**: `node
      tools/ai-tools/src/bin/typing-test.mjs serve`, Chromium, Pixel 7, CPU 4×,
      `1mb.md`, with everything on, then with `off=linenumbers,wrapmarker`.
      Expected: the median within a few ms of the 2026-10-28 run (30 ms median,
      43 ms max). Record both runs in spike 3. If the median rises by more than
      10 ms, stop and report to the user before going on.
- [ ] **Step 3: Requirements**:
  - **ED-10** "Long lines wrap softly by default; the file is not changed by
    wrapping. A **Wrap** button in the editor's toolbar turns soft wrap off and
    on, and the gutter marks the lines that wrap. The choice is a user
    preference, one for all of the user's repositories, remembered once the
    Preferences page exists; until then it lasts until the page is reloaded. The
    browser's spell check and, on phones, autocorrect are on. _(My call.)_"
  - **ED-10a** "The editor shows line numbers in a gutter."
  - Add to "Out of scope": "Remembering the soft-wrap choice, which comes with
    the Preferences page (CA-9)."
- [ ] **Step 4: Finish**: `doc-ids.mjs check`; `npx nx affected -t
      lint,test,build`; `npx nx format:write`; index row **Done**. Tell the user
      that A-8.11 asks for the phone check to be repeated
      (`docs/wiki/typing-test.md`) and that it is theirs to run.
- [ ] **Step 5: Commit** `git commit -m "Typing check and requirements for line
      numbers and the Wrap toggle (plan 38)"`.
