import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { GitConflictFile, GitResolution } from '@front-burner/shared-contracts';
import { ButtonComponent, IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { conflictOffers } from '../../utils/conflict-offers/conflict-offers';
import { fileName, parentPath } from '../../utils/file-name/file-name';
import { versionSizes } from '../../utils/version-sizes/version-sizes';

/**
 * The selected conflicting file in the editor area, in place of the editor
 * during a merge (GC-8): its name, its folder, its kind, whether it is resolved,
 * the size of each version, and the whole versions its kind offers (GC-15 to
 * GC-17), which a side that deleted it explains. A choice resolves at once,
 * without a question (GC-15): it is emitted. While `locked`, such as while a
 * resolve of any file runs, every choice is unavailable, and the one named by
 * `resolving` shows as busy. Plans 97, 99 and 100 add the other ways to resolve it.
 */
@Component({
  selector: 'rs-conflict-file',
  imports: [ TranslocoDirective, ButtonComponent, IconComponent ],
  templateUrl: './conflict-file.component.html',
  styleUrl: './conflict-file.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConflictFileComponent {
  readonly file = input.required<GitConflictFile>();
  /** The current branch, such as `main`. */
  readonly into = input.required<string>();
  /** The branch merged into it, such as `origin/main`. */
  readonly from = input.required<string>();
  /** The resolution of this file that is running, if any. */
  readonly resolving = input<GitResolution | null>(null);
  /** Whether no choice can be made now. */
  readonly locked = input(false, { transform: booleanAttribute });

  /** A whole version chosen (GC-15, GC-16). */
  readonly resolve = output<GitResolution>();

  protected readonly name = computed(() => fileName(this.file().path));
  protected readonly folder = computed(() => parentPath(this.file().path));
  protected readonly offers = computed(() => conflictOffers(this.file()));
  /** The key of the sentence saying which side deleted the file, if one did. */
  protected readonly deletedNote = computed(() => {
    switch (this.file().kind) {
      case 'deleted-by-us':
        return 'deletedByUsNote';
      case 'deleted-by-them':
        return 'deletedByThemNote';
      default:
        return null;
    }
  });
  protected readonly versions = computed(() => versionSizes(this.file()));
}
