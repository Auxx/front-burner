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
    expect(parseSize('1.0001KB')).toBe(1024);
  });

  it('reads 0 in any unit as 0', () => {
    expect(parseSize('0KB')).toBe(0);
    expect(parseSize('0.0GB')).toBe(0);
  });

  it('refuses a size above 0 that is less than a byte, as 0 would turn the check off', () => {
    expect(parseSize('0.0001KB')).toBeUndefined();
  });

  it.each([ '', ' ', 'GB', '1.5', '-1KB', '1 GB', '2TB', '1e3', 'x' ])('refuses %j', value => {
    expect(parseSize(value)).toBeUndefined();
  });
});
