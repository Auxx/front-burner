import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import type { Entry, EntryPath, NewEntryKind } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  FieldComponent,
  InlineBannerComponent,
  InputComponent
} from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom, type Observable } from 'rxjs';

import {
  entryNameField,
  type EntryRequestFailure,
  entryRequestFailure,
  ignoredEntryName
} from '../../utils/entry-name-field/entry-name-field';
import { parentPath } from '../../utils/file-name/file-name';

/** **New file** or **New folder** in `folder` (FB-29 to FB-34). */
export interface NewEntryData {
  readonly mode: 'create';
  readonly repositoryId: number;
  /** The folder to create in; `''` for the root folder. */
  readonly folder: string;
  readonly kind: NewEntryKind;
  /** Whether the folder is an ignored entry (FB-31). */
  readonly folderIgnored: boolean;
  /** The names in the folder, as listed. */
  readonly siblings: readonly string[];
}

/** **Rename** of the entry at `path` (FB-35). */
export interface RenameEntryData {
  readonly mode: 'rename';
  readonly repositoryId: number;
  readonly path: string;
  readonly entry: Entry;
  /** The names in the entry's folder, as listed, its own among them. */
  readonly siblings: readonly string[];
  /**
   * Asked before the rename is sent, with the dialog still open, such as the
   * second confirmation of a folder that holds non-Markdown files (FB-35).
   * `false` keeps the dialog as it is.
   */
  readonly confirm?: () => Promise<boolean>;
}

export type EntryNameData = NewEntryData | RenameEntryData;

/** A new file's name until the user types one; `untitled` is selected (FB-29). */
const UNTITLED = 'untitled';

let nextId = 0;

/**
 * Asks for the name of a new file or folder (FB-29 to FB-34), or the new name
 * of an entry (FB-35), checking it as the user types, and creates or renames
 * the entry. The dialog shows the final name whenever the Markdown extension
 * or NFC changes what was typed, warns when git would ignore the entry, and
 * for a new folder says that empty folders aren't saved. It closes with the
 * entry's path, or with nothing when a rename keeps the name; a failure keeps
 * it open with the name as typed (FB-45).
 */
@Component({
  selector: 'rs-entry-name',
  imports: [
    TranslocoDirective,
    FormField,
    ButtonComponent,
    DialogComponent,
    DialogFooterComponent,
    FieldComponent,
    InlineBannerComponent,
    InputComponent
  ],
  templateUrl: './entry-name.dialog.html',
  styleUrl: './entry-name.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryNameDialog {
  protected readonly ref = inject<DialogRef<EntryPath>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as EntryNameData;
  private readonly api = inject(FilesApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly input = viewChild.required('name', { read: ElementRef<HTMLInputElement> });

  protected readonly kind: NewEntryKind = this.data.mode === 'create'
    ? this.data.kind
    : this.data.entry.kind === 'folder'
    ? 'folder'
    : 'file';
  /** The entry's name as listed, when it is renamed. */
  private readonly current = this.data.mode === 'rename' ? this.data.entry.name : undefined;
  protected readonly heading = this.data.mode === 'create' ? `new-${this.kind}` : 'rename';
  protected readonly formId = `rs-entry-name-${nextId++}`;
  protected readonly model = form(signal({ name: this.initialName() }));

  private readonly field = entryNameField(() => this.model.name().value(), {
    kind: this.kind,
    siblings: () => this.data.siblings,
    current: this.current
  });
  protected readonly finalName = this.field.finalName;
  /** Whether a rename keeps the name, compared in NFC: a name on disk may be in another form (FB-28). */
  private readonly unchanged = computed(() =>
    this.current !== undefined && this.finalName() === this.current.normalize('NFC')
  );
  /** The name as typed when the request failed on it; its error shows until the name changes. */
  private readonly refused = signal<{ name: string; code: string; } | null>(null);
  /** The code of the field's error, once the user has typed or tried to confirm. */
  protected readonly error = computed(() => {
    const refused = this.refused();
    if (refused?.name === this.model.name().value()) {
      return refused.code;
    }
    const touched = this.model.name().dirty() || this.submitted();
    return touched ? this.field.problem() : null;
  });
  protected readonly showFinalName = computed(() =>
    this.field.problem() === null && !this.unchanged()
    && this.finalName() !== this.model.name().value().normalize('NFC')
  );
  private readonly ignoredName = ignoredEntryName({
    repositoryId: this.data.repositoryId,
    folder: this.data.mode === 'create' ? this.data.folder : parentPath(this.data.path),
    kind: this.kind,
    finalName: this.finalName,
    valid: computed(() => this.field.problem() === null && !this.unchanged())
  });
  protected readonly ignored = computed(() =>
    (this.data.mode === 'create' && this.data.folderIgnored) || this.ignoredName()
  );
  protected readonly emptyFolderNote = this.data.mode === 'create' && this.kind === 'folder';

  protected readonly busy = signal(false);
  private readonly submitted = signal(false);
  protected readonly failure = signal<Extract<EntryRequestFailure, { text: string; }> | null>(null);

  constructor() {
    // Before `ui-dialog` focuses the field, which keeps the selection.
    const end = this.selectionEnd();
    afterNextRender(() => this.input().nativeElement.setSelectionRange(0, end));
  }

  protected async confirm(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.busy() || this.field.problem() !== null) {
      return;
    }
    if (this.unchanged()) {
      this.ref.close();
      return;
    }
    const name = this.model.name().value();
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    try {
      const request = await this.request(name);
      if (request) {
        this.ref.close(await firstValueFrom(request));
      }
    } catch (error) {
      const failure = entryRequestFailure(error, this.errorText);
      if ('field' in failure) {
        this.refused.set({ name, code: failure.field });
        this.input().nativeElement.focus();
      } else {
        this.failure.set(failure);
      }
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }

  /** The request that creates or renames the entry; `null` when the rename's confirmation is cancelled. */
  private async request(name: string): Promise<Observable<EntryPath> | null> {
    const data = this.data;
    if (data.mode === 'create') {
      return this.api.createEntry(data.repositoryId, { folder: data.folder, name, kind: data.kind });
    }
    if (data.confirm && !(await data.confirm())) {
      return null;
    }
    return this.api.renameEntry(data.repositoryId, { path: data.path, name });
  }

  private initialName(): string {
    if (this.data.mode === 'rename') {
      return this.data.entry.name;
    }
    return this.data.kind === 'file' ? `${UNTITLED}.md` : '';
  }

  /** `untitled` of a new file, a renamed file's name without its extension, so that typing keeps it, else all. */
  private selectionEnd(): number {
    if (this.data.mode === 'create') {
      return this.data.kind === 'file' ? UNTITLED.length : 0;
    }
    const name = this.data.entry.name;
    const dot = name.lastIndexOf('.');
    return this.kind === 'file' && dot > 0 ? dot : name.length;
  }
}
