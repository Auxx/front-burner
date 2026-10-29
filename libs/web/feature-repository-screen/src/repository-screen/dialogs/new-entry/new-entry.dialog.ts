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
import type { EntryPath, NewEntryKind } from '@front-burner/shared-contracts';
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

/** What **New file** and **New folder** create, and where. */
export interface NewEntryData {
  readonly repositoryId: number;
  /** The folder to create in; `''` for the root folder. */
  readonly folder: string;
  readonly kind: NewEntryKind;
  /** Whether the folder is an ignored entry (FB-31). */
  readonly folderIgnored: boolean;
  /** The names in the folder, as listed. */
  readonly siblings: readonly string[];
}

/** A new file's name until the user types one; `untitled` is selected (FB-29). */
const UNTITLED = 'untitled';

let nextId = 0;

/**
 * **New file** (FB-29 to FB-31) and **New folder** (FB-32 to FB-34): asks for
 * a name, checking it as the user types, and creates the entry. A file's
 * name shows the final name whenever the extension changes it. Both warn when
 * git would ignore the entry, and a folder's says that empty folders aren't
 * saved. Closes with the new entry's path; a failure keeps the dialog open
 * with the name as typed (FB-45).
 */
@Component({
  selector: 'rs-new-entry',
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
  templateUrl: './new-entry.dialog.html',
  styleUrl: './new-entry.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewEntryDialog {
  protected readonly ref = inject<DialogRef<EntryPath>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as NewEntryData;
  private readonly api = inject(FilesApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly input = viewChild.required('name', { read: ElementRef<HTMLInputElement> });

  protected readonly formId = `rs-new-entry-${nextId++}`;
  protected readonly model = form(signal({ name: this.data.kind === 'file' ? `${UNTITLED}.md` : '' }));

  private readonly field = entryNameField(() => this.model.name().value(), {
    kind: this.data.kind,
    siblings: () => this.data.siblings
  });
  protected readonly finalName = this.field.finalName;
  /** The name as typed when the request failed on it; its error shows until the name changes. */
  private readonly refused = signal<{ name: string; code: string; } | null>(null);
  /** The code of the field's error, once the user has typed or tried to create. */
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
  protected readonly ignored = computed(() => this.data.folderIgnored || this.ignoredName());
  private readonly ignoredName = ignoredEntryName({
    repositoryId: this.data.repositoryId,
    folder: this.data.folder,
    kind: this.data.kind,
    finalName: this.finalName,
    valid: computed(() => this.field.problem() === null)
  });

  protected readonly busy = signal(false);
  private readonly submitted = signal(false);
  protected readonly failure = signal<Extract<EntryRequestFailure, { text: string; }> | null>(null);

  constructor() {
    if (this.data.kind === 'file') {
      // Before `ui-dialog` focuses the field, which keeps the selection.
      afterNextRender(() => this.input().nativeElement.setSelectionRange(0, UNTITLED.length));
    }
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.busy() || this.field.problem() !== null) {
      return;
    }
    const name = this.model.name().value();
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    try {
      const created = await firstValueFrom(
        this.api.createEntry(this.data.repositoryId, { folder: this.data.folder, name, kind: this.data.kind })
      );
      this.ref.close(created);
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
