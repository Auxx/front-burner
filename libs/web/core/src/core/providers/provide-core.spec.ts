import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';

import { provideCore } from './provide-core';

describe('provideCore', () => {
  it('registers the ICU transpiler: TranslocoService formats a plural', () => {
    TestBed.configureTestingModule({ providers: [ provideCore(), provideHttpClientTesting() ] });
    const transloco = TestBed.inject(TranslocoService);
    transloco.setTranslation({ files: '{count, plural, one {# file} other {# files}}' }, 'en');

    expect(transloco.translate('files', { count: 1 })).toBe('1 file');
    expect(transloco.translate('files', { count: 4 })).toBe('4 files');
  });
});
