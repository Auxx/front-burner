import { ChangeDetectionStrategy, Component, computed, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import type { RepositoryIndex, SavedCredentials } from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';

import { addRepositorySchema, emptyAddRepositoryForm } from '../repositories/models/add-repository-form.model';

/**
 * The page's model and checks without the page, for the specs of the form's
 * sections. Each spec sets the template with {@link hostWith}.
 */
@Component({
  selector: 'repo-form-host',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FormHostComponent {
  readonly index = signal<RepositoryIndex['repositories']>([]);
  readonly saved = signal<SavedCredentials | null>({ https: [], sshKeys: [] });
  readonly model = form(
    signal(emptyAddRepositoryForm('advanced')),
    addRepositorySchema({ index: this.index, saved: computed(() => this.saved() ?? { https: [], sshKeys: [] }) })
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
