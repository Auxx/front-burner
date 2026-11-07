import type { TreeEntry } from '../../models/tree-entry.model';
import { TreeEntryPipe } from './tree-entry.pipe';

describe('TreeEntryPipe', () => {
  it('returns the node itself', () => {
    const node: TreeEntry = { value: 'docs', label: 'docs', kind: 'folder', path: 'docs' };

    expect(new TreeEntryPipe().transform(node)).toBe(node);
  });
});
