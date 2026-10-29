import type { Element, Root } from 'hast';

/**
 * Calls `visit` for every element under `node`, parents before their
 * children. Returning `false` skips the element's children.
 */
export function visitElements(node: Root | Element, visit: (element: Element) => boolean | void): void {
  for (const child of node.children) {
    if (child.type === 'element' && visit(child) !== false) {
      visitElements(child, visit);
    }
  }
}

/** The `class` values of an element. */
export function classesOf(element: Element): string[] {
  const value = element.properties['className'];
  return Array.isArray(value) ? value.map(String) : [];
}
