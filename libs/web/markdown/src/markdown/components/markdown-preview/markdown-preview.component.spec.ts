import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { PREVIEW_WORKER, type PreviewSource } from '../../services/preview-renderer/preview-renderer.service';
import type { PreviewRequest, PreviewResponse } from '../../worker/preview-protocol';
import { MarkdownPreviewComponent, type PreviewPathLink } from './markdown-preview.component';

/** A worker that records requests and answers when told to. */
class FakeWorker extends EventTarget {
  readonly requests: PreviewRequest[] = [];

  postMessage(request: PreviewRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    // Nothing to stop.
  }

  /** Answers the latest update with blocks given as `[key, html]`. */
  answer(blocks: [ string, string ][]): void {
    const latest = this.requests.findLast(request => request.type === 'update');
    const response: PreviewResponse = {
      type: 'update',
      id: latest?.type === 'update' ? latest.id : 0,
      layout: blocks.map(([ key ], index) => ({ key, fromLine: index + 1, toLine: index + 1 })),
      rendered: blocks.map(([ key, html ]) => ({ key, html, removals: [] })),
      removals: []
    };
    this.dispatchEvent(new MessageEvent('message', { data: response }));
  }
}

function source(text: string): PreviewSource {
  return { version: signal(0), read: () => text };
}

@Component({
  imports: [ MarkdownPreviewComponent ],
  template: `<md-preview
    [source]="source()"
    [path]="path()"
    [label]="label()"
    [fragment]="fragment()"
    [active]="active()"
    (openPath)="opened.push($event)"
    (scrolled)="places.push($event)"
  />`
})
class HostComponent {
  readonly source = signal(source('# A'));
  readonly path = signal('docs/a.md');
  readonly label = signal('a.md');
  readonly fragment = signal<string | null>(null);
  readonly active = signal(true);
  readonly opened: PreviewPathLink[] = [];
  readonly places: number[] = [];
}

describe('MarkdownPreviewComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let worker: FakeWorker;
  let scrolled: Element[];

  beforeEach(async () => {
    worker = new FakeWorker();
    scrolled = [];
    Element.prototype.scrollIntoView = function(this: Element) {
      scrolled.push(this);
    };
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: { 'web-markdown.MarkdownPreviewComponent.label': 'Preview of {{ name }}' } },
          preloadLangs: true,
          translocoConfig: { availableLangs: [ 'en' ], defaultLang: 'en' }
        })
      ],
      providers: [ { provide: PREVIEW_WORKER, useValue: () => worker } ]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => Reflect.deleteProperty(Element.prototype, 'scrollIntoView'));

  const element = () => fixture.nativeElement as HTMLElement;
  const blocks = () => element().querySelector('.blocks') as HTMLElement;

  async function answer(blocks: [ string, string ][]): Promise<void> {
    worker.answer(blocks);
    await fixture.whenStable();
  }

  it('renders the blocks in layout order', async () => {
    await answer([ [ 'a', '<h1 id="user-content-a">A</h1>' ], [ 'b', '<p>B</p>' ] ]);

    expect(Array.from(blocks().children, child => child.textContent)).toEqual([ 'A', 'B' ]);
  });

  it('replaces only the changed block\'s element', async () => {
    await answer([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ] ]);
    const first = blocks().children[0];

    await answer([ [ 'a', '<p>A</p>' ], [ 'c', '<p>C</p>' ] ]);

    expect(blocks().children[0]).toBe(first);
    expect(blocks().children[1].textContent).toBe('C');
  });

  it('purifies what it writes', async () => {
    await answer([ [ 'a', '<p onclick="alert(1)">A<script>alert(2)</script></p>' ] ]);

    expect(blocks().innerHTML).toBe(
      '<div class="md-block" dir="auto" data-from-line="1" data-to-line="1">'
        + '<p>A</p></div>'
    );
  });

  it('labels the region with the file name', async () => {
    const region = element().querySelector('section');

    expect(region?.getAttribute('aria-label')).toBe('Preview of a.md');
    host.label.set('b.md');
    await fixture.whenStable();
    expect(region?.getAttribute('aria-label')).toBe('Preview of b.md');
  });

  it('shows nothing of the previous file while another one renders', async () => {
    await answer([ [ 'a', '<p><a href="guide.md">Guide</a></p>' ] ]);

    host.source.set(source('Other'));
    host.path.set('notes/x.md');
    await fixture.whenStable();

    expect(blocks().children).toHaveLength(0);
    await answer([ [ 'b', '<p>B</p>' ] ]);
    expect(blocks().textContent).toBe('B');
  });

  it('renders another file from scratch', async () => {
    await answer([ [ 'a', '<p>A</p>' ] ]);

    host.source.set(source('Other'));
    await fixture.whenStable();

    expect(worker.requests.slice(-2)).toEqual([ { type: 'reset' }, expect.objectContaining({ source: 'Other' }) ]);
  });

  describe('links', () => {
    async function click(href: string, init: MouseEventInit & { type?: string; } = {}): Promise<MouseEvent> {
      await answer([ [ 'h', '<h2 id="user-content-set-up">Set up</h2>' ], [
        'l',
        `<p><a href="${href}">link</a></p>`
      ] ]);
      const event = new MouseEvent(init.type ?? 'click', { bubbles: true, cancelable: true, ...init });
      blocks().querySelector('a')?.dispatchEvent(event);
      return event;
    }

    it('lets the browser open an external link in a new tab', async () => {
      const event = await click('https://example.com');

      expect(event.defaultPrevented).toBe(false);
      expect(blocks().querySelector('a')?.getAttribute('target')).toBe('_blank');
    });

    it('scrolls to a prefixed heading', async () => {
      const event = await click('#set-up');

      expect(event.defaultPrevented).toBe(true);
      expect(scrolled).toEqual([ blocks().querySelector('h2') ]);
    });

    it('emits a relative path with its fragment', async () => {
      const event = await click('../guide.md#install');

      expect(event.defaultPrevented).toBe(true);
      expect(host.opened).toEqual([ { path: 'guide.md', fragment: 'install', newTab: false } ]);
    });

    it.each([
      [ 'Ctrl', { ctrlKey: true } ],
      [ 'Cmd', { metaKey: true } ],
      [ 'Shift', { shiftKey: true } ],
      [ 'the middle button', { type: 'auxclick', button: 1 } ]
    ])('asks for a new tab after a click with %s', async (_name, init) => {
      const event = await click('../guide.md', init);

      expect(event.defaultPrevented).toBe(true);
      expect(host.opened).toEqual([ { path: 'guide.md', fragment: null, newTab: true } ]);
    });

    it('leaves a right click alone', async () => {
      const event = await click('../guide.md', { type: 'auxclick', button: 2 });

      expect(event.defaultPrevented).toBe(false);
      expect(host.opened).toEqual([]);
    });

    it('scrolls to the heading of a link to the open file itself', async () => {
      const event = await click('a.md#set-up');

      expect(event.defaultPrevented).toBe(true);
      expect(host.opened).toEqual([]);
      expect(scrolled).toEqual([ blocks().querySelector('h2') ]);
    });

    it('ignores a link above the root', async () => {
      const event = await click('../../../etc/passwd');

      expect(event.defaultPrevented).toBe(true);
      expect(host.opened).toEqual([]);
    });
  });

  it('scrolls to the fragment it was opened with, once', async () => {
    host.fragment.set('set-up');
    await fixture.whenStable();
    await answer([ [ 'a', '<p>A</p>' ], [ 'h', '<h2 id="user-content-set-up">Set up</h2>' ] ]);
    await answer([ [ 'b', '<p>B</p>' ], [ 'h', '<h2 id="user-content-set-up">Set up</h2>' ] ]);

    expect(scrolled).toEqual([ blocks().querySelector('h2') ]);
  });

  it('scrolls to the same fragment again after the screen had none', async () => {
    host.fragment.set('set-up');
    await fixture.whenStable();
    await answer([ [ 'h', '<h2 id="user-content-set-up">Set up</h2>' ] ]);

    host.fragment.set(null);
    await fixture.whenStable();
    host.fragment.set('set-up');
    await fixture.whenStable();

    expect(scrolled).toHaveLength(2);
  });

  it('keeps Hide on the removal notice until another file is opened', async () => {
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'update',
          id: 1,
          layout: [ { key: 'a', fromLine: 1, toLine: 1 } ],
          rendered: [ { key: 'a', html: '<p>A</p>', removals: [] } ],
          removals: [ [ 'tag:script', 1 ] ]
        } satisfies PreviewResponse
      })
    );
    await fixture.whenStable();
    const notice = () => element().querySelector('md-removal-notice ui-inline-banner');
    expect(notice()).not.toBeNull();

    const hide = Array.from(element().querySelectorAll('md-removal-notice button')).at(-1) as HTMLButtonElement;
    hide.click();
    await fixture.whenStable();
    expect(notice()).toBeNull();

    host.source.set(source('Other'));
    await fixture.whenStable();
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'update',
          id: 2,
          layout: [ { key: 'b', fromLine: 1, toLine: 1 } ],
          rendered: [ { key: 'b', html: '<p>B</p>', removals: [] } ],
          removals: [ [ 'tag:script', 1 ] ]
        } satisfies PreviewResponse
      })
    );
    await fixture.whenStable();
    expect(notice()).not.toBeNull();
  });
  describe('places', () => {
    /** Gives the blocks a layout of 100 px each, which follows `scrollTop` (jsdom has none). */
    function layOut(): void {
      const container = blocks();
      let scrollTop = 0;
      Object.defineProperty(container, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
          // Browsers fire `scroll` after the change, not during it.
          setTimeout(() => container.dispatchEvent(new Event('scroll')));
        }
      });
      container.getBoundingClientRect = () => new DOMRect(0, 0, 100, 300);
      Array.from(container.children).forEach((block, index) => {
        block.getBoundingClientRect = () => new DOMRect(0, index * 100 - scrollTop, 100, 100);
      });
    }

    function preview() {
      return fixture.debugElement.query(By.directive(MarkdownPreviewComponent))
        .componentInstance as MarkdownPreviewComponent;
    }

    beforeEach(async () => {
      // Lines 1, 3 to 6 and 8.
      await answer([ [ 'a', '<p>A</p>' ], [ 'b', '<p>B</p>' ], [ 'c', '<p>C</p>' ] ]);
      const [ a, b, c ] = Array.from(blocks().children);
      a.setAttribute('data-to-line', '1');
      b.setAttribute('data-from-line', '3');
      b.setAttribute('data-to-line', '6');
      c.setAttribute('data-from-line', '8');
      c.setAttribute('data-to-line', '8');
      layOut();
    });

    it('scrolls to a line and a share of its block', () => {
      preview().scrollToLine(5);

      expect(blocks().scrollTop).toBe(150);
      expect(preview().topLine()).toBe(5);
    });

    it('does not report a scroll it made itself', async () => {
      preview().scrollToLine(5);
      await new Promise(resolve => setTimeout(resolve));
      expect(host.places).toEqual([]);

      blocks().scrollTop = 100;
      await new Promise(resolve => setTimeout(resolve));

      expect(host.places).toEqual([ 3 ]);
    });
  });

  it('does no work while inactive', async () => {
    host.active.set(false);
    await fixture.whenStable();
    const sent = worker.requests.length;

    host.source.set(source('# B'));
    await fixture.whenStable();

    expect(worker.requests.slice(sent).filter(request => request.type === 'update')).toEqual([]);
    host.active.set(true);
    await fixture.whenStable();
    expect(worker.requests.at(-1)).toEqual(expect.objectContaining({ type: 'update', source: '# B' }));
  });
});
