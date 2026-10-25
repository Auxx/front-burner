import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';

import { ApiErrorTextService } from './api-error-text.service';

const error = (code: string, requestId = '', message = 'Server said so') => ({
  code,
  params: {},
  requestId,
  message
});

describe('ApiErrorTextService', () => {
  let service: ApiErrorTextService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { en: { 'errors.not-found': 'We could not find that.' } },
          preloadLangs: true,
          translocoConfig: { availableLangs: [ 'en' ], defaultLang: 'en' }
        })
      ]
    });
    service = TestBed.inject(ApiErrorTextService);
  });

  it('translates the error code', () => {
    expect(service.describe(error('not-found')).text).toBe('We could not find that.');
  });

  it('falls back to the message for a code without a key', () => {
    expect(service.describe(error('some-future-code')).text).toBe('Server said so');
  });

  it('shows the first 8 characters of the request id as reference', () => {
    expect(service.describe(error('not-found', 'abcdef1234')).reference).toBe('abcdef12');
  });

  it('has no reference without a request id', () => {
    expect(service.describe(error('not-found')).reference).toBeNull();
  });
});
