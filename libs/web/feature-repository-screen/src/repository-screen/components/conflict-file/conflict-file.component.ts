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
  signal,
  viewChild,
  viewChildren
} from '@angular/core';
import type { ApiError, GitConflictFile, GitResolution } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  IconComponent,
  injectNarrowViewport,
  InlineBannerComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { ApiErrorTextService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

import type { ConflictAction } from '../../services/merge-actions/merge-actions.service';
import type { OpenFile } from '../../services/open-files/open-files.service';
import { conflictOffers, shownVersions, type VersionSide } from '../../utils/conflict-offers/conflict-offers';
import { fileName, parentPath } from '../../utils/file-name/file-name';
import { versionSizes } from '../../utils/version-sizes/version-sizes';
import { ConflictVersionComponent } from '../conflict-version/conflict-version.component';
import { EditorPaneComponent } from '../editor-pane/editor-pane.component';

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
 * another file is selected.
 *
 * An unresolved file that can be edited with its conflict markers (GC-9) opens in
 * the editor below its name and the other choices, as the first way offered: the
 * page opens it through `OpenFilesService` and passes it in as `openFile`, so that
 * it saves as any file does (GC-12). Until then a spinner shows, or why it could
 * not be opened, with **Try again** (`retryOpen`). The editor is deferred, as the
 * editor area's is, so that CodeMirror stays out of the screen's first chunk.
 * **Mark as resolved** comes first among its choices (GC-14), and is emitted.
 *
 * A resolved file shows **Resolved** and **Start over** (GC-18), which is emitted,
 * in place of the editor, as saves to it are refused.
 */
@Component({
  selector: 'rs-conflict-file',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    IconComponent,
    InlineBannerComponent,
    SpinnerComponent,
    ConflictVersionComponent,
    EditorPaneComponent
  ],
  templateUrl: './conflict-file.component.html',
  styleUrl: './conflict-file.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.showing]': 'shown() !== null',
    '[class.editing]': 'shown() === null && editing()',
    '[class.typing]': 'typing()',
    '(focusin)': 'focusMoved($event)',
    '(focusout)': 'focusMoved($event)'
  }
})
export class ConflictFileComponent {
  private readonly injector = inject(Injector);
  private readonly errorText = inject(ApiErrorTextService);

  readonly repositoryId = input.required<number>();
  readonly file = input.required<GitConflictFile>();
  /** The current branch, such as `main`. */
  readonly into = input.required<string>();
  /** The branch merged into it, such as `origin/main`. */
  readonly from = input.required<string>();
  /** The resolution of this file, or its **Start over**, that is running, if any. */
  readonly resolving = input<ConflictAction | null>(null);
  /** Whether no choice can be made now. */
  readonly locked = input(false, { transform: booleanAttribute });

  /** The file opened for editing with its conflicts, once it has opened (GC-9). */
  readonly openFile = input<OpenFile | null>(null);
  /** Why the file could not be opened for editing. */
  readonly openError = input<ApiError | null>(null);

  /** A whole version chosen (GC-15, GC-16). */
  readonly resolve = output<GitResolution>();
  /** **Mark as resolved**, for a file edited with its conflicts (GC-14). */
  readonly markResolved = output<void>();
  /** **Start over**, for a resolved file (GC-18). */
  readonly startOver = output<void>();
  /** **Try again** after the file could not be opened for editing. */
  readonly retryOpen = output<void>();

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
  /** Whether the file is edited with its conflict markers (GC-9): unresolved, and editable. */
  readonly editing = computed(() => this.file().editable && !this.file().resolved);
  protected readonly openFailure = computed(() => {
    const error = this.openError();
    return error ? this.errorText.describe(error) : null;
  });
  private readonly narrow = injectNarrowViewport();
  /** Whether the focus is in the editor pane: its editor, its toolbar or its conflict bar. */
  private readonly inEditor = signal(false);
  /**
   * On a phone, while the focus is in the editor and with it the on-screen keyboard,
   * the file's name and choices make way, so that the editor keeps the height it
   * has for any file (NF-12.5); they come back when the focus leaves it.
   */
  protected readonly typing = computed(() => this.narrow() && this.inEditor() && this.editing() && !this.shown());

  protected focusMoved(event: FocusEvent): void {
    const target = event.type === 'focusin' ? event.target : event.relatedTarget;
    this.inEditor.set(target instanceof Element && target.closest('rs-editor-pane') !== null);
  }

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
