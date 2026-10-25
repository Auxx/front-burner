import { provideHttpClient, withFetch } from '@angular/common/http';
import { type EnvironmentProviders, isDevMode, makeEnvironmentProviders } from '@angular/core';
import { TitleStrategy } from '@angular/router';
import { provideTransloco, TRANSLOCO_TRANSPILER } from '@jsverse/transloco';

import { IcuTranspiler } from '../i18n/icu-transpiler';
import { TranslocoHttpLoader } from '../i18n/transloco-http.loader';
import { PageTitleStrategy } from '../routing/page-title.strategy';

/** The providers every page of the web client needs: HTTP, translations and page titles. */
export function provideCore(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideHttpClient(withFetch()),
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
    { provide: TitleStrategy, useClass: PageTitleStrategy }
  ]);
}
