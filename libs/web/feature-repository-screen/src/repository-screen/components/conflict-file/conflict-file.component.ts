import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { GitConflictFile, GitResolution } from '@front-burner/shared-contracts';
import { ButtonComponent, IconComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { conflictOffers } from '../../utils/conflict-offers/conflict-offers';
import { fileName, parentPath } from '../../utils/file-name/file-name';
import { formatSize } from '../../utils/file-size/file-size';

/** One version of the file, for its line in the list of versions (GC-17). */
interface Version {
  side: 'mine' | 'theirs';
  /** Formatted; `null` when it has no size. */
  size: string | null;
  /** The side that deleted the file. */
  deleted: boolean;
}

/**
 * The selected conflicting file in the editor area, in place of the editor
 * during a merge (GC-8): its name, its folder, its kind, whether it is resolved,
 * the size of each version, and the whole versions its kind offers (GC-15 to
 * GC-17), which a side that deleted it explains. A choice resolves at once,
 * without a question (GC-15): it is emitted, and while one runs, `resolving`
 * names it, so that it shows as busy and the others as unavailable. Plans 97,
 * 99 and 100 add the other ways to resolve it.
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

  /** A whole version chosen (GC-15, GC-16). */
  readonly resolve = output<GitResolution>();

  protected readonly name = computed(() => fileName(this.file().path));
  protected readonly folder = computed(() => parentPath(this.file().path));
  protected readonly offers = computed(() => conflictOffers(this.file()));
  /** The key of the sentence saying which side deleted the file, if one did. */
  protected readonly deletedBy = computed(() => {
    switch (this.file().kind) {
      case 'deleted-by-us':
        return 'deletedByUs';
      case 'deleted-by-them':
        return 'deletedByThem';
      default:
        return null;
    }
  });
  protected readonly versions = computed<Version[]>(() => {
    const { kind, oursSize, theirsSize } = this.file();
    return [
      { side: 'mine', size: oursSize === null ? null : formatSize(oursSize), deleted: kind === 'deleted-by-us' },
      { side: 'theirs', size: theirsSize === null ? null : formatSize(theirsSize), deleted: kind === 'deleted-by-them' }
    ];
  });

  protected choose(resolution: GitResolution): void {
    if (this.resolving() === null) {
      this.resolve.emit(resolution);
    }
  }
}
