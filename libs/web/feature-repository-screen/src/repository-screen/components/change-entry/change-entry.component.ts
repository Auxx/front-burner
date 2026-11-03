import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { GitChange, GitChangeState } from '@front-burner/shared-contracts';
import { BadgeComponent, type BadgeStatus, TooltipDirective } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { fileName, parentPath } from '../../utils/file-name/file-name';

/** The colour only repeats the state's word and letter (NF-13.7). */
const STATE_STATUS: Record<GitChangeState, BadgeStatus> = {
  modified: 'warning',
  added: 'success',
  deleted: 'danger'
};

/**
 * One entry of **Changes** (GA-11): the file name, its folder in a quieter
 * style, and its state in words and with a letter. A long path is shortened,
 * and the whole path is in a tooltip, on hover, on focus and on a long press.
 */
@Component({
  selector: 'rs-change-entry',
  imports: [ TranslocoDirective, BadgeComponent, TooltipDirective ],
  templateUrl: './change-entry.component.html',
  styleUrl: './change-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem' }
})
export class ChangeEntryComponent {
  readonly change = input.required<GitChange>();
  readonly selected = input(false);
  readonly selectPath = output<string>();

  protected readonly name = computed(() => fileName(this.change().path));
  protected readonly folder = computed(() => parentPath(this.change().path));
  protected readonly status = computed(() => STATE_STATUS[this.change().state]);
}
