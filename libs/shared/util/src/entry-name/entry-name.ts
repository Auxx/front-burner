/** The extensions of a Markdown file, compared ignoring case (glossary, FB-21). */
export const MARKDOWN_EXTENSIONS = [ '.md', '.markdown', '.mdx' ] as const;

/** FB-27, in the order they are checked. The sibling clash is checked separately with `sameEntryName`. */
export const ENTRY_NAME_PROBLEMS = [ 'empty', 'dot', 'separator', 'control', 'edge-space', 'git', 'too-long' ] as const;

export type EntryNameProblem = typeof ENTRY_NAME_PROBLEMS[number];

/** FB-27, in UTF-8 bytes of the NFC form (FB-28). */
const MAX_NAME_BYTES = 255;

// U+0000 to U+001F and U+007F.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });

export function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some(extension => lower.length > extension.length && lower.endsWith(extension));
}

/** FB-29: `notes` → `notes.md`, `notes.txt` → `notes.txt.md`. */
export function withMarkdownExtension(name: string): string {
  return isMarkdownName(name) ? name : `${name}.md`;
}

/** The first FB-27 rule the NFC form of `name` breaks, or `null`. */
export function entryNameProblem(name: string): EntryNameProblem | null {
  const nfc = name.normalize('NFC');
  if (nfc === '') {
    return 'empty';
  }
  if (nfc === '.' || nfc === '..') {
    return 'dot';
  }
  if (nfc.includes('/') || nfc.includes('\\')) {
    return 'separator';
  }
  if (CONTROL.test(nfc)) {
    return 'control';
  }
  if (nfc.startsWith(' ') || nfc.endsWith(' ')) {
    return 'edge-space';
  }
  if (nfc.toLowerCase() === '.git') {
    return 'git';
  }
  if (new TextEncoder().encode(nfc).length > MAX_NAME_BYTES) {
    return 'too-long';
  }
  return null;
}

/** FB-27's clash rule: equal after NFC, ignoring case. */
export function sameEntryName(a: string, b: string): boolean {
  return a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
}

/** FB-17's order within a group; ties are broken by code units, so the order is total and stable. */
export function compareEntryNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
