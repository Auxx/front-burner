import { ChangeDetectionStrategy, Component, computed, inject, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { apply, form } from '@angular/forms/signals';
import type { SavedCredentials } from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';

import {
  type CredentialsModel,
  credentialsSchema,
  defaultCredentials
} from '../repository-dialogs/credentials-form/credentials-form.model';
import { SessionKeysService } from '../repository-dialogs/credentials-form/services/session-keys/session-keys.service';

/**
 * A remote URL and the credentials form with its checks, as a form that uses
 * the credentials has them, for the specs of the credentials' sections. Each
 * spec sets the template with {@link hostWith}.
 */
@Component({
  selector: 'dlg-form-host',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ SessionKeysService ]
})
export class FormHostComponent {
  readonly keys = inject(SessionKeysService);
  /** As loaded from the backend; `null` while loading. */
  readonly saved = signal<SavedCredentials | null>({ https: [], sshKeys: [] });
  /** With this visit's generated key and unlocks, as the page passes them on. */
  readonly shown = computed(() => {
    const saved = this.saved();
    return saved === null ? null : this.keys.withSessionKeys(saved);
  });
  readonly model = form(
    signal<{ remoteUrl: string; credentials: CredentialsModel; }>({
      remoteUrl: '',
      credentials: defaultCredentials(undefined, { https: [], sshKeys: [] })
    }),
    path => {
      apply(
        path.credentials,
        credentialsSchema({
          saved: computed(() => this.shown() ?? { https: [], sshKeys: [] }),
          generated: this.keys.generated
        })
      );
    }
  );
  readonly protocol = computed(() => {
    const result = parseRemoteUrl(this.model.remoteUrl().value().trim());
    return result.ok ? result.remote.protocol : undefined;
  });
}

/** Gives the host `template`, which may use the components in `imports`. */
export function hostWith(template: string, imports: Type<unknown>[]): void {
  TestBed.overrideComponent(FormHostComponent, { set: { template, imports } });
}
