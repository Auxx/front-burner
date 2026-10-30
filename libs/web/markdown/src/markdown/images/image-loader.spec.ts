import { Subject } from 'rxjs';

import { renderSafeHtml } from '../pipeline/render-safe-html';
import { purifyHtml } from '../purify/purify-html';
import type { ImageCache, ImageChange, ImageResult } from './image-cache';
import { ImageLoader, type ImageLoaderTexts } from './image-loader';

const TEXTS: ImageLoaderTexts = {
  notFound: address => `Image not found: ${address}`,
  tooLarge: 'This image is too large to preview',
  unsupported: 'This image format isn\'t supported',
  refused: 'Can\'t show this image',
  error: 'This image couldn\'t be loaded',
  remote: host => `Remote image from ${host}`,
  remoteFailed: 'Remote image couldn\'t be loaded',
  insecure: 'Insecure image (http) isn\'t shown',
  button: 'Show remote images',
  note: 'Loading them lets these sites see your IP address.'
};

/** An `IntersectionObserver` whose intersections the test decides. */
class FakeIntersectionObserver {
  static current: FakeIntersectionObserver | undefined;
  readonly observed = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit
  ) {
    FakeIntersectionObserver.current = this;
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }

  /** Reports every observed element as near the viewport, or not. */
  intersect(isIntersecting = true, elements = [ ...this.observed ]): void {
    const entries = elements.map(target => ({ target, isIntersecting }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** A media query list whose `matches` follows the fake colour scheme. */
class FakeMediaList extends EventTarget {
  constructor(readonly media: string, private readonly scheme: () => string) {
    super();
  }

  get matches(): boolean {
    return this.media === `(prefers-color-scheme: ${this.scheme()})`;
  }
}

/** A cache whose loads the test answers. */
class FakeCache {
  readonly cached = new Map<string, string>();
  readonly loads: { path: string; signal?: AbortSignal; answer(result: ImageResult): void; }[] = [];
  readonly users = new Map<string, number>();
  readonly revalidated: string[] = [];
  readonly changes = new Subject<ImageChange>();
  readonly changed = this.changes.asObservable();

  peek(_id: number, path: string): string | null {
    return this.cached.get(path) ?? null;
  }

  load(_id: number, path: string, signal?: AbortSignal): Promise<ImageResult> {
    return new Promise(resolve => {
      this.loads.push({
        path,
        signal,
        answer: result => {
          if (result.kind === 'loaded') {
            this.cached.set(path, result.url);
          }
          resolve(result);
        }
      });
    });
  }

  use(_id: number, path: string): () => void {
    this.users.set(path, (this.users.get(path) ?? 0) + 1);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.users.set(path, (this.users.get(path) ?? 0) - 1);
      }
    };
  }

  revalidate(_id: number, paths: readonly string[]): void {
    this.revalidated.push(...paths);
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve));

describe('ImageLoader', () => {
  let container: HTMLElement;
  let cache: FakeCache;
  let loader: ImageLoader;
  let filePath: string;
  let scheme: string;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    cache = new FakeCache();
    filePath = 'docs/guide.md';
    scheme = 'light';
    const lists = new Map<string, FakeMediaList>();
    Object.assign(window, {
      IntersectionObserver: FakeIntersectionObserver,
      matchMedia: (media: string) => {
        const list = lists.get(media) ?? new FakeMediaList(media, () => scheme);
        lists.set(media, list);
        return list;
      }
    });
    loader = new ImageLoader({
      root: container,
      cache: cache as unknown as ImageCache,
      repositoryId: () => 7,
      filePath: () => filePath,
      texts: () => TEXTS
    });
  });

  afterEach(() => {
    loader.destroy();
    container.remove();
    Reflect.deleteProperty(window, 'IntersectionObserver');
    Reflect.deleteProperty(window, 'matchMedia');
  });

  const observer = () => FakeIntersectionObserver.current as FakeIntersectionObserver;

  /** Adds a block of the preview, rendered as the preview renders it, and hands it to the loader. */
  function block(markdown: string): HTMLElement {
    const element = document.createElement('div');
    element.className = 'md-block';
    element.innerHTML = String(purifyHtml(renderSafeHtml(markdown).html));
    container.append(element);
    loader.attach([ element ]);
    return element;
  }

  const placeholders = (element: Element = container) =>
    Array.from(
      element.querySelectorAll('.md-image-placeholder'),
      placeholder => placeholder.getAttribute('aria-label')
    );

  it('loads repository images near the preview\'s viewport', () => {
    expect(observer().options).toEqual({ root: container, rootMargin: '200px' });
  });

  it('shows a placeholder until the image is near the viewport', async () => {
    const element = block('![Flow](img/flow.png)');

    expect(placeholders()).toEqual([ 'Flow' ]);
    expect(element.querySelector('img')).toBeNull();
    expect(cache.loads).toEqual([]);
    observer().intersect();
    expect(cache.loads.map(load => load.path)).toEqual([ 'docs/img/flow.png' ]);
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:1' });
    await tick();

    expect(placeholders()).toEqual([]);
    expect(element.querySelector('img')?.getAttribute('src')).toBe('blob:1');
    expect(element.querySelector('img')?.alt).toBe('Flow');
    expect(cache.users.get('docs/img/flow.png')).toBe(1);
  });

  it('drops a waiting load when its image scrolls away', () => {
    block('![Flow](img/flow.png)');
    observer().intersect();
    const placeholder = container.querySelector('.md-image-placeholder') as Element;

    observer().intersect(false, [ placeholder ]);

    expect(cache.loads[0]?.signal?.aborted).toBe(true);
    observer().intersect(true, [ placeholder ]);
    expect(cache.loads).toHaveLength(2);
  });

  it('AC-EDIT-003.7: shows each reason with the alt text', async () => {
    block(
      '![Missing](img/missing.png) ![Big](big.png) ![Scan](scan.tiff) ![Out](../../etc/passwd) '
        + '![Broken](broken.png) ![Git](/.git/config)'
    );
    observer().intersect();

    expect(cache.loads.map(load => load.path)).toEqual([ 'docs/img/missing.png', 'docs/big.png', 'docs/broken.png' ]);
    cache.loads[0]?.answer({ kind: 'failed', reason: 'not-found' });
    cache.loads[1]?.answer({ kind: 'failed', reason: 'too-large' });
    cache.loads[2]?.answer({ kind: 'failed', reason: 'error' });
    await tick();
    expect(placeholders()).toEqual([
      'Missing, Image not found: img/missing.png',
      'Big, This image is too large to preview',
      'Scan, This image format isn\'t supported',
      'Out, Can\'t show this image',
      'Broken, This image couldn\'t be loaded',
      'Git, Can\'t show this image'
    ]);
    expect(container.querySelector('.md-image-placeholder__alt')?.textContent).toBe('Missing');
    expect(container.querySelectorAll('[src]')).toHaveLength(0);
  });

  it('shows a broken image\'s placeholder', async () => {
    block('![Bad](bad.jxl)');
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:1' });
    await tick();

    container.querySelector('img')?.dispatchEvent(new Event('error'));

    expect(placeholders()).toEqual([ 'Bad, This image couldn\'t be loaded' ]);
    expect(cache.users.get('docs/bad.jxl')).toBe(0);
  });

  it('AC-EDIT-003.14: keeps the link around a placeholder', () => {
    block('[![Logo](missing.tiff)](https://example.com)');

    expect(container.querySelector('a > .md-image-placeholder')?.getAttribute('aria-label')).toBe(
      'Logo, This image format isn\'t supported'
    );
  });

  it('AC-EDIT-003.15: names a placeholder by alt text and reason', async () => {
    block('![Logo](missing.png)');
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'failed', reason: 'not-found' });
    await tick();

    const placeholder = container.querySelector('.md-image-placeholder');
    expect(placeholder?.getAttribute('role')).toBe('img');
    expect(placeholder?.getAttribute('aria-label')).toBe('Logo, Image not found: missing.png');
  });

  it('reserves the space of an image with width and height', async () => {
    block('<img src="img/flow.png" width="200" height="100" alt="Flow">');

    const placeholder = container.querySelector<HTMLElement>('.md-image-placeholder');
    expect([ placeholder?.style.inlineSize, placeholder?.style.aspectRatio ]).toEqual([ '200px', '200 / 100' ]);
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:1' });
    await tick();
    const img = container.querySelector('img');
    expect([ img?.getAttribute('width'), img?.getAttribute('height') ]).toEqual([ '200', '100' ]);
    // So that a loaded image of other proportions keeps the written height (IM-11).
    expect(img?.style.aspectRatio).toBe('200 / 100');
  });

  it('keeps a written height without a width', async () => {
    block('<img src="img/flow.png" height="80" alt="Flow"> <img src="img/b.png" alt="B">');
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:1' });
    cache.loads[1]?.answer({ kind: 'loaded', url: 'blob:2' });
    await tick();

    const [ first, second ] = Array.from(container.querySelectorAll('img'));
    expect(first?.style.blockSize).toBe('80px');
    expect(second?.hasAttribute('style')).toBe(false);
  });

  it('shows a cached image at once, so that a block rendered again loads nothing', async () => {
    const first = block('Text ![Flow](img/flow.png)');
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:1' });
    await tick();

    // Typing in the paragraph renders its block again.
    loader.detach([ first ]);
    first.remove();
    const second = block('Text, edited ![Flow](img/flow.png)');
    observer().intersect();

    expect(second.querySelector('img')?.getAttribute('src')).toBe('blob:1');
    expect(cache.loads).toHaveLength(1);
    expect(cache.revalidated).toEqual([]);
    expect(cache.users.get('docs/img/flow.png')).toBe(1);
  });

  it('revalidates a cached image once near the viewport after its file is opened again', async () => {
    const first = block('![Flow](img/flow.png)');
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:1' });
    await tick();

    loader.detach([ first ]);
    first.remove();
    loader.reset();
    const element = block('![Flow](img/flow.png) ![Flow](img/flow.png)');

    expect(element.querySelectorAll('img[src="blob:1"]')).toHaveLength(2);
    expect(cache.revalidated).toEqual([]);
    observer().intersect();
    observer().intersect();
    expect(cache.revalidated).toEqual([ 'docs/img/flow.png' ]);
    expect(cache.loads).toHaveLength(1);
  });

  it('swaps an image whose bytes changed, and shows one that is gone', async () => {
    block('![Flow](img/flow.png)');
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:1' });
    await tick();

    cache.changes.next({ repositoryId: 7, path: 'docs/img/flow.png', result: { kind: 'loaded', url: 'blob:2' } });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:2');
    cache.changes.next({ repositoryId: 7, path: 'docs/img/flow.png', result: { kind: 'failed', reason: 'not-found' } });

    expect(placeholders()).toEqual([ 'Flow, Image not found: img/flow.png' ]);
    expect(cache.users.get('docs/img/flow.png')).toBe(0);
  });

  it('tries a failed image again when its block is rendered again', async () => {
    const first = block('![Flow](img/flow.png)');
    observer().intersect();
    cache.loads[0]?.answer({ kind: 'failed', reason: 'error' });
    await tick();

    loader.detach([ first ]);
    first.remove();
    block('![Flow](img/flow.png)');
    observer().intersect();

    expect(cache.loads).toHaveLength(2);
  });

  it('re-picks a picture source when the scheme changes', async () => {
    const element = block(
      '<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"><img src="light.png" alt="Logo"></picture>'
    );
    observer().intersect();
    expect(cache.loads.map(load => load.path)).toEqual([ 'docs/light.png' ]);
    cache.loads[0]?.answer({ kind: 'loaded', url: 'blob:light' });
    await tick();
    expect(element.querySelector('picture img')?.getAttribute('src')).toBe('blob:light');

    scheme = 'dark';
    window.matchMedia('(prefers-color-scheme: dark)').dispatchEvent(new Event('change'));
    observer().intersect();
    expect(cache.loads.map(load => load.path)).toEqual([ 'docs/light.png', 'docs/dark.png' ]);
    cache.loads[1]?.answer({ kind: 'loaded', url: 'blob:dark' });
    await tick();
    expect(element.querySelector('picture img')?.getAttribute('src')).toBe('blob:dark');
    expect(element.querySelectorAll('[srcset]')).toHaveLength(0);

    scheme = 'light';
    window.matchMedia('(prefers-color-scheme: dark)').dispatchEvent(new Event('change'));
    expect(element.querySelector('picture img')?.getAttribute('src')).toBe('blob:light');
    expect(cache.loads).toHaveLength(2);
  });

  it('AC-EDIT-003.11: shows remote placeholders and loads them after Show remote images, with no referrer', () => {
    const first = block('# Badges');
    const second = block('Build ![build](https://img.shields.io/badge/build-passing-green.svg)');
    const third = block('![](//cdn.example.com/a.png)');

    expect(placeholders()).toEqual([ 'build, Remote image from img.shields.io', 'Remote image from cdn.example.com' ]);
    expect(container.querySelectorAll('[src]')).toHaveLength(0);
    expect(first.querySelector('button')).toBeNull();
    expect(second.firstElementChild?.querySelector('button')?.textContent).toBe('Show remote images');
    expect(third.querySelector('button')).toBeNull();

    second.querySelector('button')?.click();

    const images = Array.from(container.querySelectorAll('img'));
    expect(images.map(img => [ img.getAttribute('src'), img.referrerPolicy ])).toEqual([
      [ 'https://img.shields.io/badge/build-passing-green.svg', 'no-referrer' ],
      [ 'https://cdn.example.com/a.png', 'no-referrer' ]
    ]);
    expect(container.querySelector('button')).toBeNull();
    // Added while the file stays open.
    block('![later](https://example.com/later.png)');
    expect(container.querySelector('img[src="https://example.com/later.png"]')).not.toBeNull();
    container.querySelector('img')?.dispatchEvent(new Event('error'));
    expect(placeholders()).toEqual([ 'build, Remote image couldn\'t be loaded img.shields.io' ]);
  });

  it('moves Show remote images to the first block in file order', () => {
    const later = block('![a](https://a.example.com/a.png)');
    const earlier = document.createElement('div');
    earlier.innerHTML = String(purifyHtml('<img src="https://b.example.com/b.png">'));
    container.prepend(earlier);
    loader.attach([ earlier ]);

    expect(earlier.querySelector('button')).not.toBeNull();
    expect(later.querySelector('button')).toBeNull();
    loader.detach([ earlier ]);
    earlier.remove();
    expect(later.querySelector('button')).not.toBeNull();
  });

  it('AC-EDIT-003.12: never loads http images', () => {
    block('![a](http://example.com/a.png) ![b](https://example.com/b.png)');
    container.querySelector('button')?.click();

    expect(placeholders()).toEqual([ 'a, Insecure image (http) isn\'t shown' ]);
    expect(container.querySelector('img[src^="http:"]')).toBeNull();
  });

  it('forgets Show remote images when another file is opened', () => {
    const first = block('![b](https://example.com/b.png)');
    container.querySelector('button')?.click();

    loader.detach([ first ]);
    first.remove();
    loader.reset();
    block('![b](https://example.com/b.png)');

    expect(placeholders()).toEqual([ 'b, Remote image from example.com' ]);
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('resolves every image again when the open file moves', () => {
    block('![a](a.tiff) ![b](../b.png)');
    filePath = 'guide.md';

    loader.refresh();

    expect(placeholders()).toEqual([ 'a, This image format isn\'t supported', 'b, Can\'t show this image' ]);
  });
});
