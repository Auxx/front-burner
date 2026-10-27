import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { type FieldTree, FormField } from '@angular/forms/signals';
import { CLONE_MODES, type CloneMode } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  CheckboxComponent,
  ChoiceComponent,
  type ChoiceOption,
  FieldComponent,
  InlineBannerComponent,
  SegmentedControlComponent,
  SelectComponent
} from '@front-burner/ui';
import { ApiErrorTextService } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { BranchListService } from '../../services/branch-list/branch-list.service';
import { SubmitFailuresService } from '../../services/submit-failures/submit-failures.service';
import { failureTexts, shownError } from '../../utils/add-repository-errors';

const KEY = 'web-feature-repositories.CloneSectionComponent';

/**
 * **Clone mode** and, for a single branch, **Branch**, the warning and "I
 * understand" (AR-33 to AR-37). The branch list comes from the page's
 * {@link BranchListService}; the remote's default branch is preselected.
 */
@Component({
  selector: 'repo-clone-section',
  imports: [
    TranslocoDirective,
    FormField,
    ButtonComponent,
    CheckboxComponent,
    ChoiceComponent,
    FieldComponent,
    InlineBannerComponent,
    SegmentedControlComponent,
    SelectComponent
  ],
  templateUrl: './clone-section.component.html',
  styleUrl: './clone-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CloneSectionComponent {
  readonly cloneMode = input.required<FieldTree<CloneMode>>();
  readonly branch = input.required<FieldTree<string>>();
  readonly understood = input.required<FieldTree<boolean>>();

  private readonly transloco = inject(TranslocoService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly failures = inject(SubmitFailuresService, { optional: true });
  protected readonly branches = inject(BranchListService);
  protected readonly modes = CLONE_MODES;

  protected readonly modeOptions = computed<readonly ChoiceOption<CloneMode>[]>(() => {
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    return CLONE_MODES.map(mode => ({ value: mode, label: this.transloco.translate(`${KEY}.modes.${mode}`) }));
  });

  protected readonly branchOptions = computed<readonly ChoiceOption<string>[]>(() => {
    const state = this.branches.state();
    return state.kind === 'loaded' ? state.branches.map(branch => ({ value: branch, label: branch })) : [];
  });

  /** What the dropdown shows while it has no branch to show (AR-35, AR-37). */
  protected readonly placeholder = computed(() => {
    const state = this.branches.state();
    if (state.kind === 'loading') {
      return 'loading';
    }
    return state.kind === 'loaded' && state.branches.length === 0 ? 'noBranches' : 'chooseBranch';
  });

  /** A failed branch list, else the field's own error (AR-35). */
  protected readonly branchError = computed(() => {
    this.transloco.activeLang();
    const state = this.branches.state();
    if (state.kind === 'failed') {
      const [ failure ] = failureTexts(state.error);
      return failure.key === null
        ? this.errorText.describe(state.error).text
        : this.transloco.translate(`web-feature-repositories.errors.${failure.key}`, failure.params);
    }
    const error = this.failures?.forPath('branch') ?? shownError(this.branch(), 'branch');
    return error && this.transloco.translate(`web-feature-repositories.errors.${error.key}`, error.params);
  });

  constructor() {
    // The remote's default branch, unless the new list still has the chosen one.
    effect(() => {
      const state = this.branches.state();
      if (state.kind !== 'loaded') {
        return;
      }
      untracked(() => {
        const branch = this.branch()();
        if (!state.branches.includes(branch.value())) {
          branch.value.set(state.defaultBranch ?? '');
        }
      });
    });
  }
}
