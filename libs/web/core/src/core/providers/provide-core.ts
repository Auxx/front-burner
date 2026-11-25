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
import { storageStatusInterceptor } from '../interceptors/storage-status/storage-status.interceptor';
import { versionCheckInterceptor } from '../interceptors/version-check/version-check.interceptor';
import { PageTitleStrategy } from '../routing/page-title.strategy';
import { DraftStore } from '../saving/draft-store';
import { OnboardingStateService } from '../services/onboarding-state/onboarding-state.service';

/**
 * The providers every page of the web client needs: HTTP with the auth token
 * and the version check (A-8.7), the storage status after a `low-storage` error (NF-9.7), translations and page titles. Creates the draft store at start-up, so that
 * every tab deletes the browser drafts when the session ends (NF-3.5), and
 * asks for the onboarding status at start-up, so that it arrives while the
 * first route's chunks load (NF-2.7).
 */
export function provideCore(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // The version check sees the answer the auth interceptor ends with, a
    // retried request's too.
    provideHttpClient(
      withFetch(),
      withInterceptors([ versionCheckInterceptor, storageStatusInterceptor, authInterceptor ])
    ),
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
    provideEnvironmentInitializer(() => inject(DraftStore)),
    // While the first route's chunks load, not after them: the onboarding guard awaits the same answer (NF-2.7).
    provideEnvironmentInitializer(() => void inject(OnboardingStateService).load())
  ]);
}
