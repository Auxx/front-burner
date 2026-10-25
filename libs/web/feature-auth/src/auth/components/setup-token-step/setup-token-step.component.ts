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
import { form, FormField, submit, validateStandardSchema } from '@angular/forms/signals';
import { SetupTokenRequestSchema } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  InlineBannerComponent,
  InputComponent,
  PasswordRevealDirective
} from '@front-burner/ui';
import { OnboardingApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { fieldErrorCode } from '../../utils/field-error-code';

/**
 * Asks for the setup token and checks it with the backend before the login
 * method is chosen (AO-10). The token is kept in memory only (AO-11): the page
 * receives it through `accepted`.
 */
@Component({
  selector: 'auth-setup-token-step',
  imports: [
    TranslocoDirective,
    FormField,
    FieldComponent,
    InputComponent,
    IconButtonComponent,
    IconComponent,
    PasswordRevealDirective,
    ButtonComponent,
    InlineBannerComponent
  ],
  templateUrl: './setup-token-step.component.html',
  styleUrl: './setup-token-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SetupTokenStepComponent {
  /** The backend refused the token later, when the account was created. */
  readonly rejected = input(false);
  readonly accepted = output<string>();

  private readonly api = inject(OnboardingApi);
  private readonly errorText = inject(ApiErrorTextService);

  protected readonly model = form(signal({ setupToken: '' }), path => {
    validateStandardSchema(path, SetupTokenRequestSchema);
  });

  protected readonly busy = signal(false);
  protected readonly failure = signal<{ text: string; reference: string | null; } | null>(null);
  private readonly invalid = linkedSignal(() => this.rejected());

  /** The key of the field's error under `errors.`, if one is shown. */
  protected readonly errorKey = computed(() => {
    if (this.invalid()) {
      return 'invalid';
    }
    const state = this.model.setupToken();
    const error = state.touched() ? state.errors()[0] : undefined;
    return error ? (fieldErrorCode(error) === 'too-small' ? 'required' : 'invalid') : undefined;
  });

  protected edited(): void {
    this.invalid.set(false);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    await submit(this.model, async () => {
      const setupToken = this.model.setupToken().value();
      this.busy.set(true);
      this.failure.set(null);
      try {
        await firstValueFrom(this.api.checkSetupToken({ setupToken }), { defaultValue: undefined });
        this.accepted.emit(setupToken);
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.invalid.set(true);
        } else {
          this.failure.set(this.errorText.describe(toApiError(error)));
        }
      } finally {
        this.busy.set(false);
      }
      return undefined;
    });
  }
}
