import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { OnboardingStatus } from '@front-burner/shared-contracts';

import { OnboardingStateService } from './onboarding-state.service';

const URL = '/api/v1/onboarding';
const required: OnboardingStatus = { state: 'required', oidcFromEnvironment: false, setupTokenConfigured: true };

describe('OnboardingStateService', () => {
  let service: OnboardingStateService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ provideHttpClient(), provideHttpClientTesting() ]
    });
    service = TestBed.inject(OnboardingStateService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function answer(body: object, init?: { status: number; statusText: string; }): Promise<void> {
    await Promise.resolve();
    http.expectOne(URL).flush(body, init);
  }

  it('asks the backend once', async () => {
    const first = service.load();
    const second = service.load();
    await answer(required);

    expect(await first).toEqual({ kind: 'status', status: required });
    expect(await second).toEqual({ kind: 'status', status: required });
    expect(await service.load()).toEqual({ kind: 'status', status: required });
    expect(service.view()).toEqual({ kind: 'status', status: required });
  });

  it('treats 404 as completed', async () => {
    const view = service.load();
    await answer({ code: 'not-found', params: {}, requestId: 'r', message: 'Not found.' }, {
      status: 404,
      statusText: 'Not Found'
    });

    expect(await view).toEqual({
      kind: 'status',
      status: { state: 'completed', oidcFromEnvironment: false, setupTokenConfigured: false }
    });
  });

  it('does not cache an error', async () => {
    const failed = service.load();
    await answer({ code: 'internal', params: {}, requestId: 'abcdef123456', message: 'x' }, {
      status: 500,
      statusText: 'Internal Server Error'
    });
    expect(await failed).toEqual({ kind: 'error', error: expect.objectContaining({ code: 'internal' }) });
    expect(service.view()?.kind).toBe('error');

    const retried = service.load();
    await answer(required);
    expect(await retried).toEqual({ kind: 'status', status: required });
  });

  it('refresh asks again', async () => {
    const first = service.load();
    await answer(required);
    await first;

    const refreshed = service.refresh();
    await answer({ ...required, setupTokenConfigured: false });
    expect((await refreshed).kind === 'status' && (await refreshed)).toMatchObject({
      status: { setupTokenConfigured: false }
    });
  });

  it('markCompleted answers completed without a request', async () => {
    service.markCompleted();
    expect(await service.load()).toEqual({
      kind: 'status',
      status: { state: 'completed', oidcFromEnvironment: false, setupTokenConfigured: false }
    });
  });
});
