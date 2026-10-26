import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import {
  type FieldTree,
  form,
  FormField,
  submit,
  validate,
  validateStandardSchema,
  type ValidationError
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import { PASSWORD_RULES, passwordSetupFields, refinePasswordNotEmail } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  InlineBannerComponent,
  InputComponent,
  PasswordRevealDirective,
  StrengthMeterComponent,
  ToastService
} from '@front-burner/ui';
import { OnboardingApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, OnboardingStateService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import {
  type PasswordStrength,
  PasswordStrengthService
} from '../../services/password-strength/password-strength.service';
import { fieldErrorCode } from '../../utils/field-error-code';
import { PasswordPolicyComponent } from '../password-policy/password-policy.component';

const KEY = 'web-feature-auth.PasswordSetupStepComponent';
const STRENGTH_DELAY_MS = 150;

// The backend's schema without the token; the confirmation is checked on its own.
const DETAILS_SCHEMA = z.object(passwordSetupFields).superRefine(refinePasswordNotEmail);

interface Details {
  email: string;
  displayName: string;
  password: string;
  passwordConfirmation: string;
}

/** The error codes each field has a text for; any other code gets the generic text. */
const KNOWN_CODES: Record<keyof Details, readonly string[]> = {
  email: [ 'invalid-format', 'too-big' ],
  displayName: [ 'too-small', 'too-big' ],
  password: PASSWORD_RULES,
  passwordConfirmation: [ 'mismatch' ]
};

/**
 * The username + password path (AO-17 to AO-20): the administrator's details,
 * the password policy and a strength meter (PP-13, PP-14). On success the user
 * is sent to the login page, not logged in.
 */
@Component({
  selector: 'auth-password-setup-step',
  imports: [
    TranslocoDirective,
    FormField,
    FieldComponent,
    InputComponent,
    IconButtonComponent,
    IconComponent,
    PasswordRevealDirective,
    ButtonComponent,
    InlineBannerComponent,
    StrengthMeterComponent,
    PasswordPolicyComponent
  ],
  templateUrl: './password-setup-step.component.html',
  styleUrl: './password-setup-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PasswordSetupStepComponent {
  readonly setupToken = input.required<string>();
  readonly back = output<void>();
  /** The backend answered 404: the token changed, or onboarding is closed. */
  readonly refused = output<void>();

  private readonly api = inject(OnboardingApi);
  private readonly onboarding = inject(OnboardingStateService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly strength = inject(PasswordStrengthService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  protected readonly model = form(
    signal<Details>({ email: '', displayName: '', password: '', passwordConfirmation: '' }),
    path => {
      validateStandardSchema(path, DETAILS_SCHEMA);
      validate(
        path.passwordConfirmation,
        ({ value, valueOf }) => value() === valueOf(path.password) ? undefined : { kind: 'mismatch' }
      );
    }
  );

  protected readonly busy = signal(false);
  protected readonly failure = signal<{ text: string; reference: string | null; } | null>(null);
  protected readonly score = signal<PasswordStrength | null>(null);

  constructor() {
    effect(onCleanup => {
      const password = this.model.password().value();
      const userInputs = [ this.model.email().value(), this.model.displayName().value() ];
      if (password === '') {
        this.score.set(null);
        return;
      }
      let cancelled = false;
      const timer = setTimeout(async () => {
        const score = await this.strength.estimate(password, userInputs);
        if (!cancelled) {
          this.score.set(score);
        }
      }, STRENGTH_DELAY_MS);
      onCleanup(() => {
        cancelled = true;
        clearTimeout(timer);
      });
    });
  }

  /** The key of a field's first error, once the field is touched (AR-6). */
  protected errorKey(name: keyof Details): string | undefined {
    const state = this.model[name]();
    const error = state.touched() ? state.errors()[0] : undefined;
    if (!error) {
      return undefined;
    }
    const code = fieldErrorCode(error);
    return KNOWN_CODES[name].includes(code) ? `fieldErrors.${name}.${code}` : 'fieldErrors.invalid';
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    await submit(this.model, async () => {
      const { email, displayName, password } = this.model().value();
      this.busy.set(true);
      this.failure.set(null);
      try {
        await firstValueFrom(
          this.api.setUpPassword({ setupToken: this.setupToken(), email, displayName, password }),
          { defaultValue: undefined }
        );
      } catch (error) {
        return this.refusal(error);
      } finally {
        this.busy.set(false);
      }
      this.onboarding.markCompleted();
      this.toast.show({
        message: this.transloco.translate(`${KEY}.created`),
        dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
        status: 'success'
      });
      await this.router.navigateByUrl('/login');
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
      return tree ? [ { kind: field.code, fieldTree: tree } ] : [];
    });
    if (fieldErrors.length === 0) {
      this.failure.set(this.errorText.describe(apiError));
    }
    return fieldErrors;
  }

  private fieldTree(path: string): FieldTree<string> | undefined {
    return path === 'email' || path === 'displayName' || path === 'password' ? this.model[path] : undefined;
  }
}
