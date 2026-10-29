import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { ButtonComponent } from '../../../controls/components/button/button.component';
import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { TOOLTIP_HIDE_DELAY_MS, TOOLTIP_LONG_PRESS_MS, TOOLTIP_SHOW_DELAY_MS } from '../../utils/tooltip/tooltip.util';
import { TooltipDirective } from './tooltip.directive';

@Component({
  imports: [ ButtonComponent, IconButtonComponent, IconComponent, TooltipDirective ],
  template: `
    <button uiButton unavailable uiTooltip="Nothing to push">Push</button>
    <button uiIconButton label="Ignored" uiTooltip="Ignored by .gitignore. Git won't commit this file." uiTooltipShowOnClick>
      <ui-icon name="diff-ignored" />
    </button>
    <button>Elsewhere</button>
    <button uiTooltip="handbook-with-a-long-name" uiTooltipLongPress (click)="clicks.set(clicks() + 1)">handbook…</button>
    <button [uiTooltip]="fullName()" uiTooltipLongPress (click)="clicks.set(clicks() + 1)">notes</button>
    <button uiTooltip="Fetch from the remote" (click)="clicks.set(clicks() + 1)">Fetch</button>
    <span uiTooltip="Shown from outside" [uiTooltipShown]="shown()">Row</span>
  `
})
class HostComponent {
  readonly shown = signal(false);
  readonly clicks = signal(0);
  /** Empty while the name is shown in full. */
  readonly fullName = signal('');
}

describe('TooltipDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  const button = (text: string) =>
    [ ...fixture.nativeElement.querySelectorAll('button') ].find(
      (element: HTMLButtonElement) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === text
    ) as HTMLButtonElement;
  const shown = () => [ ...document.querySelectorAll('ui-tooltip') ].map(element => element.textContent?.trim());
  // jsdom decides `:focus-visible` from the last event, as browsers do.
  const keyboardFocus = (element: HTMLElement) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    element.focus();
  };
  const pointer = (element: Element, type: 'pointerenter' | 'pointerleave') =>
    element.dispatchEvent(new MouseEvent(type));
  // jsdom has no PointerEvent; the tooltip reads only `pointerType`.
  const touch = (element: Element, type: 'pointerdown' | 'pointerup' | 'pointercancel') =>
    element.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true }), { pointerType: 'touch' }));
  /** Long-presses `element` and lifts the finger, without the click that may follow. */
  const longPress = (element: Element) => {
    touch(element, 'pointerdown');
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS);
    touch(element, 'pointerup');
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows while uiTooltipShown is true, whatever the pointer does', () => {
    const host = fixture.componentInstance;
    const span = fixture.nativeElement.querySelector('span[uitooltip]') as HTMLElement;

    host.shown.set(true);
    fixture.detectChanges();
    expect(shown()).toEqual([ 'Shown from outside' ]);

    pointer(span, 'pointerenter');
    pointer(span, 'pointerleave');
    vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS);
    expect(shown()).toEqual([ 'Shown from outside' ]);

    host.shown.set(false);
    fixture.detectChanges();
    expect(shown()).toEqual([]);
  });

  it('describes its host before it is ever shown', () => {
    const id = button('Push').getAttribute('aria-describedby') as string;

    expect(document.getElementById(id)?.textContent).toBe('Nothing to push');
  });

  it('shows after a hover delay and hides when the pointer leaves', () => {
    pointer(button('Push'), 'pointerenter');
    expect(shown()).toEqual([]);

    vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS - 1);
    expect(shown()).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([ 'Nothing to push' ]);

    pointer(button('Push'), 'pointerleave');
    vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS);
    expect(shown()).toEqual([]);
  });

  it('stays shown while the pointer moves onto it', () => {
    pointer(button('Push'), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);

    pointer(button('Push'), 'pointerleave');
    pointer(document.querySelector('ui-tooltip') as Element, 'pointerenter');
    vi.advanceTimersByTime(1000);

    expect(shown()).toEqual([ 'Nothing to push' ]);
  });

  it('shows at once on keyboard focus and hides on blur', () => {
    keyboardFocus(button('Push'));
    expect(shown()).toEqual([ 'Nothing to push' ]);

    keyboardFocus(button('Elsewhere'));
    expect(shown()).toEqual([]);
  });

  it('hides on Escape without moving the focus', () => {
    keyboardFocus(button('Push'));
    expect(shown()).toEqual([ 'Nothing to push' ]);

    button('Push').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(shown()).toEqual([]);
    expect(document.activeElement).toBe(button('Push'));
  });

  it('shows on click for an unavailable button', () => {
    button('Push').click();
    expect(shown()).toEqual([ 'Nothing to push' ]);

    button('Elsewhere').click();
    expect(shown()).toEqual([]);
  });

  it('shows on tap when asked to', () => {
    button('Ignored').click();

    expect(shown()).toEqual([ 'Ignored by .gitignore. Git won\'t commit this file.' ]);
  });

  it('shows on a long press and swallows the click that ends it', () => {
    const name = button('handbook…');

    touch(name, 'pointerdown');
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS);
    expect(shown()).toEqual([ 'handbook-with-a-long-name' ]);

    touch(name, 'pointerup');
    name.click();
    expect(fixture.componentInstance.clicks()).toBe(0);
    expect(shown()).toEqual([ 'handbook-with-a-long-name' ]);

    button('Elsewhere').click();
    expect(shown()).toEqual([]);
  });

  it('swallows no later mouse click when a long press ended without one', () => {
    const name = button('handbook…');
    touch(name, 'pointerdown');
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS);
    touch(name, 'pointerup');

    name.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true }), { pointerType: 'mouse' }));
    name.click();

    expect(fixture.componentInstance.clicks()).toBe(1);
  });

  it('ignores a long press unless asked to', () => {
    const fetch = button('Fetch');

    longPress(fetch);
    fetch.click();

    expect(shown()).toEqual([]);
    expect(fixture.componentInstance.clicks()).toBe(1);
  });

  it('swallows no click when there is nothing to show', () => {
    const notes = button('notes');

    longPress(notes);
    notes.click();

    expect(shown()).toEqual([]);
    expect(fixture.componentInstance.clicks()).toBe(1);
  });

  it('swallows no later click when the finger slid off before lifting', () => {
    const name = button('handbook…');
    longPress(name);
    vi.advanceTimersByTime(1000);

    // Enter on a focused button, with no pointer at all.
    name.click();

    expect(fixture.componentInstance.clicks()).toBe(1);
  });

  it('shows at once and keeps the platform\'s menu away when that long press comes first', () => {
    const name = button('handbook…');
    touch(name, 'pointerdown');
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS - 100);

    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    name.dispatchEvent(menu);

    expect(menu.defaultPrevented).toBe(true);
    expect(shown()).toEqual([ 'handbook-with-a-long-name' ]);
    touch(name, 'pointerup');
    name.click();
    expect(fixture.componentInstance.clicks()).toBe(0);
  });

  it('leaves a short tap alone', () => {
    const name = button('handbook…');

    touch(name, 'pointerdown');
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS - 100);
    touch(name, 'pointerup');
    name.click();
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS);

    expect(shown()).toEqual([]);
    expect(fixture.componentInstance.clicks()).toBe(1);
  });

  it('does not show when the touch is cancelled, such as by scrolling', () => {
    const name = button('handbook…');

    touch(name, 'pointerdown');
    touch(name, 'pointercancel');
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS);

    expect(shown()).toEqual([]);
  });
});
