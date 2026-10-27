import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SpinnerComponent } from '@front-burner/ui';
import { AuthSessionService, safeReturnUrl } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

import { OIDC_RETURN_KEY } from '../../utils/oidc-return';

const FAILED = '/login?oidcError=failed';

/**
 * Where the backend sends the browser after a successful OIDC login: exchanges
 * the one-time code for the session tokens (LG-22) and goes on to the page the
 * user asked for before leaving for the provider (LG-4).
 */
@Component({
  selector: 'auth-oidc-callback',
  imports: [ TranslocoDirective, SpinnerComponent ],
  templateUrl: './oidc-callback.page.html',
  styleUrl: './oidc-callback.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OidcCallbackPage {
  private readonly session = inject(AuthSessionService);
  private readonly router = inject(Router);
  private readonly window = inject(DOCUMENT).defaultView;

  constructor() {
    void this.complete(inject(ActivatedRoute).snapshot.queryParamMap.get('code'));
  }

  private async complete(code: string | null): Promise<void> {
    const returnUrl = this.takeReturnUrl();
    if (code === null || code === '') {
      await this.router.navigateByUrl(FAILED, { replaceUrl: true });
      return;
    }
    try {
      await this.session.completeOidc(code);
    } catch {
      // LG-21: the reason is in the audit log, never shown.
      await this.router.navigateByUrl(FAILED, { replaceUrl: true });
      return;
    }
    // The code in this page's URL is spent: it is not kept in the history.
    await this.router.navigateByUrl(safeReturnUrl(returnUrl), { replaceUrl: true });
  }

  private takeReturnUrl(): string | null {
    try {
      const value = this.window?.sessionStorage.getItem(OIDC_RETURN_KEY) ?? null;
      this.window?.sessionStorage.removeItem(OIDC_RETURN_KEY);
      return value;
    } catch {
      return null;
    }
  }
}
