/**
 * The rules of Shiki's highlighting classes for one preview, in a constructed
 * stylesheet in `document.adoptedStyleSheets`, which `style-src` allows
 * without `'unsafe-inline'` (D-7.5, A-8.12). Class names such as `sk-1` are
 * unique only within one preview worker, so each preview has its own sheet,
 * removed with it.
 */
export class ShikiSheet {
  private sheet: CSSStyleSheet | undefined;
  /** How much of the renderer's CSS is in the sheet. */
  private applied = 0;

  constructor(private readonly document: Document) {}

  /**
   * Adds the rules of `css` that are not in the sheet yet. `css` is the
   * renderer's CSS so far, which only grows, so only its end is read.
   */
  sync(css: string): void {
    if (css.length < this.applied) {
      throw new Error('The highlighting CSS of a preview only grows.');
    }
    const added = css.slice(this.applied);
    this.applied = css.length;
    for (const rule of added.split('\n')) {
      if (rule.trim() === '') {
        continue;
      }
      if (!this.sheet) {
        this.sheet = new CSSStyleSheet();
        this.document.adoptedStyleSheets = [ ...this.document.adoptedStyleSheets, this.sheet ];
      }
      this.sheet.insertRule(rule, this.sheet.cssRules.length);
    }
  }

  /** Removes the sheet from the document. */
  remove(): void {
    const sheet = this.sheet;
    if (sheet) {
      this.document.adoptedStyleSheets = this.document.adoptedStyleSheets.filter(adopted => adopted !== sheet);
      this.sheet = undefined;
    }
  }
}
