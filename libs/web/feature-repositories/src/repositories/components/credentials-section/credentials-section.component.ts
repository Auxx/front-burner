import { ChangeDetectionStrategy, Component, computed, effect, input, untracked } from '@angular/core';
import type { FieldTree } from '@angular/forms/signals';
import type { SavedCredentials } from '@front-burner/shared-contracts';
import { SpinnerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { type CredentialsModel, defaultCredentials } from '../../models/add-repository-form.model';
import { HttpsCredentialsComponent } from '../https-credentials/https-credentials.component';
import { SshCredentialsComponent } from '../ssh-credentials/ssh-credentials.component';

/**
 * **Credentials** (AR-11, AR-16): the options of the remote URL's protocol,
 * or "Enter the remote URL first" while it is not valid. When the protocol
 * changes, the other protocol's choices are cleared.
 */
@Component({
  selector: 'repo-credentials-section',
  imports: [ TranslocoDirective, SpinnerComponent, HttpsCredentialsComponent, SshCredentialsComponent ],
  templateUrl: './credentials-section.component.html',
  styleUrl: './credentials-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CredentialsSectionComponent {
  readonly protocol = input.required<'https' | 'ssh' | undefined>();
  readonly credentials = input.required<FieldTree<CredentialsModel>>();
  /** The user's saved credentials; `null` while they load. */
  readonly saved = input.required<SavedCredentials | null>();

  protected readonly loaded = computed(() => this.saved() !== null);

  /** The last valid protocol, so that editing the URL through invalid states keeps the choices. */
  private shownProtocol: 'https' | 'ssh' | undefined;

  constructor() {
    effect(() => {
      const protocol = this.protocol();
      if (protocol === undefined || !this.loaded() || protocol === this.shownProtocol) {
        return;
      }
      this.shownProtocol = protocol;
      untracked(() => {
        const saved = this.saved() ?? { https: [], sshKeys: [] };
        this.credentials()().value.set(defaultCredentials(protocol, saved));
      });
    });
  }
}
