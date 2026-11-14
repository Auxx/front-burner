import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import {
  BannerActionsComponent,
  ButtonComponent,
  ICON_SPRITE_URL,
  InlineBannerComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { CodeEditorComponent, createEditorState, type EditorStateChange } from '@front-burner/web-code-editor';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { EditorSettingsService } from '../../services/editor-settings/editor-settings.service';
import type { VersionSide } from '../../utils/conflict-offers/conflict-offers';
import { fileName } from '../../utils/file-name/file-name';
import { findPanelLabels } from '../../utils/find-panel-labels/find-panel-labels';

type EditorState = EditorStateChange['state'];

/** The read of the version: the editor's state once it has answered, or why it can't be shown. */
type VersionRead =
  | { kind: 'loading'; }
  | { kind: 'loaded'; state: EditorState; }
  | { kind: 'failed'; text: string; reference: string | null; };

const KEY = 'web-feature-repository-screen.ConflictVersionComponent';

/**
 * One version of a conflicting Markdown file, mine (`ours`) or theirs, opened
 * read-only by **Show mine** or **Show theirs** so that the user can compare
 * before choosing (GC-17). A banner says which version it is and that it is
 * read-only, with **Back** (ED-25).
 *
 * It keeps its own read-only editor state, since nothing of it is ever saved:
 * it does not go through `OpenFilesService`, which would give it a saver and a
 * browser draft, and the file's own editor state is not touched. The editor is
 * not editable, so a phone shows no on-screen keyboard. It shows the raw text:
 * the preview is of no use to compare source lines. A version the backend
 * refuses, such as one not valid UTF-8, says why. Loaded with `@defer`, so that
 * CodeMirror stays out of the screen's first chunk (ED-4).
 */
@Component({
  selector: 'rs-conflict-version',
  imports: [
    TranslocoDirective,
    BannerActionsComponent,
    ButtonComponent,
    CodeEditorComponent,
    InlineBannerComponent,
    SpinnerComponent
  ],
  templateUrl: './conflict-version.component.html',
  styleUrl: './conflict-version.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConflictVersionComponent {
  private readonly api = inject(GitApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);
  private readonly settings = inject(EditorSettingsService);
  private readonly iconSprite = inject(ICON_SPRITE_URL);

  readonly repositoryId = input.required<number>();
  readonly path = input.required<string>();
  readonly side = input.required<VersionSide>();
  /** The branch merged in, such as `origin/main`, which their version comes from. */
  readonly from = input.required<string>();

  /** **Back** to the file's choices. */
  readonly back = output();

  protected readonly read = signal<VersionRead>({ kind: 'loading' });
  /** The key of the banner's sentence. */
  protected readonly message = computed(() => this.side() === 'ours' ? 'mine' : 'theirs');

  constructor() {
    effect(onCleanup => {
      const repositoryId = this.repositoryId();
      const path = this.path();
      const side = this.side();
      const request = untracked(() => {
        this.read.set({ kind: 'loading' });
        return this.api.gitMergeVersion(repositoryId, { path, side }).subscribe({
          next: version => this.read.set({ kind: 'loaded', state: this.stateOf(version.content, path, side) }),
          error: (error: unknown) => this.read.set({ kind: 'failed', ...this.errorText.describe(toApiError(error)) })
        });
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  /** Keeps the cursor and the find panel of the version while it is shown. */
  protected changed(change: EditorStateChange): void {
    this.read.set({ kind: 'loaded', state: change.state });
  }

  private stateOf(content: string, path: string, side: VersionSide): EditorState {
    return createEditorState({
      content,
      highlight: true,
      readOnly: true,
      softWrap: this.settings.softWrap(),
      label: this.transloco.translate(`${KEY}.label.${side}`, { name: fileName(path) }),
      findLabels: findPanelLabels(this.transloco),
      findIconSprite: this.iconSprite
    });
  }
}
