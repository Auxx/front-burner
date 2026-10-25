import { inject, Injectable } from '@angular/core';
import type { ApiError } from '@front-burner/shared-contracts';
import { TranslocoService } from '@jsverse/transloco';

const REFERENCE_LENGTH = 8;

/** Turns an API error into the text and the support reference shown to the user (A-8.6, NF-10.6). */
@Injectable({ providedIn: 'root' })
export class ApiErrorTextService {
  private readonly transloco = inject(TranslocoService);

  /**
   * Relies on the active language being loaded already (true once any page has
   * rendered); until then every code falls back to `error.message`.
   */
  describe(error: ApiError): { text: string; reference: string | null; } {
    const key = `errors.${error.code}`;
    // Transloco returns the key itself when it has no translation.
    const translated = this.transloco.translate(key, error.params);
    return {
      text: translated === key ? error.message : translated,
      reference: error.requestId === '' ? null : error.requestId.slice(0, REFERENCE_LENGTH)
    };
  }
}
