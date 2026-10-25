import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TranslocoHttpLoader } from './transloco-http.loader';

describe('TranslocoHttpLoader', () => {
  it('GETs i18n/<lang>.json', () => {
    TestBed.configureTestingModule({
      providers: [ provideHttpClient(), provideHttpClientTesting() ]
    });
    const http = TestBed.inject(HttpTestingController);
    let result: unknown;
    TestBed.inject(TranslocoHttpLoader).getTranslation('en').subscribe(t => result = t);

    http.expectOne('i18n/en.json').flush({ hello: 'Hello' });

    expect(result).toEqual({ hello: 'Hello' });
    http.verify();
  });
});
