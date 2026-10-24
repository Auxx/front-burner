import { Dir } from '@angular/cdk/bidi';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SplitPaneComponent, SplitPaneShow } from './split-pane.component';

@Component({
  imports: [ SplitPaneComponent, Dir ],
  template: `
    <div [dir]="dir()">
      <ui-split-pane
        [(size)]="size"
        [orientation]="orientation()"
        [show]="show()"
        separatorLabel="Resize file tree"
      >
        <p uiSplitPaneStart>Tree</p>
        <p uiSplitPaneEnd>Editor</p>
      </ui-split-pane>
    </div>
  `
})
class HostComponent {
  readonly size = signal(30);
  readonly orientation = signal<'horizontal' | 'vertical'>('horizontal');
  readonly show = signal<SplitPaneShow>('both');
  readonly dir = signal<'ltr' | 'rtl'>('ltr');
}

describe('SplitPaneComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;

  const splitPane = () => element.querySelector('ui-split-pane') as HTMLElement;
  const separator = () => element.querySelector('[role="separator"]') as HTMLElement | null;
  const pane = (name: 'start' | 'end') => element.querySelector(`.pane.${name}`) as HTMLElement;

  const press = async (key: string) => {
    separator()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };

  const pointer = async (type: string, clientX: number, clientY = 0) => {
    const event = new MouseEvent(type, { clientX, clientY, bubbles: true }) as MouseEvent & { pointerId: number; };
    Object.defineProperty(event, 'pointerId', { value: 1 });
    separator()?.dispatchEvent(event);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('describes the separator for assistive technology', () => {
    const sep = separator() as HTMLElement;
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    expect(sep.getAttribute('aria-valuenow')).toBe('30');
    expect(sep.getAttribute('aria-valuemin')).toBe('10');
    expect(sep.getAttribute('aria-valuemax')).toBe('90');
    expect(sep.getAttribute('aria-label')).toBe('Resize file tree');
    expect(sep.getAttribute('aria-controls')).toBe(pane('start').id);
    expect(pane('start').id).toBeTruthy();
    expect(sep.tabIndex).toBe(0);
  });

  it('resizes with the arrow keys, Home and End', async () => {
    await press('ArrowRight');
    expect(host.size()).toBe(35);

    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(host.size()).toBe(25);
    expect(separator()?.getAttribute('aria-valuenow')).toBe('25');

    await press('Home');
    expect(host.size()).toBe(10);

    await press('End');
    expect(host.size()).toBe(90);
  });

  it('uses the up and down arrows when vertical', async () => {
    host.orientation.set('vertical');
    await fixture.whenStable();
    expect(separator()?.getAttribute('aria-orientation')).toBe('horizontal');

    await press('ArrowDown');
    expect(host.size()).toBe(35);
    await press('ArrowUp');
    await press('ArrowUp');
    expect(host.size()).toBe(25);
    await press('ArrowLeft');
    expect(host.size()).toBe(25);
  });

  it('reverses the horizontal arrows in right-to-left', async () => {
    host.dir.set('rtl');
    await fixture.whenStable();

    await press('ArrowLeft');
    expect(host.size()).toBe(35);
  });

  it('clamps stored sizes', async () => {
    for (const [ size, expected ] of [ [ 150, '90' ], [ -5, '10' ], [ Number.NaN, '50' ] ] as const) {
      host.size.set(size);
      await fixture.whenStable();

      expect(separator()?.getAttribute('aria-valuenow')).toBe(expected);
      expect(splitPane().style.getPropertyValue('--ui-split-pane-size')).toBe(`${expected}%`);
    }
  });

  it('steps from the clamped size', async () => {
    host.size.set(150);
    await fixture.whenStable();

    await press('ArrowLeft');
    expect(host.size()).toBe(85);
  });

  it('shows one pane and no separator unless both are shown', async () => {
    host.show.set('end');
    await fixture.whenStable();
    expect(pane('start').hidden).toBe(true);
    expect(pane('end').hidden).toBe(false);
    expect(separator()).toBeNull();

    host.show.set('start');
    await fixture.whenStable();
    expect(pane('start').hidden).toBe(false);
    expect(pane('end').hidden).toBe(true);
    expect(separator()).toBeNull();
  });

  describe('dragging', () => {
    beforeEach(() => {
      vi.spyOn(splitPane(), 'getBoundingClientRect').mockReturnValue(
        { left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500 } as DOMRect
      );
      const sep = separator() as HTMLElement;
      sep.setPointerCapture = vi.fn();
      sep.releasePointerCapture = vi.fn();
    });

    afterEach(() => vi.restoreAllMocks());

    it('resizes by dragging the separator', async () => {
      await pointer('pointerdown', 300);
      await pointer('pointermove', 400);
      expect(host.size()).toBe(40);

      await pointer('pointerup', 400);
      await pointer('pointermove', 600);
      expect(host.size()).toBe(40);
    });

    it('keeps a dragged size within its limits', async () => {
      await pointer('pointerdown', 300);
      await pointer('pointermove', 990);
      expect(host.size()).toBe(90);
    });

    it('measures from the right edge in right-to-left', async () => {
      host.dir.set('rtl');
      await fixture.whenStable();

      await pointer('pointerdown', 700);
      await pointer('pointermove', 600);
      expect(host.size()).toBe(40);
    });

    it('measures from the top when vertical', async () => {
      host.orientation.set('vertical');
      await fixture.whenStable();

      await pointer('pointerdown', 0, 100);
      await pointer('pointermove', 0, 200);
      expect(host.size()).toBe(40);
    });
  });
});
