let sheet: CSSStyleSheet | undefined;
const adopted = new Set<string>();

/**
 * Adds the rules of Shiki's highlighting classes to one constructed
 * stylesheet in `document.adoptedStyleSheets`, which `style-src` allows
 * without `'unsafe-inline'` (D-7.5, A-8.12). Each rule is added once, so
 * `css` may repeat rules already adopted.
 */
export function adoptShikiCss(css: string): void {
  for (const rule of css.split('\n')) {
    if (rule.trim() === '' || adopted.has(rule)) {
      continue;
    }
    if (!sheet) {
      sheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [ ...document.adoptedStyleSheets, sheet ];
    }
    sheet.insertRule(rule, sheet.cssRules.length);
    adopted.add(rule);
  }
}
