import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import type { ApiError } from '@front-burner/shared-contracts';
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
import { GitApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

export interface NewBranchData {
  readonly repositoryId: number;
  readonly currentBranch?: string | null;
  readonly stillOn: () => boolean;
  readonly saveWaiting: () => Promise<ApiError | null>;
}

const FIELD_ERRORS = [ 'branch-name-invalid', 'branch-exists', 'branch-name-conflict' ] as const;

let nextId = 0;

/**
 * Asks for the name of a new branch (GA-38, AC-GIT-002.16) and creates it from the
 * current commit, switching to it. Surrounding whitespace is trimmed. A server-side
 * refusal (`branch-name-invalid`, `branch-exists`, `branch-name-conflict`) keeps the
 * dialog open, retaining the typed name with the error beside the field and keeping
 * input focus.
 */
@Component({
  selector: 'rs-new-branch',
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
  templateUrl: './new-branch.dialog.html',
  styleUrl: './new-branch.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewBranchDialog {
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as NewBranchData;
  private readonly api = inject(GitApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly input = viewChild.required('name', { read: ElementRef<HTMLInputElement> });

  protected readonly formId = `rs-new-branch-${nextId++}`;
  protected readonly model = form(signal({ name: '' }));

  /** The name as typed when the request failed on it; its error shows until the name changes. */
  private readonly refused = signal<{ name: string; code: string; } | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<{ text: string; reference: string | null; } | null>(null);

  protected readonly error = computed(() => {
    const refused = this.refused();
    if (refused?.name === this.model.name().value()) {
      return refused.code;
    }
    return null;
  });

  protected async confirm(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    const raw = this.model.name().value();
    const name = raw.trim();
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    this.refused.set(null);
    try {
      const saveError = await this.data.saveWaiting();
      if (!this.data.stillOn()) {
        return;
      }
      if (saveError) {
        this.failure.set(this.errorText.describe(saveError));
        return;
      }
      await firstValueFrom(this.api.createBranch(this.data.repositoryId, { name }));
      this.ref.close();
    } catch (error) {
      if (!this.data.stillOn()) {
        return;
      }
      const apiError = toApiError(error);
      if (FIELD_ERRORS.includes(apiError.code as (typeof FIELD_ERRORS)[number])) {
        if (apiError.code === 'branch-exists' && this.data.currentBranch !== name) {
          try {
            const branches = await firstValueFrom(this.api.gitBranches(this.data.repositoryId));
            if (branches.current === name) {
              this.ref.close();
              return;
            }
          } catch {
            // ignore
          }
        }
        this.refused.set({ name: raw, code: apiError.code });
        this.input().nativeElement.focus();
      } else {
        if (this.data.currentBranch !== name) {
          try {
            const branches = await firstValueFrom(this.api.gitBranches(this.data.repositoryId));
            if (branches.current === name) {
              this.ref.close();
              return;
            }
          } catch {
            // ignore
          }
        }
        this.failure.set(this.errorText.describe(apiError));
      }
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }
}
