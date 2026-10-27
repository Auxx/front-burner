import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { ButtonComponent, type ChoiceOption, SegmentedControlComponent } from '@front-burner/ui';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

export type LoginMethod = 'password' | 'oidc';

/**
 * Explains that the first administrator is being set up and offers the login
 * methods (AO-14); the user can go back until they submit (AO-15).
 */
@Component({
  selector: 'auth-login-method-step',
  imports: [ TranslocoDirective, SegmentedControlComponent, ButtonComponent ],
  templateUrl: './login-method-step.component.html',
  styleUrl: './login-method-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginMethodStepComponent {
  /** The method chosen first: OIDC while a setup is pending (AO-16). */
  readonly initial = input<LoginMethod>('password');
  readonly chosen = output<LoginMethod>();
  readonly back = output<void>();

  private readonly transloco = inject(TranslocoService);

  protected readonly method = linkedSignal<LoginMethod | undefined>(() => this.initial());

  protected readonly options = computed<readonly ChoiceOption<LoginMethod>[]>(() => {
    const key = 'web-feature-auth.LoginMethodStepComponent';
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    return [
      { value: 'password', label: this.transloco.translate(`${key}.password`) },
      { value: 'oidc', label: this.transloco.translate(`${key}.oidc`) }
    ];
  });

  protected continue(): void {
    this.chosen.emit(this.method() ?? 'password');
  }
}
