import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import {
  ApiErrorTextService,
  onboardingDestination,
  OnboardingStateService,
  type OnboardingView,
  toApiError
} from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

import { LoginMethodStepComponent } from '../../components/login-method-step/login-method-step.component';
import { PasswordSetupStepComponent } from '../../components/password-setup-step/password-setup-step.component';
import { SetupTokenStepComponent } from '../../components/setup-token-step/setup-token-step.component';

type Step = 'token' | 'method' | 'password';

const ONBOARDING = '/onboarding';

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

  /** The state, while it belongs on this page; a closed onboarding shows nothing until it has left. */
  protected readonly status = computed(() => {
    const view = this.view();
    return view?.kind === 'status' && onboardingDestination(view, ONBOARDING) === true ? view.status : null;
  });

  protected readonly failure = computed(() => {
    const view = this.view();
    return view?.kind === 'error' ? this.errorText.describe(toApiError(view.cause)) : null;
  });

  protected tokenAccepted(token: string): void {
    this.setupToken.set(token);
    this.tokenRejected.set(false);
    this.step.set('method');
  }

  protected async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.leaveIfClosed(await this.onboarding.refresh());
    } finally {
      this.retrying.set(false);
    }
  }

  /** Setup answered 404: either onboarding closed meanwhile or the token changed. */
  protected async refused(): Promise<void> {
    const view = await this.onboarding.refresh();
    this.setupToken.set('');
    this.step.set('token');
    // When the state cannot be loaded, the page shows that error and a retry;
    // the token may well be right.
    this.tokenRejected.set(view.kind === 'status');
    await this.leaveIfClosed(view);
  }

  /** After a refresh, goes where the guard would send this page (AO-3, AO-33). */
  private async leaveIfClosed(view: OnboardingView): Promise<void> {
    const target = onboardingDestination(view, ONBOARDING);
    if (target !== true) {
      await this.router.navigateByUrl(target);
    }
  }
}
