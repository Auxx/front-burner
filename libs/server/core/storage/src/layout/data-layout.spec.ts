import { join } from 'node:path';
import { DataLayout } from './data-layout';

describe('DataLayout', () => {
  const layout = new DataLayout('/data');

  it('places working copies, temporary files and orphans in the data directory', () => {
    expect(layout.reposDir).toBe(join('/data', 'repos'));
    expect(layout.tmpDir).toBe(join('/data', 'tmp'));
    expect(layout.orphansDir).toBe(join('/data', 'orphans'));
  });

  it('places a working copy under the user\'s and repository\'s IDs', () => {
    expect(layout.workingCopy(4, 17)).toBe(join('/data', 'repos', '4', '17'));
  });

  it('puts repos, tmp and orphans under the repositories root', () => {
    const separate = new DataLayout('/data', '/slow');

    expect(separate.reposDir).toBe(join('/slow', 'repos'));
    expect(separate.tmpDir).toBe(join('/slow', 'tmp'));
    expect(separate.orphansDir).toBe(join('/slow', 'orphans'));
    expect(separate.workingCopy(4, 17)).toBe(join('/slow', 'repos', '4', '17'));
  });

  it('the data directory as the repositories directory is the default layout', () => {
    expect(new DataLayout('/data', '/data')).toEqual(layout);
  });
});
