import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ToastService } from '@front-burner/ui';
import { OnboardingStateService } from '@front-burner/web-core';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { PasswordStrengthService } from '../../services/password-strength/password-strength.service';
import { PasswordSetupStepComponent } from './password-setup-step.component';

const KEY = 'web-feature-auth.PasswordSetupStepComponent';
const SETUP = '/api/v1/onboarding/password-setup';
const TOKEN = 'a-setup-token-0123456789';

@Component({ template: '' })
class BlankComponent {}

@Component({
  imports: [ PasswordSetupStepComponent ],
  template:
    `<auth-password-setup-step [setupToken]="token" (back)="events.push('back')" (refused)="events.push('refused')" />`
})
class HostComponent {
  readonly token = TOKEN;
  readonly events: string[] = [];
}

describe('PasswordSetupStepComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  const markCompleted = vi.fn();
  const show = vi.fn();

  const element = () => fixture.nativeElement as HTMLElement;
  const field = (name: string) => element().querySelector(`input[name$=".${name}"]`) as HTMLInputElement;
  const fieldText = (name: string) => field(name).closest('ui-field')?.textContent ?? '';

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
    email: 'alice@example.com',
    displayName: 'Alice',
    password: 'correct horse 1',
    passwordConfirmation: 'correct horse 1'
  };

  beforeEach(async () => {
    markCompleted.mockReset();
    show.mockReset();
    await TestBed.configureTestingModule({
      imports: [ HostComponent, translocoTesting() ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([ { path: 'login', component: BlankComponent } ]),
        { provide: OnboardingStateService, useValue: { markCompleted } },
        { provide: ToastService, useValue: { show } },
        { provide: PasswordStrengthService, useValue: { estimate: () => Promise.resolve(2) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    http = TestBed.inject(HttpTestingController);
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('shows the policy and the strength meter under the password', async () => {
    expect(element().querySelector('auth-password-policy')).not.toBeNull();
    expect(element().querySelector('ui-strength-meter')).not.toBeNull();
  });

  it('rates the password as the user types', async () => {
    await fill({ password: 'correct horse 1' });
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(element().querySelector('ui-strength-meter')?.getAttribute('aria-valuenow')).toBe('2');
    });
  });

  it('shows client errors on submit and does not send', async () => {
    await fill({ ...valid, password: 'abc', passwordConfirmation: 'abc' });
    await submit();
    http.expectNone(SETUP);
    expect(fieldText('password')).toContain(`${KEY}.fieldErrors.password.too-short`);
  });

  it('does not submit while the confirmation differs', async () => {
    await fill({ ...valid, passwordConfirmation: 'correct horse 2' });
    await submit();
    http.expectNone(SETUP);
    expect(fieldText('passwordConfirmation')).toContain(`${KEY}.fieldErrors.passwordConfirmation.mismatch`);
  });

  it('sends the token with the details, without the confirmation', async () => {
    await fill(valid);
    await submit();
    const request = http.expectOne(SETUP);
    expect(request.request.body).toEqual({
      setupToken: TOKEN,
      email: 'alice@example.com',
      displayName: 'Alice',
      password: 'correct horse 1'
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
  });

  it('on success marks onboarding completed, shows the toast and goes to /login', async () => {
    await fill(valid);
    await submit();
    http.expectOne(SETUP).flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);

    expect(markCompleted).toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: `${KEY}.created`, status: 'success' }));
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('shows the backend\'s field errors on their fields', async () => {
    await fill(valid);
    await submit();
    http.expectOne(SETUP).flush({
      code: 'validation-failed',
      params: {},
      requestId: 'r',
      message: 'x',
      fields: [ { path: 'password', code: 'equals-email', params: {} } ]
    }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(fieldText('password')).toContain(`${KEY}.fieldErrors.password.equals-email`);
  });

  it('emits refused on 404', async () => {
    await fill(valid);
    await submit();
    http.expectOne(SETUP).flush({ code: 'not-found', params: {}, requestId: 'r', message: 'x' }, {
      status: 404,
      statusText: 'Not Found'
    });
    await settle(fixture);
    expect(fixture.componentInstance.events).toEqual([ 'refused' ]);
  });

  it('goes back', () => {
    ([ ...element().querySelectorAll('button') ].find(b => b.textContent?.includes(`${KEY}.back`)) as HTMLElement)
      .click();
    expect(fixture.componentInstance.events).toEqual([ 'back' ]);
  });
});
