import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { OnboardingStatus, PasswordSetupRequest } from '@front-burner/shared-contracts';
import { OnboardingApi } from './Onboarding';

describe('OnboardingApi', () => {
  let api: OnboardingApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ provideHttpClient(), provideHttpClientTesting() ]
    });
    api = TestBed.inject(OnboardingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('status() GETs /api/v1/onboarding and emits the body', () => {
    const body: OnboardingStatus = { state: 'required', oidcFromEnvironment: false, setupTokenConfigured: true };
    let received: OnboardingStatus | undefined;

    api.status().subscribe(value => (received = value));

    const request = http.expectOne('/api/v1/onboarding');
    expect(request.request.method).toBe('GET');
    request.flush(body);
    expect(received).toEqual(body);
  });

  it('checkSetupToken() POSTs the token', () => {
    api.checkSetupToken({ setupToken: 'token' }).subscribe();

    const request = http.expectOne('/api/v1/onboarding/setup-token/check');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ setupToken: 'token' });
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('setUpPassword() POSTs the request', () => {
    const body: PasswordSetupRequest = {
      setupToken: 'token',
      email: 'alice@example.com',
      displayName: 'Alice',
      password: 'abcdefghi1'
    };

    api.setUpPassword(body).subscribe();

    const request = http.expectOne('/api/v1/onboarding/password-setup');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(body);
    request.flush(null, { status: 204, statusText: 'No Content' });
  });
});
