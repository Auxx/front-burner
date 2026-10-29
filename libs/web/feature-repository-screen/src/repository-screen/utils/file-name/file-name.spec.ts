import { fileName, parentPath } from './file-name';

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
