import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { GitConflictFile } from '@front-burner/shared-contracts';
import { IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { fileName, parentPath } from '../../utils/file-name/file-name';

/**
 * The selected conflicting file in the editor area, in place of the editor
 * during a merge (GC-8): its name, its folder, its kind and whether it is
 * resolved. Plans 96, 97, 99 and 100 add the ways to resolve it.
 */
@Component({
  selector: 'rs-conflict-file',
  imports: [ TranslocoDirective, IconComponent ],
  templateUrl: './conflict-file.component.html',
  styleUrl: './conflict-file.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConflictFileComponent {
  readonly file = input.required<GitConflictFile>();

  protected readonly name = computed(() => fileName(this.file().path));
  protected readonly folder = computed(() => parentPath(this.file().path));
}
