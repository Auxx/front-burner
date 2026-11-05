import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { GitChange, GitChangeState } from '@front-burner/shared-contracts';
import {
  BadgeComponent,
  type BadgeStatus,
  CheckboxComponent,
  IconButtonComponent,
  IconComponent,
  TooltipDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { fileName, parentPath } from '../../utils/file-name/file-name';

/** The colour only repeats the state's word and letter (NF-13.7). */
const STATE_STATUS: Record<GitChangeState, BadgeStatus> = {
  modified: 'warning',
  added: 'success',
  deleted: 'danger'
};

/**
 * One entry of **Changes** (GA-11): the checkbox of a commit (GA-17), the file name, its folder in a quieter
 * style, and its state in words and with a letter. A long path is shortened,
 * and the whole path is in a tooltip, on hover, on focus and on a long press.
 * **Discard** beside it (GA-23) is always shown, since a touch screen has no hover.
 */
@Component({
  selector: 'rs-change-entry',
  imports: [
    TranslocoDirective,
    BadgeComponent,
    CheckboxComponent,
    IconButtonComponent,
    IconComponent,
    TooltipDirective
  ],
  templateUrl: './change-entry.component.html',
  styleUrl: './change-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem' }
})
export class ChangeEntryComponent {
  readonly change = input.required<GitChange>();
  readonly selected = input(false);
  readonly ticked = input(true);
  readonly tickedChange = output<boolean>();
  readonly selectPath = output<string>();
  readonly discard = output<GitChange>();

  protected readonly name = computed(() => fileName(this.change().path));
  protected readonly folder = computed(() => parentPath(this.change().path));
  protected readonly status = computed(() => STATE_STATUS[this.change().state]);
}
