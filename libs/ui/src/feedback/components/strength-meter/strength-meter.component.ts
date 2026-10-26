import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A guess of how hard a secret is to guess, from 0 (very easy) to 4 (very hard). */
export type StrengthScore = 0 | 1 | 2 | 3 | 4;

const SEGMENTS = [ 1, 2, 3, 4 ];

/**
 * Shows how strong a password is, such as a zxcvbn score (PP-14). Advisory
 * only: it is not a form control. A `score` of `null` means nothing to rate
 * yet: no segment is filled and `valueText`, such as "No password yet", is
 * announced but not shown. A score of 0 still fills one segment, so that
 * "weak" is visible.
 */
@Component({
  selector: 'ui-strength-meter',
  templateUrl: './strength-meter.component.html',
  styleUrl: './strength-meter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'meter',
    'aria-valuemin': '0',
    'aria-valuemax': '4',
    '[attr.aria-label]': 'label()',
    // A meter must have a value (ARIA); before anything is rated it is 0 and
    // the value text says so.
    '[attr.aria-valuenow]': 'score() ?? 0',
    '[attr.aria-valuetext]': 'valueText()',
    '[attr.data-level]': 'level()'
  }
})
export class StrengthMeterComponent {
  readonly score = input.required<StrengthScore | null>();
  /** The accessible name, such as "Password strength". */
  readonly label = input.required<string>();
  /** The visible and announced value, such as "Weak". */
  readonly valueText = input.required<string>();

  protected readonly segments = SEGMENTS;

  protected readonly filled = computed(() => {
    const score = this.score();
    return score === null ? 0 : Math.max(score, 1);
  });

  protected readonly level = computed(() => {
    const score = this.score();
    if (score === null) {
      return null;
    }
    return score <= 1 ? 'weak' : score === 2 ? 'fair' : 'strong';
  });
}
