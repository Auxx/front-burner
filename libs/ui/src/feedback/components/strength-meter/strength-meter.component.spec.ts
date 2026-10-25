import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StrengthMeterComponent } from './strength-meter.component';

type Score = 0 | 1 | 2 | 3 | 4 | null;

@Component({
  imports: [ StrengthMeterComponent ],
  template: `<ui-strength-meter label="Password strength" [score]="score()" [valueText]="valueText()" />`
})
class HostComponent {
  readonly score = signal<Score>(null);
  readonly valueText = signal('');
}

describe('StrengthMeterComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const meter = () => fixture.nativeElement.querySelector('ui-strength-meter') as HTMLElement;
  const filled = () => meter().querySelectorAll('.segment[data-filled]').length;
  const set = async (score: Score, valueText: string) => {
    fixture.componentInstance.score.set(score);
    fixture.componentInstance.valueText.set(valueText);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ HostComponent ] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  it('is a meter from 0 to 4 with its label', () => {
    expect(meter().getAttribute('role')).toBe('meter');
    expect(meter().getAttribute('aria-label')).toBe('Password strength');
    expect(meter().getAttribute('aria-valuemin')).toBe('0');
    expect(meter().getAttribute('aria-valuemax')).toBe('4');
  });

  it('before anything is rated, is at 0 with no filled segment and only announces its text', async () => {
    await set(null, 'No password yet');
    // A meter must have a value (ARIA); the text says that nothing is rated.
    expect(meter().getAttribute('aria-valuenow')).toBe('0');
    expect(meter().getAttribute('aria-valuetext')).toBe('No password yet');
    expect(meter().hasAttribute('data-level')).toBe(false);
    expect(filled()).toBe(0);
    expect(meter().querySelectorAll('.segment')).toHaveLength(4);
    expect(meter().textContent?.trim()).toBe('');
  });

  it.each(
    [
      [ 0, 1, 'weak' ],
      [ 1, 1, 'weak' ],
      [ 2, 2, 'fair' ],
      [ 3, 3, 'strong' ],
      [ 4, 4, 'strong' ]
    ] as const
  )('score %i fills %i segments at level %s', async (score, segments, level) => {
    await set(score, 'Text');
    expect(meter().getAttribute('aria-valuenow')).toBe(String(score));
    expect(filled()).toBe(segments);
    expect(meter().getAttribute('data-level')).toBe(level);
  });

  it('shows and announces the value text', async () => {
    await set(2, 'Fair');
    expect(meter().getAttribute('aria-valuetext')).toBe('Fair');
    expect(meter().textContent?.trim()).toBe('Fair');
  });
});
