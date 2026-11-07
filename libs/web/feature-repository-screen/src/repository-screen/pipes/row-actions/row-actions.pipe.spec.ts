import type { Entry } from '@front-burner/shared-contracts';

import { RowActionsPipe } from './row-actions.pipe';

const folder: Entry = { name: 'docs', kind: 'folder', size: null, markdown: false, ignored: false, empty: false };

describe('RowActionsPipe', () => {
  const pipe = new RowActionsPipe();

  it('lists an entry\'s actions', () => {
    expect(pipe.transform({ value: 'docs', label: 'docs', kind: 'folder', path: 'docs', entry: folder })).toEqual([
      'new-file',
      'new-folder',
      'rename',
      'delete'
    ]);
  });

  it('lists none for an entry being deleted', () => {
    expect(
      pipe.transform({ value: 'docs', label: 'docs', kind: 'folder', path: 'docs', entry: folder, deleting: true })
    )
      .toEqual([]);
  });

  it('lists none for a row that is not an entry', () => {
    expect(pipe.transform({ value: '\u0000loading:docs', label: '…', kind: 'loading', path: 'docs' })).toEqual([]);
  });
});
