import { fileName, isWithin, joinPath, movedPath, parentPath } from './file-name';

describe('fileName', () => {
  it.each([
    [ 'README.md', 'README.md' ],
    [ 'docs/api/index.md', 'index.md' ],
    [ '', '' ]
  ])('names %j %j', (path, name) => {
    expect(fileName(path)).toBe(name);
  });
});

describe('parentPath', () => {
  it.each([
    [ 'README.md', '' ],
    [ 'docs/api/index.md', 'docs/api' ]
  ])('finds the folder of %j: %j', (path, parent) => {
    expect(parentPath(path)).toBe(parent);
  });
});

describe('joinPath', () => {
  it.each([
    [ '', 'README.md', 'README.md' ],
    [ 'docs/api', 'index.md', 'docs/api/index.md' ]
  ])('joins %j and %j', (folder, name, path) => {
    expect(joinPath(folder, name)).toBe(path);
  });
});

describe('movedPath', () => {
  it.each([
    [ 'docs', 'guides' ],
    [ 'docs/api/index.md', 'guides/api/index.md' ],
    [ 'docs2/x.md', null ],
    [ 'doc', null ],
    [ 'README.md', null ]
  ])('moves %j to %j when docs becomes guides', (path, moved) => {
    expect(movedPath(path, 'docs', 'guides')).toBe(moved);
  });
});

describe('isWithin', () => {
  it.each([
    [ 'docs', true ],
    [ 'docs/api/index.md', true ],
    [ 'docs2/x.md', false ],
    [ 'doc', false ]
  ])('says whether %j is docs or lies under it', (path, within) => {
    expect(isWithin(path, 'docs')).toBe(within);
  });
});
