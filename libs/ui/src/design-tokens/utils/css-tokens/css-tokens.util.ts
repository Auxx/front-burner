/**
 * Collects the names of every `--ui-*` custom property declared in the given
 * style sheets, in the order they first appear, without the `--ui-` prefix.
 * Looks inside nested rules such as `@layer` and `@media`.
 */
export function collectTokenNames(styleSheets: Iterable<CSSStyleSheet>): string[] {
  const names = new Set<string>();

  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        for (const property of Array.from(rule.style)) {
          if (property.startsWith('--ui-')) {
            names.add(property.slice('--ui-'.length));
          }
        }
      }
      if ('cssRules' in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };

  for (const sheet of styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Style sheets from another origin cannot be read; tokens are never there.
    }
  }

  return [ ...names ];
}
