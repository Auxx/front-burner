import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { HealthStatus } from '@front-burner/shared-contracts';
import { HealthApi } from './Health';

describe('HealthApi', () => {
  let api: HealthApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ provideHttpClient(), provideHttpClientTesting() ]
    });
    api = TestBed.inject(HealthApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('live() GETs /api/health/live and emits the body', () => {
    const body: HealthStatus = { status: 'ok' };
    let received: HealthStatus | undefined;

    api.live().subscribe(value => (received = value));

    const request = http.expectOne('/api/health/live');
    expect(request.request.method).toBe('GET');
    request.flush(body);
    expect(received).toEqual(body);
  });

  it('ready() GETs /api/health/ready', () => {
    api.ready().subscribe();

    const request = http.expectOne('/api/health/ready');
    expect(request.request.method).toBe('GET');
    request.flush({ status: 'ok' } satisfies HealthStatus);
  });
});
