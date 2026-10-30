import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Root } from 'hast';
import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { unified } from 'unified';
import { hashKey, type SourceBlock, type SplitSource } from '../blocks/split-blocks';
import { collectRemovals, type RemovalKey } from '../pipeline/collect-removals';
import { classesOf, visitElements } from '../pipeline/elements';
import { hastToHtml, markdownToHast, sanitizeHast } from '../pipeline/render-safe-html';
import { SAFE_HTML } from '../whitelist/safe-html';
import { footnoteListSource, footnoteStubs, keepFootnoteList, renumberFootnotes } from './footnotes';
import { createShikiClasses } from './shiki-classes';

/** A block's HTML, sanitised once (A-8.12), and what was removed from it. */
export interface RenderedBlock {
  key: string;
  html: string;
  removals: [ RemovalKey, number ][];
}

export interface BlockRenderer {
  render: (block: SourceBlock, split: SplitSource) => Promise<RenderedBlock>;
  /** The list of every footnote, or `null` when the file references none. */
  renderFootnotes: (split: SplitSource) => Promise<RenderedBlock | null>;
  /** The CSS rules of the highlighting classes created since the last call. */
  takeCss: () => string;
}

/** Languages that Shiki can load, by name and alias. */
export type LanguageLoaders = Readonly<Record<string, LanguageInput>>;

export interface BlockRendererOptions {
  /** The languages loaded on demand; Shiki's bundled list by default. */
  languages?: LanguageLoaders;
}

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

/** The highlighted code blocks kept for blocks rendered again (`@shikijs/rehype`'s `cache`). */
const CACHE_SIZE = 500;

/**
 * Creates the renderer of the preview's blocks, with one Shiki highlighter
 * (D-7.5). A block goes through plan 28's pipeline, gets heading IDs, and is
 * highlighted after sanitising, so the file can never pass for highlighting's
 * classes (SH-5).
 */
export async function createBlockRenderer(options: BlockRendererOptions = {}): Promise<BlockRenderer> {
  const languages = options.languages ?? bundledLanguages;
  const highlighter = await createHighlighterCore({
    themes: [ import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs') ],
    langs: [
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/yaml.mjs'),
      import('shiki/langs/shellscript.mjs'),
      import('shiki/langs/html.mjs'),
      import('shiki/langs/css.mjs'),
      import('shiki/langs/markdown.mjs')
    ],
    engine: createJavaScriptRegexEngine()
  });
  const classes = createShikiClasses();
  const highlight = unified()
    .use(rehypeShikiFromHighlighter, highlighter, {
      themes: THEMES,
      defaultColor: false,
      transformers: [ classes.transformer ],
      cache: new BoundedMap<string, Root>(CACHE_SIZE),
      // A block that Shiki cannot highlight stays a plain code block.
      onError: () => undefined
    })
    .freeze();
  const loadLanguages = languageLoader(highlighter, languages);

  const renderTree = async (markdown: string, key: string, shape: (tree: Root) => void): Promise<RenderedBlock> => {
    const tree = markdownToHast(markdown);
    const removals = collectRemovals(tree);
    const safe = sanitizeHast(tree);
    shape(safe);
    addHeadingIds(safe);
    await loadLanguages(safe);
    const highlighted = highlight.runSync(safe);
    return { key, html: hastToHtml(highlighted), removals: [ ...removals ] };
  };

  return {
    render: (block, split) => {
      const markdown = [ block.text, split.definitions, footnoteStubs(block.footnotes) ].join('\n\n');
      return renderTree(markdown, block.key, tree => renumberFootnotes(tree, block.footnotes));
    },
    renderFootnotes: async split => {
      const markdown = footnoteListSource(split);
      return markdown === null ? null : renderTree(markdown, hashKey('footnotes', markdown), keepFootnoteList);
    },
    takeCss: classes.takeCss
  };
}

/** Loads the languages that a tree's code blocks name, once each; one that fails to load is not tried again. */
function languageLoader(
  highlighter: HighlighterCore,
  languages: LanguageLoaders
): (tree: Root) => Promise<void> {
  const failed = new Set<string>();
  return async tree => {
    const wanted = new Set<string>();
    visitElements(tree, element => {
      const language = codeLanguage(element);
      if (language && Object.hasOwn(languages, language) && !failed.has(language)) {
        wanted.add(language);
      }
    });
    const loaded = highlighter.getLoadedLanguages();
    await Promise.all(
      [ ...wanted ].filter(language => !loaded.includes(language)).map(async language => {
        try {
          await highlighter.loadLanguage(languages[language]);
        } catch {
          failed.add(language);
        }
      })
    );
  };
}

/** The language a `pre`'s code block names, as `@shikijs/rehype` reads it. */
function codeLanguage(element: Element): string | undefined {
  const code = element.tagName === 'pre' ? element.children[0] : undefined;
  if (code?.type !== 'element' || code.tagName !== 'code') {
    return undefined;
  }
  return classesOf(code).find(name => name.startsWith('language-'))?.slice('language-'.length);
}

/**
 * Gives every heading without an `id` GitHub's slug of its text, prefixed
 * like every `id` (SH-14). Slugs are unique within a block; the preview
 * component makes them unique in the file.
 */
function addHeadingIds(tree: Root): void {
  const slugger = new GithubSlugger();
  visitElements(tree, element => {
    if (/^h[1-6]$/.test(element.tagName) && element.properties['id'] === undefined) {
      element.properties['id'] = SAFE_HTML.idPrefix + slugger.slug(textOf(element));
    }
  });
}

function textOf(node: ElementContent | Element): string {
  if (node.type === 'text') {
    return node.value;
  }
  return node.type === 'element' ? node.children.map(textOf).join('') : '';
}

/** A map that forgets its oldest entries beyond a size. */
class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly limit: number) {
    super();
  }

  override set(key: K, value: V): this {
    super.set(key, value);
    if (this.size > this.limit) {
      this.delete(this.keys().next().value as K);
    }
    return this;
  }
}
