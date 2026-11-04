import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { TOOLTIP_LONG_PRESS_MS, TOOLTIP_SHOW_DELAY_MS } from '../../utils/tooltip/tooltip.util';
import { TruncatedTooltipDirective } from './truncated-tooltip.directive';

@Component({
  imports: [ TruncatedTooltipDirective ],
  template: `
    <span
      #tip="uiTruncatedTooltip"
      [uiTruncatedTooltip]="name()"
      uiTruncatedTooltipLongPress
      [attr.tabindex]="tip.truncated() ? 0 : null"
    >{{ name() }}</span>
  `
})
class HostComponent {
  readonly name = signal('handbook');
}

describe('TruncatedTooltipDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  /** The observer's callback: jsdom has neither layout nor ResizeObserver. */
  let resized: ResizeObserverCallback | undefined;
  let observers: number;
  let scrollWidth: number;

  const span = () => fixture.nativeElement.querySelector('span') as HTMLElement;
  const shown = () => [ ...document.querySelectorAll('ui-tooltip') ].map(element => element.textContent?.trim());
  const resize = async (width: number) => {
    scrollWidth = width;
    resized?.([], {} as ResizeObserver);
    await fixture.whenStable();
  };
  const hover = () => {
    span().dispatchEvent(new MouseEvent('pointerenter'));
    vi.advanceTimersByTime(TOOLTIP_SHOW_DELAY_MS);
  };

  beforeEach(async () => {
    observers = 0;
    scrollWidth = 80;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = callback;
          observers++;
        }
        observe(): void {
          // Run by `resize()`.
        }
        disconnect(): void {
          // Nothing to release.
        }
      }
    );
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => scrollWidth);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
    TestBed.configureTestingModule({ imports: [ HostComponent ] });
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows nothing while the text fits', () => {
    vi.useFakeTimers();
    hover();

    expect(shown()).toEqual([]);
    expect(span().getAttribute('tabindex')).toBeNull();
  });

  it('shows the full text while it is shortened', async () => {
    await resize(200);
    vi.useFakeTimers();
    hover();

    expect(shown()).toEqual([ 'handbook' ]);
    expect(span().getAttribute('tabindex')).toBe('0');
  });

  it('never describes the host, whose text is already its name', async () => {
    await resize(200);

    expect(span().hasAttribute('aria-describedby')).toBe(false);
  });

  it('measures a new text once it has rendered, with the one observer', async () => {
    await resize(200);
    expect(span().getAttribute('tabindex')).toBe('0');

    scrollWidth = 40;
    fixture.componentInstance.name.set('main');
    await fixture.whenStable();

    expect(span().getAttribute('tabindex')).toBeNull();
    expect(observers).toBe(1);
  });

  it('shows on a long press when asked to', async () => {
    await resize(200);
    vi.useFakeTimers();

    span().dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true }), { pointerType: 'touch' }));
    vi.advanceTimersByTime(TOOLTIP_LONG_PRESS_MS);

    expect(shown()).toEqual([ 'handbook' ]);
  });
});
