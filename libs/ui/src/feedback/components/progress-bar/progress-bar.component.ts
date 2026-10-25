import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * How far an operation has come, such as a clone (RM-7). A `value` of `null`
 * is indeterminate. Values outside `0…max` are clamped, `NaN` counts as
 * `null`, and a `max` of 0 or less counts as 100.
 */
@Component({
  selector: 'ui-progress-bar',
  template: '<div class="fill"></div>',
  styleUrl: './progress-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuemax]': 'safeMax()',
    '[attr.aria-valuenow]': 'now()',
    '[attr.aria-valuetext]': 'valueText() ?? null',
    '[attr.data-indeterminate]': 'now() === null || null',
    '[style.--ui-progress-value]': 'fraction()'
  }
})
export class ProgressBarComponent {
  readonly label = input.required<string>();
  readonly value = input<number | null>(null);
  readonly max = input(100);
  readonly valueText = input<string>();

  protected readonly safeMax = computed(() => (this.max() > 0 ? this.max() : 100));

  protected readonly now = computed(() => {
    const value = this.value();
    return value === null || Number.isNaN(value) ? null : Math.min(Math.max(value, 0), this.safeMax());
  });

  protected readonly fraction = computed(() => {
    const now = this.now();
    return now === null ? null : String(now / this.safeMax());
  });
}
