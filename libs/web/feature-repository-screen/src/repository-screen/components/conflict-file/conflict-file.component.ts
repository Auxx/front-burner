import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  viewChild,
  viewChildren
} from '@angular/core';
import type { GitConflictFile, GitResolution } from '@front-burner/shared-contracts';
import { ButtonComponent, IconComponent, SpinnerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { conflictOffers, shownVersions, type VersionSide } from '../../utils/conflict-offers/conflict-offers';
import { fileName, parentPath } from '../../utils/file-name/file-name';
import { versionSizes } from '../../utils/version-sizes/version-sizes';
import { ConflictVersionComponent } from '../conflict-version/conflict-version.component';

/**
 * The selected conflicting file in the editor area, in place of the editor
 * during a merge (GC-8): its name, its folder, its kind, whether it is resolved,
 * the size of each version, and the whole versions its kind offers (GC-15 to
 * GC-17), which a side that deleted it explains. A choice resolves at once,
 * without a question (GC-15): it is emitted. While `locked`, such as while a
 * resolve of any file runs, every choice is unavailable, and the one named by
 * `resolving` shows as busy.
 *
 * **Show mine** and **Show theirs** open that version read-only in its place
 * (GC-17), until **Back**, which gives the focus back to the button, or until
 * another file is selected. Plans 99 and 100 add the other ways to resolve it.
 */
@Component({
  selector: 'rs-conflict-file',
  imports: [ TranslocoDirective, ButtonComponent, IconComponent, SpinnerComponent, ConflictVersionComponent ],
  templateUrl: './conflict-file.component.html',
  styleUrl: './conflict-file.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.showing]': 'shown() !== null'
  }
})
export class ConflictFileComponent {
  private readonly injector = inject(Injector);

  readonly repositoryId = input.required<number>();
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

  private readonly showButtons = viewChildren('showButton', { read: ElementRef<HTMLButtonElement> });
  private readonly heading = viewChild('heading', { read: ElementRef<HTMLElement> });

  private readonly path = computed(() => this.file().path);
  protected readonly name = computed(() => fileName(this.path()));
  protected readonly folder = computed(() => parentPath(this.path()));
  protected readonly offers = computed(() => conflictOffers(this.file()));
  /** The versions **Show mine** and **Show theirs** can open (GC-17). */
  protected readonly shows = computed(() => shownVersions(this.file()));
  /** The version open read-only, if any; another file starts without one. */
  protected readonly shown = linkedSignal<string, VersionSide | null>({
    source: this.path,
    computation: () => null
  });
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

  protected show(side: VersionSide): void {
    this.shown.set(side);
  }

  /**
   * **Back**: the file's choices again, with the focus on the button that opened
   * the version, or on the file's name when that button has gone meanwhile, such
   * as when the merge was read again and the version can no longer be shown.
   */
  protected back(): void {
    const side = this.shown();
    this.shown.set(null);
    afterNextRender(() => {
      const index = side === null ? -1 : this.shows().indexOf(side);
      (this.showButtons()[index] ?? this.heading())?.nativeElement.focus();
    }, { injector: this.injector });
  }
}
