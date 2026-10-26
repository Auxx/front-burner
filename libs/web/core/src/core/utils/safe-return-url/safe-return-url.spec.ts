import { safeReturnUrl } from './safe-return-url';

describe('safeReturnUrl', () => {
  it.each([ '/', '/repositories/new?x=1', '/repositories/3#changes' ])(
    'keeps a path inside the web client: %s',
    url => {
      expect(safeReturnUrl(url)).toBe(url);
    }
  );

  it.each([
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'repositories',
    '/\u0000x',
    '/\tx',
    '/x\u007f',
    '',
    undefined,
    null,
    [ '/repositories' ]
  ])('refuses a return target outside the web client: %j', value => {
    expect(safeReturnUrl(value)).toBe('/');
  });
});
