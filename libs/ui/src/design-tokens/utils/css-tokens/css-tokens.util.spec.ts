import { collectTokenNames } from './css-tokens.util';

describe('collectTokenNames', () => {
  let style: HTMLStyleElement;

  const sheetWith = (css: string): CSSStyleSheet => {
    style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    return style.sheet as CSSStyleSheet;
  };

  afterEach(() => style.remove());

  it('returns token names without the prefix, in order, once each', () => {
    const sheet = sheetWith(`
      :root { --ui-text-default: black; --ui-space-1: 4px; color: red; }
      [data-theme='dark'] { --ui-text-default: white; }
    `);

    expect(collectTokenNames([ sheet ])).toEqual([ 'text-default', 'space-1' ]);
  });

  it('finds tokens inside media rules', () => {
    const sheet = sheetWith(`@media (pointer: coarse) { :root { --ui-row-height: 44px; } }`);

    expect(collectTokenNames([ sheet ])).toEqual([ 'row-height' ]);
  });

  it('ignores other custom properties', () => {
    const sheet = sheetWith(`:root { --other: 1px; }`);

    expect(collectTokenNames([ sheet ])).toEqual([]);
  });
});
