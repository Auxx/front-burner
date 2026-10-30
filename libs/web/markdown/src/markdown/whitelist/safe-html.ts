// The safe HTML whitelist of the live preview (REQ-EDIT-002).
//
// SECURITY: this is the one place that decides which HTML a Markdown file can
// put on the page (SH-2). Both sanitising steps, rehype-sanitize and DOMPurify,
// are derived from it (derive.ts), so a change here is a security change and
// is reviewed as one.

/**
 * The markup that the pipeline itself produces from Markdown syntax (SH-5):
 * footnotes and task lists. It is kept only on elements that the pipeline
 * made, never on raw HTML written in the file. Names are HTML attribute names.
 * The task list checkbox needs nothing here: `input` as SH-12 allows it is
 * exactly what the pipeline produces.
 */
export interface PipelineMarkup {
  /** Attributes per tag, apart from `class`. */
  attributes: Readonly<Record<string, readonly string[]>>;
  /** `class` values per tag. */
  classes: Readonly<Record<string, readonly string[]>>;
}

/** The whitelist. Names are HTML tag and attribute names, in lower case. */
export interface SafeHtmlWhitelist {
  /** Allowed tags (SH-6). */
  tags: readonly string[];
  /** Tags removed together with their content (SH-9); every other tag that is not allowed keeps its content (SH-8). */
  contentRemovedTags: readonly string[];
  /** Attributes allowed on every allowed tag (SH-11). */
  globalAttributes: readonly string[];
  /** Attributes allowed on some tags only (SH-11, SH-12). */
  attributes: Readonly<Record<string, readonly string[]>>;
  /** Tags allowed only inside one of these tags (SH-11). */
  ancestors: Readonly<Record<string, readonly string[]>>;
  /** The values an attribute may have; any other value removes it (SH-11, SH-13). */
  values: Readonly<Record<string, RegExp>>;
  /**
   * Values that remove any attribute, as text that could close the markup
   * around it. DOMPurify removes them on its own (`SAFE_FOR_XML`), so the first
   * step removes them too, and both steps agree.
   */
  unsafeValue: RegExp;
  /** The schemes an address may have, besides relative addresses (SH-15). */
  protocols: Readonly<Record<AddressAttribute, readonly string[]>>;
  /** `input` is allowed only with this `type`, and always gets the `required` attributes (SH-12). */
  input: { type: string; required: readonly string[]; };
  /** The prefix of every `id` and `name` (SH-14). */
  idPrefix: string;
  pipeline: PipelineMarkup;
}

/** Attributes that hold an address. */
export type AddressAttribute = 'href' | 'src' | 'srcset' | 'cite';

/** The pipeline's own markup (SH-5), as `remark-rehype` produces it. */
export const PIPELINE_MARKUP: PipelineMarkup = {
  attributes: {
    a: [ 'id', 'data-footnote-ref', 'data-footnote-backref', 'aria-describedby', 'aria-label' ],
    h2: [ 'id' ],
    li: [ 'id' ],
    section: [ 'data-footnotes' ]
  },
  classes: {
    a: [ 'data-footnote-backref' ],
    h2: [ 'sr-only' ],
    li: [ 'task-list-item' ],
    ol: [ 'contains-task-list' ],
    section: [ 'footnotes' ],
    ul: [ 'contains-task-list' ]
  }
};

const ALIGNED = [ 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'td', 'th', 'tr' ];

/** Attributes per tag, built from SH-11's table, which lists tags per attribute. */
function attributesByTag(
  rows: readonly (readonly [ readonly string[], readonly string[] ])[]
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [ tags, attributes ] of rows) {
    for (const tag of tags) {
      result[tag] = [ ...new Set([ ...(result[tag] ?? []), ...attributes ]) ];
    }
  }
  return result;
}

export const SAFE_HTML: SafeHtmlWhitelist = {
  tags: [
    // Headings
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    // Blocks
    'p',
    'div',
    'blockquote',
    'pre',
    'hr',
    'figure',
    'figcaption',
    'details',
    'summary',
    'section',
    // Lists
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    // Tables
    'table',
    'caption',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    // Inline formatting
    'b',
    'strong',
    'i',
    'em',
    's',
    'strike',
    'del',
    'ins',
    'mark',
    'small',
    'sub',
    'sup',
    'q',
    'cite',
    'dfn',
    'abbr',
    'time',
    // Code and keys
    'code',
    'kbd',
    'samp',
    'var',
    'tt',
    // Text direction
    'bdo',
    'span',
    'br',
    'wbr',
    'ruby',
    'rt',
    'rp',
    // Links and images
    'a',
    'img',
    'picture',
    'source',
    // Task lists, only as a disabled checkbox (SH-12)
    'input'
  ],
  contentRemovedTags: [
    'script',
    'noscript',
    'style',
    'template',
    'textarea',
    'title',
    'iframe',
    'object',
    'embed',
    'svg',
    'math'
  ],
  globalAttributes: [ 'dir', 'lang', 'title', 'id', 'name' ],
  attributes: attributesByTag([
    [ [ 'a' ], [ 'href' ] ],
    [ [ 'img' ], [ 'src', 'alt', 'width', 'height', 'align' ] ],
    // Only inside `picture` (SH-11).
    [ [ 'source' ], [ 'srcset', 'media', 'type', 'width', 'height' ] ],
    [ ALIGNED, [ 'align' ] ],
    [ [ 'table', 'td', 'th' ], [ 'width' ] ],
    [ [ 'td', 'th' ], [ 'colspan', 'rowspan', 'valign', 'headers', 'scope' ] ],
    [ [ 'ol' ], [ 'start', 'reversed', 'type' ] ],
    [ [ 'li' ], [ 'value' ] ],
    [ [ 'details' ], [ 'open' ] ],
    [ [ 'blockquote', 'q', 'del', 'ins' ], [ 'cite' ] ],
    [ [ 'del', 'ins', 'time' ], [ 'datetime' ] ],
    // Only `language-<name>` (SH-11).
    [ [ 'code' ], [ 'class' ] ],
    // Only `type="checkbox"`, always disabled (SH-12).
    [ [ 'input' ], [ 'type', 'checked', 'disabled' ] ]
  ]),
  ancestors: { source: [ 'picture' ] },
  values: {
    align: /^(?:left|center|right|justify)$/i,
    // Any name, as remark gives it from the info string, such as `ts:app.ts`.
    class: /^language-\S+$/,
    dir: /^(?:ltr|rtl|auto)$/i,
    height: /^\d+%?$/,
    valign: /^(?:top|middle|bottom|baseline)$/i,
    width: /^\d+%?$/
  },
  unsafeValue: /((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i,
  protocols: {
    href: [ 'http', 'https', 'mailto' ],
    src: [ 'http', 'https' ],
    srcset: [ 'http', 'https' ],
    cite: [ 'http', 'https' ]
  },
  input: { type: 'checkbox', required: [ 'disabled' ] },
  idPrefix: 'user-content-',
  pipeline: PIPELINE_MARKUP
};
