import { TranslocoTestingModule } from '@jsverse/transloco';

/**
 * Transloco for specs. Without `texts` every message renders as its key, so a
 * spec checks which message is shown; `en.json` is checked by the web
 * application's translations spec.
 */
export function translocoTesting(texts: Record<string, string> = {}) {
  return TranslocoTestingModule.forRoot({
    langs: { en: texts },
    preloadLangs: true,
    translocoConfig: {
      availableLangs: [ 'en' ],
      defaultLang: 'en',
      missingHandler: { logMissingKey: false }
    }
  });
}
