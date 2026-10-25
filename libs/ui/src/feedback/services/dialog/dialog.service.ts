import { Dialog, type DialogRef as CdkDialogRef } from '@angular/cdk/dialog';
import { inject, Injectable, type Type } from '@angular/core';
import { filter, firstValueFrom } from 'rxjs';

import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { DialogRef } from './dialog-ref';
import { type ConfirmOptions, DIALOG_CONTEXT, DIALOG_DATA, type DialogOptions } from './dialog.model';

let nextId = 0;

/**
 * Opens modal dialogs (A-10.43). The dialog component puts a `ui-dialog` at the
 * root of its template, and injects `DialogRef` and `DIALOG_DATA`. Features
 * use this service, never the CDK's dialog.
 *
 * A dialog focuses its first field (or an element marked `data-autofocus`, or
 * itself), returns the focus to where it was when it closes, and closes on
 * Escape unless it is not `dismissible`. A click on the backdrop never closes
 * it, so that what the user typed is not lost.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(Dialog);

  open<C, D = unknown, R = unknown>(component: Type<C>, options: DialogOptions<D> = {}): DialogRef<R> {
    const headingId = `ui-dialog-heading-${nextId++}`;
    let ref!: DialogRef<R>;

    const cdkRef = this.dialog.open<R, D, C>(component, {
      data: options.data,
      hasBackdrop: true,
      backdropClass: 'ui-dialog-backdrop',
      // Escape is handled below, so that it honours `dismissible`.
      disableClose: true,
      ariaLabelledBy: headingId,
      ariaModal: true,
      // `ui-dialog` moves the focus to its first field once it has rendered.
      autoFocus: 'dialog',
      restoreFocus: true,
      closeOnNavigation: true,
      providers: dialogRef => {
        ref = new DialogRef<R>(dialogRef as CdkDialogRef<R, unknown>);
        return [
          { provide: DialogRef, useValue: ref },
          { provide: DIALOG_DATA, useValue: options.data },
          { provide: DIALOG_CONTEXT, useValue: { headingId, size: options.size ?? 'medium' } }
        ];
      }
    });

    cdkRef.keydownEvents.pipe(filter(event => event.key === 'Escape')).subscribe(event => {
      if (ref.dismissible()) {
        event.preventDefault();
        ref.close();
      }
    });

    return ref;
  }

  /** Asks a yes/no question; resolves `true` only when the user confirms. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.open<ConfirmDialogComponent, ConfirmOptions, boolean>(ConfirmDialogComponent, {
      data: options,
      size: 'small'
    });
    return (await firstValueFrom(ref.closed)) === true;
  }

  /** Closes every open dialog, as when the user logs out. */
  closeAll(): void {
    this.dialog.closeAll();
  }
}
