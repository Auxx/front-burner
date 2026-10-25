import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PASSWORD_RULES, passwordPolicyIssues, type PasswordRule } from '@front-burner/shared-contracts';
import { IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

// Rules that most passwords never break are listed only while they are broken.
const LISTED_WHEN_FAILING: readonly PasswordRule[] = [ 'too-long', 'control-character' ];

/** The password policy, checked as the user types (PP-13). Only helps: the backend decides. */
@Component({
  selector: 'auth-password-policy',
  imports: [ TranslocoDirective, IconComponent ],
  templateUrl: './password-policy.component.html',
  styleUrl: './password-policy.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PasswordPolicyComponent {
  readonly password = input.required<string>();
  readonly email = input.required<string>();

  protected readonly rules = computed(() => {
    const failed = new Set(passwordPolicyIssues(this.password(), this.email()));
    return PASSWORD_RULES
      .filter(rule => failed.has(rule) || !LISTED_WHEN_FAILING.includes(rule))
      .map(rule => ({ rule, met: !failed.has(rule) }));
  });
}
