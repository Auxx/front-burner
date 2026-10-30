import type { Element, Root } from 'hast';
import { normalizeUri } from 'micromark-util-sanitize-uri';
import type { FootnoteUse, SplitSource } from '../blocks/split-blocks';
import { visitElements } from '../pipeline/elements';
import { SAFE_HTML } from '../whitelist/safe-html';

// Footnotes across blocks (plan 29). Rendered on its own, every block would
// number its footnotes from 1 and list them. Instead, each block is rendered
// with stand-in definitions of the footnotes it references, its references
// are given their numbers in the file, and its list is dropped; one last block
// lists every footnote.

/** Stand-in definitions of a block's footnotes: they make its references links, and their text is dropped. */
export function footnoteStubs(uses: readonly FootnoteUse[]): string {
  return uses.map(use => `[^${use.label}]: -`).join('\n');
}

/** The Markdown of the footnote list: every reference, in number order, then every definition. */
export function footnoteListSource(split: SplitSource): string | null {
  const { numbers, counts, definitions } = split.footnotes;
  if (numbers.size === 0) {
    return null;
  }
  const labels = [ ...numbers.keys() ];
  const references = labels.map(label => `[^${label}]`.repeat(counts.get(label) ?? 1)).join(' ');
  const texts = labels.map(label => definitions.get(label) ?? '');
  return [ references, ...texts, split.definitions ].join('\n\n');
}

/** Gives a block's footnote references their numbers and IDs in the file, and removes its footnote list. */
export function renumberFootnotes(tree: Root, uses: readonly FootnoteUse[]): void {
  if (uses.length === 0) {
    return;
  }
  const byId = new Map(uses.map(use => [ normalizeUri(use.label), use ]));
  const hrefPrefix = `#${SAFE_HTML.idPrefix}fn-`;
  const idPrefix = `${SAFE_HTML.idPrefix}fnref-`;
  visitElements(tree, element => {
    if (element.tagName !== 'a' || element.properties['dataFootnoteRef'] === undefined) {
      return;
    }
    const href = String(element.properties['href'] ?? '');
    const safeId = href.slice(hrefPrefix.length);
    const use = href.startsWith(hrefPrefix) ? byId.get(safeId) : undefined;
    const id = String(element.properties['id'] ?? '');
    if (!use || !id.startsWith(idPrefix + safeId)) {
      return;
    }
    // The block's own count: `fnref-x`, then `fnref-x-2`, `fnref-x-3`…
    const suffix = id.slice((idPrefix + safeId).length);
    const ordinal = use.first + (suffix ? Number(suffix.slice(1)) : 1) - 1;
    element.properties['id'] = idPrefix + safeId + (ordinal > 1 ? `-${ordinal}` : '');
    element.children = [ { type: 'text', value: String(use.number) } ];
  });
  tree.children = tree.children.filter(child => !(child.type === 'element' && isFootnoteList(child)));
}

/** Keeps only the footnote list of a tree. */
export function keepFootnoteList(tree: Root): void {
  tree.children = tree.children.filter(child => child.type === 'element' && isFootnoteList(child));
}

/** The pipeline's footnote list: only the pipeline's own markup has `data-footnotes` (SH-5). */
function isFootnoteList(element: Element): boolean {
  return element.tagName === 'section' && element.properties['dataFootnotes'] !== undefined;
}
