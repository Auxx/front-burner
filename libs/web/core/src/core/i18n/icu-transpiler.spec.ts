import { TestBed } from '@angular/core/testing';
import { provideTransloco, TRANSLOCO_TRANSPILER, type TranslocoTranspiler } from '@jsverse/transloco';

import { IcuTranspiler } from './icu-transpiler';

describe('IcuTranspiler', () => {
  let transpiler: TranslocoTranspiler;

  const format = (value: string, params?: Record<string, unknown>) =>
    transpiler.transpile({ value, params, translation: {}, key: 'k' });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideTransloco({ config: { availableLangs: [ 'en' ], defaultLang: 'en' } }),
        { provide: TRANSLOCO_TRANSPILER, useClass: IcuTranspiler }
      ]
    });
    transpiler = TestBed.inject(TRANSLOCO_TRANSPILER);
  });

  const plural = '{count, plural, one {# file} other {# files}}';

  it('formats plurals', () => {
    expect(format(plural, { count: 1 })).toBe('1 file');
    expect(format(plural, { count: 3 })).toBe('3 files');
  });

  it('formats select', () => {
    const select = '{kind, select, folder {a folder} other {a file}}';

    expect(format(select, { kind: 'folder' })).toBe('a folder');
    expect(format(select, { kind: 'x' })).toBe('a file');
  });

  it('formats named arguments', () => {
    expect(format('Hello {name}!', { name: 'Ada' })).toBe('Hello Ada!');
  });

  it('formats plural branches that start with an argument', () => {
    const nested = '{n, plural, one {{name} liked this} other {{name} and # others}}';

    expect(format(nested, { n: 1, name: 'Ann' })).toBe('Ann liked this');
    expect(format(nested, { n: 3, name: 'Ann' })).toBe('Ann and 3 others');
  });

  it('keeps {{ param }} interpolation', () => {
    expect(format('Wait {{ retryAfter }} seconds.', { retryAfter: 30 })).toBe('Wait 30 seconds.');
  });

  it('returns plain text, apostrophes included, unchanged', () => {
    expect(format('Signing in isn\'t available yet.')).toBe('Signing in isn\'t available yet.');
  });

  describe('broken messages', () => {
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => error.mockRestore());

    it('returns a malformed message as it is and logs the key once', () => {
      expect(format('{count, plural, one {# file}')).toBe('{count, plural, one {# file}');
      expect(format('{count, plural, one {# file}')).toBe('{count, plural, one {# file}');

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0].join(' ')).toContain('k');
    });

    it('returns a message as it is when an argument is missing, without logging values', () => {
      expect(format('Hello {name}!', { other: 'secret' })).toBe('Hello {name}!');

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0].join(' ')).not.toContain('secret');
    });
  });

  it('never compiles code at run time (CSP, Trusted Types)', () => {
    const original = globalThis.Function;
    globalThis.Function = (() => {
      throw new Error('Function constructor used');
    }) as unknown as FunctionConstructor;
    try {
      expect(format(plural, { count: 2 })).toBe('2 files');
    } finally {
      globalThis.Function = original;
    }
  });
});
