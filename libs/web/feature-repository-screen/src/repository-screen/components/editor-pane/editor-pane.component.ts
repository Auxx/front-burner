import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import {
  ButtonComponent,
  SplitPaneComponent,
  type SplitPaneShow,
  TabContentDirective,
  TabGroupDirective,
  TabPanelDirective
} from '@front-burner/ui';
import {
  CodeEditorComponent,
  contentOf,
  createEditorState,
  cursorOf,
  type EditorStateChange,
  isHighlighting,
  replaceContent,
  setHighlighting,
  setLabel,
  setReadOnly
} from '@front-burner/web-code-editor';
import { MarkdownPreviewComponent, type PreviewPathLink } from '@front-burner/web-markdown';
import { TranslocoDirective } from '@jsverse/transloco';

import { DiskChangesService } from '../../services/disk-changes/disk-changes.service';
import { type OpenFile, OpenFilesService } from '../../services/open-files/open-files.service';
import { type ViewModeName, ViewModeService } from '../../services/view-mode/view-mode.service';
import { fileName } from '../../utils/file-name/file-name';
import { type ScrollPane, ScrollSync } from '../../utils/scroll-sync/scroll-sync';
import { ChangedOnDiskComponent } from '../changed-on-disk/changed-on-disk.component';
import { DraftOfferComponent } from '../draft-offer/draft-offer.component';
import { GoneElsewhereComponent } from '../gone-elsewhere/gone-elsewhere.component';
import { LargeFileNoteComponent } from '../large-file-note/large-file-note.component';
import { ViewModeSwitchComponent } from '../view-mode-switch/view-mode-switch.component';

type EditorState = EditorStateChange['state'];

/** Which panes are on screen, and how. */
interface Layout {
  narrow: boolean;
  mode: ViewModeName;
}

/** The `revision` of the content each file's editor state was built from (ED-24). */
const built = new WeakMap<OpenFile, number>();

/**
 * The editor of the open file: CodeMirror with the file's own state (A-8.15),
 * **Find** (ED-11), and above it the offer of a browser draft (ED-7) and the
 * large-file note of ED-9a. While a draft is offered the editor is read-only;
 * **Restore** puts the draft in it as one undoable edit, which is saved at
 * once. Above it too, after a change on disk, the question **Reload** or
 * **Keep mine** (ED-24), or, for a file gone elsewhere, **Recreate it**
 * (ED-21); meanwhile the editor is read-only too, since nothing is saved
 * until the user chooses. When **Recreate it** finds the file there again,
 * the file is checked again, which asks **Reload** or **Keep mine**. Loaded with
 * `@defer`, so that CodeMirror stays out of the screen's first chunk (ED-4).
 *
 * Each new state of the editor is written back into the `OpenFile` at once,
 * and an edit goes to its saver, which reads the content only when it sends.
 * The editor is given another state only when another file is shown, or when
 * the file's highlighting, name, offered draft, gone state or loaded content
 * changes (ED-9a, ED-37), so that it is never handed a state older than its
 * own. A reloaded file gets a new state, without undo history, with the
 * cursor at the same line and column as far as the new text allows, and,
 * when it was the file shown, the same first visible line (ED-24).
 *
 * The live preview (ED-26, A-8.12) has `fragment` as the heading to scroll
 * to; a link in it to another entry is emitted as `openPath` (ED-31). It
 * follows the file's `preview` source, whose version is bumped on every
 * change of the text. The view mode (ED-34) shows the editor and the preview
 * side by side, or one of them: in a split pane on wide screens, as **Edit**
 * and **Preview** tabs on narrow ones. A preview that is not on screen does
 * no work (A-8.12). In **Split** mode the two scroll together (ED-35); when
 * the mode or the screen size changes, the panes now shown open at the place
 * of the file that was at the top before (ED-36).
 */
@Component({
  selector: 'rs-editor-pane',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CodeEditorComponent,
    ChangedOnDiskComponent,
    DraftOfferComponent,
    GoneElsewhereComponent,
    LargeFileNoteComponent,
    MarkdownPreviewComponent,
    SplitPaneComponent,
    TabContentDirective,
    TabGroupDirective,
    TabPanelDirective,
    ViewModeSwitchComponent
  ],
  templateUrl: './editor-pane.component.html',
  styleUrl: './editor-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorPaneComponent {
  readonly file = input.required<OpenFile>();
  /** The heading of the file to show in the preview, such as from a link in another file. */
  readonly fragment = input<string | null>(null);
  /** A link in the preview to another entry of the repository (ED-31). */
  readonly openPath = output<PreviewPathLink>();

  private readonly openFiles = inject(OpenFilesService);
  private readonly diskChanges = inject(DiskChangesService);
  protected readonly viewMode = inject(ViewModeService);
  /**
   * The editor, once it is there: not while the pane first renders, nor on a
   * narrow screen before the **Edit** tab was first opened.
   */
  private readonly editor = viewChild(CodeEditorComponent);
  private readonly editorElement = viewChild(CodeEditorComponent, { read: ElementRef });
  private readonly preview = viewChild(MarkdownPreviewComponent);
  private readonly previewElement = viewChild(MarkdownPreviewComponent, { read: ElementRef });
  private readonly injector = inject(Injector);
  /** The file whose state the editor was last given. */
  private shownFile: OpenFile | null = null;

  private readonly scrollSync = new ScrollSync();
  /** The panes that scroll together, while they do. */
  private synced: { editor: ScrollPane; preview: ScrollPane; } | null = null;
  /** The layout the panes are shown in. */
  private shownLayout: Layout | null = null;
  /**
   * The place at the top of the panes on screen, as they last reported it, or `null` before
   * either scrolled. It is not read when the layout changes: by then the tabs may have hidden
   * the pane already.
   */
  private place: number | null = null;
  /** The place the panes of a new layout open at, and the panes still to scroll there (ED-36). */
  private placeToKeep: { place: number; editor: boolean; preview: boolean; } | null = null;

  protected readonly show = computed<SplitPaneShow>(() => {
    const mode = this.viewMode.mode();
    return mode === 'split' ? 'both' : mode === 'edit' ? 'start' : 'end';
  });
  /** The editor's share of the pane beside the preview, in percent. */
  protected readonly editorSize = signal(50);
  protected readonly name = computed(() => fileName(this.file().path()));

  protected readonly state = linkedSignal(() => {
    const file = this.file();
    return this.stateFor(
      file,
      file.highlight(),
      fileName(file.path()),
      file.draft() !== null || file.gone() || file.changed() !== null,
      file.revision()
    );
  });
  protected readonly noteShown = computed(() => {
    const file = this.file();
    return file.largeOnNarrow && !file.highlight() && this.viewMode.editorShown();
  });

  constructor() {
    // The switch to the remembered mode at start is not the user's, so it keeps no place.
    effect(() => {
      const layout = { narrow: this.viewMode.narrow(), mode: this.viewMode.mode() };
      const restored = this.viewMode.restored();
      untracked(() => {
        if (restored) {
          this.keepPlace(layout);
        } else {
          this.shownLayout = null;
        }
      });
    });

    // The editor's state is built even while the editor is not there, as on a narrow screen before the
    // Edit tab was first opened, so that Restore, Keep mine and Recreate it have the file's content.
    effect(() => this.state());

    // A pane of a tab is created only when its tab is first opened, after the layout has rendered.
    effect(() => {
      this.editor();
      this.preview();
      untracked(() => afterNextRender(() => this.applyPlace(), { injector: this.injector }));
    });

    // ED-35: Split mode only, once both panes are there.
    effect(onCleanup => {
      const split = !this.viewMode.narrow() && this.viewMode.mode() === 'split';
      const editor = this.editor();
      const editorElement = this.editorElement()?.nativeElement as HTMLElement | undefined;
      const preview = this.preview();
      const previewElement = this.previewElement()?.nativeElement as HTMLElement | undefined;
      if (!split || !editor || !editorElement || !preview || !previewElement) {
        return;
      }
      const synced = {
        editor: { element: editorElement, scrollToLine: (place: number) => editor.scrollToLine(place) },
        preview: { element: previewElement, scrollToLine: (place: number) => preview.scrollToLine(place) }
      };
      this.synced = synced;
      const disconnect = this.scrollSync.connect(synced.editor, synced.preview);
      onCleanup(() => {
        disconnect();
        if (this.synced === synced) {
          this.synced = null;
        }
      });
    });
  }

  protected openSearch(): void {
    this.editor()?.openSearch();
  }

  protected editorScrolled(place: number): void {
    if (onScreen(this.editorElement())) {
      this.place = place;
    }
    if (this.synced) {
      this.scrollSync.scrolled(this.synced.editor, place);
    }
  }

  protected previewScrolled(place: number): void {
    if (onScreen(this.previewElement())) {
      this.place = place;
    }
    if (this.synced) {
      this.scrollSync.scrolled(this.synced.preview, place);
    }
  }

  /** **Restore**: the draft replaces the text as one undoable edit and is saved at once (ED-7). */
  protected restore(): void {
    const file = this.file();
    this.openFiles.restoreDraft(file.path(), content => {
      const current = file.editorState as EditorState;
      file.editorState = current.update(replaceContent(current, content)).state;
      return () => contentOf(file.editorState as EditorState);
    });
    file.preview.version.update(version => version + 1);
    this.editor()?.focus();
  }

  /** **Discard**: the draft is deleted and the file stays as on disk (ED-7). */
  protected discard(): void {
    this.openFiles.discardDraft(this.file().path());
    this.editor()?.focus();
  }

  /** **Reload**: the new content replaces the unsaved edits (ED-24). */
  protected reload(): void {
    this.openFiles.reload(this.file().path(), { discard: true }).catch(() => undefined);
    this.editor()?.focus();
  }

  /** **Keep mine**: the editor's content is saved over the change on disk (ED-24). */
  protected keepMine(): void {
    const file = this.file();
    this.openFiles.keepMine(file.path(), () => contentOf(file.editorState as EditorState));
    this.editor()?.focus();
  }

  /** **Recreate it**: the file is created again with the editor's content (ED-21). */
  protected async recreate(): Promise<void> {
    const file = this.file();
    await this.openFiles.recreate(file.path(), () => contentOf(file.editorState as EditorState));
    if (file.recreateError()?.code === 'entry-exists') {
      this.diskChanges.notice(file.path());
    } else if (!file.gone() && this.file() === file) {
      this.editor()?.focus();
    }
  }

  protected changed(change: EditorStateChange): void {
    const file = this.file();
    file.editorState = change.state;
    this.state.set(change.state);
    if (change.docChanged) {
      file.saver.edit(() => contentOf(file.editorState as EditorState));
      file.preview.version.update(version => version + 1);
    }
  }

  /**
   * ED-36: when the layout changes, the panes shown next open at the place
   * that was at the top of the panes shown before.
   */
  private keepPlace(layout: Layout): void {
    const before = this.shownLayout;
    this.shownLayout = layout;
    if (!before || (before.narrow === layout.narrow && before.mode === layout.mode)) {
      return;
    }
    const place = this.place;
    if (place === null) {
      this.placeToKeep = null;
      return;
    }
    this.placeToKeep = { place, editor: layout.mode !== 'preview', preview: layout.mode !== 'edit' };
    afterNextRender(() => this.applyPlace(), { injector: this.injector });
  }

  /** Scrolls the panes of the new layout that are there to the kept place. */
  private applyPlace(): void {
    const keep = this.placeToKeep;
    if (!keep) {
      return;
    }
    const editor = keep.editor ? this.editor() : undefined;
    const preview = keep.preview ? this.preview() : undefined;
    editor?.scrollToLine(keep.place);
    preview?.scrollToLine(keep.place);
    keep.editor &&= !editor;
    keep.preview &&= !preview;
    if (!keep.editor && !keep.preview) {
      this.placeToKeep = null;
    }
  }

  /**
   * The file's state, created on its first showing and again for each
   * reload, with its highlighting, name and read-only mode brought up to date.
   */
  private stateFor(
    file: OpenFile,
    highlight: boolean,
    label: string,
    readOnly: boolean,
    revision: number
  ): EditorState {
    const existing = file.editorState as EditorState | null;
    const reloaded = existing !== null && (built.get(file) ?? 0) !== revision;
    built.set(file, revision);
    const view = this.editor();
    if (reloaded && view && this.shownFile === file) {
      const top = view.topLine();
      afterNextRender(() => this.editor()?.scrollToLine(top), { injector: this.injector });
    }
    if (this.shownFile !== file) {
      // Another file opens at its own place.
      this.place = null;
    }
    this.shownFile = file;
    const state = existing === null || reloaded
      ? createEditorState({
        content: file.file.content,
        highlight,
        label,
        readOnly,
        cursor: reloaded ? cursorOf(existing) : undefined
      })
      : existing.update(
        setLabel(label),
        ...(isHighlighting(existing) === highlight ? [] : [ setHighlighting(highlight) ]),
        ...(existing.readOnly === readOnly ? [] : [ setReadOnly(readOnly) ])
      ).state;
    file.editorState = state;
    if (existing === null) {
      // The same text as the loaded content, which the preview read until now.
      file.preview.read = () => contentOf(file.editorState as EditorState);
    } else if (reloaded) {
      // Only a reload changes the text here; a new label, highlighting or read-only mode does not.
      untracked(() => file.preview.version.update(version => version + 1));
    }
    return state;
  }
}

/** Whether a pane is on screen: there, and not in a hidden tab panel or split pane. */
function onScreen(pane: ElementRef | undefined): boolean {
  const element = pane?.nativeElement as HTMLElement | undefined;
  return element !== undefined && element.closest('[hidden]') === null;
}
