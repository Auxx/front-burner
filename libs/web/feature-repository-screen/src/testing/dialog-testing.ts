import { HttpErrorResponse } from '@angular/common/http';

/** The overlay that `DialogService` opens dialogs in. */
export function overlay(): HTMLElement {
  return document.querySelector('.cdk-overlay-container') as HTMLElement;
}

/** The name field's input of an open dialog. */
export function nameInput(): HTMLInputElement {
  return overlay().querySelector('ui-field input') as HTMLInputElement;
}

/** Types `text` into a control as the user would, replacing its value. */
export function type(element: HTMLInputElement, text: string): void {
  element.value = text;
  element.dispatchEvent(new Event('input'));
}

/** The button of an open dialog whose text is `text`. */
export function dialogButton(text: string): HTMLButtonElement | undefined {
  return [ ...overlay().querySelectorAll<HTMLButtonElement>('button') ].find(button =>
    button.textContent?.trim() === text
  );
}

/** Lets promise chains, timers and the dialog's rendering finish. */
export async function settleDialog(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 20));
}

/** An API error response, with field errors when `fields` is given. */
export function apiError(status: number, code: string, fields?: { path: string; code: string; }[]): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: {
      code,
      params: {},
      requestId: 'abcdef0123456789',
      message: code,
      ...(fields ? { fields: fields.map(field => ({ ...field, params: {} })) } : {})
    }
  });
}
