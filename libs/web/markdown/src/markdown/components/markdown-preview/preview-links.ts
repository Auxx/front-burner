/** What a click on a link of the preview does (ED-31). */
export type PreviewLink =
  | { kind: 'external'; }
  | { kind: 'fragment'; id: string; }
  | { kind: 'path'; path: string; fragment: string | null; }
  | { kind: 'none'; };

const EXTERNAL = /^(?:https?|mailto):/i;

/**
 * Reads a link of the preview of the file at `filePath` (ED-31):
 * - `http:`, `https:` and `mailto:` open in a new tab;
 * - `#name` scrolls to the heading `name` of the same file;
 * - anything else is a path relative to the file's folder, or to the root
 *   when it starts with `/`, percent-decoded, with its fragment. A path that
 *   climbs above the root, or names the root itself, does nothing.
 */
export function resolvePreviewLink(filePath: string, href: string): PreviewLink {
  if (EXTERNAL.test(href) || href.startsWith('//')) {
    return { kind: 'external' };
  }
  const hash = href.indexOf('#');
  const fragment = hash < 0 ? null : decode(href.slice(hash + 1));
  const address = (hash < 0 ? href : href.slice(0, hash)).replace(/\?.*$/, '');
  if (address === '') {
    return fragment ? { kind: 'fragment', id: fragment } : { kind: 'none' };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(address)) {
    return { kind: 'none' };
  }
  const segments = address.startsWith('/') ? [] : filePath.split('/').slice(0, -1);
  for (const raw of address.split('/')) {
    const segment = decode(raw);
    if (segment === null) {
      return { kind: 'none' };
    }
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return { kind: 'none' };
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    return { kind: 'none' };
  }
  return { kind: 'path', path: segments.join('/'), fragment: fragment || null };
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
