import type { PurifiedHtml } from '../../purify/purify-html';
import type { PreviewState } from '../../services/preview-renderer/preview-renderer.service';
import { SAFE_HTML } from '../../whitelist/safe-html';

/** Purifies a block's HTML right before it reaches the page (plan 28). */
export type Purify = (html: string) => PurifiedHtml;

/** The class of a block's element. */
export const BLOCK_CLASS = 'md-block';

/** The key of each block element. */
const keys = new WeakMap<Element, string>();
/** The ID each heading was rendered with, before it was made unique in the file. */
const headingIds = new WeakMap<Element, string>();

const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const EXTERNAL = /^(?:https?|mailto):/i;

/**
 * Brings `container`'s blocks to `state`'s layout (A-8.12, D-7.6): a block
 * already shown keeps its element, untouched, a new block gets an element
 * with its purified HTML, and a block that is gone loses its element. New
 * elements are inserted before the kept ones without moving them; only a
 * block moved in the file moves. Then the headings get unique IDs in
 * document order, numbered as GitHub numbers them.
 *
 * This is the only place in the web client that writes HTML into the page.
 */
export function patchBlocks(container: HTMLElement, state: PreviewState, purify: Purify): void {
  const pool = new Map<string, HTMLElement[]>();
  for (const element of Array.from(container.children) as HTMLElement[]) {
    const key = keys.get(element);
    if (key === undefined) {
      element.remove();
      continue;
    }
    const same = pool.get(key);
    if (same) {
      same.push(element);
    } else {
      pool.set(key, [ element ]);
    }
  }

  const wanted: HTMLElement[] = [];
  for (const block of state.layout) {
    const html = state.rendered.get(block.key);
    let element = pool.get(block.key)?.shift();
    if (!element) {
      if (html === undefined) {
        continue;
      }
      element = createBlock(container.ownerDocument, block.key, purify(html));
    }
    setAttribute(element, 'data-from-line', String(block.fromLine));
    setAttribute(element, 'data-to-line', String(block.toLine));
    wanted.push(element);
  }
  for (const elements of pool.values()) {
    for (const element of elements) {
      element.remove();
    }
  }

  wanted.forEach((element, index) => {
    const at = container.children[index] ?? null;
    if (at !== element) {
      container.insertBefore(element, at);
    }
  });

  numberHeadings(container);
}

function createBlock(document: Document, key: string, html: PurifiedHtml): HTMLElement {
  const element = document.createElement('div');
  element.className = BLOCK_CLASS;
  element.dir = 'auto';
  // D-7.6: the one assignment of HTML in the web client, of DOMPurify's output.
  // eslint-disable-next-line no-restricted-syntax
  element.innerHTML = html as string;
  keys.set(element, key);
  for (const heading of Array.from(element.querySelectorAll(HEADINGS))) {
    if (heading.id) {
      headingIds.set(heading, heading.id);
    }
  }
  // A task list's checkbox is named by its item's text (ED-32, ED-39).
  for (const checkbox of Array.from(element.querySelectorAll('li > input[type="checkbox"]'))) {
    const text = checkbox.parentElement?.textContent?.replace(/\s+/g, ' ').trim();
    if (text) {
      checkbox.setAttribute('aria-label', text);
    }
  }
  for (const link of Array.from(element.querySelectorAll('a[href]'))) {
    if (EXTERNAL.test(link.getAttribute('href') ?? '')) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return element;
}

/**
 * Makes heading IDs unique in the file: the second `install` becomes
 * `install-1`, skipping any number already taken, as `github-slugger` does.
 */
function numberHeadings(container: HTMLElement): void {
  const taken = new Set<string>();
  const counts = new Map<string, number>();
  for (const heading of Array.from(container.querySelectorAll(HEADINGS))) {
    const original = headingIds.get(heading);
    if (original === undefined) {
      continue;
    }
    let id = original;
    let count = counts.get(original) ?? 0;
    while (taken.has(id)) {
      count++;
      id = `${original}-${count}`;
    }
    counts.set(original, count);
    taken.add(id);
    setAttribute(heading, 'id', id);
  }
}

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** The element of the preview with this `id`, which may lack the `user-content-` prefix (SH-14). */
export function findById(container: HTMLElement, id: string): HTMLElement | null {
  const prefixed = id.startsWith(SAFE_HTML.idPrefix) ? id : SAFE_HTML.idPrefix + id;
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[id]'));
  return elements.find(element => element.id === prefixed) ?? null;
}
