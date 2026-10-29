import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  Text,
  type TransactionSpec
} from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { classHighlighter, tagHighlighter, tags } from '@lezer/highlight';
import { editorTheme } from '../theme/editor-theme';

export interface EditorStateOptions {
  content: string;
  /** Markdown and front matter highlighting; off for large files on narrow screens (ED-9a). */
  highlight: boolean;
  readOnly?: boolean;
  /** The editor's accessible name: the open file's name (ED-37). */
  label: string;
  /**
   * Where the cursor starts, as close to this line and column (1-based) as
   * the text allows, such as after the file was reloaded (ED-24); at the start
   * without it.
   */
  cursor?: CursorPosition;
}

/** A position in the text by line and column, both 1-based. */
export interface CursorPosition {
  line: number;
  column: number;
}

// The Markdown language, without languages for fenced code and without its keymap, which
// continues lists on Enter (ED-9).
const language = yamlFrontmatter({ content: markdown({ codeLanguages: [], addKeymap: false }) });

// The Markdown tags that `classHighlighter` has no class for. Both highlighters run in the
// same pass over the syntax tree, so this costs no extra work while typing.
const markdownHighlighter = tagHighlighter([
  { tag: tags.quote, class: 'tok-quote' },
  { tag: tags.monospace, class: 'tok-monospace' },
  { tag: tags.processingInstruction, class: 'tok-mark' },
  { tag: tags.tagName, class: 'tok-tagName' },
  { tag: tags.attributeName, class: 'tok-attributeName' }
]);

const highlighting = new Compartment();
const readOnly = new Compartment();
const label = new Compartment();

const readOnlyExtension: Extension = [ EditorState.readOnly.of(true), EditorView.editable.of(false) ];

/** Replaces the selection with a tab, also when it spans lines (ED-11). */
const insertTabCharacter: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) {
    return false;
  }
  dispatch(state.update(state.replaceSelection('\t'), { scrollIntoView: true, userEvent: 'input' }));
  return true;
};

// Enter and Tab insert exactly what they say. They come before `defaultKeymap`, whose Enter
// indents the new line and clears a line of spaces, and they replace `indentWithTab`, which
// indents the whole line (ED-9, ED-11, ED-12). `Esc` then `Tab` still moves the focus out:
// CodeMirror handles that before any binding (NF-13.3).
const exactKeys = [
  { key: 'Enter', run: insertNewline, shift: insertNewline },
  { key: 'Tab', run: insertTabCharacter }
];

function labelExtension(text: string): Extension {
  return EditorView.contentAttributes.of({ 'aria-label': text });
}

/**
 * A file's editor state with exactly the extensions of A-8.11, the setup that spike 3
 * measured on a real phone. Nothing in it changes the text on its own (ED-9): adding an
 * extension means measuring again with the `typing-test` tool.
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  const doc = Text.of(options.content.split(/\r\n?|\n/));
  return EditorState.create({
    doc,
    selection: options.cursor ? EditorSelection.cursor(offsetOf(doc, options.cursor)) : undefined,
    extensions: [
      history(),
      drawSelection(),
      search({ top: true }),
      keymap.of([ ...exactKeys, ...defaultKeymap, ...historyKeymap, ...searchKeymap ]),
      highlighting.of(options.highlight ? language : []),
      syntaxHighlighting(classHighlighter),
      syntaxHighlighting(markdownHighlighter),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      EditorView.contentAttributes.of({
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences'
      }),
      label.of(labelExtension(options.label)),
      readOnly.of(options.readOnly ? readOnlyExtension : []),
      editorTheme
    ]
  });
}

/** Switches highlighting without recreating the state, so the undo history stays (ED-8, ED-9a). */
export function setHighlighting(on: boolean): TransactionSpec {
  return { effects: highlighting.reconfigure(on ? language : []) };
}

export function isHighlighting(state: EditorState): boolean {
  return highlighting.get(state) === language;
}

export function setReadOnly(on: boolean): TransactionSpec {
  return { effects: readOnly.reconfigure(on ? readOnlyExtension : []) };
}

/** Replaces the whole text as one undoable edit, such as with a restored browser draft (ED-7). */
export function replaceContent(state: EditorState, content: string): TransactionSpec {
  return { changes: { from: 0, to: state.doc.length, insert: content }, userEvent: 'input.replace' };
}

/** Renames the editor (ED-37) without recreating the state, so the undo history stays. */
export function setLabel(text: string): TransactionSpec {
  return { effects: label.reconfigure(labelExtension(text)) };
}

/** The text with `\n` line breaks; the file's own line ending is added back on save. */
export function contentOf(state: EditorState): string {
  return state.doc.toString();
}

/** The line and column (1-based) of the cursor, the head of the main selection. */
export function cursorOf(state: EditorState): CursorPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

/** The offset of `position` in `doc`, on its last line or at the end of its line when they are shorter. */
function offsetOf(doc: Text, position: CursorPosition): number {
  const line = doc.line(Math.min(Math.max(1, Math.round(position.line)), doc.lines));
  return line.from + Math.min(Math.max(0, Math.round(position.column) - 1), line.length);
}
