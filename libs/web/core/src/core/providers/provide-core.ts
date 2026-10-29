import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  type EnvironmentProviders,
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer
} from '@angular/core';
import { TitleStrategy } from '@angular/router';
import { provideTransloco, TRANSLOCO_TRANSPILER } from '@jsverse/transloco';

import { IcuTranspiler } from '../i18n/icu-transpiler';
import { TranslocoHttpLoader } from '../i18n/transloco-http.loader';
import { authInterceptor } from '../interceptors/auth/auth.interceptor';
import { PageTitleStrategy } from '../routing/page-title.strategy';
import { DraftStore } from '../saving/draft-store';

/**
 * The providers every page of the web client needs: HTTP with the auth token,
 * translations and page titles. Creates the draft store at start-up, so that
 * every tab deletes the browser drafts when the session ends (NF-3.5).
 */
export function provideCore(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideHttpClient(withFetch(), withInterceptors([ authInterceptor ])),
    provideTransloco({
      config: {
        availableLangs: [ 'en' ],
        defaultLang: 'en',
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode()
      },
      loader: TranslocoHttpLoader
    }),
    { provide: TRANSLOCO_TRANSPILER, useClass: IcuTranspiler },
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    provideEnvironmentInitializer(() => inject(DraftStore))
  ]);
}
