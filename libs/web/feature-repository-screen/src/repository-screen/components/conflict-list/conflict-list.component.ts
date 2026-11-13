import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import type { GitConflictKind, GitMergeState } from '@front-burner/shared-contracts';
import { IconComponent, TooltipDirective } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { fileName, parentPath } from '../../utils/file-name/file-name';
import { type VersionSize, versionSizes } from '../../utils/version-sizes/version-sizes';

/** How many of the files merged without conflicts the expanded list shows; the rest are counted. */
export const OTHER_FILES_SHOWN = 200;

/** One conflicting file as the list shows it. */
interface ConflictRow {
  path: string;
  name: string;
  folder: string;
  kind: GitConflictKind;
  resolved: boolean;
  sizes: VersionSize[];
}

/**
 * The conflicting files of the merge in progress, in the side pane in place of
 * the file tree and **Changes** (GC-7, FB-26): sorted by path, as the API sends
 * them, each with its name, its folder in a quieter style, the size of each
 * version (GC-17), its kind in words and whether it is resolved, in words and
 * with an icon (NF-13.7). Below them, the
 * files merged without conflicts, collapsed; expanded, the first
 * `OTHER_FILES_SHOWN` of them and how many more, so that thousands don't slow
 * the screen. Selecting a file asks the page to show it (GC-8).
 */
@Component({
  selector: 'rs-conflict-list',
  imports: [ TranslocoDirective, IconComponent, TooltipDirective ],
  templateUrl: './conflict-list.component.html',
  styleUrl: './conflict-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // To take the focus when what had it went away, such as the activity bar's items.
  host: { tabindex: '-1' }
})
export class ConflictListComponent {
  readonly state = input.required<GitMergeState>();
  /** The path of the file shown in the editor area. */
  readonly selected = input<string | null>(null);
  readonly selectPath = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Whether the files merged without conflicts are listed. */
  protected readonly expanded = signal(false);

  protected readonly rows = computed<ConflictRow[]>(() =>
    this.state().files.map(file => ({
      path: file.path,
      name: fileName(file.path),
      folder: parentPath(file.path),
      kind: file.kind,
      resolved: file.resolved,
      sizes: versionSizes(file)
    }))
  );
  protected readonly otherCount = computed(() => this.state().otherFiles.length);
  protected readonly otherShown = computed(() => this.state().otherFiles.slice(0, OTHER_FILES_SHOWN));
  protected readonly otherMore = computed(() => Math.max(0, this.otherCount() - OTHER_FILES_SHOWN));

  protected toggleOther(): void {
    this.expanded.update(expanded => !expanded);
  }

  /** Takes the focus: the selected file's entry, or the first one, or the list itself. */
  focus(): void {
    const entry = this.host.querySelector<HTMLElement>('.entry[aria-current="true"]')
      ?? this.host.querySelector<HTMLElement>('.entry');
    (entry ?? this.host).focus();
  }
}
