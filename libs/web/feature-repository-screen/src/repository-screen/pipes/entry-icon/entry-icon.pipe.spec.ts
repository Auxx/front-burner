import type { Entry } from '@front-burner/shared-contracts';

import type { TreeEntry, TreeEntryKind } from '../../models/tree-entry.model';
import { EntryIconPipe } from './entry-icon.pipe';

function row(kind: TreeEntryKind, markdown = false): TreeEntry {
  const entry: Entry | undefined = kind === 'folder' || kind === 'file' || kind === 'symlink' || kind === 'submodule'
    ? { name: 'x', kind, size: null, markdown, ignored: false, empty: false }
    : undefined;
  return { value: 'x', label: 'x', kind, path: 'x', entry };
}

describe('EntryIconPipe', () => {
  const pipe = new EntryIconPipe();

  it.each(
    [
      [ 'folder', false, 'folder' ],
      [ 'symlink', false, 'file-symlink-file' ],
      [ 'submodule', false, 'file-submodule' ],
      [ 'file', true, 'markdown' ],
      [ 'file', false, 'file' ]
    ] as const
  )('shows a %s (Markdown: %s) as %s', (kind, markdown, icon) => {
    expect(pipe.transform(row(kind, markdown))).toBe(icon);
  });
});
