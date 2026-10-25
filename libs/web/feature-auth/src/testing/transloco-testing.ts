import { TranslocoTestingModule } from '@jsverse/transloco';

/**
 * Transloco for specs, with no texts: every message renders as its key, so a
 * spec checks which message is shown; `en.json` is checked by the web
 * application's translations spec.
 */
export function translocoTesting() {
  return TranslocoTestingModule.forRoot({
    langs: { en: {} },
    preloadLangs: true,
    translocoConfig: {
      availableLangs: [ 'en' ],
      defaultLang: 'en',
      missingHandler: { logMissingKey: false }
    }
  });
}
