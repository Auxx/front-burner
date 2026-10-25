import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { OnboardingStatus } from '@front-burner/shared-contracts';
import { OnboardingStateService, type OnboardingView } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { PasswordStrengthService } from '../../services/password-strength/password-strength.service';
import { OnboardingPage } from './onboarding.page';

const KEY = 'web-feature-auth.OnboardingPage';
const TOKEN = 'a-setup-token-0123456789';

@Component({ template: '' })
class BlankComponent {}

const status = (overrides: Partial<OnboardingStatus> = {}): OnboardingView => ({
  kind: 'status',
  status: { state: 'required', oidcFromEnvironment: false, setupTokenConfigured: true, ...overrides }
});

describe('OnboardingPage', () => {
  let fixture: ComponentFixture<OnboardingPage>;
  let http: HttpTestingController;
  let view: ReturnType<typeof signal<OnboardingView | undefined>>;
  let refreshTo: OnboardingView;
  const refresh = vi.fn(async () => {
    view.set(refreshTo);
    return refreshTo;
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const button = (key: string) =>
    [ ...element().querySelectorAll('button') ].find(b => b.textContent?.includes(key)) as HTMLButtonElement;

  async function start(initial: OnboardingView): Promise<void> {
    view = signal<OnboardingView | undefined>(initial);
    refresh.mockClear();
    await TestBed.configureTestingModule({
      imports: [ OnboardingPage, translocoTesting() ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([ { path: 'login', component: BlankComponent } ]),
        {
          provide: OnboardingStateService,
          useValue: { view, refresh, load: async () => view(), markCompleted: vi.fn() }
        },
        { provide: PasswordStrengthService, useValue: { estimate: () => Promise.resolve(2) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(OnboardingPage);
    http = TestBed.inject(HttpTestingController);
    await settle(fixture);
  }

  async function enterToken(): Promise<void> {
    const input = element().querySelector('auth-setup-token-step input') as HTMLInputElement;
    input.value = TOKEN;
    input.dispatchEvent(new Event('input'));
    element().querySelector('auth-setup-token-step form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
    http.expectOne('/api/v1/onboarding/setup-token/check').flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
  }

  async function reachPasswordStep(): Promise<void> {
    await enterToken();
    button('LoginMethodStepComponent.continue').click();
    await settle(fixture);
  }

  async function submitPasswordSetup(): Promise<void> {
    const values: Record<string, string> = {
      email: 'alice@example.com',
      displayName: 'Alice',
      password: 'correct horse 1',
      passwordConfirmation: 'correct horse 1'
    };
    for (const [ name, value ] of Object.entries(values)) {
      const input = element().querySelector(`input[name$=".${name}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    element().querySelector('auth-password-setup-step form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
    http.expectOne('/api/v1/onboarding/password-setup').flush(
      { code: 'not-found', params: {}, requestId: 'r', message: 'x' },
      { status: 404, statusText: 'Not Found' }
    );
    await settle(fixture);
  }

  afterEach(() => http.verify());

  it('is one main landmark with the page heading', async () => {
    await start(status());
    expect(element().querySelectorAll('main')).toHaveLength(1);
    expect(element().querySelector('h1')?.textContent).toContain(`${KEY}.title`);
  });

  it('shows the no-token explanation', async () => {
    await start(status({ setupTokenConfigured: false }));
    expect(element().textContent).toContain(`${KEY}.noToken.message`);
    expect(element().querySelector('code')?.textContent).toBe('FRONT_BURNER_SETUP_TOKEN');
    expect(element().querySelector('auth-setup-token-step')).toBeNull();
  });

  it('shows the state error with a retry', async () => {
    await start({ kind: 'error', error: { code: 'network', params: {}, requestId: '', message: 'Network error' } });
    expect(element().querySelector('ui-inline-banner')).not.toBeNull();
    refreshTo = status();
    button(`${KEY}.retry`).click();
    await settle(fixture);
    expect(refresh).toHaveBeenCalled();
    expect(element().querySelector('auth-setup-token-step')).not.toBeNull();
  });

  it('walks token → method → password and back', async () => {
    await start(status());
    expect(element().querySelector('auth-setup-token-step')).not.toBeNull();

    await reachPasswordStep();
    expect(element().querySelector('auth-password-setup-step')).not.toBeNull();

    button('PasswordSetupStepComponent.back').click();
    await settle(fixture);
    expect(element().querySelector('auth-login-method-step')).not.toBeNull();

    button('LoginMethodStepComponent.back').click();
    await settle(fixture);
    expect(element().querySelector('auth-setup-token-step')).not.toBeNull();
  });

  it('goes to the login page when setup answers 404 and onboarding is completed', async () => {
    await start(status());
    await reachPasswordStep();
    refreshTo = status({ state: 'completed' });
    await submitPasswordSetup();
    await settle(fixture);
    expect(refresh).toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('returns to the token step when setup answers 404 and onboarding is still required', async () => {
    await start(status());
    await reachPasswordStep();
    refreshTo = status();
    await submitPasswordSetup();
    await settle(fixture);
    expect(element().querySelector('auth-setup-token-step')).not.toBeNull();
    expect(element().textContent).toContain('SetupTokenStepComponent.errors.invalid');
  });

  it('never writes the token to storage or cookies', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const cookie = vi.spyOn(document, 'cookie', 'set');
    try {
      await start(status());
      await reachPasswordStep();
      expect(setItem).not.toHaveBeenCalled();
      expect(cookie).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      cookie.mockRestore();
    }
  });
});
