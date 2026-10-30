import DOMPurify, { type DOMPurify as Purifier, type UponSanitizeAttributeHookEvent } from 'dompurify';
import { checkAddress, isAddressAttribute } from '../whitelist/addresses';
import {
  allowedAttributes,
  IMAGE_ADDRESS_ATTRIBUTES,
  isAllowedInputType,
  purifyConfig,
  withIdPrefix
} from '../whitelist/derive';
import { SAFE_HTML, type SafeHtmlWhitelist } from '../whitelist/safe-html';

/** The classes that highlighting adds after sanitising (plan 29, D-7.5), and the tags it adds them to. */
const HIGHLIGHT_CLASS = /^sk-[\w-]+$/;
const HIGHLIGHTED_TAGS: readonly string[] = [ 'span' ];

/** Attributes that hold an `id`, which always carry the prefix (SH-14). */
const ID_ATTRIBUTES: readonly string[] = [ 'id', 'name', 'aria-describedby' ];

// `purifyConfig` sets `RETURN_TRUSTED_TYPE` already; the literal picks DOMPurify's `TrustedHTML` overload.
const CONFIG = { ...purifyConfig(), RETURN_TRUSTED_TYPE: true } as const;

function sanitize(purifier: Purifier, html: string) {
  return purifier.sanitize(html, CONFIG);
}

/** Sanitised HTML: a `TrustedHTML` where the browser has Trusted Types, a string where it does not. */
export type PurifiedHtml = ReturnType<typeof sanitize> | string;

let purifier: Purifier | undefined;

/**
 * The second sanitising step (A-8.12, D-7.6): DOMPurify with the whitelist's
 * configuration, right before the HTML reaches the page. It needs a DOM, so
 * it runs on the main thread only. Its own instance keeps its hooks away from
 * any other use of DOMPurify. Image addresses come out in pipeline
 * attributes, for the image loader to read (IM-24).
 */
export function purifyHtml(html: string): PurifiedHtml {
  purifier ??= createPurifier(SAFE_HTML);
  return sanitize(purifier, html);
}

function createPurifier(whitelist: SafeHtmlWhitelist): Purifier {
  const instance = DOMPurify(window);
  instance.addHook('uponSanitizeAttribute', (node, event) => checkAttribute(node, event, whitelist));
  instance.addHook('afterSanitizeAttributes', node => {
    checkElement(node, whitelist);
    moveImageAddress(node);
  });
  return instance;
}

/** Applies what is per tag, which DOMPurify's own lists cannot say. */
function checkAttribute(node: Element, event: UponSanitizeAttributeHookEvent, whitelist: SafeHtmlWhitelist): void {
  const tag = node.localName;
  const name = event.attrName;
  if (name === 'class') {
    const classes = event.attrValue.split(/\s+/).filter(value => isAllowedClass(tag, value, whitelist));
    event.attrValue = classes.join(' ');
    event.keepAttr = classes.length > 0;
    return;
  }
  if (!allowedAttributes(tag, whitelist).has(name) && !whitelist.pipeline.attributes[tag]?.includes(name)) {
    event.keepAttr = false;
    return;
  }
  const pattern = whitelist.values[name];
  if (pattern && !pattern.test(event.attrValue)) {
    event.keepAttr = false;
    return;
  }
  if (isAddressAttribute(name)) {
    const check = checkAddress(name, event.attrValue, whitelist);
    if (!check.allowed) {
      event.keepAttr = false;
      return;
    }
    event.attrValue = check.value;
  }
  if (ID_ATTRIBUTES.includes(name)) {
    event.attrValue = event.attrValue
      .split(/\s+/)
      .map(id => withIdPrefix(id, whitelist))
      .join(' ');
  }
}

function isAllowedClass(tag: string, value: string, whitelist: SafeHtmlWhitelist): boolean {
  return whitelist.pipeline.classes[tag]?.includes(value)
    || (whitelist.attributes[tag]?.includes('class') && whitelist.values['class']?.test(value))
    || (HIGHLIGHTED_TAGS.includes(tag) && HIGHLIGHT_CLASS.test(value))
    || false;
}

/**
 * Moves an image's address into its pipeline attribute (IM-24), after every
 * check, so that the HTML that reaches the page loads nothing on its own.
 */
function moveImageAddress(node: Element): void {
  const move = IMAGE_ADDRESS_ATTRIBUTES[node.localName];
  const value = move ? node.getAttribute(move.from) : null;
  if (!move || value === null) {
    return;
  }
  node.removeAttribute(move.from);
  node.setAttribute(move.to, value);
}

/** Removes a `source` outside `picture` and an `input` that is not a checkbox, and disables checkboxes (SH-11, SH-12). */
function checkElement(node: Element, whitelist: SafeHtmlWhitelist): void {
  const tag = node.localName;
  const ancestors = whitelist.ancestors[tag];
  if (ancestors && !ancestors.some(ancestor => node.parentElement?.closest(ancestor))) {
    node.remove();
    return;
  }
  if (tag === 'input') {
    if (!isAllowedInputType(node.getAttribute('type') ?? '', whitelist)) {
      node.remove();
      return;
    }
    node.setAttribute('type', whitelist.input.type);
    for (const attribute of whitelist.input.required) {
      node.setAttribute(attribute, '');
    }
  }
}
