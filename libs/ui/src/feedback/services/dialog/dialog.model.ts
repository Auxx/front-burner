import { InjectionToken } from '@angular/core';

/** How a dialog is opened with `DialogService.open()`. */
export interface DialogOptions<D> {
  /** Given to the dialog component as `DIALOG_DATA`. */
  readonly data?: D;
  /** Its maximum width: 24rem, 32rem (the default) or 48rem. */
  readonly size?: 'small' | 'medium' | 'large';
}

/** A yes/no question asked with `DialogService.confirm()`. */
export interface ConfirmOptions {
  readonly heading: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** `danger` for a confirmation that deletes or discards something. */
  readonly variant?: 'primary' | 'danger';
}

/** The `data` a dialog was opened with. */
export const DIALOG_DATA = new InjectionToken<unknown>('DIALOG_DATA');

/** What `ui-dialog` needs from the service that opened it. Internal. */
export interface DialogContext {
  readonly headingId: string;
  readonly size: 'small' | 'medium' | 'large';
}

export const DIALOG_CONTEXT = new InjectionToken<DialogContext>('DIALOG_CONTEXT');
