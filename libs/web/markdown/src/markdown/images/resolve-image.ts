/** Where an image of the preview comes from, as IM-1 to IM-5 and IM-9 read its address. */
export type ImageTarget =
  | { kind: 'repository'; path: string; }
  | { kind: 'remote'; url: string; host: string; }
  | { kind: 'insecure'; }
  | { kind: 'refused'; }
  | { kind: 'unsupported'; };

/** The extensions of the formats the preview shows (IM-9), as the image endpoint serves them. */
export const IMAGE_EXTENSIONS: readonly string[] = [ 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'jxl', 'svg' ];

/** The content types of the same formats, which a `<source type>` may name (IM-12). */
export const IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/jxl',
  'image/svg+xml'
];

/**
 * Reads the image address `address` of the Markdown file at `filePath`:
 *
 * - `https:` and protocol-relative addresses are remote (IM-1, SH-16), and
 *   `http:` is insecure (IM-17); any other scheme is refused;
 * - an address with no scheme and no host is a path in the repository,
 *   resolved from the file's folder, or from the root when it starts with
 *   `/` (IM-2), percent-decoded, without its query and fragment, in its own
 *   case (IM-3);
 * - a path that climbs above the root, leads into `.git` (in any case) or
 *   cannot be decoded is refused (IM-4), before its format is looked at;
 * - a path whose extension is not in IM-9 is unsupported.
 *
 * The backend checks every path again (A-7.6); this only spares a request
 * that it would refuse.
 */
export function resolveImageAddress(filePath: string, address: string): ImageTarget {
  // eslint-disable-next-line no-control-regex -- the URL parser strips exactly these.
  let url = address.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\n\r]/g, '');
  if (/^[\\/]{2}/.test(url)) {
    url = `https://${url.slice(2)}`;
  }
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    return remoteTarget(scheme, url);
  }
  const path = url.replace(/[?#].*$/s, '');
  if (path === '') {
    return { kind: 'refused' };
  }
  // A browser reads `\` as `/` in an `https:` page's addresses.
  const segments = /^[\\/]/.test(path) ? [] : filePath.split('/').slice(0, -1);
  for (const raw of path.split(/[\\/]/)) {
    const segment = decode(raw);
    if (segment === null || /[\\/]/.test(segment) || segment.includes('\0')) {
      return { kind: 'refused' };
    }
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return { kind: 'refused' };
      }
      segments.pop();
      continue;
    }
    if (segment.toLowerCase() === '.git') {
      return { kind: 'refused' };
    }
    segments.push(segment);
  }
  const name = segments.at(-1);
  if (name === undefined) {
    return { kind: 'refused' };
  }
  const dot = name.lastIndexOf('.');
  if (dot < 0 || !IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())) {
    return { kind: 'unsupported' };
  }
  return { kind: 'repository', path: segments.join('/') };
}

function remoteTarget(scheme: string, url: string): ImageTarget {
  if (scheme === 'http') {
    return { kind: 'insecure' };
  }
  if (scheme !== 'https') {
    return { kind: 'refused' };
  }
  try {
    const parsed = new URL(url);
    return parsed.host ? { kind: 'remote', url: parsed.href, host: parsed.host } : { kind: 'refused' };
  } catch {
    return { kind: 'refused' };
  }
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
