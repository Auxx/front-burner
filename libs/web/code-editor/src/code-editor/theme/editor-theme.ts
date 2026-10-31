import { EditorView } from '@codemirror/view';

// CodeMirror's own parts on the `ui` tokens, so that the editor follows the colour scheme
// (ED-14). The rules go in CodeMirror's style element, which gets the CSP nonce (NF-11.1);
// the syntax classes are styled by the component's stylesheet.
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--ui-text-default)',
    backgroundColor: 'var(--ui-editor-background)',
    fontFamily: 'var(--ui-font-family-mono)',
    fontSize: 'var(--ui-font-size-md)'
  },
  // The focus ring (A-10.30), inside the editor so that the pane around it does not clip it.
  '&.cm-focused': {
    outline: 'var(--ui-focus-ring-width) solid var(--ui-border-focus)',
    outlineOffset: 'calc(-1 * var(--ui-focus-ring-width))'
  },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'var(--ui-line-height-code)' },
  '.cm-content': { padding: 'var(--ui-space-3) 0', caretColor: 'var(--ui-editor-cursor)' },
  '.cm-gutters': {
    color: 'var(--ui-editor-line-number)',
    backgroundColor: 'var(--ui-editor-background)',
    border: 'none'
  },
  '.cm-lineNumbers .cm-gutterElement': { color: 'var(--ui-editor-line-number)' },
  '.cm-activeLineGutter': {
    color: 'var(--ui-editor-line-number-active)',
    backgroundColor: 'transparent'
  },
  '.cm-activeLineGutter.cm-gutterElement': { color: 'var(--ui-editor-line-number-active)' },
  '.cm-line': { padding: '0 var(--ui-space-4)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ui-editor-cursor)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--ui-editor-selection)'
  },
  '.cm-searchMatch, .cm-searchMatch-selected': { backgroundColor: 'var(--ui-editor-match)' },
  '.cm-searchMatch-selected': { outline: '1px solid var(--ui-border-strong)' },
  '.cm-panels': {
    color: 'var(--ui-text-default)',
    backgroundColor: 'var(--ui-surface-island)',
    fontFamily: 'var(--ui-font-family-sans)'
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--ui-border-default)' },
  '.cm-textfield, .cm-button': {
    color: 'var(--ui-text-default)',
    backgroundColor: 'var(--ui-surface-sunken)',
    backgroundImage: 'none',
    border: '1px solid var(--ui-border-default)',
    borderRadius: 'var(--ui-radius-control)',
    fontSize: 'var(--ui-font-size-sm)'
  },
  '.cm-textfield:focus-visible, .cm-button:focus-visible, .cm-panel.cm-search input[type=checkbox]:focus-visible, .cm-panel.cm-search [name=close]:focus-visible':
    {
      outline: 'var(--ui-focus-ring-width) solid var(--ui-border-focus)',
      outlineOffset: 'var(--ui-focus-ring-offset)'
    },
  '.cm-panel.cm-search [name=close]': { color: 'var(--ui-text-muted)' }
});
