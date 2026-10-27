import { join } from 'node:path';
import { DataLayout } from './data-layout';

describe('DataLayout', () => {
  const layout = new DataLayout('/data');

  it('places working copies and temporary files in the data directory', () => {
    expect(layout.reposDir).toBe(join('/data', 'repos'));
    expect(layout.tmpDir).toBe(join('/data', 'tmp'));
  });

  it('places a working copy under the user\'s and repository\'s IDs', () => {
    expect(layout.workingCopy(4, 17)).toBe(join('/data', 'repos', '4', '17'));
  });
});
