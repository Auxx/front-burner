import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

import { DraftStore } from '../saving/draft-store';
import { AuthSessionService } from '../services/auth-session/auth-session.service';

import { provideCore } from './provide-core';

describe('provideCore', () => {
  it('registers the ICU transpiler: TranslocoService formats a plural', () => {
    TestBed.configureTestingModule({ providers: [ provideCore(), provideHttpClientTesting() ] });
    const transloco = TestBed.inject(TranslocoService);
    transloco.setTranslation({ files: '{count, plural, one {# file} other {# files}}' }, 'en');

    expect(transloco.translate('files', { count: 1 })).toBe('1 file');
    expect(transloco.translate('files', { count: 4 })).toBe('4 files');
  });

  it('adds the auth token to API requests', () => {
    TestBed.configureTestingModule({
      providers: [
        provideCore(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthSessionService, useValue: { authToken: () => 'token' } }
      ]
    });
    TestBed.inject(HttpClient).get('/api/v1/me').subscribe();

    const request = TestBed.inject(HttpTestingController).expectOne('/api/v1/me').request;
    expect(request.headers.get('Authorization')).toBe('Bearer token');
  });

  it('creates the draft store at start-up, so that drafts are deleted when the session ends', () => {
    const created = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideCore(),
        provideHttpClientTesting(),
        { provide: DraftStore, useFactory: () => created() ?? {} }
      ]
    });

    TestBed.inject(TranslocoService);

    expect(created).toHaveBeenCalledTimes(1);
  });
});
