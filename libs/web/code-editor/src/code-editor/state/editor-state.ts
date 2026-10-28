import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';

export interface EditorStateOptions {
  content: string;
  /** Markdown and front matter highlighting; off for large files on narrow screens (ED-9a). */
  highlight: boolean;
  readOnly?: boolean;
  /** The editor's accessible name: the open file's name (ED-37). */
  label: string;
  /** The page's CSP nonce for CodeMirror's style element (NF-11.1). */
  nonce?: string;
}

// The Markdown language, without languages for fenced code and without its keymap, which
// continues lists on Enter (ED-9).
const language = yamlFrontmatter({ content: markdown({ codeLanguages: [], addKeymap: false }) });

const highlighting = new Compartment();
const readOnly = new Compartment();

const readOnlyExtension: Extension = [ EditorState.readOnly.of(true), EditorView.editable.of(false) ];

/**
 * A file's editor state with exactly the extensions of A-8.11, the setup that spike 3
 * measured on a real phone. Nothing in it changes the text on its own (ED-9): adding an
 * extension means measuring again with the `typing-test` tool.
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return EditorState.create({
    doc: options.content,
    extensions: [
      history(),
      drawSelection(),
      search({ top: true }),
      keymap.of([ ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab ]),
      highlighting.of(options.highlight ? language : []),
      syntaxHighlighting(classHighlighter),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      EditorView.contentAttributes.of({
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
        'aria-label': options.label
      }),
      readOnly.of(options.readOnly ? readOnlyExtension : []),
      EditorView.cspNonce.of(options.nonce ?? '')
    ]
  });
}

/** Switches highlighting without recreating the state, so the undo history stays (ED-8, ED-9a). */
export function setHighlighting(_state: EditorState, on: boolean): TransactionSpec {
  return { effects: highlighting.reconfigure(on ? language : []) };
}

export function isHighlighting(state: EditorState): boolean {
  return highlighting.get(state) === language;
}

export function setReadOnly(_state: EditorState, on: boolean): TransactionSpec {
  return { effects: readOnly.reconfigure(on ? readOnlyExtension : []) };
}

/** The text with `\n` line breaks; the file's own line ending is added back on save. */
export function contentOf(state: EditorState): string {
  return state.doc.toString();
}
