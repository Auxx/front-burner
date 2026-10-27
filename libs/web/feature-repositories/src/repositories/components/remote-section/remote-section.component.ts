import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import type { RepositoryIndex } from '@front-burner/shared-contracts';
import { defaultRepositoryName, parseRemoteUrl, remoteKey } from '@front-burner/shared-util';
import { FieldComponent, InlineBannerComponent, InputComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { SubmitFailuresService } from '../../services/submit-failures/submit-failures.service';
import { shownError } from '../../utils/add-repository-errors';

/**
 * **Remote URL** and **Repository name** (AR-8 to AR-15): the warning about a
 * remote the user already has, and the name filled from the URL until the
 * user edits it.
 */
@Component({
  selector: 'repo-remote-section',
  imports: [ TranslocoDirective, FormField, FieldComponent, InputComponent, InlineBannerComponent ],
  templateUrl: './remote-section.component.html',
  styleUrl: './remote-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RemoteSectionComponent {
  readonly remoteUrl = input.required<FieldTree<string>>();
  readonly name = input.required<FieldTree<string>>();
  /** The user's repositories; empty until loaded. */
  readonly index = input.required<RepositoryIndex['repositories']>();

  private readonly failures = inject(SubmitFailuresService, { optional: true });

  private readonly remote = computed(() => {
    const result = parseRemoteUrl(this.remoteUrl()().value().trim());
    return result.ok ? result.remote : undefined;
  });

  /** The names of the user's repositories with the same remote (AR-12). */
  protected readonly duplicates = computed(() => {
    const remote = this.remote();
    if (remote === undefined) {
      return '';
    }
    const key = remoteKey(remote);
    return this.index().filter(entry => entry.remoteKey === key).map(entry => entry.name).join(', ');
  });

  protected readonly urlError = computed(() =>
    this.failures?.forPath('remoteUrl') ?? shownError(this.remoteUrl(), 'remoteUrl')
  );
  protected readonly nameError = computed(() => this.failures?.forPath('name') ?? shownError(this.name(), 'name'));

  constructor() {
    // AR-13: a name typed by the user marks the field dirty; a filled one does not.
    effect(() => {
      const remote = this.remote();
      const name = this.name();
      if (remote !== undefined && untracked(() => !name().dirty())) {
        name().value.set(defaultRepositoryName(remote));
      }
    });
  }
}
