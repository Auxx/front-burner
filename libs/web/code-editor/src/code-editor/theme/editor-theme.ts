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
    fontSize: 'var(--ui-font-size-md)',
    // The find panel slides in from above the editor's top edge, not over what is above it.
    overflow: 'clip'
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
  '.cm-wrapMarkers .cm-gutterElement': {
    color: 'var(--ui-editor-line-number)',
    padding: '0 var(--ui-space-1)'
  },
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
  // The find panel (ED-11) floats over the top end of the text, so the text never moves when
  // it opens. CodeMirror counts its height as a scroll margin, so a match is never under it.
  '.cm-panels.cm-panels-top': {
    position: 'absolute',
    top: '0',
    insetInlineStart: 'auto',
    insetInlineEnd: 'var(--ui-space-3)',
    inlineSize: 'min(28rem, 100% - 2 * var(--ui-space-3))',
    boxSizing: 'border-box',
    color: 'var(--ui-text-default)',
    backgroundColor: 'var(--ui-surface-raised)',
    boxShadow: 'var(--ui-shadow-popover)',
    border: 'none',
    borderRadius: '0 0 var(--ui-radius-popover) var(--ui-radius-popover)',
    fontFamily: 'var(--ui-font-family-sans)',
    fontSize: 'var(--ui-font-size-ui)',
    // No motion when the user asks for less: the duration token is then 0.
    animation: 'fb-find-slide-in var(--ui-duration-base) var(--ui-easing-standard)'
  },
  '@keyframes fb-find-slide-in': {
    from: { transform: 'translateY(-100%)' },
    to: { transform: 'none' }
  },
  '.fb-find': { display: 'flex', gap: 'var(--ui-space-1)', padding: 'var(--ui-space-1)' },
  '.fb-find [hidden]': { display: 'none' },
  '.fb-find-rows': {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: 'var(--ui-space-1)',
    minInlineSize: '0'
  },
  // The rows wrap rather than overflow in a narrow editor.
  '.fb-find-row': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--ui-space-1)' },
  '.fb-find-field': {
    flex: '1 1 8rem',
    minInlineSize: '0',
    minBlockSize: 'var(--ui-control-height-small)',
    boxSizing: 'border-box',
    margin: '0',
    padding: '0 var(--ui-space-2)',
    color: 'var(--ui-text-default)',
    backgroundColor: 'var(--ui-surface-sunken)',
    border: 'var(--ui-border-width) solid var(--ui-border-default)',
    borderRadius: 'var(--ui-radius-control)',
    font: 'inherit',
    fontSize: 'var(--ui-font-size-input)'
  },
  '.fb-find-button': {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: 'var(--ui-control-height-small)',
    blockSize: 'var(--ui-control-height-small)',
    boxSizing: 'border-box',
    margin: '0',
    padding: '0',
    color: 'var(--ui-text-default)',
    backgroundColor: 'transparent',
    border: 'var(--ui-border-width) solid transparent',
    borderRadius: 'var(--ui-radius-control)',
    cursor: 'pointer'
  },
  '.fb-find-button:hover': { backgroundColor: 'var(--ui-surface-hover)' },
  '.fb-find-button:active': { backgroundColor: 'var(--ui-surface-pressed)' },
  '.fb-find-button[aria-pressed=true]': {
    borderColor: 'var(--ui-border-strong)',
    backgroundColor: 'var(--ui-selected-inactive)'
  },
  // The chevron spans both rows, as in VS Code.
  '.fb-find-toggle': { blockSize: 'auto', minBlockSize: 'var(--ui-control-height-small)' },
  '.fb-find-icon': { inlineSize: 'var(--ui-icon-size)', blockSize: 'var(--ui-icon-size)' },
  // Wide enough for "999 of 999", so that the buttons after it do not move while typing.
  '.fb-find-count': {
    flex: 'none',
    minInlineSize: '10ch',
    color: 'var(--ui-text-muted)',
    fontSize: 'var(--ui-font-size-ui-small)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
    whiteSpace: 'nowrap'
  },
  '.fb-find-field:focus-visible, .fb-find-button:focus-visible': {
    outline: 'var(--ui-focus-ring-width) solid var(--ui-border-focus)',
    outlineOffset: 'calc(-1 * var(--ui-focus-ring-width))'
  },
  // Shadows are removed in forced colours, so the panel gets a border; the pressed background
  // is `Highlight` (A-10.22).
  '@media (forced-colors: active)': {
    '.cm-panels.cm-panels-top': { border: 'var(--ui-border-width) solid var(--ui-border-default)' },
    '.fb-find-button[aria-pressed=true]': { color: 'HighlightText' }
  }
});
