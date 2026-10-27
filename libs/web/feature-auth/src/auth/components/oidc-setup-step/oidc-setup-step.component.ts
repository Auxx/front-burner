import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal
} from '@angular/core';
import {
  type FieldTree,
  form,
  FormField,
  submit,
  validate,
  validateStandardSchema,
  type ValidationError
} from '@angular/forms/signals';
import {
  DEFAULT_OIDC_SCOPES,
  type OidcFailureReason,
  oidcSetupFields,
  type OidcSetupView
} from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  CheckboxComponent,
  ChoiceComponent,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  InlineBannerComponent,
  InputComponent,
  PasswordRevealDirective,
  ToastService
} from '@front-burner/ui';
import { OnboardingApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import { fieldErrorCode } from '../../utils/field-error-code';

const KEY = 'web-feature-auth.OidcSetupStepComponent';
/** The backend's callback route (plan 4); the operator registers it with the provider (AO-22). */
const CALLBACK_PATH = '/api/v1/auth/oidc/callback';

// The backend's schema without the token. Blank scopes mean the default, and
// the secret is checked on its own, because a saved one may be kept (AO-26).
const SETUP_SCHEMA = z.object({
  ...oidcSetupFields,
  scopes: z.string().trim().max(512).refine(
    scopes => scopes === '' || scopes.split(/\s+/).includes('openid'),
    { params: { code: 'missing-openid' } }
  )
});

interface Setup {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  requireVerifiedEmail: boolean;
  adminEmail: string;
}

type TextField = Exclude<keyof Setup, 'requireVerifiedEmail'>;

/** The error codes each field has a text for; any other code gets the generic text. */
const KNOWN_CODES: Record<TextField, readonly string[]> = {
  issuer: [
    'invalid-format',
    'too-big',
    'query-or-fragment',
    'oidc-issuer-unreachable',
    'oidc-issuer-mismatch',
    'oidc-discovery-invalid'
  ],
  clientId: [ 'too-small', 'too-big' ],
  clientSecret: [ 'required', 'too-big' ],
  scopes: [ 'missing-openid', 'too-big' ],
  adminEmail: [ 'invalid-format', 'too-big' ]
};

const initialSetup = (saved: OidcSetupView | undefined): Setup => ({
  issuer: saved?.issuer ?? '',
  clientId: saved?.clientId ?? '',
  clientSecret: '',
  scopes: saved?.scopes ?? DEFAULT_OIDC_SCOPES,
  requireVerifiedEmail: saved?.requireVerifiedEmail ?? true,
  adminEmail: saved?.adminEmail ?? ''
});

/**
 * The OIDC path (AO-21 to AO-26): the provider's settings and the
 * administrator email, with the redirect URI to register. The backend checks
 * the provider before saving; the secret is not kept after submitting.
 */
@Component({
  selector: 'auth-oidc-setup-step',
  imports: [
    TranslocoDirective,
    FormField,
    FieldComponent,
    InputComponent,
    CheckboxComponent,
    ChoiceComponent,
    IconButtonComponent,
    IconComponent,
    PasswordRevealDirective,
    ButtonComponent,
    InlineBannerComponent
  ],
  templateUrl: './oidc-setup-step.component.html',
  styleUrl: './oidc-setup-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OidcSetupStepComponent {
  readonly setupToken = input.required<string>();
  /** A pending setup to pre-fill the form with (AO-16, AO-26). */
  readonly saved = input<OidcSetupView | undefined>(undefined);
  /** Why the last OIDC login failed, shown until the next submit (AO-26). */
  readonly failure = input<OidcFailureReason | undefined>(undefined);
  readonly back = output<void>();
  /** The backend answered 404: the token changed, or onboarding is closed. */
  readonly refused = output<void>();
  /** The setup was saved; onboarding is now `oidc-pending` (AO-24). */
  readonly submitted = output<void>();

  private readonly api = inject(OnboardingApi);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  protected readonly redirectUri = `${this.document.location.origin}${CALLBACK_PATH}`;
  protected readonly keepsSecret = computed(() => this.saved()?.hasClientSecret === true);

  protected readonly model = form(linkedSignal(() => initialSetup(this.saved())), path => {
    validateStandardSchema(path, SETUP_SCHEMA);
    validate(
      path.clientSecret,
      ({ value }) => value() === '' && !this.keepsSecret() ? { kind: 'required' } : undefined
    );
  });

  protected readonly busy = signal(false);
  protected readonly loginFailure = linkedSignal(() => this.failure());
  protected readonly requestFailure = signal<{ text: string; reference: string | null; } | null>(null);

  /** The key and parameters of a field's first error, once the field is touched (AR-6). */
  protected error(name: TextField): { key: string; params: Record<string, unknown>; } | undefined {
    const state = this.model[name]();
    const error = state.touched() ? state.errors()[0] : undefined;
    if (!error) {
      return undefined;
    }
    const code = fieldErrorCode(error);
    const params = (error as { params?: Record<string, unknown>; }).params ?? {};
    return KNOWN_CODES[name].includes(code)
      ? { key: `fieldErrors.${name}.${code}`, params }
      : { key: 'fieldErrors.invalid', params };
  }

  protected async copyRedirectUri(): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(this.redirectUri);
    } catch {
      // Without clipboard access the address can still be selected and copied by hand.
      return;
    }
    this.toast.show({
      message: this.transloco.translate(`${KEY}.copied`),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status: 'success'
    });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.loginFailure.set(undefined);
    await submit(this.model, async () => {
      const setup = this.model().value();
      this.busy.set(true);
      this.requestFailure.set(null);
      try {
        await firstValueFrom(
          this.api.saveOidcSetup({
            setupToken: this.setupToken(),
            issuer: setup.issuer.trim(),
            clientId: setup.clientId,
            clientSecret: setup.clientSecret,
            scopes: setup.scopes.trim() || DEFAULT_OIDC_SCOPES,
            requireVerifiedEmail: setup.requireVerifiedEmail,
            adminEmail: setup.adminEmail
          }),
          { defaultValue: undefined }
        );
      } catch (error) {
        return this.refusal(error);
      } finally {
        this.busy.set(false);
        // AO-38: the secret is not kept once it has been sent.
        this.model.clientSecret().value.set('');
      }
      this.submitted.emit();
      return undefined;
    });
  }

  /** Turns a failed request into field errors, a banner, or `refused`. */
  private refusal(error: unknown): ValidationError.WithOptionalFieldTree[] | undefined {
    if (error instanceof HttpErrorResponse && error.status === 404) {
      this.refused.emit();
      return undefined;
    }
    const apiError = toApiError(error);
    const fieldErrors = (apiError.fields ?? []).flatMap(field => {
      const tree = this.fieldTree(field.path);
      return tree ? [ { kind: field.code, params: field.params, fieldTree: tree } ] : [];
    });
    if (fieldErrors.length === 0) {
      this.requestFailure.set(this.errorText.describe(apiError));
    }
    return fieldErrors;
  }

  private fieldTree(path: string): FieldTree<string> | undefined {
    return path in KNOWN_CODES ? this.model[path as TextField] : undefined;
  }
}
