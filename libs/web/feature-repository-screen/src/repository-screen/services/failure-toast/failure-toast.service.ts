import { inject, Injectable } from '@angular/core';
import type { ApiError } from '@front-burner/shared-contracts';
import { type ToastAction, ToastService } from '@front-burner/ui';
import { ApiErrorTextService } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';

const KEY = 'web-feature-repository-screen.FailureToastService';

export interface FailureToastOptions {
  /** Buttons on the toast, such as **Try again**. A toast with any stays until it is dismissed. */
  readonly actions?: readonly ToastAction[];
  /** What to say in place of the error's own text, which then has no reference. */
  readonly text?: string;
  /** A toast with the same key as one on screen replaces it. */
  readonly key?: string;
}

/** Says why something the user just did failed, in a toast, with the error's reference if it has one (GA-43). */
@Injectable({ providedIn: 'root' })
export class FailureToastService {
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  show(error: ApiError, options: FailureToastOptions = {}): { dismiss(): void; } {
    const { actions, text, key } = options;
    return this.toast.show({
      message: text ?? this.describe(error),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status: 'danger',
      ...(actions?.length ? { actions } : {}),
      ...(key === undefined ? {} : { key })
    });
  }

  private describe(error: ApiError): string {
    const { text, reference } = this.errorText.describe(error);
    return reference === null ? text : `${text} ${this.transloco.translate(`${KEY}.reference`, { reference })}`;
  }
}
