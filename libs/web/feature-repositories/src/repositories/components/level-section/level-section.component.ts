import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import { GIT_LEVELS, type GitLevel } from '@front-burner/shared-contracts';
import { type ChoiceOption, FieldComponent, SelectComponent } from '@front-burner/ui';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { SubmitFailuresService } from '../../services/submit-failures/submit-failures.service';

const KEY = 'web-feature-repositories.LevelSectionComponent';

/**
 * **Git control level** (AR-38 to AR-40): the levels the user is allowed, from
 * Simple to Advanced, each with a description. Hidden when only one is
 * allowed; the page then uses that one.
 */
@Component({
  selector: 'repo-level-section',
  imports: [ TranslocoDirective, FormField, FieldComponent, SelectComponent ],
  templateUrl: './level-section.component.html',
  styleUrl: './level-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LevelSectionComponent {
  readonly gitLevel = input.required<FieldTree<GitLevel>>();
  readonly allowed = input.required<readonly GitLevel[]>();

  private readonly transloco = inject(TranslocoService);
  private readonly failures = inject(SubmitFailuresService, { optional: true });

  /** A failure the backend reported for the level (AR-40). */
  protected readonly error = computed(() => this.failures?.forPath('gitLevel'));

  protected readonly options = computed<readonly ChoiceOption<GitLevel>[]>(() => {
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    return GIT_LEVELS.filter(level => this.allowed().includes(level)).map(level => ({
      value: level,
      label: this.transloco.translate(`${KEY}.levels.${level}`),
      description: this.transloco.translate(`${KEY}.descriptions.${level}`)
    }));
  });
}
