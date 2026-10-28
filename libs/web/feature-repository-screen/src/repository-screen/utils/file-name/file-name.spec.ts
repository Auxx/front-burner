import { fileName } from './file-name';

describe('fileName', () => {
  it.each([
    [ 'README.md', 'README.md' ],
    [ 'docs/api/index.md', 'index.md' ],
    [ '', '' ]
  ])('names %j %j', (path, name) => {
    expect(fileName(path)).toBe(name);
  });
});
