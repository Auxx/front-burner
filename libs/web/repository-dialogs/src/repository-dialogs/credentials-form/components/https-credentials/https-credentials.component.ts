import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import type { SavedHttpsCredentials } from '@front-burner/shared-contracts';
import {
  type ChoiceOption,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  InputComponent,
  PasswordRevealDirective,
  SegmentedControlComponent,
  SelectComponent
} from '@front-burner/ui';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { credentialsShownError, type FieldErrorText } from '../../credentials-errors';
import type { CredentialsChoice, CredentialsModel } from '../../credentials-form.model';
import { SubmitFailuresService } from '../../services/submit-failures/submit-failures.service';

const KEY = 'web-repository-dialogs.HttpsCredentialsComponent';

/**
 * The HTTPS options (AR-19 to AR-22): saved credentials (only when the user
 * has some, and then the default), new credentials, or none for a public
 * repository.
 */
@Component({
  selector: 'dlg-https-credentials',
  imports: [
    TranslocoDirective,
    FormField,
    FieldComponent,
    InputComponent,
    IconButtonComponent,
    IconComponent,
    PasswordRevealDirective,
    SegmentedControlComponent,
    SelectComponent
  ],
  templateUrl: './https-credentials.component.html',
  styleUrl: './https-credentials.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HttpsCredentialsComponent {
  readonly credentials = input.required<FieldTree<CredentialsModel>>();
  readonly saved = input.required<readonly SavedHttpsCredentials[]>();

  private readonly transloco = inject(TranslocoService);
  private readonly failures = inject(SubmitFailuresService, { optional: true });

  protected readonly choices = computed<readonly ChoiceOption<CredentialsChoice>[]>(() => {
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    const choices: CredentialsChoice[] = this.saved().length > 0
      ? [ 'saved', 'new-https', 'none' ]
      : [ 'new-https', 'none' ];
    return choices.map(choice => ({ value: choice, label: this.transloco.translate(`${KEY}.choices.${choice}`) }));
  });

  protected readonly savedOptions = computed<readonly ChoiceOption<number>[]>(() =>
    this.saved().map(saved => ({ value: saved.id, label: `${saved.name} (${saved.username})` }))
  );

  /** The error to show on each field, under `web-repository-dialogs.errors`. */
  protected readonly fieldErrors = computed(() => ({
    savedId: this.fieldError('savedId'),
    name: this.fieldError('name'),
    username: this.fieldError('username'),
    password: this.fieldError('password')
  }));

  private fieldError(name: keyof CredentialsModel): FieldErrorText | undefined {
    return this.failures?.forPath(`credentials.${name}`)
      ?? credentialsShownError(this.credentials()[name], `credentials.${name}`);
  }
}
