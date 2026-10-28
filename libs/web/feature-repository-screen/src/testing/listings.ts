import type { Entry, FolderListing } from '@front-burner/shared-contracts';

/** An entry of a folder listing; a file unless `kind` says otherwise. */
export function entry(name: string, overrides: Partial<Entry> = {}): Entry {
  const kind = overrides.kind ?? 'file';
  return {
    name,
    kind,
    size: kind === 'file' ? 100 : null,
    markdown: kind === 'file' && /\.(md|markdown|mdx)$/i.test(name),
    ignored: false,
    empty: false,
    ...overrides
  };
}

export function folder(name: string, overrides: Partial<Entry> = {}): Entry {
  return entry(name, { ...overrides, kind: 'folder' });
}

export function listing(path: string, entries: Entry[], overrides: Partial<FolderListing> = {}): FolderListing {
  return { path, ignored: false, entries, more: 0, ...overrides };
}
