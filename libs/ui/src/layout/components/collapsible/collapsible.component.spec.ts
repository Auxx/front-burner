import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CollapsibleComponent } from './collapsible.component';

@Component({
  imports: [ CollapsibleComponent ],
  template: `
    <ui-collapsible id="region"
                    [open]="open()"><p>Content</p></ui-collapsible>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
class HostComponent {
  readonly open = signal(false);
}

describe('CollapsibleComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const region = () => (fixture.nativeElement as HTMLElement).querySelector('#region') as HTMLElement;

  async function setOpen(open: boolean): Promise<void> {
    fixture.componentInstance.open.set(open);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('keeps its content in the document while closed, inert', () => {
    expect(region().textContent).toContain('Content');
    expect(region().hasAttribute('inert')).toBe(true);
  });

  it('is not inert while open', async () => {
    await setOpen(true);

    expect(region().hasAttribute('inert')).toBe(false);
  });

  it('ends in the last state when toggled quickly', async () => {
    fixture.componentInstance.open.set(true);
    fixture.componentInstance.open.set(false);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();

    expect(region().hasAttribute('inert')).toBe(false);

    await setOpen(false);

    expect(region().hasAttribute('inert')).toBe(true);
  });
});
