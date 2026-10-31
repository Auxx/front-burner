import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { OIDC_FAILURE_REASONS, type OidcFailureReason, type OidcSetupView } from '@front-burner/shared-contracts';
import { ButtonComponent, CentredIslandComponent, InlineBannerComponent } from '@front-burner/ui';
import { OnboardingApi } from '@front-burner/web-api-client';
import {
  ApiErrorTextService,
  onboardingDestination,
  OnboardingStateService,
  type OnboardingView,
  toApiError
} from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import {
  type LoginMethod,
  LoginMethodStepComponent
} from '../../components/login-method-step/login-method-step.component';
import { OidcSetupStepComponent } from '../../components/oidc-setup-step/oidc-setup-step.component';
import { PasswordSetupStepComponent } from '../../components/password-setup-step/password-setup-step.component';
import { SetupTokenStepComponent } from '../../components/setup-token-step/setup-token-step.component';

type Step = 'token' | 'method' | LoginMethod;

const ONBOARDING = '/onboarding';

/**
 * The Administrator onboarding page (REQ-AUTH-001): setup token, login method,
 * then the administrator's details or the OIDC settings. The guard has already
 * loaded the state. After a failed OIDC login the backend sends the user back
 * here with `oidcError` (AO-26).
 */
@Component({
  selector: 'auth-onboarding',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CentredIslandComponent,
    InlineBannerComponent,
    SetupTokenStepComponent,
    LoginMethodStepComponent,
    PasswordSetupStepComponent,
    OidcSetupStepComponent
  ],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OnboardingPage {
  private readonly onboarding = inject(OnboardingStateService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(OnboardingApi);

  protected readonly view = this.onboarding.view;
  protected readonly step = signal<Step>('token');
  /** In memory only, never stored (AO-11). */
  protected readonly setupToken = signal('');
  protected readonly tokenRejected = signal(false);
  protected readonly retrying = signal(false);
  /** Read once, so it survives the token step (AO-11); the OIDC step hides it on its next submit. */
  protected readonly oidcFailure = this.readOidcFailure();
  /** The pending OIDC setup, without its secret, for the pre-filled form (AO-16, AO-26). */
  protected readonly savedOidcSetup = signal<OidcSetupView | undefined>(undefined);
  protected readonly initialMethod = computed<LoginMethod>(() =>
    this.status()?.state === 'oidc-pending' ? 'oidc' : 'password'
  );

  /** The state, while it belongs on this page; a closed onboarding shows nothing until it has left. */
  protected readonly status = computed(() => {
    const view = this.view();
    return view?.kind === 'status' && onboardingDestination(view, ONBOARDING) === true ? view.status : null;
  });

  protected readonly failure = computed(() => {
    const view = this.view();
    return view?.kind === 'error' ? this.errorText.describe(toApiError(view.cause)) : null;
  });

  protected async tokenAccepted(token: string): Promise<void> {
    this.setupToken.set(token);
    this.tokenRejected.set(false);
    if (this.status()?.state === 'oidc-pending') {
      this.savedOidcSetup.set(await this.loadOidcSetup(token));
    }
    // After a failed OIDC login, straight back to the form with the reason (AO-26).
    this.step.set(this.oidcFailure !== undefined && this.savedOidcSetup() !== undefined ? 'oidc' : 'method');
  }

  /** The OIDC setup was saved: log in with OIDC to complete onboarding (AO-25). */
  protected async oidcSetupSaved(): Promise<void> {
    await this.onboarding.refresh();
    await this.router.navigateByUrl('/login');
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

  /** Without a saved setup (for example when it cannot be loaded) the form is empty. */
  private async loadOidcSetup(setupToken: string): Promise<OidcSetupView | undefined> {
    try {
      return await firstValueFrom(this.api.currentOidcSetup({ setupToken }));
    } catch {
      return undefined;
    }
  }

  private readOidcFailure(): OidcFailureReason | undefined {
    const reason = this.route.snapshot.queryParamMap.get('oidcError');
    if (reason === null) {
      return undefined;
    }
    return OIDC_FAILURE_REASONS.find(known => known === reason) ?? 'failed';
  }
}
