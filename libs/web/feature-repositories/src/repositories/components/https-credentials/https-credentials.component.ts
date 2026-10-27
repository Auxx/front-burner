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

import type { CredentialsChoice, CredentialsModel } from '../../models/add-repository-form.model';
import { shownErrorKey } from '../../utils/add-repository-errors';

const KEY = 'web-feature-repositories.HttpsCredentialsComponent';

/**
 * The HTTPS options (AR-19 to AR-22): saved credentials (only when the user
 * has some, and then the default), new credentials, or none for a public
 * repository.
 */
@Component({
  selector: 'repo-https-credentials',
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

  protected error(name: keyof CredentialsModel): string | undefined {
    return shownErrorKey(this.credentials()[name], `credentials.${name}`);
  }
}
