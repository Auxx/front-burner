import { parseSize } from './parse-size';

describe('parseSize', () => {
  it.each([
    [ '0', 0 ],
    [ '4096', 4096 ],
    [ '1KB', 1024 ],
    [ '25MB', 25 * 1024 ** 2 ],
    [ '2GB', 2 * 1024 ** 3 ],
    [ '2gb', 2 * 1024 ** 3 ],
    [ '0.5KB', 512 ],
    [ '1.5MB', 1.5 * 1024 ** 2 ]
  ])('reads %s', (value, bytes) => {
    expect(parseSize(value)).toBe(bytes);
  });

  it('rounds a fraction of a byte down', () => {
    expect(parseSize('0.0001KB')).toBe(0);
  });

  it.each([ '', ' ', 'GB', '1.5', '-1KB', '1 GB', '2TB', '1e3', 'x' ])('refuses %j', value => {
    expect(parseSize(value)).toBeUndefined();
  });
});
