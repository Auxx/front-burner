import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressBarComponent } from './progress-bar.component';

@Component({
  imports: [ ProgressBarComponent ],
  template: `<ui-progress-bar label="Cloning handbook" [value]="value()" [max]="max()" [valueText]="valueText()" />`
})
class HostComponent {
  readonly value = signal<number | null>(45);
  readonly max = signal(100);
  readonly valueText = signal<string | undefined>(undefined);
}

describe('ProgressBarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const bar = () => fixture.nativeElement.querySelector('ui-progress-bar') as HTMLElement;
  const fraction = () => bar().style.getPropertyValue('--ui-progress-value');
  const set = async (changes: { value?: number | null; max?: number; valueText?: string; }) => {
    const host = fixture.componentInstance;
    if ('value' in changes) {
      host.value.set(changes.value ?? null);
    }
    if (changes.max !== undefined) {
      host.max.set(changes.max);
    }
    if (changes.valueText !== undefined) {
      host.valueText.set(changes.valueText);
    }
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is a labelled progress bar with its value', () => {
    expect(bar().getAttribute('role')).toBe('progressbar');
    expect(bar().getAttribute('aria-label')).toBe('Cloning handbook');
    expect(bar().getAttribute('aria-valuemin')).toBe('0');
    expect(bar().getAttribute('aria-valuemax')).toBe('100');
    expect(bar().getAttribute('aria-valuenow')).toBe('45');
    expect(fraction()).toBe('0.45');
  });

  it('says its value in words when given', async () => {
    await set({ valueText: 'Receiving objects: 45 %' });

    expect(bar().getAttribute('aria-valuetext')).toBe('Receiving objects: 45 %');
  });

  it('is indeterminate without a value', async () => {
    await set({ value: null });

    expect(bar().hasAttribute('aria-valuenow')).toBe(false);
    expect(bar().dataset['indeterminate']).toBe('true');
  });

  it('keeps out-of-range values inside the bar', async () => {
    await set({ value: 150 });
    expect(bar().getAttribute('aria-valuenow')).toBe('100');
    expect(fraction()).toBe('1');

    await set({ value: -5 });
    expect(bar().getAttribute('aria-valuenow')).toBe('0');

    await set({ value: Number.NaN });
    expect(bar().hasAttribute('aria-valuenow')).toBe(false);
    expect(bar().dataset['indeterminate']).toBe('true');

    await set({ value: 50, max: 0 });
    expect(bar().getAttribute('aria-valuemax')).toBe('100');
  });
});
