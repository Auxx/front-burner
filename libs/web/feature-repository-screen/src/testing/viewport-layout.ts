// jsdom has no layout: the virtual scroll viewport of `ui-tree` gets a height
// of 10 rows of 24 px, and a `scrollTop` that remembers its value and fires
// `scroll`, so that the CDK renders the rows near the scroll position.
const VIEWPORT = 'CDK-VIRTUAL-SCROLL-VIEWPORT';
const scrollTops = new WeakMap<Element, number>();
const elementScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop') as PropertyDescriptor;
const elementClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight') as PropertyDescriptor;

/** Call in `beforeAll`, and `restoreLayout` in `afterAll`. */
export function stubViewportLayout(): void {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === VIEWPORT ? 240 : elementClientHeight.get?.call(this);
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === VIEWPORT ? scrollTops.get(this) ?? 0 : elementScrollTop.get?.call(this);
    },
    set(this: HTMLElement, value: number) {
      if (this.tagName === VIEWPORT) {
        scrollTops.set(this, value);
        this.dispatchEvent(new Event('scroll'));
      } else {
        elementScrollTop.set?.call(this, value);
      }
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top != null) {
        this.scrollTop = options.top;
      }
    }
  });
}

export function restoreLayout(): void {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
}
