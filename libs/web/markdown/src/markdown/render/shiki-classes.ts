import type { ShikiTransformer, ThemeRegistration } from 'shiki/core';

/**
 * The syntax tokens (A-10.14) that code blocks use, each with the TextMate
 * scopes it colours. The editor uses the same tokens, so the editor and the
 * preview match in both schemes.
 */
const SCOPES = {
  comment: [ 'comment', 'punctuation.definition.comment' ],
  keyword: [ 'keyword', 'storage', 'constant.language', 'variable.language' ],
  punctuation: [ 'punctuation', 'keyword.operator', 'meta.brace' ],
  string: [ 'string', 'string.regexp', 'punctuation.definition.string', 'constant.character.escape' ],
  number: [ 'constant.numeric', 'constant.other', 'support.constant' ],
  function: [ 'entity.name.function', 'support.function', 'meta.function-call.generic' ],
  type: [ 'entity.name.type', 'entity.name.class', 'entity.other.inherited-class', 'support.type', 'support.class' ],
  meta: [
    'meta.preprocessor',
    'meta.annotation',
    'meta.decorator',
    'support.type.property-name',
    'entity.name.tag.yaml'
  ],
  'html-tag': [ 'entity.name.tag', 'punctuation.definition.tag' ],
  'html-attribute': [ 'entity.other.attribute-name' ],
  heading: [ 'markup.heading', 'entity.name.section', 'punctuation.definition.heading' ],
  strong: [ 'markup.bold' ],
  emphasis: [ 'markup.italic' ],
  quote: [ 'markup.quote' ],
  code: [ 'markup.inline.raw', 'markup.fenced_code', 'markup.raw' ],
  'list-marker': [ 'punctuation.definition.list', 'beginning.punctuation.definition.list' ],
  link: [ 'string.other.link', 'markup.underline.link.image' ],
  url: [ 'markup.underline.link' ]
} as const;

type SyntaxToken = keyof typeof SCOPES;

/** The syntax tokens that highlighting's classes name, each coloured by the preview's stylesheet. */
export const SYNTAX_TOKENS = Object.keys(SCOPES) as SyntaxToken[];

const TOKEN_COLOUR = /^var\(--ui-syntax-([a-z-]+)\)$/;

/**
 * Shiki's theme for the preview: every colour is a syntax token, never a
 * colour of its own, so code blocks follow the design system in both
 * schemes (A-10.14).
 */
export const SYNTAX_THEME: ThemeRegistration = {
  name: 'front-burner',
  type: 'light',
  fg: 'var(--ui-text-default)',
  bg: 'transparent',
  settings: (Object.entries(SCOPES) as [ SyntaxToken, readonly string[] ][]).map(([ token, scope ]) => ({
    scope: [ ...scope ],
    settings: { foreground: `var(--ui-syntax-${token})` }
  }))
};

/**
 * Replaces every token's colour with a class `sk-<token>`, and Shiki's own
 * markup with none, so that neither sanitising step nor the content security
 * policy has to allow `style` (D-7.5, A-8.12). The preview's stylesheet
 * colours the classes with the tokens.
 */
export const shikiClasses: ShikiTransformer = {
  name: 'front-burner:classes',
  pre(node) {
    node.properties = {};
  },
  code(node) {
    node.properties = { className: [ `language-${this.options.lang}` ] };
  },
  line(node) {
    node.properties = {};
  },
  span(node, _line, _column, _lineElement, token) {
    const name = TOKEN_COLOUR.exec(token.color ?? '')?.[1];
    node.properties = name && Object.hasOwn(SCOPES, name) ? { className: [ `sk-${name}` ] } : {};
  }
};
