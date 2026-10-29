import { entry, folder } from '../../../testing/listings';
import { entryActions } from './entry-actions';

describe('entryActions', () => {
  it('lists each kind\'s actions', () => {
    expect(entryActions(folder('docs'))).toEqual([ 'new-file', 'new-folder', 'rename' ]);
    expect(entryActions(entry('guide.md'))).toEqual([ 'rename' ]);
    expect(entryActions(entry('logo.png'))).toEqual([]);
    expect(entryActions(entry('latest', { kind: 'symlink', size: null }))).toEqual([]);
    expect(entryActions(entry('vendor', { kind: 'submodule', size: null }))).toEqual([]);
  });
});
