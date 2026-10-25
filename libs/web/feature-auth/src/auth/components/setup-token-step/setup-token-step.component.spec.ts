import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { SetupTokenStepComponent } from './setup-token-step.component';

const KEY = 'web-feature-auth.SetupTokenStepComponent';
const CHECK = '/api/v1/onboarding/setup-token/check';

@Component({
  imports: [ SetupTokenStepComponent ],
  template: `<auth-setup-token-step [rejected]="rejected()" (accepted)="accepted.push($event)" />`
})
class HostComponent {
  readonly rejected = signal(false);
  readonly accepted: string[] = [];
}

describe('SetupTokenStepComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;

  const element = () => fixture.nativeElement as HTMLElement;
  const input = () => element().querySelector('input') as HTMLInputElement;

  async function submit(token: string): Promise<void> {
    input().value = token;
    input().dispatchEvent(new Event('input'));
    element().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ HostComponent, translocoTesting() ],
      providers: [ provideHttpClient(), provideHttpClientTesting() ]
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    http = TestBed.inject(HttpTestingController);
    await settle(fixture);
  });

  afterEach(() => http.verify());

  it('asks for the setup token in a password field', () => {
    expect(input().type).toBe('password');
    expect(element().textContent).toContain(`${KEY}.label`);
  });

  it('does not send an empty token', async () => {
    await submit('');
    http.expectNone(CHECK);
    expect(element().textContent).toContain(`${KEY}.errors.required`);
  });

  it('emits the token unchanged on 204', async () => {
    await submit(' a-setup-token-0123456789 ');
    const request = http.expectOne(CHECK);
    expect(request.request.body).toEqual({ setupToken: ' a-setup-token-0123456789 ' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    expect(fixture.componentInstance.accepted).toEqual([ ' a-setup-token-0123456789 ' ]);
  });

  it('shows invalid setup token on 404', async () => {
    await submit('wrong-token');
    http.expectOne(CHECK).flush({ code: 'not-found', params: {}, requestId: 'r', message: 'Not found.' }, {
      status: 404,
      statusText: 'Not Found'
    });
    await settle(fixture);
    expect(element().textContent).toContain(`${KEY}.errors.invalid`);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(fixture.componentInstance.accepted).toEqual([]);
  });

  it('shows other errors in a banner', async () => {
    await submit('a-setup-token-0123456789');
    http.expectOne(CHECK).flush({ code: 'rate-limited', params: {}, requestId: 'abcdef123456', message: 'x' }, {
      status: 429,
      statusText: 'Too Many Requests'
    });
    await settle(fixture);
    expect(element().querySelector('ui-inline-banner')?.textContent).toContain('abcdef12');
  });

  it('shows invalid setup token when the page says it was rejected', async () => {
    fixture.componentInstance.rejected.set(true);
    await settle(fixture);
    expect(element().textContent).toContain(`${KEY}.errors.invalid`);
  });
});
