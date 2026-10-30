import type { Element, Properties, Root } from 'hast';
import rehypeSanitize from 'rehype-sanitize';
import { checkAddress, isAddressAttribute } from '../whitelist/addresses';
import { attributeOf, isAllowedInputType, propertyOf, sanitizeSchema, withIdPrefix } from '../whitelist/derive';
import { SAFE_HTML, type SafeHtmlWhitelist } from '../whitelist/safe-html';
import { classesOf, visitElements } from './elements';
import './pipeline-marks';

declare module 'hast' {
  interface ElementData {
    /** The pipeline's own markup of the element, kept aside while the file's HTML is sanitised. */
    pipelineMarkup?: Properties;
  }
}

/**
 * The first sanitising step (A-8.12), run after `rehype-raw` and
 * `pipelineMarks().find`. It sanitises the tree with the whitelist's
 * `rehype-sanitize` schema, and around that:
 * - removes every `input` that is not a checkbox (SH-12);
 * - removes attributes whose value matches the whitelist's `unsafeValue`, as
 *   DOMPurify does;
 * - checks addresses as `checkAddress` reads them, removing the attribute of
 *   a forbidden one and turning protocol-relative ones into `https:` (SH-15,
 *   SH-16);
 * - keeps the pipeline's own markup (SH-5) on the elements the pipeline made,
 *   and on no other: it is set aside before sanitising and put back after,
 *   with `id`s that point to the footnote label given the `user-content-`
 *   prefix like every other (SH-14).
 */
export function rehypeSafeHtml(whitelist: SafeHtmlWhitelist = SAFE_HTML): (tree: Root) => Root {
  const sanitize = rehypeSanitize(sanitizeSchema(whitelist));
  return tree => {
    prepare(tree, whitelist);
    const result = sanitize(tree);
    restore(result, whitelist);
    return result;
  };
}

function prepare(node: Root | Element, whitelist: SafeHtmlWhitelist): void {
  node.children = node.children.filter(child => child.type !== 'element' || !isRemovedInput(child, whitelist));
  for (const child of node.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tagName === 'input') {
      child.properties['type'] = whitelist.input.type;
    }
    checkValues(child, whitelist);
    if (child.data?.pipeline) {
      setAsidePipelineMarkup(child, whitelist);
    }
    prepare(child, whitelist);
  }
}

/** An `input` that SH-12 does not allow, which is removed whole. */
export function isRemovedInput(element: Element, whitelist: SafeHtmlWhitelist = SAFE_HTML): boolean {
  return element.tagName === 'input' && !isAllowedInputType(String(element.properties['type'] ?? ''), whitelist);
}

function checkValues(element: Element, whitelist: SafeHtmlWhitelist): void {
  for (const [ property, value ] of Object.entries(element.properties)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (whitelist.unsafeValue.test(valueOf(value))) {
      delete element.properties[property];
      continue;
    }
    const attribute = attributeOf(property);
    if (!isAddressAttribute(attribute)) {
      continue;
    }
    const check = checkAddress(attribute, Array.isArray(value) ? value.join(', ') : String(value), whitelist);
    if (!check.allowed) {
      delete element.properties[property];
    } else {
      element.properties[property] = attribute === 'srcset' ? check.value.split(', ') : check.value;
    }
  }
}

function setAsidePipelineMarkup(element: Element, whitelist: SafeHtmlWhitelist): void {
  const markup: Properties = {};
  for (const attribute of whitelist.pipeline.attributes[element.tagName] ?? []) {
    const property = propertyOf(attribute);
    if (element.properties[property] !== undefined) {
      markup[property] = element.properties[property];
      delete element.properties[property];
    }
  }
  const pipelineClasses = whitelist.pipeline.classes[element.tagName];
  if (pipelineClasses) {
    const classes = classesOf(element).filter(name => pipelineClasses.includes(name));
    if (classes.length > 0) {
      markup['className'] = classes;
    }
    delete element.properties['className'];
  }
  element.data = { ...element.data, pipelineMarkup: markup };
}

function restore(tree: Root, whitelist: SafeHtmlWhitelist): void {
  visitElements(tree, element => {
    const markup = element.data?.pipelineMarkup;
    if (markup) {
      for (const [ property, value ] of Object.entries(markup)) {
        element.properties[property] = property === 'id' || property === 'ariaDescribedBy'
          ? prefixed(value, whitelist)
          : value;
      }
    }
    // A `class` whose every value was removed.
    if (Array.isArray(element.properties['className']) && element.properties['className'].length === 0) {
      delete element.properties['className'];
    }
    if (element.data) {
      delete element.data.pipeline;
      delete element.data.pipelineMarkup;
    }
  });
}

function prefixed(value: Properties[string], whitelist: SafeHtmlWhitelist): Properties[string] {
  return Array.isArray(value)
    ? value.map(name => withIdPrefix(String(name), whitelist))
    : withIdPrefix(String(value), whitelist);
}

/** A property's value as the attribute's text, near enough to test it for `unsafeValue`. */
export function valueOf(value: NonNullable<Properties[string]>): string {
  return Array.isArray(value) ? value.join(' ') : String(value);
}
