import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OidcFailureReason, OidcSetupView } from '@front-burner/shared-contracts';
import { ToastService } from '@front-burner/ui';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { OidcSetupStepComponent } from './oidc-setup-step.component';

const KEY = 'web-feature-auth.OidcSetupStepComponent';
const SETUP = '/api/v1/onboarding/oidc-setup';
const TOKEN = 'a-setup-token-0123456789';

const SAVED: OidcSetupView = {
  issuer: 'https://id.example.com',
  clientId: 'front-burner',
  scopes: 'openid email',
  requireVerifiedEmail: false,
  adminEmail: 'admin@example.com',
  hasClientSecret: true
};

@Component({
  imports: [ OidcSetupStepComponent ],
  template: `<auth-oidc-setup-step
    [setupToken]="token"
    [saved]="saved()"
    [failure]="failure()"
    (back)="events.push('back')"
    (refused)="events.push('refused')"
    (submitted)="events.push('submitted')"
  />`
})
class HostComponent {
  readonly token = TOKEN;
  readonly saved = signal<OidcSetupView | undefined>(undefined);
  readonly failure = signal<OidcFailureReason | undefined>(undefined);
  readonly events: string[] = [];
}

describe('OidcSetupStepComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  const show = vi.fn();
  const writeText = vi.fn(() => Promise.resolve());

  const element = () => fixture.nativeElement as HTMLElement;
  const field = (name: string) => element().querySelector(`input[name$=".${name}"]`) as HTMLInputElement;
  const fieldText = (name: string) => field(name).closest('ui-field, label')?.textContent ?? '';
  const submitButton = () => element().querySelector('button[type="submit"]') as HTMLButtonElement;
  const button = (key: string) =>
    [ ...element().querySelectorAll('button') ].find(b =>
      b.textContent?.includes(`${KEY}.${key}`)
    ) as HTMLButtonElement;

  async function fill(values: Record<string, string>): Promise<void> {
    for (const [ name, value ] of Object.entries(values)) {
      field(name).value = value;
      field(name).dispatchEvent(new Event('input'));
    }
    await settle(fixture);
  }

  async function submit(): Promise<void> {
    element().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  const valid = {
    issuer: 'https://id.example.com',
    clientId: 'front-burner',
    clientSecret: 'a-client-secret',
    adminEmail: 'admin@example.com'
  };

  async function start(saved?: OidcSetupView, failure?: OidcFailureReason): Promise<void> {
    show.mockReset();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await TestBed.configureTestingModule({
      imports: [ HostComponent, translocoTesting() ],
      providers: [ provideHttpClient(), provideHttpClientTesting(), { provide: ToastService, useValue: { show } } ]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.saved.set(saved);
    fixture.componentInstance.failure.set(failure);
    http = TestBed.inject(HttpTestingController);
    await settle(fixture);
  }

  afterEach(() => http.verify());

  it('shows the redirect URI and copies it', async () => {
    await start();
    const uri = `${location.origin}/api/v1/auth/oidc/callback`;
    const input = element().querySelector('input[readonly]') as HTMLInputElement;
    expect(input.value).toBe(uri);

    button('copy').click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(uri);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: `${KEY}.copied` }));
  });

  it('defaults the scopes and requires a verified email', async () => {
    await start();
    expect(field('scopes').value).toBe('openid email profile');
    expect(field('requireVerifiedEmail').checked).toBe(true);
  });

  it('disables submit until the form is valid', async () => {
    await start();
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
    await fill(valid);
    expect(submitButton().getAttribute('aria-disabled')).toBeNull();
    await fill({ issuer: 'http://id.example.com' });
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('sends the setup with the token, and forgets the secret', async () => {
    await start();
    await fill({ ...valid, scopes: '' });
    await submit();
    const request = http.expectOne(SETUP);
    expect(request.request.body).toEqual({
      setupToken: TOKEN,
      issuer: 'https://id.example.com',
      clientId: 'front-burner',
      clientSecret: 'a-client-secret',
      scopes: 'openid email profile',
      requireVerifiedEmail: true,
      adminEmail: 'admin@example.com'
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    expect(field('clientSecret').value).toBe('');
  });

  it('pre-fills a saved setup and makes the secret optional', async () => {
    await start(SAVED);
    expect(field('issuer').value).toBe(SAVED.issuer);
    expect(field('clientId').value).toBe(SAVED.clientId);
    expect(field('scopes').value).toBe(SAVED.scopes);
    expect(field('requireVerifiedEmail').checked).toBe(false);
    expect(field('adminEmail').value).toBe(SAVED.adminEmail);
    expect(field('clientSecret').value).toBe('');
    expect(fieldText('clientSecret')).toContain(`${KEY}.clientSecretKeep`);
    expect(submitButton().getAttribute('aria-disabled')).toBeNull();

    await submit();
    expect(http.expectOne(SETUP).request.body).toMatchObject({ clientSecret: '', requireVerifiedEmail: false });
  });

  it('requires the secret when none is saved', async () => {
    await start();
    await fill({ ...valid, clientSecret: '' });
    expect(submitButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the backend\'s issuer error on the field', async () => {
    await start();
    await fill(valid);
    await submit();
    http.expectOne(SETUP).flush(
      {
        code: 'validation-failed',
        params: {},
        requestId: 'r',
        message: 'x',
        fields: [ { path: 'issuer', code: 'oidc-issuer-mismatch', params: { expected: 'https://other.example.com' } } ]
      },
      { status: 400, statusText: 'Bad Request' }
    );
    await settle(fixture);
    expect(fieldText('issuer')).toContain(`${KEY}.fieldErrors.issuer.oidc-issuer-mismatch`);
    expect(fixture.componentInstance.events).toEqual([]);
  });

  it('emits submitted after a successful submit', async () => {
    await start();
    await fill(valid);
    await submit();
    http.expectOne(SETUP).flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    expect(fixture.componentInstance.events).toEqual([ 'submitted' ]);
  });

  it('emits refused on 404', async () => {
    await start();
    await fill(valid);
    await submit();
    http.expectOne(SETUP).flush(
      { code: 'not-found', params: {}, requestId: 'r', message: 'x' },
      { status: 404, statusText: 'Not Found' }
    );
    await settle(fixture);
    expect(fixture.componentInstance.events).toEqual([ 'refused' ]);
  });

  it('shows why the OIDC login failed until the next submit', async () => {
    await start(SAVED, 'code-exchange-failed');
    expect(element().textContent).toContain('web-feature-auth.oidcErrors.code-exchange-failed');
    await submit();
    expect(element().textContent).not.toContain('web-feature-auth.oidcErrors.code-exchange-failed');
    http.expectOne(SETUP).flush(null, { status: 204, statusText: 'No Content' });
  });

  it('names the administrator email field when the login email does not match', async () => {
    await start(SAVED, 'admin-email-mismatch');
    expect(element().textContent).toContain(`${KEY}.adminEmailMismatch`);
    expect(element().textContent).not.toContain('web-feature-auth.oidcErrors.admin-email-mismatch');
  });

  it('goes back', async () => {
    await start();
    button('back').click();
    expect(fixture.componentInstance.events).toEqual([ 'back' ]);
  });
});
