import { entry, folder } from '../../../testing/listings';
import { entryActions } from './entry-actions';

describe('entryActions', () => {
  it('offers Delete for files, links and folders but not submodules', () => {
    expect(entryActions(folder('docs'))).toEqual([ 'new-file', 'new-folder', 'rename', 'delete' ]);
    expect(entryActions(entry('guide.md'))).toEqual([ 'rename', 'delete' ]);
    expect(entryActions(entry('logo.png'))).toEqual([ 'delete' ]);
    expect(entryActions(entry('latest', { kind: 'symlink', size: null }))).toEqual([ 'delete' ]);
    expect(entryActions(entry('vendor', { kind: 'submodule', size: null }))).toEqual([]);
  });
});
