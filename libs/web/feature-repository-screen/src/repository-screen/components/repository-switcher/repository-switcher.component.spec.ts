import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RecentRepositories, RepositorySummary } from '@front-burner/shared-contracts';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { Observable, of, Subject, throwError } from 'rxjs';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { RepositorySwitcherComponent } from './repository-switcher.component';

const KEY = 'web-feature-repository-screen.RepositorySwitcherComponent';
const STATUS = 'web-shell.RepositoryStatusComponent';

const summary = (id: number, name: string, extra: Partial<RepositorySummary> = {}): RepositorySummary => ({
  id,
  name,
  remote: `github.com/acme/${name}`,
  status: 'ready',
  error: null,
  warnings: [],
  lastAccessedAt: '2026-10-28T10:00:00.000Z',
  ...extra
});

const handbook = summary(12, 'handbook');

describe('RepositorySwitcherComponent', () => {
  let fixture: ComponentFixture<RepositorySwitcherComponent>;
  let recent: ReturnType<typeof vi.fn<(query?: { exclude?: number; }) => Observable<RecentRepositories>>>;

  const trigger = () => (fixture.nativeElement as HTMLElement).querySelector('button.name') as HTMLButtonElement;
  const menu = () => document.querySelector('.cdk-overlay-container ui-menu') as HTMLElement | null;
  const items = () =>
    // A bound `[uiMenuItem]` leaves no attribute; every item is a link or a button.
    [ ...(menu()?.querySelectorAll('a, button') ?? []) ].map(item => ({
      text: item.querySelector('.label')?.textContent?.replace(/\s+/g, ' ').trim(),
      href: item.getAttribute('href')
    }));

  async function show(inputs: { narrow?: boolean; } = {}): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ RepositorySwitcherComponent, translocoTesting() ],
      providers: [ provideRouter([]), { provide: RepositoriesApi, useValue: { recent } } ]
    });
    fixture = TestBed.createComponent(RepositorySwitcherComponent);
    fixture.componentRef.setInput('repository', handbook);
    fixture.componentRef.setInput('narrow', inputs.narrow ?? false);
    await settle(fixture);
  }

  async function open(): Promise<void> {
    trigger().click();
    await settle(fixture);
  }

  beforeEach(() => {
    recent = vi.fn(() => of({ repositories: [] }));
  });

  it('names the trigger after the repository and says it opens a menu', async () => {
    await show();

    expect(trigger().textContent?.trim()).toBe('handbook');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(recent).not.toHaveBeenCalled();
  });

  it('lists other repositories with their status', async () => {
    recent.mockReturnValue(of({
      repositories: [ summary(3, 'notes'), summary(4, 'blog', { warnings: [ 'key-locked' ] }) ]
    }));
    await show();

    await open();

    expect(recent).toHaveBeenCalledWith({ exclude: 12 });
    expect(items()).toEqual([
      { text: 'notes', href: '/repositories/3' },
      { text: `blog ${STATUS}.warning.key-locked`, href: '/repositories/4' },
      { text: `${KEY}.all`, href: '/repositories' },
      { text: `${KEY}.settings`, href: '/repositories/12/settings' }
    ]);
  });

  it('links a cloning repository to its settings', async () => {
    recent.mockReturnValue(of({
      repositories: [
        summary(3, 'notes', { status: 'cloning' }),
        summary(4, 'blog', { status: 'error', error: 'clone-failed' })
      ]
    }));
    await show();

    await open();

    expect(items().slice(0, 2)).toEqual([
      { text: `notes ${STATUS}.status.cloning`, href: '/repositories/3/settings' },
      { text: `blog ${STATUS}.status.error`, href: '/repositories/4/settings' }
    ]);
  });

  it('offers All repositories and Repository settings', async () => {
    await show();

    await open();

    expect(items()).toEqual([
      { text: `${KEY}.all`, href: '/repositories' },
      { text: `${KEY}.settings`, href: '/repositories/12/settings' }
    ]);
  });

  it('offers Dashboard on narrow screens', async () => {
    recent.mockReturnValue(of({ repositories: [ summary(3, 'notes') ] }));
    await show({ narrow: true });

    await open();

    expect(items().slice(1)).toEqual([
      { text: `${KEY}.dashboard`, href: '/' },
      { text: `${KEY}.all`, href: '/repositories' },
      { text: `${KEY}.settings`, href: '/repositories/12/settings' }
    ]);
  });

  it('shows the full name in a tooltip only while it is shortened', async () => {
    // jsdom has neither layout nor ResizeObserver: the widths are stubbed, and
    // the observer's callback is run by hand.
    let callback: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(observed: ResizeObserverCallback) {
          callback = observed;
        }
        observe(): void {
          // Run by `resize()`.
        }
        disconnect(): void {
          // Nothing to release.
        }
      }
    );
    let scrollWidth = 80;
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => scrollWidth);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
    const resize = async (width: number) => {
      scrollWidth = width;
      callback?.([], {} as ResizeObserver);
      await settle(fixture);
    };
    const description = () => document.getElementById(trigger().getAttribute('aria-describedby') ?? '');

    try {
      await show();
      expect(trigger().hasAttribute('aria-describedby')).toBe(false);

      await resize(200);
      expect(description()?.textContent).toBe('handbook');

      await resize(80);
      expect(trigger().hasAttribute('aria-describedby')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('shows a loading row until the list arrives, every time it opens', async () => {
    const answers = [ new Subject<RecentRepositories>(), new Subject<RecentRepositories>() ];
    recent.mockReturnValueOnce(answers[0]).mockReturnValueOnce(answers[1]);
    await show();

    await open();
    expect(menu()?.textContent).toContain(`${KEY}.loading`);
    answers[0].next({ repositories: [ summary(3, 'notes') ] });
    answers[0].complete();
    await settle(fixture);
    expect(menu()?.textContent).not.toContain(`${KEY}.loading`);
    expect(items()[0]).toEqual({ text: 'notes', href: '/repositories/3' });
    expect(document.activeElement?.textContent?.trim()).toBe('notes');

    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await settle(fixture);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await open();

    expect(recent).toHaveBeenCalledTimes(2);
    expect(menu()?.textContent).toContain(`${KEY}.loading`);
  });

  it('keeps the links when the list fails', async () => {
    recent.mockReturnValue(throwError(() => new Error('offline')));
    await show();

    await open();

    expect(menu()?.textContent).toContain(`${KEY}.loadFailed`);
    expect(items()).toEqual([
      { text: `${KEY}.retry`, href: null },
      { text: `${KEY}.all`, href: '/repositories' },
      { text: `${KEY}.settings`, href: '/repositories/12/settings' }
    ]);
  });

  it('loads the list again with Try again and keeps the menu open', async () => {
    recent.mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of({ repositories: [ summary(3, 'notes') ] }));
    await show();
    await open();

    (menu()?.querySelector('[uiMenuItem="retry"]') as HTMLButtonElement).click();
    await settle(fixture);

    expect(recent).toHaveBeenCalledTimes(2);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(items()[0]).toEqual({ text: 'notes', href: '/repositories/3' });
  });
});
