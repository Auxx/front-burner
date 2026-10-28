# web-code-editor

CodeMirror 6 as the editor of the web client (A-8.11). Loaded only from lazy
code (ED-4, NF-2.9).

- `createEditorState`: a file's editor state with exactly the extensions of
  A-8.11, no `basicSetup` and nothing that changes the text on its own (ED-9).
  `setHighlighting` and `setReadOnly` switch Markdown highlighting (ED-9a) and
  read-only through compartments, keeping the undo history (ED-8).

## Running unit tests

Run `nx test web-code-editor` to execute the unit tests.
