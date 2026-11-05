import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild
} from '@angular/core';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  InlineBannerComponent
} from '@front-burner/ui';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

/** **Discard** or **Discard all** of `count` files (GA-23). */
export interface DiscardChangesData {
  readonly count: number;
  /** Discards the files; a call after a failure goes on with what is left. */
  readonly discard: () => Promise<void>;
}

/** A failed discard, as the banner shows it (GA-43). */
interface Failure {
  readonly text: string;
  readonly reference: string | null;
  /** Whether it was a network or server error, so that **Try again** can help. */
  readonly retry: boolean;
}

/** A network error, or the server's own: another try can go differently (GA-43). */
function canRetry(error: unknown): boolean {
  return !(error instanceof HttpErrorResponse) || error.status === 0 || error.status >= 500;
}

/**
 * Asks before discarding (GA-23), saying how many files and that the changes
 * cannot be recovered, with the focus on **Cancel**. It closes with `true` once
 * they are discarded. A failure keeps it open with the reason; a network or
 * server error offers **Try again**, and a refusal, which another try would not
 * change, leaves only **Cancel**, which then takes the focus.
 */
@Component({
  selector: 'rs-discard-changes',
  imports: [ TranslocoDirective, ButtonComponent, DialogComponent, DialogFooterComponent, InlineBannerComponent ],
  templateUrl: './discard-changes.dialog.html',
  styleUrl: './discard-changes.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DiscardChangesDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as DiscardChangesData;
  private readonly errorText = inject(ApiErrorTextService);
  private readonly injector = inject(Injector);
  private readonly cancel = viewChild.required('cancel', { read: ElementRef<HTMLElement> });
  private readonly action = viewChild('action', { read: ElementRef<HTMLElement> });

  protected readonly failure = signal<Failure | null>(null);
  protected readonly busy = signal(false);

  protected async confirm(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    try {
      await this.data.discard();
      this.ref.close(true);
    } catch (error) {
      this.failure.set({ ...this.errorText.describe(toApiError(error)), retry: canRetry(error) });
      afterNextRender({
        read: () => ((this.action() ?? this.cancel()).nativeElement as HTMLElement).focus()
      }, { injector: this.injector });
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }
}
