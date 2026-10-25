import { parseOpenApiFile } from './cli';

describe('parseOpenApiFile', () => {
  it('is undefined without the flag', () => {
    expect(parseOpenApiFile([ 'node', 'main.js' ])).toBeUndefined();
  });

  it('returns the file after the flag', () => {
    expect(parseOpenApiFile([ 'node', 'main.js', '--write-openapi', 'out.json' ])).toBe('out.json');
  });

  it('refuses the flag without a file', () => {
    expect(() => parseOpenApiFile([ 'node', 'main.js', '--write-openapi' ])).toThrow('--write-openapi needs a file');
  });

  it('refuses another flag in place of the file', () => {
    expect(() => parseOpenApiFile([ 'node', 'main.js', '--write-openapi', '--x' ])).toThrow(
      '--write-openapi needs a file'
    );
  });
});
