import { formatSize } from './file-size';

describe('formatSize', () => {
  it('uses the largest unit that keeps the size above 1', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3 MB');
  });
});
