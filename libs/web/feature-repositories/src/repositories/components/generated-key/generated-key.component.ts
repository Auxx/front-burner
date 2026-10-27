import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, linkedSignal, signal } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import {
  ButtonComponent,
  CheckboxComponent,
  ChoiceComponent,
  FieldComponent,
  InlineBannerComponent,
  InputComponent,
  TextareaComponent,
  ToastService
} from '@front-burner/ui';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import type { CredentialsModel } from '../../models/add-repository-form.model';
import { SessionKeysService } from '../../services/session-keys/session-keys.service';
import { fieldErrorKey, type FieldErrorText, shownError } from '../../utils/add-repository-errors';

const KEY = 'web-feature-repositories.GeneratedKeyComponent';

/**
 * **Generate a key** (AR-29, AR-30): a key name and **Generate**, then the
 * public key with **Copy**, the instructions and "I have added this key to my
 * git server". The key is kept for the visit, so switching options and back
 * shows it again.
 */
@Component({
  selector: 'repo-generated-key',
  imports: [
    TranslocoDirective,
    FormField,
    ButtonComponent,
    CheckboxComponent,
    ChoiceComponent,
    FieldComponent,
    InlineBannerComponent,
    InputComponent,
    TextareaComponent
  ],
  templateUrl: './generated-key.component.html',
  styleUrl: './generated-key.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GeneratedKeyComponent {
  readonly credentials = input.required<FieldTree<CredentialsModel>>();

  private readonly document = inject(DOCUMENT);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly errorText = inject(ApiErrorTextService);
  protected readonly keys = inject(SessionKeysService);

  /** A name the backend refused, until the name changes. */
  protected readonly nameError = linkedSignal<string, FieldErrorText | null>({
    source: () => this.credentials().generateName().value(),
    computation: () => null
  });
  protected readonly failure = signal<{ text: string; reference: string | null; } | null>(null);

  protected error(): FieldErrorText | undefined {
    return this.nameError() ?? shownError(this.credentials().generateName, 'credentials.generateName');
  }

  protected async generate(): Promise<void> {
    const name = this.credentials().generateName;
    name().markAsTouched();
    if (name().invalid() || this.keys.busy()) {
      return;
    }
    this.failure.set(null);
    try {
      await this.keys.generate(name().value().trim());
    } catch (error) {
      const apiError = toApiError(error);
      const code = apiError.fields?.find(field => field.path === 'name')?.code;
      if (code) {
        this.nameError.set({ key: fieldErrorKey('credentials.generateName', code), params: {} });
      } else {
        this.failure.set(this.errorText.describe(apiError));
      }
    }
  }

  protected async copy(publicKey: string): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(publicKey);
    } catch {
      // Without clipboard access the key can still be selected and copied by hand.
      return;
    }
    this.toast.show({
      message: this.transloco.translate(`${KEY}.copied`),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status: 'success'
    });
  }
}
