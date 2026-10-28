# web-code-editor

CodeMirror 6 as the editor of the web client (A-8.11). Loaded only from lazy
code (ED-4, NF-2.9).

- `createEditorState`: a file's editor state with exactly the extensions of
  A-8.11, no `basicSetup` and nothing that changes the text on its own (ED-9).
  `setHighlighting` and `setReadOnly` switch Markdown highlighting (ED-9a) and
  read-only through compartments, keeping the undo history (ED-8).
  `contentOf` returns the text with `\n` line breaks.
- `CodeEditorComponent` (`ce-code-editor`): the one `EditorView`. It shows the
  `state` it is given and emits `stateChange` after every transaction, so that
  the caller keeps one state per file (A-8.15). `openSearch`, `focus`,
  `scrollToLine` and `topLine` for the screens around it. Keeps the cursor
  above the on-screen keyboard (ED-15) and gives CodeMirror's style element the
  page's `CSP_NONCE` (NF-11.1).
- `editorTheme` (`theme/editor-theme.ts`): CodeMirror's parts on the `ui`
  tokens. Syntax colours are CSS classes (`classHighlighter` plus `tok-quote`,
  `tok-monospace`, `tok-mark`, `tok-tagName` and `tok-attributeName`), styled
  by the component's stylesheet on the `--ui-syntax-*` tokens (A-10.14).

## Running unit tests

Run `nx test web-code-editor` to execute the unit tests.
