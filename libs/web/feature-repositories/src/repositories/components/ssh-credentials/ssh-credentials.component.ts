import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import type { SavedSshKey } from '@front-burner/shared-contracts';
import {
  type ChoiceOption,
  FieldComponent,
  IconComponent,
  InputComponent,
  SegmentedControlComponent,
  SelectComponent,
  SelectOptionDirective,
  TextareaComponent
} from '@front-burner/ui';
import { toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import type { CredentialsChoice, CredentialsModel } from '../../models/add-repository-form.model';
import { SessionKeysService } from '../../services/session-keys/session-keys.service';
import { fieldErrorKey, shownErrorKey } from '../../utils/add-repository-errors';
import { GeneratedKeyComponent } from '../generated-key/generated-key.component';

const KEY = 'web-feature-repositories.SshCredentialsComponent';

/**
 * The SSH options (AR-23 to AR-31): a saved key (only when the user has some,
 * and then the default), a pasted key, or a generated one. A locked saved key
 * asks for its passphrase, which unlocks it for the session as soon as the
 * user leaves the field.
 */
@Component({
  selector: 'repo-ssh-credentials',
  imports: [
    TranslocoDirective,
    FormField,
    FieldComponent,
    IconComponent,
    InputComponent,
    SegmentedControlComponent,
    SelectComponent,
    SelectOptionDirective,
    TextareaComponent,
    GeneratedKeyComponent
  ],
  templateUrl: './ssh-credentials.component.html',
  styleUrl: './ssh-credentials.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SshCredentialsComponent {
  readonly credentials = input.required<FieldTree<CredentialsModel>>();
  /** The user's saved keys, with this visit's generated key and unlocks. */
  readonly keys = input.required<readonly SavedSshKey[]>();

  private readonly transloco = inject(TranslocoService);
  private readonly sessionKeys = inject(SessionKeysService);

  protected readonly choices = computed<readonly ChoiceOption<CredentialsChoice>[]>(() => {
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    const choices: CredentialsChoice[] = this.keys().length > 0
      ? [ 'saved', 'new-ssh-key', 'generate' ]
      : [ 'new-ssh-key', 'generate' ];
    return choices.map(choice => ({ value: choice, label: this.transloco.translate(`${KEY}.choices.${choice}`) }));
  });

  protected readonly keyOptions = computed<readonly ChoiceOption<number>[]>(() =>
    this.keys().map(key => ({ value: key.id, label: key.name }))
  );

  protected readonly chosenKey = computed(() =>
    this.keys().find(key => key.id === this.credentials().savedId().value())
  );

  /** A refused unlock, until the passphrase changes. */
  protected readonly unlockError = linkedSignal<string, string | null>({
    source: () => this.credentials().passphrase().value(),
    computation: () => null
  });

  protected key(id: number): SavedSshKey | undefined {
    return this.keys().find(key => key.id === id);
  }

  protected error(name: keyof CredentialsModel): string | undefined {
    if (name === 'passphrase' && this.unlockError()) {
      return this.unlockError() ?? undefined;
    }
    return shownErrorKey(this.credentials()[name], `credentials.${name}`);
  }

  /** Unlocks the chosen key for the session (AR-25, AR-31); the passphrase is then forgotten. */
  protected async unlock(): Promise<void> {
    const key = this.chosenKey();
    const passphrase = this.credentials().passphrase;
    if (key === undefined || !key.passphraseProtected || key.unlocked || passphrase().value() === '') {
      return;
    }
    try {
      await this.sessionKeys.unlock(key.id, passphrase().value());
    } catch (error) {
      const code = toApiError(error).fields?.find(field => field.path === 'passphrase')?.code ?? 'unlock-failed';
      this.unlockError.set(fieldErrorKey('credentials.passphrase', code));
      return;
    }
    passphrase().value.set('');
  }
}
