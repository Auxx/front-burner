import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { ApiErrorTextService, OnboardingStateService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

import { LoginMethodStepComponent } from '../../components/login-method-step/login-method-step.component';
import { PasswordSetupStepComponent } from '../../components/password-setup-step/password-setup-step.component';
import { SetupTokenStepComponent } from '../../components/setup-token-step/setup-token-step.component';

type Step = 'token' | 'method' | 'password';

/**
 * The Administrator onboarding page (REQ-AUTH-001): setup token, login method,
 * then the administrator's details. The guard has already loaded the state.
 */
@Component({
  selector: 'auth-onboarding',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    InlineBannerComponent,
    SetupTokenStepComponent,
    LoginMethodStepComponent,
    PasswordSetupStepComponent
  ],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OnboardingPage {
  private readonly onboarding = inject(OnboardingStateService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly router = inject(Router);

  protected readonly view = this.onboarding.view;
  protected readonly step = signal<Step>('token');
  /** In memory only, never stored (AO-11). */
  protected readonly setupToken = signal('');
  protected readonly tokenRejected = signal(false);
  protected readonly retrying = signal(false);

  protected readonly status = computed(() => {
    const view = this.view();
    return view?.kind === 'status' ? view.status : null;
  });

  protected readonly failure = computed(() => {
    const view = this.view();
    return view?.kind === 'error' ? this.errorText.describe(view.error) : null;
  });

  protected tokenAccepted(token: string): void {
    this.setupToken.set(token);
    this.tokenRejected.set(false);
    this.step.set('method');
  }

  protected async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.onboarding.refresh();
    } finally {
      this.retrying.set(false);
    }
  }

  /** Setup answered 404: either onboarding closed meanwhile or the token changed. */
  protected async refused(): Promise<void> {
    const view = await this.onboarding.refresh();
    if (view.kind === 'status' && view.status.state === 'completed') {
      await this.router.navigateByUrl('/login');
      return;
    }
    this.setupToken.set('');
    this.tokenRejected.set(true);
    this.step.set('token');
  }
}
