import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, submit, validateStandardSchema } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { LoginRequestSchema, OIDC_FAILURE_REASONS, type OidcFailureReason } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  CentredIslandComponent,
  DividerComponent,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  InlineBannerComponent,
  InputComponent,
  PasswordRevealDirective
} from '@front-burner/ui';
import { AuthApi } from '@front-burner/web-api-client';
import {
  ApiErrorTextService,
  AuthSessionService,
  type LoginMessage,
  safeReturnUrl,
  toApiError
} from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { catchError, map, of } from 'rxjs';

import { BROWSER_LOCATION } from '../../utils/browser-location';
import { OIDC_RETURN_KEY } from '../../utils/oidc-return';

const SCHEMA = LoginRequestSchema.pick({ email: true, password: true });

const LOGIN_MESSAGES: readonly LoginMessage[] = [ 'logged-out', 'session-expired', 'password-reset' ];

/** Addresses where plain HTTP is expected: the operator's own machine (LG-68). */
const LOCAL_HOSTS = [ 'localhost', '127.0.0.1', '[::1]' ];

const DEPLOYMENT_GUIDE = 'https://github.com/Auxx/front-burner/blob/master/docs/wiki/deployment.md';

interface Credentials {
  email: string;
  password: string;
}

/** Starts an OIDC login: a full navigation, as the backend redirects to the provider (LG-17). */
const OIDC_START = '/api/v1/auth/oidc/start';

/**
 * The login page (REQ-AUTH-003): username + password (LG-10, LG-11), OIDC
 * when it is configured (LG-7, LG-21), a one-off message from another page
 * (LG-9) and the plain HTTP warning (LG-68). On success it goes to the page
 * the user asked for, or the dashboard (LG-4).
 */
@Component({
  selector: 'auth-login',
  imports: [
    TranslocoDirective,
    FormField,
    FieldComponent,
    InputComponent,
    IconButtonComponent,
    IconComponent,
    PasswordRevealDirective,
    ButtonComponent,
    CentredIslandComponent,
    DividerComponent,
    InlineBannerComponent
  ],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginPage {
  private readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly passwordInput = viewChild.required('password', { read: ElementRef<HTMLInputElement> });
  private readonly window = inject(DOCUMENT).defaultView;

  protected readonly deploymentGuide = DEPLOYMENT_GUIDE;
  protected readonly oidcStart = OIDC_START;

  /** Undefined until known, and when the methods cannot be loaded: the password form still works. */
  protected readonly oidc = toSignal(
    inject(AuthApi).methods().pipe(map(methods => methods.oidc), catchError(() => of(undefined))),
    { initialValue: undefined }
  );

  /** A failed OIDC login: the reason only while onboarding is pending from the environment (AO-34). */
  protected readonly oidcError = this.oidcFailure();

  protected readonly model = form(signal<Credentials>({ email: '', password: '' }), path => {
    validateStandardSchema(path, SCHEMA);
  });

  protected readonly busy = signal(false);
  protected readonly failure = signal<{ text: string; reference: string | null; } | null>(null);

  /** Passed in the navigation's state, so a reload does not show it again (LG-9). */
  protected readonly message = signal(this.loginMessage());

  protected readonly insecure = (() => {
    const { protocol, hostname } = inject(BROWSER_LOCATION);
    return protocol === 'http:' && !LOCAL_HOSTS.includes(hostname);
  })();

  /** The key of a field's error, once the field is touched. */
  protected errorKey(name: keyof Credentials): string | undefined {
    const state = this.model[name]();
    if (!state.touched() || state.errors().length === 0) {
      return undefined;
    }
    return state.value() === '' ? `${name}Required` : `${name}Invalid`;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.message.set(null);
    await submit(this.model, async () => {
      const { email, password } = this.model().value();
      this.busy.set(true);
      this.failure.set(null);
      try {
        await this.session.login(email, password);
      } catch (error) {
        this.refusal(error);
        return undefined;
      } finally {
        this.busy.set(false);
      }
      await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
      return undefined;
    });
  }

  /** Remembers where to go after the provider sends the user back. */
  protected rememberReturn(): void {
    try {
      this.window?.sessionStorage.setItem(
        OIDC_RETURN_KEY,
        safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'))
      );
    } catch {
      // Without storage the login ends on the dashboard.
    }
  }

  private oidcFailure(): OidcFailureReason | null {
    const reason = this.route.snapshot.queryParamMap.get('oidcError');
    if (reason === null) {
      return null;
    }
    return OIDC_FAILURE_REASONS.find(known => known === reason) ?? 'failed';
  }

  private refusal(error: unknown): void {
    const described = this.errorText.describe(toApiError(error));
    if (error instanceof HttpErrorResponse && error.status === 401) {
      // LG-14: the same generic error for every reason; the password is typed again.
      this.failure.set({ text: described.text, reference: null });
      this.model.password().reset('');
      this.passwordInput().nativeElement.focus();
      return;
    }
    this.failure.set(described);
  }

  private loginMessage(): LoginMessage | null {
    const state: unknown = this.router.currentNavigation()?.extras.state?.['loginMessage'];
    return LOGIN_MESSAGES.find(message => message === state) ?? null;
  }
}
