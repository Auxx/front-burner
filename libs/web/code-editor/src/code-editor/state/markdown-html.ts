import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import type { Extension } from '@codemirror/state';

// Imported only dynamically, by `loadHtmlInMarkdown` in `editor-state.ts`: `markdown()` brings
// `@codemirror/lang-html` with its CSS and JavaScript grammars, which the build then puts in a
// chunk of their own, loaded after the editor is ready (A-8.11, A-8.18, plan 163). Nothing
// else may import `@codemirror/lang-markdown`, or that chunk would come back into the editor's.

/**
 * The full language: Markdown with HTML tags highlighted, without languages for fenced code
 * and without its keymap, which continues lists on Enter (ED-9), and with front matter.
 */
export const MARKDOWN_WITH_HTML: Extension = yamlFrontmatter({
  content: markdown({ codeLanguages: [], addKeymap: false })
});
