import { ChangeDetectionStrategy, Component, computed, inject, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import type { RepositoryIndex, SavedCredentials } from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';

import { addRepositorySchema, emptyAddRepositoryForm } from '../repositories/models/add-repository-form.model';
import { SessionKeysService } from '../repositories/services/session-keys/session-keys.service';

/**
 * The page's model and checks without the page, for the specs of the form's
 * sections. Each spec sets the template with {@link hostWith}.
 */
@Component({
  selector: 'repo-form-host',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ SessionKeysService ]
})
export class FormHostComponent {
  readonly keys = inject(SessionKeysService);
  readonly index = signal<RepositoryIndex['repositories']>([]);
  /** As loaded from the backend; `null` while loading. */
  readonly saved = signal<SavedCredentials | null>({ https: [], sshKeys: [] });
  /** With this visit's generated key and unlocks, as the page passes them on. */
  readonly shown = computed(() => {
    const saved = this.saved();
    return saved === null ? null : this.keys.withSessionKeys(saved);
  });
  readonly model = form(
    signal(emptyAddRepositoryForm('advanced')),
    addRepositorySchema({
      index: this.index,
      saved: computed(() => this.shown() ?? { https: [], sshKeys: [] }),
      generated: this.keys.generated
    })
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
