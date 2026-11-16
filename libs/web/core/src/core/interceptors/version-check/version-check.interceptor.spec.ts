import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { VersionCheckService } from '../../services/version-check/version-check.service';
import { APP_VERSION } from '../../tokens/app-version';
import { versionCheckInterceptor } from './version-check.interceptor';

describe('versionCheckInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let versions: VersionCheckService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([ versionCheckInterceptor ])),
        provideHttpClientTesting(),
        { provide: APP_VERSION, useValue: '1.4.2' }
      ]
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    versions = TestBed.inject(VersionCheckService);
  });

  afterEach(() => backend.verify());

  it('shows the new-version banner on a version change', async () => {
    const answer = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush({}, { headers: { 'X-Front-Burner-Version': '1.5.0' } });
    await answer;

    expect(versions.newVersion()).toBe(true);
  });

  it('keeps it off for the same version', async () => {
    const answer = firstValueFrom(http.get('/api/v1/me'));
    backend.expectOne('/api/v1/me').flush({}, { headers: { 'X-Front-Burner-Version': '1.4.2' } });
    await answer;

    expect(versions.newVersion()).toBe(false);
  });

  it('reads the header of an error too', async () => {
    const answer = firstValueFrom(http.get('/api/v1/me')).catch(() => undefined);
    backend.expectOne('/api/v1/me').flush(
      { code: 'internal' },
      { status: 500, statusText: 'Internal Server Error', headers: { 'X-Front-Burner-Version': '1.5.0' } }
    );
    await answer;

    expect(versions.newVersion()).toBe(true);
  });

  it('ignores a response without the header', async () => {
    const answer = firstValueFrom(http.get('/api/v1/me')).catch(() => undefined);
    backend.expectOne('/api/v1/me').flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    await answer;

    expect(versions.newVersion()).toBe(false);
  });
});
