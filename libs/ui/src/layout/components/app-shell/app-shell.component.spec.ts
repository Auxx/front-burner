import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppShellSideDirective } from '../../directives/app-shell-side/app-shell-side.directive';
import {
  FakeBreakpointObserver,
  provideFakeBreakpointObserver
} from '../../utils/narrow-viewport/narrow-viewport.testing';
import { AppShellComponent } from './app-shell.component';

@Component({
  imports: [ AppShellComponent, AppShellSideDirective ],
  template: `
    <button type="button" class="outside">Outside</button>
    <button type="button" class="other">Other</button>
    <ui-app-shell skipLinkLabel="Skip to content" [(sideOpen)]="sideOpen" [(drawerOpen)]="drawerOpen" [(sideSize)]="sideSize">
      <span uiAppShellHeader>Front Burner</span>
      @if (withSide()) {
        <div uiAppShellSide resizeLabel="Resize side panel">
          <button type="button" class="opener">Tree</button>
        </div>
      }
      <p class="content">Content</p>
    </ui-app-shell>
  `
})
class HostComponent {
  readonly sideOpen = signal(true);
  readonly drawerOpen = signal(false);
  readonly sideSize = signal(20);
  readonly withSide = signal(true);
}

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;
  let breakpoints: FakeBreakpointObserver;

  const query = <T extends HTMLElement = HTMLElement>(selector: string) => element.querySelector(selector) as T | null;
  const main = () => query('main') as HTMLElement;
  const side = () => query('[uiAppShellSide]') as HTMLElement;
  const separator = () => query('[role="separator"]');
  const isShown = (child: HTMLElement) => !child.closest('[hidden]');

  const setViewport = async (narrow: boolean) => {
    breakpoints.set(narrow);
    await fixture.whenStable();
  };

  const set = async (update: () => void) => {
    update();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    breakpoints = new FakeBreakpointObserver();
    await TestBed.configureTestingModule({
      imports: [ HostComponent ],
      providers: [ provideFakeBreakpointObserver(breakpoints) ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement;
    document.body.append(element);
    await fixture.whenStable();
  });

  afterEach(() => element.remove());

  it('has banner and main landmarks and a skip link to main', () => {
    const skip = query<HTMLAnchorElement>('a.skip-link') as HTMLAnchorElement;
    expect(skip.textContent?.trim()).toBe('Skip to content');
    expect(query('ui-app-shell')?.firstElementChild).toBe(skip);
    expect(query('header span')?.textContent).toBe('Front Burner');
    expect(main().querySelector('.content')).toBeTruthy();

    skip.click();
    expect(document.activeElement).toBe(main());
  });

  it('shows side and main side by side on wide screens', () => {
    expect(separator()?.getAttribute('aria-label')).toBe('Resize side panel');
    expect(isShown(side())).toBe(true);
    expect(isShown(main())).toBe(true);
  });

  it('collapses the side panel on wide screens', async () => {
    await set(() => host.sideOpen.set(false));

    expect(isShown(side())).toBe(false);
    expect(isShown(main())).toBe(true);
    expect(separator()).toBeNull();
  });

  it('shows only main when there is no side content', async () => {
    await set(() => host.withSide.set(false));

    expect(separator()).toBeNull();
    expect(isShown(main())).toBe(true);
  });

  it('starts on narrow screens with the drawer closed', async () => {
    await setViewport(true);

    expect(isShown(side())).toBe(false);
    expect(isShown(main())).toBe(true);
    expect(separator()).toBeNull();
  });

  it('shows the drawer instead of main on narrow screens', async () => {
    await setViewport(true);

    await set(() => host.drawerOpen.set(true));
    expect(isShown(side())).toBe(true);
    expect(isShown(main())).toBe(false);

    await set(() => host.drawerOpen.set(false));
    expect(isShown(side())).toBe(false);
    expect(isShown(main())).toBe(true);
  });

  it('moves focus into the drawer and back', async () => {
    await setViewport(true);
    const outside = query('.outside') as HTMLElement;
    outside.focus();

    await set(() => host.drawerOpen.set(true));
    expect(document.activeElement).toBe(side());

    side().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(host.drawerOpen()).toBe(false);
    expect(host.sideOpen()).toBe(true);
    expect(document.activeElement).toBe(outside);
  });

  it('focuses main when the opener is gone', async () => {
    await setViewport(true);
    const outside = query('.outside') as HTMLElement;
    outside.focus();
    await set(() => host.drawerOpen.set(true));

    outside.remove();
    await set(() => host.drawerOpen.set(false));

    expect(document.activeElement).toBe(main());
  });

  it('focuses main when nothing had the focus when the drawer opened', async () => {
    // iOS Safari does not focus a tapped button.
    await setViewport(true);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    await set(() => host.drawerOpen.set(true));
    await set(() => host.drawerOpen.set(false));

    expect(document.activeElement).toBe(main());
  });

  it('leaves the focus where the consumer put it when the drawer closes', async () => {
    await setViewport(true);
    (query('.outside') as HTMLElement).focus();
    await set(() => host.drawerOpen.set(true));

    // A consumer that closes the drawer and focuses something else at once.
    const other = query('.other') as HTMLElement;
    host.drawerOpen.set(false);
    other.focus();
    await fixture.whenStable();

    expect(document.activeElement).toBe(other);
  });

  it('ignores Escape from outside the drawer', async () => {
    await setViewport(true);
    await set(() => host.drawerOpen.set(true));

    query('header span')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(host.drawerOpen()).toBe(true);
  });

  it('ignores an Escape that a control in the drawer has handled', async () => {
    await setViewport(true);
    await set(() => host.drawerOpen.set(true));

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    escape.preventDefault();
    (query('.opener') as HTMLElement).dispatchEvent(escape);
    await fixture.whenStable();

    expect(host.drawerOpen()).toBe(true);
  });

  it('ignores Escape on wide screens', async () => {
    side().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(host.sideOpen()).toBe(true);
  });

  it('keeps main and the focus when a wide screen becomes narrow', async () => {
    const opener = query('.opener') as HTMLElement;
    opener.focus();

    await setViewport(true);

    expect(isShown(main())).toBe(true);
    expect(isShown(side())).toBe(false);
    expect(host.drawerOpen()).toBe(false);
    expect(host.sideOpen()).toBe(true);
  });

  it('closes the drawer without moving the focus when a narrow screen becomes wide', async () => {
    await setViewport(true);
    await set(() => host.drawerOpen.set(true));
    const opener = query('.opener') as HTMLElement;
    opener.focus();

    await setViewport(false);

    expect(host.drawerOpen()).toBe(false);
    expect(isShown(side())).toBe(true);
    expect(isShown(main())).toBe(true);
    expect(separator()).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps the side size in sync with the split', async () => {
    separator()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();

    expect(host.sideSize()).toBe(25);
  });

  it('exposes whether the viewport is narrow', async () => {
    const shell = fixture.debugElement.children
      .find(child => child.componentInstance instanceof AppShellComponent)
      ?.componentInstance as AppShellComponent;
    expect(shell.narrow()).toBe(false);

    await setViewport(true);
    expect(shell.narrow()).toBe(true);
  });
});
