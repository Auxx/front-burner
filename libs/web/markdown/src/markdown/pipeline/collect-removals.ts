import type { Element, Root } from 'hast';
import { checkAddress, isAddressAttribute } from '../whitelist/addresses';
import { allowedAttributes, attributeOf } from '../whitelist/derive';
import { SAFE_HTML, type SafeHtmlWhitelist } from '../whitelist/safe-html';
import { classesOf } from './elements';
import './pipeline-marks';
import { isRemovedInput, valueOf } from './rehype-safe-html';

/** What was removed: a tag, an attribute (or its value), or an address by its scheme (SH-18). */
export type RemovalKey = `tag:${string}` | `attribute:${string}` | `address:${string}`;

/** How many times each kind of HTML was removed. Never holds content or values (SH-18). */
export type RemovalReport = ReadonlyMap<RemovalKey, number>;

/**
 * Counts what `rehypeSafeHtml` will remove from a tree, walking it after
 * `rehype-raw` and before sanitising (SH-17, SH-18). A tag removed with its
 * content counts once and its content not at all; comments do not count
 * (SH-10), and neither does the pipeline's own markup on the pipeline's
 * elements (SH-5).
 */
export function collectRemovals(tree: Root, whitelist: SafeHtmlWhitelist = SAFE_HTML): RemovalReport {
  const report = new Map<RemovalKey, number>();
  const add = (key: RemovalKey) => report.set(key, (report.get(key) ?? 0) + 1);
  const ancestors: string[] = [];
  const visit = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') {
        continue;
      }
      const tag = child.tagName;
      if (!isAllowedTag(child, ancestors, whitelist)) {
        add(`tag:${tag}`);
        if (whitelist.contentRemovedTags.includes(tag)) {
          continue;
        }
      } else {
        collectAttributes(child, whitelist, add);
      }
      ancestors.push(tag);
      visit(child);
      ancestors.pop();
    }
  };
  visit(tree);
  return report;
}

/** The sum of several reports, such as those of a file's blocks. */
export function mergeRemovals(reports: Iterable<RemovalReport>): RemovalReport {
  const result = new Map<RemovalKey, number>();
  for (const report of reports) {
    for (const [ key, count ] of report) {
      result.set(key, (result.get(key) ?? 0) + count);
    }
  }
  return result;
}

function isAllowedTag(element: Element, ancestors: readonly string[], whitelist: SafeHtmlWhitelist): boolean {
  const required = whitelist.ancestors[element.tagName];
  return whitelist.tags.includes(element.tagName)
    && (!required || required.some(tag => ancestors.includes(tag)))
    && !isRemovedInput(element, whitelist);
}

function collectAttributes(element: Element, whitelist: SafeHtmlWhitelist, add: (key: RemovalKey) => void): void {
  const tag = element.tagName;
  const allowed = allowedAttributes(tag, whitelist);
  const pipeline = element.data?.pipeline === true;
  for (const [ property, value ] of Object.entries(element.properties)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    const attribute = attributeOf(property);
    if (whitelist.unsafeValue.test(valueOf(value))) {
      add(`attribute:${attribute}`);
      continue;
    }
    if (pipeline && whitelist.pipeline.attributes[tag]?.includes(attribute)) {
      continue;
    }
    if (attribute === 'class') {
      const pipelineClasses = pipeline ? whitelist.pipeline.classes[tag] ?? [] : [];
      const pattern = allowed.has('class') ? whitelist.values['class'] : undefined;
      const removed = classesOf(element).filter(name => !pipelineClasses.includes(name) && !pattern?.test(name));
      if (removed.length > 0) {
        add('attribute:class');
      }
      continue;
    }
    if (!allowed.has(attribute)) {
      add(`attribute:${attribute}`);
      continue;
    }
    const pattern = whitelist.values[attribute];
    if (pattern && !pattern.test(String(value))) {
      add(`attribute:${attribute}`);
      continue;
    }
    if (isAddressAttribute(attribute)) {
      const check = checkAddress(attribute, Array.isArray(value) ? value.join(', ') : String(value), whitelist);
      if (!check.allowed) {
        add(`address:${check.scheme}`);
      }
    }
  }
}
