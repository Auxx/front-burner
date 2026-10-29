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
import type { Entry, EntryPath } from '@front-burner/shared-contracts';
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
import { firstValueFrom } from 'rxjs';

import {
  entryNameField,
  type EntryRequestFailure,
  entryRequestFailure,
  ignoredEntryName
} from '../../utils/entry-name-field/entry-name-field';

/** The entry to rename, and where it is. */
export interface RenameEntryData {
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

let nextId = 0;

/**
 * **Rename** (FB-35): asks for the entry's new name, filled in with its name,
 * and renames it in place. A Markdown file keeps a Markdown extension, and
 * the dialog shows the final name whenever the extension changes what was
 * typed. Warns when git would ignore the new name. Closes with the new path,
 * or with nothing when the name is unchanged; a failure keeps the dialog
 * open with the name as typed (FB-45).
 */
@Component({
  selector: 'rs-rename-entry',
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
  templateUrl: './rename-entry.dialog.html',
  styleUrl: './rename-entry.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RenameEntryDialog {
  protected readonly ref = inject<DialogRef<EntryPath>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as RenameEntryData;
  private readonly api = inject(FilesApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly input = viewChild.required('name', { read: ElementRef<HTMLInputElement> });

  protected readonly kind = this.data.entry.kind === 'folder' ? 'folder' : 'file';
  protected readonly formId = `rs-rename-entry-${nextId++}`;
  protected readonly model = form(signal({ name: this.data.entry.name }));

  private readonly field = entryNameField(() => this.model.name().value(), {
    kind: this.kind,
    siblings: () => this.data.siblings,
    current: this.data.entry.name
  });
  protected readonly finalName = this.field.finalName;
  /** The name as typed when the request failed on it; its error shows until the name changes. */
  private readonly refused = signal<{ name: string; code: string; } | null>(null);
  /** The code of the field's error, once the user has typed or tried to rename. */
  protected readonly error = computed(() => {
    const refused = this.refused();
    if (refused?.name === this.model.name().value()) {
      return refused.code;
    }
    const touched = this.model.name().dirty() || this.submitted();
    return touched ? this.field.problem() : null;
  });
  protected readonly showFinalName = computed(() =>
    this.field.problem() === null && this.finalName() !== this.model.name().value()
  );
  protected readonly ignored = ignoredEntryName({
    repositoryId: this.data.repositoryId,
    folder: parentOf(this.data.path),
    kind: this.kind,
    finalName: this.finalName,
    valid: computed(() => this.field.problem() === null && this.finalName() !== this.data.entry.name)
  });

  protected readonly busy = signal(false);
  private readonly submitted = signal(false);
  protected readonly failure = signal<Extract<EntryRequestFailure, { text: string; }> | null>(null);

  constructor() {
    // A file's extension is not selected, so that typing keeps it; before `ui-dialog` focuses the field.
    const name = this.data.entry.name;
    const dot = name.lastIndexOf('.');
    const end = this.kind === 'file' && dot > 0 ? dot : name.length;
    afterNextRender(() => this.input().nativeElement.setSelectionRange(0, end));
  }

  protected async rename(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.busy() || this.field.problem() !== null) {
      return;
    }
    if (this.finalName() === this.data.entry.name) {
      this.ref.close();
      return;
    }
    const name = this.model.name().value();
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    try {
      if (this.data.confirm && !(await this.data.confirm())) {
        return;
      }
      const renamed = await firstValueFrom(
        this.api.renameEntry(this.data.repositoryId, { path: this.data.path, name })
      );
      this.ref.close(renamed);
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
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}
